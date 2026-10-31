"""The end of the order chain over the API: a credit note for a failed reprint, and goods received against a supplier PO. Real database (PGlite), no network."""
from decimal import Decimal
from uuid import uuid4

from support.fixtures import env, pg_url  # noqa: F401
from test_chain import go, mk
from test_chain_api import chain_of, err, hand_job, pay, pdf_of, proforma, quote_job
from test_revenue_api import WIN, report


def credit(e, job, amount="100.00", reason="Failed reprint of the bracket", who=None):
    return e.c.post(f"/api/jobs/{job}/credit-notes", json={"amount": amount, "reason": reason}, headers=who or e.O)


def invoiced(e, amount="1000.00"):
    j = hand_job(e, amount)
    assert e.c.post(f"/api/jobs/{j}/invoice", json={"override_reason": "collected by hand"}, headers=e.O).status_code == 201
    return j


def test_the_deposit_is_50_percent_unless_the_owner_or_the_quote_says_otherwise(env):
    e = env
    d = proforma(e, hand_job(e, "800.00")).json()
    assert d["extra"]["deposit_pct"] == "50" and d["extra"]["deposit_amount"] == "400.00"


def test_a_credit_note_lowers_what_is_owed_and_has_its_own_number_and_pdf(env):
    e = env
    j = invoiced(e)
    r = credit(e, j, "150.50")
    assert r.status_code == 201, r.text
    cn = r.json()
    assert cn["kind"] == "credit_note" and cn["doc_no"].startswith("CN-") and cn["total"] == "150.50"
    c = chain_of(e, j)
    assert Decimal(c["total"]) == Decimal("849.50") and Decimal(c["balance"]) == Decimal("849.50") and Decimal(c["credited"]) == Decimal("150.50")
    text = pdf_of(e, cn["id"])
    assert "Credit Note" in text and "bracket" in text
    assert credit(e, j, "10.00").json()["doc_no"].endswith("-0002")


def test_the_customer_can_then_pay_exactly_the_reduced_amount_and_no_more(env):
    e = env
    j = invoiced(e)
    assert credit(e, j, "200.00").status_code == 201
    assert pay(e, j, "800.01", purpose="balance").status_code in (409, 422)  # more than is now owed
    assert pay(e, j, "800.00", purpose="balance").status_code == 201
    assert chain_of(e, j)["stage"] == "paid"


def test_credit_note_rules(env):
    e = env
    err(credit(e, hand_job(e)), 409, "no_invoice")  # nothing to credit before an invoice
    j = invoiced(e)
    err(credit(e, j, "1000.00"), 409, "too_big")  # cancelling everything is a void, not a credit
    assert credit(e, j, "0").status_code == 422 and credit(e, j, "-5").status_code == 422 and credit(e, j, reason="x").status_code == 422
    assert pay(e, j, "700.00", purpose="balance").status_code == 201
    err(credit(e, j, "400.00"), 409, "already_paid")  # would leave the customer overpaid
    err(credit(e, j, "100.00", who=e.S), 403, "owner_only")
    assert credit(e, j, "300.00").status_code == 201  # exactly what is still owed


def test_voiding_a_credit_note_puts_the_amount_back(env):
    e = env
    j = invoiced(e)
    cn = credit(e, j, "250.00").json()
    assert e.c.post(f"/api/deal-docs/{cn['id']}/void", json={"reason": "customer changed mind"}, headers=e.O).status_code == 200
    c = chain_of(e, j)
    assert Decimal(c["total"]) == Decimal("1000.00") and Decimal(c["credited"]) == 0


def spo_with_two_lines(e, sent=True):
    sup = e.c.post("/api/contacts", json={"role": "supplier", "name": "Filament Supplier " + uuid4().hex[:6]}, headers=e.O).json()["id"]
    body = {"kind": "spo", "customer_id": sup, "lines": [{"description": "PLA filament, white", "qty": 10, "uom": "spool", "unit_price": "55.00"},
                                                          {"description": "PETG filament, black", "qty": 4, "uom": "spool", "unit_price": "62.00"}]}
    spo = e.c.post("/api/chain", json=body, headers=e.O).json()
    if sent:
        assert go(e, spo["id"], "pending_approval").status_code == 200 and go(e, spo["id"], "sent").status_code == 200
    return spo


def receive(e, spo, lines, who=None, note=None):
    return e.c.post(f"/api/chain/{spo}/receive", json={"lines": lines, "note": note}, headers=who or e.O)


def test_goods_received_in_parts_move_the_supplier_po_until_it_is_complete(env):
    e = env
    spo = spo_with_two_lines(e)
    r = receive(e, spo["id"], [{"no": 1, "qty": 6}])
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "partially_received" and r.json()["note"]["doc_no"].startswith("GRN-") and r.json()["note"]["parent_id"] == spo["id"]
    assert {x["no"]: x["left"] for x in r.json()["receiving"]} == {1: "4", 2: "4"}
    r = receive(e, spo["id"], [{"no": 1, "qty": 4}, {"no": 2, "qty": 4}], note="1 spool dented")
    assert r.json()["status"] == "received" and all(Decimal(x["left"]) == 0 for x in r.json()["receiving"])
    d = e.c.get(f"/api/chain/{spo['id']}", headers=e.O).json()
    assert d["status"] == "received" and [t["kind"] for t in d["trail"]] == ["spo", "grn", "grn"] and d["receiving"][0]["received"] == "10"


def test_goods_received_rules(env):
    e = env
    draft = spo_with_two_lines(e, sent=False)
    err(receive(e, draft["id"], [{"no": 1, "qty": 1}]), 409, "not_sent")  # nothing arrives against an unsent PO
    spo = spo_with_two_lines(e)
    err(receive(e, spo["id"], [{"no": 1, "qty": 11}]), 409, "too_many")  # cannot receive more than ordered
    err(receive(e, spo["id"], [{"no": 3, "qty": 1}]), 422, "bad_line")
    err(receive(e, spo["id"], [{"no": 1, "qty": 1}, {"no": 1, "qty": 1}]), 422, "bad_line")
    err(receive(e, spo["id"], [{"no": 1, "qty": 0}]), 422, "bad_qty")
    assert receive(e, spo["id"], []).status_code == 422
    assert e.sql("select count(*) n from chain_docs where kind='grn'")[0]["n"] == 0  # every refusal left nothing behind
    err(receive(e, mk(e, "so").json()["id"], [{"no": 1, "qty": 1}]), 409, "not_a_supplier_po")


def test_a_credit_note_carries_the_orders_share_of_sst(env):
    e = env
    j = quote_job(e)
    e.sql("update document_lines set tax_rate=8 where document_id=(select quote_id from jobs where id=%s)", (j,))
    e.sql("update tenants set sst_registered=true, sst_no='W10-1234567-89'")
    assert e.c.post(f"/api/jobs/{j}/invoice", json={"override_reason": "collected by hand"}, headers=e.O).status_code == 201
    total = Decimal(chain_of(e, j)["total"])
    cn = credit(e, j, str((total / 10).quantize(Decimal("0.01")))).json()
    assert cn["tax_total"] is not None and Decimal(cn["tax_total"]) > 0
    assert Decimal(cn["subtotal"]) + Decimal(cn["tax_total"]) == Decimal(cn["total"])
    assert abs(Decimal(cn["tax_total"]) / Decimal(cn["total"]) - Decimal("0.08") / Decimal("1.08")) < Decimal("0.001")  # the same share as the order's SST
    assert credit(e, invoiced(e), "100.00").json()["tax_total"] is None  # no SST on the order, none on the credit


def test_an_invoice_with_a_live_credit_note_cannot_be_voided_until_the_credit_note_is(env):
    e = env
    j = invoiced(e)
    cn = credit(e, j).json()
    inv = next(d for d in chain_of(e, j)["documents"] if d["kind"] == "invoice")
    err(e.c.post(f"/api/deal-docs/{inv['id']}/void", json={"reason": "wrong customer"}, headers=e.O), 409, "has_credit_notes")
    assert e.c.post(f"/api/deal-docs/{cn['id']}/void", json={"reason": "withdrawn"}, headers=e.O).status_code == 200
    assert e.c.post(f"/api/deal-docs/{inv['id']}/void", json={"reason": "wrong customer"}, headers=e.O).status_code == 200


def test_the_revenue_page_counts_sales_less_credit_notes(env):
    e = env
    j = invoiced(e)
    assert Decimal(report(e, *WIN).json()["sales"]) == Decimal("1000.00")
    assert credit(e, j, "150.00").status_code == 201
    r = report(e, *WIN).json()
    assert Decimal(r["sales"]) == Decimal("850.00") and Decimal(r["to_collect"]) == Decimal("850.00")
