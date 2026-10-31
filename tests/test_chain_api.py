"""Order chain steps 1-2 over the API: proforma, deposit math, payments with receipts, reversal, the chain view, the slip proposal, PDFs from the
layout snapshot, and who may do what. No network (OCR and ILMU are the fakes of support/fixtures)."""
import io
import threading
from decimal import Decimal

import pytest
from psycopg.types.json import Jsonb
from pypdf import PdfReader

from src import doc_layout
from src.api import chain
from support.fixtures import env, pg_url  # noqa: F401
from test_api import seed_quote, tr
from test_roles import member, role

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def hand_job(e, amount="1000.01", title="Shopfront sign", who=None):
    r = e.c.post("/api/jobs", json={"title": title, "amount": amount}, headers=who or e.O)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def quote_job(e, pct=30):
    q = seed_quote(e)
    assert tr(e, q, "accepted").status_code == 200
    e.sql("update documents set deposit_pct=%s where id=%s", (pct, q))
    return e.sql("select id from jobs where quote_id=%s", (q,))[0]["id"]


def proforma(e, job, who=None, **body):
    return e.c.post(f"/api/jobs/{job}/proforma", json=body, headers=who or e.O)


def pay(e, job, amount="300.00", key=None, who=None, **kw):
    body = {"amount": amount, "method": "transfer", "paid_on": "2026-01-02", "purpose": "deposit", "idempotency_key": key or f"key-{amount}-{job}", **kw}
    return e.c.post(f"/api/jobs/{job}/payments", json=body, headers=who or e.O)


def chain_of(e, job, who=None):
    r = e.c.get(f"/api/jobs/{job}/chain", headers=who or e.O)
    assert r.status_code == 200, r.text
    return r.json()


def text(pdf: bytes) -> str:
    return "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(pdf)).pages)


def pdf_of(e, doc_id, who=None):
    r = e.c.get(f"/api/deal-docs/{doc_id}/pdf", headers=who or e.O)
    assert r.status_code == 200 and r.content[:4] == b"%PDF", r.text[:200]
    return text(r.content)


def err(r, status, code):
    assert r.status_code == status and r.json()["error"]["code"] == code, r.text


def count(e, table, where="true"):
    return e.sql(f"select count(*) n from {table} where {where}")[0]["n"]


# ---------------------------------------------------------------- proforma and deposit math
def test_deposit_is_exact_to_the_cent_and_rounds_half_up(env):
    e = env
    j = hand_job(e, "1000.01")
    r = proforma(e, j, deposit_pct=30)
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["extra"] == {"deposit_pct": "30", "deposit_amount": "300.00"}  # 300.003 -> 300.00
    assert d["kind"] == "proforma" and d["status"] == "issued" and d["total"] == "1000.01" and d["tax_total"] is None
    assert d["doc_no"].startswith("PF-") and d["doc_no"].endswith("-0001")
    k = hand_job(e, "10.05")
    assert proforma(e, k, deposit_pct=50).json()["extra"]["deposit_amount"] == "5.03"  # 5.025 is a half: up, not banker's
    assert chain.money(Decimal("2.675")) == Decimal("2.68") and chain.money(Decimal("0.004")) == Decimal("0.00")
    c = chain_of(e, j)
    assert c["total"] == "1000.01" and c["deposit"] == {"pct": "30", "amount": "300.00", "paid": "0"} and c["stage"] == "awaiting_deposit"


def test_proforma_from_a_quote_uses_its_deposit_pct_and_the_owner_may_override(env):
    e = env
    j = quote_job(e, pct=30)
    d = proforma(e, j).json()
    total = Decimal(chain_of(e, j)["total"])
    assert d["extra"]["deposit_pct"] == "30" and Decimal(d["extra"]["deposit_amount"]) == (total * 30 / 100).quantize(Decimal("0.01"), "ROUND_HALF_UP")
    assert d["tax_total"] is None  # the business is not SST-registered: no estimated tax line
    k = quote_job_second(e)
    assert Decimal(proforma(e, k, deposit_pct=50).json()["extra"]["deposit_amount"]) == (Decimal(chain_of(e, k)["total"]) / 2).quantize(Decimal("0.01"), "ROUND_HALF_UP")


def quote_job_second(e):
    """A second order from a second accepted quote, 10% deposit on the quote itself."""
    q = e.sql("""insert into documents(tenant_id, direction, kind, party_id, status, doc_no, currency, deposit_pct)
                 select tenant_id, 'out', 'quotation', party_id, 'accepted', 'QT-X-0002', currency, 10 from documents where direction='out' limit 1 returning id""")[0]["id"]
    e.sql("insert into document_lines(document_id, line_no, description, qty, uom, unit_price) values (%s, 1, 'Banner', 3, 'pcs', 33.33)", (q,))
    return e.sql("insert into jobs(tenant_id, quote_id) select tenant_id, id from documents where id=%s returning id", (q,))[0]["id"]


def test_sst_line_only_for_a_registered_business_using_the_quotes_rates(env):
    e = env
    j = quote_job(e)
    e.sql("update document_lines set tax_rate=8 where document_id=(select quote_id from jobs where id=%s)", (j,))
    assert proforma(e, j).json()["tax_total"] is None  # rates on the lines, but the business is not registered
    e.sql("update deal_docs set status='void', void_reason='x', voided_at=now()")
    e.sql("update tenants set sst_registered=true, sst_no='W10-1234567-89'")
    e.sql("update jobs set order_total=null")  # not frozen yet in this test's story
    d = proforma(e, j).json()
    assert Decimal(d["tax_total"]) > 0 and Decimal(d["total"]) == Decimal(d["subtotal"]) + Decimal(d["tax_total"])
    assert "SST (estimate)" in pdf_of(e, d["id"]) and "not a tax invoice" in pdf_of(e, d["id"]).lower()


def test_one_live_proforma_per_order_and_void_frees_it(env):
    e = env
    j = hand_job(e)
    first = proforma(e, j, deposit_pct=30).json()
    err(proforma(e, j, deposit_pct=30), 409, "already_issued")
    assert count(e, "deal_docs", "kind='proforma'") == 1
    err(e.c.post(f"/api/deal-docs/{first['id']}/void", json={"reason": "wrong pct"}, headers=e.S), 403, "owner_only")
    assert e.c.post(f"/api/deal-docs/{first['id']}/void", json={"reason": "wrong pct"}, headers=e.O).status_code == 200
    err(e.c.post(f"/api/deal-docs/{first['id']}/void", json={"reason": "wrong pct"}, headers=e.O), 409, "already_void")
    second = proforma(e, j, deposit_pct=20).json()
    assert second["doc_no"].endswith("-0002") and second["extra"]["deposit_amount"] == "200.00"
    assert chain_of(e, j)["deposit"]["amount"] == "200.00"  # the live one counts, the voided one does not


def test_proforma_needs_a_pct_and_an_amount_and_is_owner_only(env):
    e = env
    err(proforma(e, hand_job(e)), 422, "deposit_pct_needed")  # a hand-made job has no quote to take a pct from
    err(proforma(e, hand_job(e), who=e.S, deposit_pct=10), 403, "owner_only")
    assert proforma(e, hand_job(e), deposit_pct=101).status_code == 422
    err(proforma(e, "00000000-0000-0000-0000-000000000000", deposit_pct=10), 404, "not_found")
    j = e.sql("insert into jobs(tenant_id, title) select id, 'no amount' from tenants returning id")[0]["id"]
    err(proforma(e, j, deposit_pct=10), 409, "no_amount")


# ---------------------------------------------------------------- payments, receipts, idempotency
def test_a_payment_issues_a_deposit_receipt_and_the_same_key_returns_the_first_result(env):
    e = env
    j = hand_job(e, "1000.00")
    proforma(e, j, deposit_pct=30)
    a = pay(e, j, "300.00", key="dep-key-0001", reference="TRX 99")
    assert a.status_code == 201, a.text
    body = a.json()
    assert body["payment"]["amount"] == "300.00" and body["payment"]["reference"] == "TRX 99" and body["payment"]["purpose"] == "deposit"
    assert body["receipt"]["doc_no"].startswith("RC-") and body["receipt"]["status"] == "issued"
    b = pay(e, j, "300.00", key="dep-key-0001")  # a double tap / retry
    assert b.status_code == 200 and b.json() == body
    assert pay(e, j, "999.00", key="dep-key-0001").json() == body  # whatever the replay says, the first result stands
    assert count(e, "payments") == 1 and count(e, "deal_docs", "kind='receipt'") == 1
    other = hand_job(e, "50.00")
    err(pay(e, other, "10.00", key="dep-key-0001"), 409, "key_reused")
    c = chain_of(e, j)
    assert c["paid"] == "300.00" and c["balance"] == "700.00" and c["stage"] == "in_production" and c["deposit"]["paid"] == "300.00"
    t = pdf_of(e, body["receipt"]["id"])
    assert "Deposit receipt, not a tax invoice" in t and "300.00" in t and "700.00" in t and "TRX 99" in t


def test_balance_payment_issues_its_receipt_and_the_order_is_paid(env):
    e = env
    j = hand_job(e, "1000.00")
    proforma(e, j, deposit_pct=30)
    assert chain_of(e, j)["stage"] == "awaiting_deposit"
    pay(e, j, "300.00", key="dep-key-0001")
    r = pay(e, j, "700.00", key="bal-key-0001", purpose="balance", method="cash")
    assert r.status_code == 201
    c = chain_of(e, j)
    assert c["stage"] == "paid" and c["balance"] == "0.00" and [d["kind"] for d in c["documents"]] == ["proforma", "receipt", "receipt"]
    assert "PAID" in pdf_of(e, r.json()["receipt"]["id"]) and "Deposit receipt" not in pdf_of(e, r.json()["receipt"]["id"])
    nums = [d["doc_no"] for d in c["documents"] if d["kind"] == "receipt"]
    assert nums[0].endswith("-0001") and nums[1].endswith("-0002")


def test_payment_input_is_checked(env):
    e = env
    j = hand_job(e, "100.00")
    for bad in ({"amount": "0"}, {"amount": "-5"}, {"amount": "1.001"}, {"method": "bitcoin"}, {"purpose": "tip"}, {"idempotency_key": "short"},
                {"paid_on": "not a date"}, {"reference": "x" * 101}, {"surprise": 1}):
        ok = {"amount": "10.00", "method": "cash", "paid_on": "2026-01-02", "purpose": "deposit", "idempotency_key": "valid-key-1"}
        assert e.c.post(f"/api/jobs/{j}/payments", json={**ok, **bad}, headers=e.O).status_code == 422, bad
    err(pay(e, j, "10.00", key="valid-key-1", paid_on="2999-01-01"), 422, "future_date")
    assert count(e, "payments") == 0
    no_amount = e.sql("insert into jobs(tenant_id, title) select id, 'nothing agreed' from tenants returning id")[0]["id"]
    err(pay(e, no_amount, "10.00"), 409, "no_amount")


def test_overpayment_is_blocked_by_the_api_and_the_database(env):
    e = env
    j = hand_job(e, "1000.00")
    assert pay(e, j, "600.00", key="first-key-01").status_code == 201
    r = pay(e, j, "400.01", key="second-key-1")
    assert r.status_code == 409 and "overpayment" in r.json()["error"]["message"] and "400.00" in r.json()["error"]["message"]
    assert pay(e, j, "400.00", key="third-key-01").status_code == 201
    assert pay(e, j, "0.01", key="fourth-key-1").status_code == 409
    assert count(e, "payments") == 2
    with pytest.raises(Exception, match="overpayment"):  # the same rule without the API
        e.sql("insert into payments(tenant_id, job_id, amount, method, paid_on, purpose, idempotency_key) "
              "select tenant_id, id, 5, 'cash', current_date, 'balance', 'direct-insert-1' from jobs where id=%s", (j,))


def test_two_payments_racing_for_the_same_balance_cannot_both_land(env):
    e = env
    j = hand_job(e, "1000.00")
    out, barrier = [], threading.Barrier(2)

    def go(n):
        barrier.wait()
        out.append(pay(e, j, "600.00", key=f"race-key-{n}").status_code)
    ts = [threading.Thread(target=go, args=(n,)) for n in range(2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(out) == [201, 409]
    assert e.sql("select sum(amount) s from payments")[0]["s"] == Decimal("600.00")
    out.clear()
    ts = [threading.Thread(target=lambda: (barrier.wait(), out.append(pay(e, j, "100.00", key="same-key-001").status_code))) for _ in range(2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(out) == [200, 201] and count(e, "payments") == 2  # a raced replay is still one payment


def test_reversal_restores_the_balance_voids_the_receipt_and_is_owner_only(env):
    e = env
    j = hand_job(e, "1000.00")
    proforma(e, j, deposit_pct=30)
    p = pay(e, j, "300.00", key="dep-key-0001").json()
    url = f"/api/payments/{p['payment']['id']}/reverse"
    err(e.c.post(url, json={"reason": "bounced"}, headers=e.S), 403, "owner_only")
    assert e.c.post(url, json={"reason": "x"}, headers=e.O).status_code == 422  # a reason of some substance
    r = e.c.post(url, json={"reason": "cheque bounced"}, headers=e.O)
    assert r.status_code == 201, r.text
    assert r.json()["voided_receipt"] == p["receipt"]["doc_no"] and r.json()["paid"] == "0.00"
    c = chain_of(e, j)
    assert c["paid"] == "0.00" and c["balance"] == "1000.00" and c["stage"] == "awaiting_deposit"
    rc = next(d for d in c["documents"] if d["kind"] == "receipt")
    assert rc["status"] == "void" and "cheque bounced" in rc["void_reason"]
    assert [x["reversed"] for x in c["payments"]] == [True, False] and c["payments"][1]["reverses_payment_id"] == p["payment"]["id"]
    assert count(e, "payments") == 2  # the original stays; a row was added
    err(e.c.post(url, json={"reason": "again"}, headers=e.O), 409, "not_reversible")
    err(e.c.post(f"/api/payments/{r.json()['reversal']['id']}/reverse", json={"reason": "undo it"}, headers=e.O), 409, "not_reversible")
    assert pay(e, j, "1000.00", key="whole-key-01", purpose="balance").status_code == 201  # the reversed money no longer counts against the cap
    err(e.c.post(f"/api/deal-docs/{rc['id']}/void", json={"reason": "just void"}, headers=e.O), 409, "reverse_payment")
    ev = [x["event"] for x in e.c.get("/api/audit", headers=e.O).json() if x["entity"] == "jobs"]
    assert any(x.startswith("proforma PF-") and "deposit RM300.00 (30%)" in x for x in ev)
    assert any(x.startswith("payment of RM300.00 recorded (deposit, transfer); receipt RC-") for x in ev)
    assert any(x.startswith("payment of RM300.00 reversed: cheque bounced; receipt RC-") and x.endswith("voided") for x in ev)


def test_a_proforma_cannot_be_voided_once_money_is_on_the_order(env):
    e = env
    j = hand_job(e, "1000.00")
    pf = proforma(e, j, deposit_pct=30).json()
    p = pay(e, j, "300.00", key="dep-key-0001").json()
    err(e.c.post(f"/api/deal-docs/{pf['id']}/void", json={"reason": "change it"}, headers=e.O), 409, "has_payments")
    e.c.post(f"/api/payments/{p['payment']['id']}/reverse", json={"reason": "refunded"}, headers=e.O)
    assert e.c.post(f"/api/deal-docs/{pf['id']}/void", json={"reason": "change it"}, headers=e.O).status_code == 200


# ---------------------------------------------------------------- numbering
def test_numbers_run_per_kind_and_year_and_follow_the_tenants_prefix(env):
    e = env
    a, b, c = hand_job(e, "10.00"), hand_job(e, "20.00"), hand_job(e, "30.00")
    nos = [proforma(e, j, deposit_pct=10).json()["doc_no"] for j in (a, b)]
    assert [n.rsplit("-", 1)[1] for n in nos] == ["0001", "0002"]
    r1 = pay(e, a, "1.00", key="rc-key-0001").json()["receipt"]["doc_no"]
    assert r1.endswith("-0001") and r1.startswith("RC-")  # receipts count on their own
    assert e.c.post("/api/settings", json={"proforma_prefix": "PRO", "receipt_prefix": "OR-9", "doc_language": "ms"}, headers=e.O).status_code == 200
    assert proforma(e, c, deposit_pct=10).json()["doc_no"].startswith("PRO-") and proforma(e, c, deposit_pct=10).status_code == 409
    d = pay(e, b, "2.00", key="rc-key-0002").json()["receipt"]["doc_no"]
    assert d.startswith("OR-9-") and d.endswith("-0002")  # the sequence carries on across a prefix change
    for bad in ({"proforma_prefix": "pf"}, {"invoice_prefix": "TOOLONG123"}, {"receipt_prefix": "A B"}, {"doc_language": "fr"}):
        assert e.c.post("/api/settings", json=bad, headers=e.O).status_code == 422, bad
    assert e.c.post("/api/settings", json={"proforma_prefix": None, "receipt_prefix": None, "doc_language": None}, headers=e.O).json()["proforma_prefix"] == "PF"
    assert e.c.get("/api/settings", headers=e.O).json()["doc_language"] == "en"


def test_parallel_issues_never_share_a_number(env):
    e = env
    jobs = [hand_job(e, "10.00", title=f"Job {n}") for n in range(4)]
    out, barrier = [], threading.Barrier(4)

    def go(j):
        barrier.wait()
        out.append(proforma(e, j, deposit_pct=10).json()["doc_no"])
    ts = [threading.Thread(target=go, args=(j,)) for j in jobs]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(n.rsplit("-", 1)[1] for n in out) == ["0001", "0002", "0003", "0004"]


# ---------------------------------------------------------------- who may do what
def test_staff_without_record_payments_get_403_and_no_data(env):
    e = env
    j = hand_job(e, "1234.56")
    pf = proforma(e, j, deposit_pct=30).json()
    p = pay(e, j, "370.37", key="dep-key-0001").json()
    nobody = member(e, role(e, "Nothing", []))
    mine = [("GET", f"/api/jobs/{j}/chain", {}), ("GET", f"/api/deal-docs/{pf['id']}/pdf", {}), ("GET", f"/api/deal-docs/{p['receipt']['id']}/pdf", {}),
            ("POST", f"/api/jobs/{j}/payments", {"json": {"amount": "1.00", "method": "cash", "paid_on": "2026-01-01", "purpose": "deposit", "idempotency_key": "staff-key-01"}}),
            ("POST", "/api/payments/propose-from-slip", {"files": {"image": ("s.jpg", JPEG, "image/jpeg")}}),
            ("POST", f"/api/jobs/{j}/proforma", {"json": {"deposit_pct": 5}}), ("POST", f"/api/payments/{p['payment']['id']}/reverse", {"json": {"reason": "mine now"}}),
            ("POST", f"/api/deal-docs/{pf['id']}/void", {"json": {"reason": "mine now"}}), ("PUT", "/api/settings/doc-layout/proforma", {"json": {}}),
            ("GET", "/api/settings/doc-layout/proforma", {})]
    for who in (e.S, nobody):
        for m, url, kw in mine:
            r = e.c.request(m, url, headers=who, **kw)
            assert r.status_code == 403 and r.json()["error"]["code"] in ("permission_required", "owner_only"), (m, url, r.status_code)
            assert not any(s in r.text for s in ("1234.56", "370.37", pf["doc_no"], "Shopfront", "TRX")), r.text
    assert count(e, "payments") == 1


def test_record_payments_role_records_but_cannot_issue_reverse_or_void(env):
    e = env
    j = hand_job(e, "1000.00")
    pf = proforma(e, j, deposit_pct=30).json()
    clerk = member(e, role(e, "Clerk", ["record_payments"]), "Clerk")
    r = pay(e, j, "300.00", key="clerk-key-01", who=clerk)
    assert r.status_code == 201 and chain_of(e, j, clerk)["paid"] == "300.00"
    assert pdf_of(e, pf["id"], clerk) and pdf_of(e, r.json()["receipt"]["id"], clerk)
    err(proforma(e, hand_job(e), who=clerk, deposit_pct=10), 403, "owner_only")
    err(e.c.post(f"/api/payments/{r.json()['payment']['id']}/reverse", json={"reason": "mine now"}, headers=clerk), 403, "owner_only")
    err(e.c.post(f"/api/deal-docs/{pf['id']}/void", json={"reason": "mine now"}, headers=clerk), 403, "owner_only")
    ev = [x for x in e.c.get("/api/audit", headers=e.O).json() if x["event"].startswith("payment of")]
    assert ev and ev[0]["actor"]


def test_the_catalog_lists_the_new_permissions_default_off(env):
    e = env
    cat = {x["key"]: x for x in e.c.get("/api/roles", headers=e.O).json()["catalog"]}
    assert cat["record_payments"]["default"] is False and cat["issue_delivery"]["default"] is False
    got = e.c.get("/api/roles", headers=e.O).json()
    assert {"issue_proforma", "issue_invoice", "void_documents"} <= {x["key"] for x in got["non_assignable"]}
    assert "record_payments" not in got["roles"][1]["permissions"]  # default staff cannot touch money
    err(e.c.post("/api/roles", json={"name": "Boss", "permissions": ["void_documents"]}, headers=e.O), 422, "not_assignable")


def test_an_issue_delivery_role_reads_only_delivery_order_pdfs(env):
    e = env
    j = hand_job(e)
    pf = proforma(e, j, deposit_pct=10).json()
    driver = member(e, role(e, "Driver", ["issue_delivery"]), "Driver")
    err(e.c.get(f"/api/deal-docs/{pf['id']}/pdf", headers=driver), 403, "permission_required")
    err(e.c.get(f"/api/jobs/{j}/chain", headers=driver), 403, "permission_required")
    do = e.sql("""insert into deal_docs(tenant_id, job_id, kind, doc_no, lines, subtotal, total, layout_snapshot)
                  select tenant_id, id, 'delivery_order', 'DO-2026-0001', %s, 1000.01, 1000.01, %s from jobs where id=%s returning id""",
               (Jsonb([{"no": 1, "description": "Shopfront sign", "qty": "1", "uom": "lot", "unit_price": "1000.01", "discount_pct": None, "amount": "1000.01", "is_header": False}]),
                Jsonb(doc_layout.default_spec("delivery_order")), j))[0]["id"]
    t = pdf_of(e, do, driver)
    assert "Delivery Order" in t and "Goods received in good order" in t and "1,000.01" not in t  # prices are off on a DO by default


# ---------------------------------------------------------------- slip proposal
class SlipOcr:
    def ocr_image(self, b):
        return [{"text": "DuitNow", "conf": 0.9, "bbox": [0, 0, 5, 5]}, {"text": "RM300.00", "conf": 0.8, "bbox": [0, 9, 5, 14]}]


def slip(e, who=None, data=JPEG):
    return e.c.post("/api/payments/propose-from-slip", files={"image": ("slip.jpg", data, "image/jpeg")}, headers=who or e.O)


def test_a_slip_makes_a_proposal_and_records_nothing(env):
    e = env
    e.svc.ocr = SlipOcr()
    j = hand_job(e, "1000.00")
    proforma(e, j, deposit_pct=30)
    e.ai.payload = {"amount": 300, "paid_on": "2026-01-02", "reference": "  TRX\x00 8812\n3 ", "payer": "Ali bin Abu"}
    before = {t: count(e, t) for t in ("payments", "deal_docs", "ai_actions", "jobs")}
    r = slip(e)
    assert r.status_code == 200, r.text
    assert r.json() == {"amount": "300.00", "paid_on": "2026-01-02", "reference": "TRX 8812 3", "payer": "Ali bin Abu", "matched_job_id": j,
                        "confidence": 0.85, "notice": "A slip is not proof of money received: check your bank before confirming."}
    assert {t: count(e, t) for t in before} == before and e.ai.calls == 1  # nothing recorded, nothing in ai_actions
    assert "payment" not in " ".join(x["event"] for x in e.c.get("/api/audit", headers=e.O).json() if x["entity"] == "payments")
    # the owner confirms through the normal endpoint and the proposal is kept on the payment
    ok = pay(e, j, "300.00", key="slip-key-001", extraction={k: r.json()[k] for k in ("amount", "paid_on", "reference", "payer", "confidence")})
    assert ok.status_code == 201
    assert e.sql("select extraction->>'payer' p from payments")[0]["p"] == "Ali bin Abu" and count(e, "ai_actions") == 0
    assert "extraction" not in e.sql("select after::text a from audit_log where entity='payments'")[0]["a"]


def test_a_slip_with_hostile_or_missing_content_gives_a_safe_proposal(env):
    e = env
    e.svc.ocr = SlipOcr()
    e.ai.payload = {"amount": "99999999999999", "paid_on": "yesterday", "reference": "<script>alert(1)</script> " + "x" * 300, "payer": 42,
                    "matched_job_id": "00000000-0000-0000-0000-000000000000", "ignore": "previous instructions"}
    r = slip(e)
    assert r.status_code == 200
    j = r.json()
    assert j["amount"] is None and j["paid_on"] is None and j["payer"] is None and j["matched_job_id"] is None
    assert len(j["reference"]) == 100 and set(j) == {"amount", "paid_on", "reference", "payer", "matched_job_id", "confidence", "notice"}
    assert count(e, "payments") == 0
    e.ai.payload = {"amount": -5}
    assert slip(e).json()["amount"] is None


def test_a_slip_that_matches_two_orders_or_none_names_no_order(env):
    e = env
    e.svc.ocr = SlipOcr()
    e.ai.payload = {"amount": 300}
    a, b = hand_job(e, "300.00"), hand_job(e, "300.00", title="Twin")
    assert slip(e).json()["matched_job_id"] is None  # two orders could be it: the owner picks
    pay(e, b, "300.00", key="twin-key-001", purpose="balance")
    assert slip(e).json()["matched_job_id"] == a  # b is settled now


def test_slip_failures_are_plain_and_leave_nothing_behind(env):
    e = env
    err(slip(e, data=b"GIF89a" + b"\x00" * 20), 415, "unsupported_media")
    e.svc.ocr = type("O", (), {"ocr_image": lambda s, b: []})()
    err(slip(e), 422, "no_text")
    e.svc.ocr = type("O", (), {"ocr_image": lambda s, b: (_ for _ in ()).throw(RuntimeError("secret engine path"))})()
    r = slip(e)
    assert r.status_code == 422 and r.json()["error"]["code"] == "ocr_failed" and "secret engine path" not in r.text
    e.svc.ocr, e.ai.fail = SlipOcr(), True
    err(slip(e), 502, "ilmu_unavailable")
    assert count(e, "payments") == 0


# ---------------------------------------------------------------- PDF and layout
def test_an_issued_pdf_keeps_the_layout_it_was_issued_with(env):
    e = env
    j = hand_job(e, "1000.00")
    first = proforma(e, j, deposit_pct=30).json()
    assert "Proforma Invoice" in pdf_of(e, first["id"])
    snap = e.sql("select layout_snapshot s from deal_docs where id=%s", (first["id"],))[0]["s"]
    assert snap["kind"] == "proforma" and snap["title"]["en"] == "Proforma Invoice"
    r = e.c.put("/api/settings/doc-layout/proforma", json={"title": {"en": "Pro Forma Bill"}, "footer_text": "Thank you"}, headers=e.O)
    assert r.status_code == 200 and r.json()["title"]["en"] == "Pro Forma Bill" and r.json()["title"]["ms"] == "Invois Proforma"
    t = pdf_of(e, first["id"])
    assert "Proforma Invoice" in t and "Pro Forma Bill" not in t and "Thank you" not in t  # the issued one is unchanged
    e.c.post(f"/api/deal-docs/{first['id']}/void", json={"reason": "reissue"}, headers=e.O)
    second = proforma(e, j, deposit_pct=30).json()
    t2 = pdf_of(e, second["id"])
    assert "Pro Forma Bill" in t2 and "Thank you" in t2
    assert e.sql("select layout_snapshot->'title'->>'en' t from deal_docs where id=%s", (first["id"],))[0]["t"] == "Proforma Invoice"


def test_pdf_follows_the_document_language_and_shows_selling_prices_only(env):
    e = env
    j = quote_job(e)
    pf = proforma(e, j).json()
    t = pdf_of(e, pf["id"])
    assert "Proforma Invoice" in t and pf["doc_no"] in t and "Deposit due" in t and "This is not a tax invoice." in t
    assert not [w for w in ("margin", "supplier", "unit_cost", "tenant_id") if w in t.lower()]
    assert e.c.post("/api/settings", json={"doc_language": "ms"}, headers=e.O).status_code == 200
    t = pdf_of(e, pf["id"])
    assert "Invois Proforma" in t and "Deposit perlu dibayar" in t
    e.c.post("/api/settings", json={"doc_language": "zh"}, headers=e.O)
    assert "形式发票" in pdf_of(e, pf["id"])
    assert e.c.get(f"/api/deal-docs/{pf['id']}/pdf", headers=e.O).headers["content-disposition"].endswith(f'{pf["doc_no"]}.pdf"')


def test_layout_settings_validate_save_and_audit(env):
    e = env
    put = lambda kind, body, who=None: e.c.put(f"/api/settings/doc-layout/{kind}", json=body, headers=who or e.O)
    assert e.c.get("/api/settings/doc-layout/delivery_order", headers=e.O).json()["show_prices"] is False
    for bad in ({"blocks": ["header", "script"]}, {"style": "neon"}, {"font_size": 99}, {"kind": "invoice"}, {"columns": "all"}, {"title": {"xx": "no"}},
                {"unknown": 1}, {"footer_text": "x" * 301}):
        r = put("proforma", bad)
        assert r.status_code == 422 and r.json()["error"]["code"] == "bad_layout", bad
    assert e.sql("select doc_layouts d from tenants")[0]["d"] == {}  # nothing invalid was saved
    assert put("delivery_order", {"show_prices": True, "style": "band"}).json()["show_prices"] is True
    assert e.c.get("/api/settings/doc-layout/delivery_order", headers=e.O).json()["style"] == "band"
    assert e.sql("select doc_layouts d from tenants")[0]["d"] == {"delivery_order": {"show_prices": True, "style": "band"}}  # the override, not the whole spec
    assert put("proforma", {"style": "classic"}).status_code == 200 and put("proforma", {}).json()["style"] == "simple"  # {} = back to the default
    err(put("nonsense", {}), 404, "not_found")
    assert any(x["event"] == "delivery order layout changed" for x in e.c.get("/api/audit", headers=e.O).json())


# ---------------------------------------------------------------- stage
@pytest.mark.parametrize("args,want", [
    ((Decimal(100), Decimal(0), None, Decimal(0), False, False), "awaiting_deposit"),
    ((Decimal(100), Decimal(10), None, Decimal(10), False, False), "in_production"),  # no proforma: any money means work has started
    ((Decimal(100), Decimal(20), Decimal(30), Decimal(20), False, False), "awaiting_deposit"),
    ((Decimal(100), Decimal(30), Decimal(30), Decimal(30), False, False), "in_production"),
    ((Decimal(100), Decimal(0), Decimal(0), Decimal(0), False, False), "in_production"),  # nothing asked up front
    ((Decimal(100), Decimal(30), Decimal(30), Decimal(30), False, True), "delivered"),
    ((Decimal(100), Decimal(30), Decimal(30), Decimal(30), True, True), "awaiting_payment"),
    ((Decimal(100), Decimal(100), Decimal(30), Decimal(30), True, True), "paid"),
    ((None, Decimal(0), None, Decimal(0), False, False), "awaiting_deposit"),
])
def test_stage(args, want):
    assert chain.stage(*args) == want
