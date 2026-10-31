"""Step 220: quote-to-cash chain (PO, sales order, proforma, delivery order, invoice, receipt, supplier PO): totals, state machines, numbering,
partial deliveries, payments, owner-only approvals, tenant isolation."""
from decimal import Decimal as D

from uuid import uuid4

import pytest

from src import chain
from src.errors import ApiError
from support.fixtures import env, pg_url  # noqa: F401
from test_api import seed_quote, tr


# ---------------------------------------------------------------- pure rules
def L(q, p, d="x"):
    return {"description": d, "qty": str(q), "unit_price": str(p)}


def test_totals_discount_sst_and_five_sen_rounding():
    t = chain.totals([L(3, "10.10"), L(1, "0.03")], discount_pct=10, sst_rate=6)
    assert (t["subtotal"], t["discount"], t["sst"], t["total"]) == (D("30.33"), D("3.03"), D("1.64"), D("28.94"))
    r = chain.totals([L(3, "10.10"), L(1, "0.03")], discount_pct=10, sst_rate=6, round5=True)
    assert r["total"] == D("28.95") and r["rounding"] == D("0.01")
    assert chain.totals([L(1, "0.02")], round5=True)["total"] == D("0.00")  # 2 sen rounds down to 0


def test_lines_are_validated():
    for bad in ([], [{"description": "", "qty": 1}], [{"description": "a", "qty": 0}], [{"description": "a", "qty": 1, "unit_price": -1}],
                [{"description": "a", "qty": "x"}]):
        with pytest.raises(ApiError):
            chain.clean_lines(bad)
    assert chain.clean_lines([{"description": " a ", "qty": 2.0, "unit_price": "3"}])[0] == {"description": "a", "qty": "2", "uom": "unit", "unit_price": "3.00"}


def test_state_machines_refuse_illegal_moves_and_gate_owner_moves():
    chain.check_move("inv", "draft", "pending_approval", owner=False)
    with pytest.raises(ApiError) as e:
        chain.check_move("inv", "draft", "issued", owner=True)
    assert e.value.status == 409
    with pytest.raises(ApiError) as e:
        chain.check_move("inv", "pending_approval", "issued", owner=False)
    assert e.value.status == 403
    chain.check_move("inv", "pending_approval", "issued", owner=True)
    for kind, flow in chain.FLOW.items():  # every kind starts somewhere that has a way out, and terminal states have none
        assert chain.START[kind] in flow
    assert "paid" not in chain.FLOW["inv"] and "void" not in chain.FLOW["rcp"]


def test_overdue_and_ageing_buckets():
    from datetime import date
    today = date(2026, 3, 11)
    assert chain.effective_status("inv", "issued", date(2026, 3, 10), today) == "overdue"
    assert chain.effective_status("inv", "paid", date(2026, 3, 10), today) == "paid"
    assert [chain.ageing_bucket(n) for n in (-3, 0, 1, 30, 31, 60, 61)] == ["current", "current", "1-30", "1-30", "31-60", "31-60", "60+"]


# ---------------------------------------------------------------- API
def customer(e, name="Aisyah Catering"):
    r = e.c.post("/api/contacts", json={"role": "customer", "name": name + " " + uuid4().hex[:6]}, headers=e.O)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def mk(e, kind="so", cust=None, who=None, **extra):
    body = {"kind": kind, "customer_id": cust or customer(e, f"Cust {kind}"),
            "lines": [{"description": "Nasi lemak set", "qty": 10, "uom": "pax", "unit_price": "12.50"},
                      {"description": "Teh tarik", "qty": 4, "unit_price": "3"}], **extra}
    return e.c.post("/api/chain", json=body, headers=who or e.O)


def go(e, doc, to, who=None, **kw):
    return e.c.post(f"/api/chain/{doc}/transition", json={"to": to, **kw}, headers=who or e.O)


def conv(e, doc, to, who=None, **kw):
    return e.c.post(f"/api/chain/{doc}/convert", json={"to": to, **kw}, headers=who or e.O)


def test_full_chain_with_partial_deliveries_deposit_and_payments(env):
    e = env
    so = mk(e).json()
    assert so["doc_no"].startswith("SO-") and so["doc_no"].endswith("-0001") and so["total"] == "137.00" and so["status"] == "confirmed"
    assert mk(e).json()["doc_no"].endswith("-0002")  # gap-free numbering per kind
    # proforma asks for a 30% deposit; paying it issues a receipt and moves the proforma
    pf = conv(e, so["id"], "pf", deposit_pct=30).json()
    assert pf["status"] == "draft" and pf["deposit_pct"] == "30.00"
    assert go(e, pf["id"], "sent").status_code == 200
    assert e.c.post(f"/api/chain/{pf['id']}/payment", json={"amount": "50"}, headers=e.O).status_code == 409  # more than the 41.10 deposit
    p = e.c.post(f"/api/chain/{pf['id']}/payment", json={"amount": "41.10"}, headers=e.O)
    assert p.status_code == 201 and p.json()["document"]["status"] == "deposit_received" and p.json()["receipt"]["doc_no"].startswith("RCP-")
    # two partial deliveries; a third cannot exceed the order
    d1 = conv(e, so["id"], "do", qty={"1": 6}).json()
    assert [x["qty"] for x in d1["lines"]] == ["6"] and conv(e, so["id"], "do", qty={"1": 5}).status_code == 409
    assert go(e, d1["id"], "dispatched").status_code == 200 and go(e, d1["id"], "delivered").status_code == 200
    assert e.c.get(f"/api/chain/{so['id']}", headers=e.O).json()["status"] == "in_fulfilment"
    d2 = conv(e, so["id"], "do").json()  # everything still open: 4 nasi lemak and 4 teh tarik
    assert [x["qty"] for x in d2["lines"]] == ["4", "4"]
    go(e, d2["id"], "dispatched"), go(e, d2["id"], "delivered")
    assert e.c.get(f"/api/chain/{so['id']}", headers=e.O).json()["status"] == "fulfilled"
    # invoice only what was delivered; staff cannot issue it; two payments pay it
    inv = conv(e, d1["id"], "inv").json()
    assert inv["total"] == "75.00" and inv["due_on"] and conv(e, d1["id"], "inv").status_code == 409
    assert go(e, inv["id"], "pending_approval", who=e.S).status_code == 200
    assert go(e, inv["id"], "issued", who=e.S).status_code == 403
    assert go(e, inv["id"], "issued").status_code == 200
    r1 = e.c.post(f"/api/chain/{inv['id']}/payment", json={"amount": "25"}, headers=e.O).json()
    assert r1["document"]["status"] == "partially_paid" and r1["document"]["balance"] == "50.00"
    r2 = e.c.post(f"/api/chain/{inv['id']}/payment", json={"amount": "50", "method": "cash"}, headers=e.O).json()
    assert r2["document"]["status"] == "paid"
    assert e.c.post(f"/api/chain/{inv['id']}/payment", json={"amount": "1"}, headers=e.O).status_code == 409
    # voiding a receipt needs the owner and a reason, and puts the money back on the invoice
    assert go(e, r2["receipt"]["id"], "void", who=e.S).status_code == 403
    assert go(e, r2["receipt"]["id"], "void").status_code == 422
    assert go(e, r2["receipt"]["id"], "void", reason="wrong amount").status_code == 200
    assert e.c.get(f"/api/chain/{inv['id']}", headers=e.O).json()["status"] == "partially_paid"
    # the trail shows every document of the deal, and the history shows who did what
    t = e.c.get(f"/api/chain/{inv['id']}", headers=e.O).json()
    assert {x["kind"] for x in t["trail"]} == {"so", "pf", "do", "inv", "rcp"} and len(t["history"]) >= 3


def test_invoice_straight_from_a_service_order_and_not_after_deliveries(env):
    e = env
    so = mk(e).json()
    assert conv(e, so["id"], "inv").status_code == 201
    so2 = mk(e).json()
    conv(e, so2["id"], "do")
    assert conv(e, so2["id"], "inv").status_code == 409
    assert conv(e, so["id"], "so").status_code == 409  # illegal conversion
    assert conv(e, so["id"], "pf").status_code == 422  # a proforma needs its deposit


def test_customer_po_is_checked_for_duplicates_and_becomes_an_order(env):
    e = env
    c = customer(e)
    cpo = mk(e, "cpo", c, ref="PO-7781").json()
    assert cpo["status"] == "received" and mk(e, "cpo", c, ref="po-7781").status_code == 409
    assert mk(e, "cpo", customer(e, "Other"), ref="PO-7781").status_code == 201  # same number, different customer
    so = conv(e, cpo["id"], "so").json()
    assert so["parent_id"] == cpo["id"] and so["deal_id"] == cpo["deal_id"]
    assert e.c.get(f"/api/chain/{cpo['id']}", headers=e.O).json()["status"] == "confirmed"
    assert go(e, cpo["id"], "received").status_code == 409


def test_supplier_po_needs_a_supplier_and_owner_approval(env):
    e = env
    cust = customer(e)
    assert mk(e, "spo", cust).status_code == 422  # a customer is not a supplier
    sup = e.c.post("/api/contacts", json={"role": "supplier", "name": "Pasar Borong " + uuid4().hex[:5]}, headers=e.O).json()["id"]
    spo = mk(e, "spo", sup).json()
    assert spo["doc_no"].startswith("SPO-") and spo["status"] == "draft"
    assert go(e, spo["id"], "pending_approval", who=e.S).status_code == 200
    assert go(e, spo["id"], "sent", who=e.S).status_code == 403
    assert go(e, spo["id"], "sent").status_code == 200 and go(e, spo["id"], "partially_received").status_code == 200
    assert go(e, spo["id"], "draft").status_code == 409


def test_from_quote_needs_an_accepted_quote_and_only_once(env):
    e = env
    q = seed_quote(e)
    r = e.c.post(f"/api/chain/from-quote/{q}", json={}, headers=e.O)
    assert r.status_code == 409 and r.json()["error"]["code"] == "quote_not_accepted"
    assert tr(e, q, "accepted").status_code == 200
    ok = e.c.post(f"/api/chain/from-quote/{q}", json={"to": "cpo", "ref": "PO-1"}, headers=e.O)
    assert ok.status_code == 201 and ok.json()["quote_id"] == str(q) and ok.json()["total"] != "0.00"
    assert e.c.post(f"/api/chain/from-quote/{q}", json={"to": "cpo"}, headers=e.O).status_code == 409


def test_receivables_ageing_and_overdue(env):
    e = env
    so = mk(e).json()
    inv = conv(e, so["id"], "inv", due_in_days=0).json()
    go(e, inv["id"], "pending_approval"), go(e, inv["id"], "issued")
    e.sql("update chain_docs set due_on = current_date - 45 where id=%s", (inv["id"],))
    a = e.c.get("/api/chain/receivables", headers=e.O).json()
    assert a["buckets"]["31-60"] == {"count": 1, "outstanding": "137.00"} and a["total"] == "137.00"
    row = [x for x in e.c.get("/api/chain?kind=inv", headers=e.O).json() if x["id"] == inv["id"]][0]
    assert row["status_effective"] == "overdue" and row["days_overdue"] >= 44 and row["ageing"] == "31-60"
    assert len(e.c.get("/api/chain?status=overdue", headers=e.O).json()) == 1


def test_another_business_cannot_see_or_move_a_document(env):
    from test_rfq import other_tenant
    e = env
    so = mk(e).json()
    other = other_tenant(e)
    h = other
    r = e.c.get(f"/api/chain/{so['id']}", headers=h)
    assert r.status_code == 404
    assert e.c.post(f"/api/chain/{so['id']}/transition", json={"to": "cancelled", "reason": "x"}, headers=h).status_code == 404


def test_staff_cannot_cancel_an_order(env):
    e = env
    so = mk(e).json()
    assert go(e, so["id"], "cancelled", who=e.S, reason="x").status_code == 403
    assert go(e, so["id"], "cancelled", reason="customer changed mind").status_code == 200
