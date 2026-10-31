"""Step 220, folded: customer PO, sales order and supplier PO: totals, state machines, numbering, the link to the order (jobs row), owner-only
approvals, tenant isolation. Proforma, delivery, invoice and payments are tested in test_chain_api / test_chain_delivery."""
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
    chain.check_move("spo", "draft", "pending_approval", owner=False)
    with pytest.raises(ApiError) as e:
        chain.check_move("spo", "draft", "sent", owner=True)
    assert e.value.status == 409
    with pytest.raises(ApiError) as e:
        chain.check_move("spo", "pending_approval", "sent", owner=False)
    assert e.value.status == 403
    chain.check_move("spo", "pending_approval", "sent", owner=True)
    for kind, flow in chain.FLOW.items():  # every kind starts somewhere that has a way out
        assert chain.START[kind] in flow
    # proforma, delivery order, invoice and receipt are deal_docs (api/chain.py), not chain_docs kinds
    assert set(chain.KINDS) == set(chain.FLOW) == set(chain.START) == {"cpo", "so", "spo", "grn"}
    assert not {"pf", "do", "inv", "rcp"} & set(chain.CONVERT["so"]) and chain.CONVERT["cpo"] == {"so"}


def test_ageing_buckets():
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


def job_of(e, doc):
    return e.sql("select job_id from chain_docs where id=%s", (doc,))[0]["job_id"]


def test_a_sales_order_is_an_order_and_the_old_money_paths_are_gone(env):
    e = env
    so = mk(e).json()
    assert so["doc_no"].startswith("SO-") and so["doc_no"].endswith("-0001") and so["total"] == "137.00" and so["status"] == "confirmed"
    assert mk(e).json()["doc_no"].endswith("-0002")  # gap-free numbering per kind (cpo / so / spo only)
    job = so["job_id"]
    assert job and e.sql("select amount from jobs where id=%s", (job,))[0]["amount"] == D("137.00")
    # the money for it lives on the job, through the order chain
    assert e.c.post(f"/api/jobs/{job}/proforma", json={"deposit_pct": 30}, headers=e.O).status_code == 201
    c = e.c.get(f"/api/jobs/{job}/chain", headers=e.O).json()
    assert c["total"] == "137.00" and c["job"]["quote_deposit_pct"] is None and c["job"]["customer"]
    assert e.c.get("/api/chain/receivables", headers=e.O).json()["deposits_waiting"] == 1  # the proforma's deposit is not recorded yet
    # their pf / do / inv / rcp paths are gone
    assert e.c.post(f"/api/chain/{so['id']}/payment", json={"amount": "1"}, headers=e.O).status_code in (404, 405)
    for to in ("pf", "do", "inv"):
        assert conv(e, so["id"], to).status_code == 422
    assert mk(e, "pf").status_code == 422
    assert e.c.get("/api/chain?kind=inv", headers=e.O).status_code == 422
    assert e.sql("select count(*) n from chain_docs where kind not in ('cpo','so','spo','grn')")[0]["n"] == 0
    # cancelling the order is refused once money is recorded on it
    assert e.c.post(f"/api/jobs/{job}/payments", headers=e.O, json={"amount": "10.00", "method": "cash", "paid_on": "2026-01-02", "purpose": "deposit", "idempotency_key": "k" * 12}).status_code == 201
    r = go(e, so["id"], "cancelled", reason="changed mind")
    assert r.status_code == 409 and r.json()["error"]["code"] == "has_payments"
    # staff may not see an order's chain without record_payments, whatever route they come by
    assert e.c.get("/api/chain/receivables", headers=e.S).status_code == 403


def test_receivables_come_from_the_order_chain_invoices_and_payments(env):
    e = env
    so = mk(e).json()
    job = so["job_id"]
    assert e.c.post(f"/api/jobs/{job}/invoice", json={"override_reason": "service, no delivery"}, headers=e.O).status_code == 201
    a = e.c.get("/api/chain/receivables", headers=e.O).json()
    assert a["total"] == "137.00" and a["buckets"]["current"]["count"] == 1  # the default invoice has no due date: current
    pay = e.c.post(f"/api/jobs/{job}/payments", headers=e.O, json={"amount": "37.00", "method": "cash", "paid_on": "2026-01-02", "purpose": "balance", "idempotency_key": "r" * 12})
    assert pay.status_code == 201
    assert e.c.get("/api/chain/receivables", headers=e.O).json()["total"] == "100.00"
    e.c.post(f"/api/jobs/{job}/payments", headers=e.O, json={"amount": "100.00", "method": "cash", "paid_on": "2026-01-02", "purpose": "balance", "idempotency_key": "s" * 12})
    assert e.c.get("/api/chain/receivables", headers=e.O).json()["total"] == "0"


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


def test_from_quote_joins_the_job_that_accept_made(env):
    e = env
    q = seed_quote(e)
    r = e.c.post(f"/api/chain/from-quote/{q}", json={}, headers=e.O)
    assert r.status_code == 409 and r.json()["error"]["code"] == "quote_not_accepted"
    assert tr(e, q, "accepted").status_code == 200
    job = e.sql("select id from jobs where quote_id=%s", (q,))[0]["id"]
    ok = e.c.post(f"/api/chain/from-quote/{q}", json={"to": "cpo", "ref": "PO-1"}, headers=e.O)
    assert ok.status_code == 201 and ok.json()["quote_id"] == str(q) and ok.json()["total"] != "0.00" and ok.json()["job_id"] == str(job)
    assert e.c.post(f"/api/chain/from-quote/{q}", json={"to": "cpo"}, headers=e.O).status_code == 409
    so = conv(e, ok.json()["id"], "so").json()  # PO -> SO keeps the same order
    assert so["job_id"] == str(job) and so["deal_id"] == ok.json()["deal_id"]
    assert e.sql("select count(*) n from jobs where quote_id=%s", (q,))[0]["n"] == 1
    assert e.sql("select count(*) n from jobs")[0]["n"] == 1  # no second order was made


def test_a_quote_without_an_order_row_cannot_start_a_chain(env):
    e = env
    q = seed_quote(e)
    assert tr(e, q, "accepted").status_code == 200
    e.sql("delete from jobs where quote_id=%s", (q,))
    assert e.c.post(f"/api/chain/from-quote/{q}", json={}, headers=e.O).json()["error"]["code"] == "no_order"


def test_a_supplier_po_that_serves_an_order_shares_its_job(env):
    e = env
    so = mk(e).json()
    sup = e.c.post("/api/contacts", json={"role": "supplier", "name": "Pasar " + uuid4().hex[:5]}, headers=e.O).json()["id"]
    spo = mk(e, "spo", sup, serves=so["id"]).json()
    assert spo["job_id"] == so["job_id"] and spo["deal_id"] == so["deal_id"]
    assert mk(e, "spo", sup).json()["job_id"] is None  # a stand-alone supplier PO has no order and makes none
    assert e.sql("select count(*) n from jobs")[0]["n"] == 1


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
