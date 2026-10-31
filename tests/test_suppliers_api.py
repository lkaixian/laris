"""Suppliers API: permissions, comparison, recommendation snapshot, contract flow (staff drafts, manager approves), in/out of contract, off-contract guard."""
from datetime import date, timedelta
from decimal import Decimal as D

from support.fixtures import env, pg_url  # noqa: F401


def setup(e):
    tid = e.sql("select id from tenants limit 1")[0]["id"]
    e.sql("select seed_supplier_demo(%s)", (tid,))
    pid = lambda n: str(e.sql("select id from products where name=%s", (n,))[0]["id"])
    sid = lambda n: str(e.sql("select id from parties where name like %s", (f"%{n}%",))[0]["id"])
    return pid, sid


def role(e, name, perms):
    rid = e.c.post("/api/roles", json={"name": name, "permissions": perms}, headers=e.O).json()["id"]
    uid = str(e.sql("insert into users(tenant_id,name,role,role_id) select tenant_id,%s,'staff',%s from users limit 1 returning id", (name, rid))[0]["id"])
    return {"X-Role": "staff", "X-User": uid}


def test_default_staff_cannot_see_supplier_prices(env):
    e = env
    setup(e)
    for path in ("/api/suppliers", "/api/products", "/api/contracts", "/api/suppliers/summary"):
        assert e.c.get(path, headers=e.S).status_code == 403
        assert e.c.get(path, headers=e.O).status_code == 200


def test_supplier_list_filters(env):
    e = env
    setup(e)
    allx = e.c.get("/api/suppliers", headers=e.O).json()
    assert len(allx) == 11  # 3 from the base seed + 8 demo
    halal = e.c.get("/api/suppliers?cert=halal&state=Selangor", headers=e.O).json()
    assert [x["name"][7:21] for x in halal] == ["Selangor Fresh"]
    st = {x["name"]: x["contract_status"] for x in allx}
    assert st["SAMPLE Selangor Fresh Wholesale (synthetic)"] == "expiring"  # contract ends in 20 days, notice 30
    assert e.c.get("/api/suppliers?contract=in_contract", headers=e.O).json()  # paper contract with Penang
    assert [x["standing"] for x in e.c.get("/api/suppliers?standing=blocked", headers=e.O).json()] == ["blocked"]


def test_oil_comparison_guardrails_and_winner_changes_with_quantity(env):
    e = env
    pid, _ = setup(e)
    oil = pid("Cooking oil 17kg")
    r = e.c.get(f"/api/products/{oil}/compare?qty=85&needed_by={date.today() + timedelta(days=3)}", headers=e.O).json()
    why = {x["supplier_name"][7:18]: x["why_not"] for x in r["disqualified"]}
    assert why["Johor Edibl"] == ["below_moq"] and why["Penang Trad"] == ["too_slow"] and why["KL Foodstuf"] == ["expired"] and why["Kedah Cheap"] == ["blocked"]
    assert r["recommended"]["supplier_name"].startswith("SAMPLE Perak")  # 5 x 67
    assert set(r["why"]) == {"en", "ms", "zh", "ta"} and "Perak" in r["why"]["en"]
    big = e.c.get(f"/api/products/{oil}/compare?qty=170", headers=e.O).json()  # 10 tins: Perak tier 61 and Johor MOQ met
    assert big["recommended"]["supplier_name"].startswith("SAMPLE Perak")
    assert next(x for x in big["qualified"] if x["supplier_name"].startswith("SAMPLE Johor"))["landed"]["total"] == "620.00"
    assert r["coverage"]["status"] == "expiring"
    assert r["contract"]["insight"]["market_cheaper"] is False


def test_delivery_fee_flips_and_carton_vs_kg(env):
    e = env
    pid, _ = setup(e)
    r = e.c.get(f"/api/products/{pid('Cooking oil 17kg')}/compare?qty=85", headers=e.O).json()
    order = [x["supplier_name"][7:18] for x in r["qualified"]]
    assert order.index("Melaka Dry ") > order.index("Selangor Fr")  # 65 + 40 delivery loses to 66 + 15
    ch = e.c.get(f"/api/products/{pid('Chicken breast, fresh')}/compare?qty=30", headers=e.O).json()
    assert ch["recommended"]["landed"]["per_base_unit"] and len(ch["qualified"]) >= 3


def test_bad_inputs_are_rejected(env):
    e = env
    pid, _ = setup(e)
    oil = pid("Cooking oil 17kg")
    assert e.c.get(f"/api/products/{oil}/compare?qty=0", headers=e.O).status_code == 422
    assert e.c.get(f"/api/products/{oil}/compare?qty=5&uom=l", headers=e.O).json()["error"]["code"] == "uom_mismatch"
    assert e.c.get(f"/api/products/{oil}/compare?qty=5&uom=bushel", headers=e.O).json()["error"]["code"] == "bad_uom"
    assert e.c.get("/api/products/00000000-0000-0000-0000-000000000000/compare", headers=e.O).status_code == 404
    assert e.c.get(f"/api/products/{oil}/compare?w_price=0&w_lead=0&w_reliability=0&w_terms=0", headers=e.O).status_code == 422


def test_recommendation_snapshot_is_stored(env):
    e = env
    pid, _ = setup(e)
    r = e.c.post(f"/api/products/{pid('Cooking oil 17kg')}/recommendation?qty=85", headers=e.O)
    assert r.status_code == 201 and set(r.json()["why"]) == {"en", "ms", "zh", "ta"}
    row = e.sql("select inputs, result from recommendations")[0]
    assert row["inputs"]["qty"] == "85" and row["result"]["ranking"] and row["result"]["disqualified"] and row["result"]["rules"]


def test_offer_upsert_validation_and_history(env):
    e = env
    pid, sid = setup(e)
    body = {"supplier_id": sid("Kedah"), "product_id": pid("Flour 25kg"), "pack_label": "bag", "pack_size": "25", "tiers": [[1, "50"]], "lead_days": 2, "delivery_fee": "0"}
    assert e.c.put("/api/offers", json=body, headers=e.S).status_code == 200  # manage_contacts is a staff default
    assert e.c.put("/api/offers", json={**body, "tiers": [[1, "50"], [1, "40"]]}, headers=e.O).json()["error"]["code"] == "bad_tiers"
    assert e.c.put("/api/offers", json={**body, "sst_rate": "2"}, headers=e.O).status_code == 422
    assert e.sql("select count(*) c from offer_history")[0]["c"] > 0


def test_contract_flow_staff_drafts_manager_approves_and_product_flips(env):
    e = env
    pid, sid = setup(e)
    buyer = role(e, "Buyer", ["manage_contracts"])
    mgr = role(e, "Manager", ["manage_contracts", "approve_contracts"])
    chk = pid("Chicken breast, fresh")
    assert e.c.get(f"/api/contracts/coverage?product_id={chk}", headers=e.O).json()["status"] == "not_in_contract"  # expired contract only
    t = date.today()
    body = {"supplier_id": sid("Sabah"), "name": "Chicken 2026-27", "items": [{"product_id": chk, "pack_size": "1", "price_per_pack": "10.4"}],
            "start_on": str(t), "end_on": str(t + timedelta(days=365)), "notice_days": 30, "value": "3000", "min_qty": "500", "max_qty": "1500"}
    cid = e.c.post("/api/contracts", json=body, headers=buyer).json()["id"]
    mv = lambda who, to, **k: e.c.post(f"/api/contracts/{cid}/transition", json={"to": to, **k}, headers=who)
    assert mv(buyer, "active").json()["error"]["code"] == "bad_transition"  # cannot skip approval
    assert mv(buyer, "pending_approval").status_code == 200
    assert mv(buyer, "active").json()["error"]["code"] == "self_approval"
    assert mv(e.S, "active").status_code == 403
    assert mv(mgr, "active").status_code == 200
    assert e.c.get(f"/api/contracts/coverage?product_id={chk}", headers=e.O).json()["status"] == "in_contract"
    assert mv(mgr, "terminated", reason="x").json()["error"]["code"] == "owner_only"
    assert mv(e.O, "terminated").json()["error"]["code"] == "bad_transition"  # a reason is needed
    ev = e.c.get(f"/api/contracts/{cid}", headers=e.O).json()["events"]
    assert [x["to_state"] for x in ev] == ["draft", "pending_approval", "active"]
    assert e.sql("select count(*) c from audit_log where entity='contracts' and entity_id=%s", (cid,))[0]["c"] >= 3


def test_manager_limit_sends_big_contracts_to_the_owner(env):
    e = env
    pid, sid = setup(e)
    mgr = role(e, "Manager", ["manage_contracts", "approve_contracts"])
    drafter = role(e, "Drafter", ["manage_contracts"])
    t = date.today()
    body = {"supplier_id": sid("Sabah"), "name": "Big", "items": [{"product_id": pid("Flour 25kg"), "pack_size": "25", "price_per_pack": "50"}],
            "start_on": str(t), "end_on": str(t + timedelta(days=100)), "value": "50000"}
    cid = e.c.post("/api/contracts", json=body, headers=drafter).json()["id"]
    e.c.post(f"/api/contracts/{cid}/transition", json={"to": "pending_approval"}, headers=drafter)
    assert e.c.post(f"/api/contracts/{cid}/transition", json={"to": "active"}, headers=mgr).json()["error"]["code"] == "approval_limit"
    assert e.c.post(f"/api/contracts/{cid}/transition", json={"to": "active"}, headers=e.O).status_code == 200


def test_contract_validation(env):
    e = env
    pid, sid = setup(e)
    t = date.today()
    ok = {"supplier_id": sid("Sabah"), "name": "x", "items": [{"product_id": pid("Flour 25kg"), "price_per_pack": "50"}], "start_on": str(t), "end_on": str(t + timedelta(days=10))}
    assert e.c.post("/api/contracts", json={**ok, "end_on": str(t)}, headers=e.O).json()["error"]["code"] == "bad_dates"
    assert e.c.post("/api/contracts", json={**ok, "min_qty": "10", "max_qty": "5"}, headers=e.O).json()["error"]["code"] == "bad_volume"
    assert e.c.post("/api/contracts", json={**ok, "items": []}, headers=e.O).status_code == 422
    assert e.c.post("/api/contracts", json=ok, headers=e.S).status_code == 403


def test_timeline_has_durations_gaps_and_reminders(env):
    e = env
    setup(e)
    tl = e.c.get("/api/contracts/timeline", headers=e.O).json()
    flat = [c for lane in tl["lanes"] for c in lane["contracts"]]
    exp = next(c for c in flat if c["name"] == "Cooking oil supply 2026")
    assert exp["days_left"] == 20 and exp["state"] == "expiring" and exp["notice_deadline"] == str(date.today() - timedelta(days=10))
    assert [m["kind"] for m in exp["milestones"]][-1] == "end"
    assert any(c["name"] == "Flour 12-month supply" and c["state"] == "active" and c["start"] > tl["today"] for c in flat)
    assert any(c["state"] == "expired" for c in flat)
    assert tl["coverage"] and tl["reminders"]
    assert e.c.get("/api/contracts/timeline?group=product", headers=e.O).status_code == 200


def test_off_contract_guard_and_approval(env):
    e = env
    pid, sid = setup(e)
    buyer = role(e, "Buyer", ["manage_contracts"])
    mgr = role(e, "Mgr", ["manage_contracts", "approve_contracts"])
    oil = pid("Cooking oil 17kg")
    other = {"product_id": oil, "supplier_id": sid("Perak"), "qty": "85", "amount": "335"}
    chk = e.c.post("/api/purchases/check", json=other, headers=buyer).json()
    assert chk["guard"]["needs_approval"] is True
    assert e.c.post("/api/purchases", json=other, headers=buyer).json()["error"]["code"] == "reason_needed"
    p = e.c.post("/api/purchases", json={**other, "reason": "urgent"}, headers=buyer).json()
    assert p["status"] == "pending" and p["off_contract"]
    assert e.c.get("/api/suppliers/summary", headers=e.O).json()["needs_you"]["off_contract_orders_pending"] == 1
    assert e.c.post(f"/api/purchases/{p['id']}/decide?approve=true", headers=buyer).status_code == 403
    assert e.c.post(f"/api/purchases/{p['id']}/decide?approve=true", headers=mgr).json()["status"] == "approved"
    own = e.c.post("/api/purchases", json={**other, "supplier_id": sid("Selangor")}, headers=buyer).json()  # the contracted supplier: no guard
    assert own["status"] == "approved" and own["contract_id"] and not own["off_contract"]
    assert e.sql("select count(*) c from contract_usage where contract_id=%s", (own["contract_id"],))[0]["c"] == 5
    boss = e.c.post("/api/purchases", json={**other, "reason": "owner decision"}, headers=e.O).json()
    assert boss["status"] == "approved"


def test_nudge_and_summary(env):
    e = env
    setup(e)
    n = e.c.get("/api/purchases/nudges", headers=e.O).json()
    assert len(n) == 1 and n[0]["product_name"] == "Takeaway box 750ml" and n[0]["count"] == 6 and D(n[0]["spend"]) == D("4200")
    s = e.c.get("/api/suppliers/summary", headers=e.O).json()
    assert s["suppliers"] == 11 and s["active_contracts"] == 2 and s["expiring_90"] >= 1 and s["by_status"]["expired"] == 1


def test_market_cheaper_than_contract_and_renewal_pack(env):
    e = env
    setup(e)
    pap = e.sql("select c.id from contracts c where name='A4 paper 2026'")[0]["id"]
    c = e.c.get(f"/api/contracts/{pap}", headers=e.O).json()
    assert c["market"][0]["market_cheaper"] is True and "review_in_days" in c["market"][0] and "Not legal advice" in c["boundary"]
    rp = e.c.get(f"/api/contracts/{pap}/renewal-pack", headers=e.O).json()
    assert rp["options"] == ["renew_as_is", "renegotiate", "switch_supplier"] and rp["market"][0]["suggested_target_per_pack"]


def test_tenants_are_isolated(env):
    e = env
    setup(e)
    other = e.sql("insert into tenants(name,trade_template,min_margin_pct) select 'Other Co', trade_template, 20 from tenants limit 1 returning id")[0]["id"]
    e.sql("select seed_supplier_demo(%s)", (other,))
    assert e.sql("select count(*) c from products")[0]["c"] == 10
    assert len(e.c.get("/api/products", headers=e.O).json()) == 5


def test_demo_loader_is_owner_only_and_idempotent(env):
    e = env
    assert e.c.post("/api/suppliers-demo", headers=e.S).status_code == 403
    assert e.c.post("/api/suppliers-demo", headers=e.O).status_code == 201
    assert e.c.post("/api/suppliers-demo", headers=e.O).status_code == 201
    assert len(e.c.get("/api/products", headers=e.O).json()) == 5


def test_offer_to_cost_book(env):
    e = env
    setup(e)
    oid = e.sql("select o.id from supplier_offers o join products p on p.id=o.product_id where p.name='Flour 25kg' limit 1")[0]["id"]
    assert e.c.post(f"/api/offers/{oid}/to-cost-book", headers=e.S).status_code == 403
    r = e.c.post(f"/api/offers/{oid}/to-cost-book", headers=e.O)
    assert r.status_code == 200, r.text
    assert e.sql("select count(*) c from cost_items where item_key='flour_25kg'")[0]["c"] >= 1


def test_pending_list_and_event_order(env):
    e = env
    pid, sid = setup(e)
    buyer = role(e, "Buyer", ["manage_contracts"])
    other = {"product_id": pid("Cooking oil 17kg"), "supplier_id": sid("Perak"), "qty": "85", "amount": "335", "reason": "urgent"}
    e.c.post("/api/purchases", json=other, headers=buyer)
    p = e.c.get("/api/purchases/pending", headers=e.O).json()
    assert len(p) == 1 and p[0]["reason"] == "urgent" and p[0]["product_name"] == "Cooking oil 17kg"
    cid = e.sql("select id from contracts where name='Cooking oil supply 2026'")[0]["id"]
    ev = e.c.get(f"/api/contracts/{cid}", headers=e.O).json()["events"]
    assert [x["to_state"] for x in ev] == ["draft", "pending_approval", "active"]


def test_savings_this_month_counts_only_real_cheaper_orders(env):
    e = env
    pid, sid = setup(e)
    before = D(e.c.get("/api/suppliers/summary", headers=e.O).json()["savings_this_month"])
    e.c.post(f"/api/products/{pid('Takeaway box 750ml')}/recommendation?qty=100", headers=e.O)  # advice nobody acted on, saved twice
    e.c.post(f"/api/products/{pid('Takeaway box 750ml')}/recommendation?qty=100", headers=e.O)
    assert D(e.c.get("/api/suppliers/summary", headers=e.O).json()["savings_this_month"]) == before
    p = e.c.post("/api/products", json={"name": "Savings probe", "base_uom": "kg"}, headers=e.O).json()["id"]
    today = e.sql("select (now() at time zone 'Asia/Kuala_Lumpur')::date d")[0]["d"]
    tid = e.sql("select id from tenants limit 1")[0]["id"]
    s_ = sid("Selangor")
    buy = lambda on, amt, st="approved": e.sql("insert into purchases(tenant_id,product_id,supplier_id,bought_on,qty,amount,status) values (%s,%s,%s,%s,10,%s,%s)", (tid, p, s_, on, amt, st))
    buy(today - timedelta(days=40), 100)     # last paid: 10.00 a kg
    buy(today, 80)                           # now 8.00 a kg: 20.00 saved
    buy(today, 50, "pending")                # not approved: counts for nothing
    buy(today, 120)                          # dearer than last paid: never a negative saving
    assert D(e.c.get("/api/suppliers/summary", headers=e.O).json()["savings_this_month"]) - before == D("20")
