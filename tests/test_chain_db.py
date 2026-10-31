"""Order chain step 1, the database itself (db/chain.sql): tenant isolation, append-only payments, frozen documents, the overpayment guard under
a race, the uniqueness rules, and a schema that applies twice. Rules are asserted at the SQL level so they hold for any caller, not only the API."""
import threading
from decimal import Decimal

import psycopg
import pytest
from psycopg.types.json import Jsonb

from src import db, doc_layout
from support.fixtures import env, pg_url  # noqa: F401
from test_chain_api import count, err, hand_job, pay, proforma
from test_rfq import other_tenant

LAYOUT = Jsonb(doc_layout.default_spec("invoice"))


def raw(pg_url, q, p=()):
    """As the schema owner (superuser: RLS and privileges do not apply), so only the triggers and constraints are in the way."""
    with psycopg.connect(pg_url, autocommit=True) as c:
        cur = c.execute(q, p)
        return cur.fetchall() if cur.description else None


def mkpay(e, job, amount, key, **kw):
    return e.sql("""insert into payments(tenant_id, job_id, amount, method, paid_on, purpose, idempotency_key)
                    select tenant_id, id, %s, 'cash', current_date, 'balance', %s from jobs where id=%s returning id""", (amount, key, job))[0]["id"]


def mkdoc(e, job, kind="invoice", no="INV-2026-0001", status="issued", **cols):
    return e.sql("""insert into deal_docs(tenant_id, job_id, kind, doc_no, status, subtotal, total, layout_snapshot)
                    select tenant_id, id, %s, %s, %s, 10, 10, %s from jobs where id=%s returning id""", (kind, no, status, LAYOUT, job))[0]["id"]


# ---------------------------------------------------------------- tenant isolation
def test_two_tenants_see_none_of_each_others_orders_documents_or_payments(env):
    e = env
    j = hand_job(e, "1000.00")
    pf = proforma(e, j, deposit_pct=30).json()
    p = pay(e, j, "300.00", key="dep-key-0001").json()
    b = other_tenant(e)
    bj = hand_job(e, "50.00", title="B's job", who=b)
    assert pay(e, bj, "50.00", key="b-key-00001", who=b).status_code == 201
    for m, url, kw in [("GET", f"/api/jobs/{j}/chain", {}), ("GET", f"/api/deal-docs/{pf['id']}/pdf", {}),
                       ("POST", f"/api/jobs/{j}/proforma", {"json": {"deposit_pct": 5}}),
                       ("POST", f"/api/jobs/{j}/payments", {"json": {"amount": "1.00", "method": "cash", "paid_on": "2026-01-02", "purpose": "deposit", "idempotency_key": "intruder-01"}}),
                       ("POST", f"/api/payments/{p['payment']['id']}/reverse", {"json": {"reason": "not yours"}}),
                       ("POST", f"/api/deal-docs/{pf['id']}/void", {"json": {"reason": "not yours"}})]:
        r = e.c.request(m, url, headers=b, **kw)
        assert r.status_code == 404 and r.json()["error"]["code"] == "not_found", (m, url, r.status_code, r.text)
    err(e.c.request("POST", f"/api/jobs/{bj}/payments", headers=e.O, json={"amount": "1.00", "method": "cash", "paid_on": "2026-01-02", "purpose": "deposit", "idempotency_key": "b-key-00001"}), 404, "not_found")
    assert count(e, "payments") == 2
    tenant_a, tenant_b = (e.sql("select tenant_id::text t from jobs where id=%s", (x,))[0]["t"] for x in (j, bj))
    for t in ("payments", "deal_docs"):
        with db.tx("owner", tenant=tenant_b) as c:
            assert {str(r["tenant_id"]) for r in c.execute(f"select tenant_id from {t}").fetchall()} == {tenant_b}
        with db.tx("owner", tenant="") as c:  # no tenant named: nothing
            assert c.execute(f"select count(*) n from {t}").fetchone()["n"] == 0
        with db.tx("owner", tenant=tenant_a) as c:
            assert tenant_b not in {str(r["tenant_id"]) for r in c.execute(f"select tenant_id from {t}").fetchall()}
    with pytest.raises(psycopg.Error), db.tx("owner", tenant=tenant_b) as c:  # B cannot write a row for A, even naming A's job
        c.execute("insert into payments(tenant_id, job_id, amount, method, paid_on, purpose, idempotency_key) values (%s,%s,1,'cash',current_date,'deposit','sneaky-key-1')", (tenant_a, j))
    with pytest.raises(psycopg.Error), db.tx("owner", tenant=tenant_b) as c:  # nor a B row hanging off A's job (composite foreign key)
        c.execute("insert into payments(tenant_id, job_id, amount, method, paid_on, purpose, idempotency_key) values (%s,%s,1,'cash',current_date,'deposit','sneaky-key-2')", (tenant_b, j))
    assert count(e, "payments") == 2


# ---------------------------------------------------------------- append-only and frozen
def test_payments_are_append_only_for_the_app_role_and_for_the_owner(env, pg_url):
    e = env
    j = hand_job(e, "1000.00")
    p = pay(e, j, "300.00", key="dep-key-0001").json()["payment"]["id"]
    for q in ("update payments set amount = 1", "delete from payments", "truncate payments, deal_docs, delivery_signatures"):
        with pytest.raises(psycopg.Error):
            e.sql(q)  # the app role has no UPDATE / DELETE / TRUNCATE
        with pytest.raises(psycopg.errors.RaiseException, match="payments is append-only"):
            raw(pg_url, q)  # and the trigger stops even the owner
    assert e.sql("select amount from payments where id=%s", (p,))[0]["amount"] == Decimal("300.00")


def test_a_reversal_must_undo_one_whole_payment_of_the_same_order(env, pg_url):
    e = env
    j, k = hand_job(e, "1000.00"), hand_job(e, "500.00", title="Other")
    e.sql("update jobs set order_total = 1000")
    p = mkpay(e, j, 300, "base-key-001")
    ins = lambda job, amount, target: e.sql(
        """insert into payments(tenant_id, job_id, amount, method, paid_on, purpose, idempotency_key, reverses_payment_id, reversal_reason)
           select tenant_id, id, %s, 'cash', current_date, 'balance', 'rev-' || gen_random_uuid()::text, %s, 'because' from jobs where id=%s returning id""", (amount, target, job))
    for job, amount in ((j, 100), (k, 300), (j, 300.01)):
        with pytest.raises(psycopg.Error, match="reversal must undo"):
            ins(job, amount, p)
    with pytest.raises(psycopg.Error):  # a reversal without a reason
        e.sql("""insert into payments(tenant_id, job_id, amount, method, paid_on, purpose, idempotency_key, reverses_payment_id)
                 select tenant_id, id, 300, 'cash', current_date, 'balance', 'rev-noreason-1', %s from jobs where id=%s""", (p, j))
    rev = ins(j, 300, p)[0]["id"]
    with pytest.raises(psycopg.Error):  # one reversal per payment
        ins(j, 300, p)
    with pytest.raises(psycopg.Error, match="reversal must undo"):  # a reversal is not itself reversible
        ins(j, 300, rev)


def test_an_issued_document_is_frozen_and_void_is_final(env, pg_url):
    e = env
    j = hand_job(e)
    d = mkdoc(e, j)
    for q in ("update deal_docs set total = 99", "update deal_docs set lines = '[]'::jsonb || '[1]'::jsonb", "update deal_docs set doc_no = 'X-1'",
              "update deal_docs set layout_snapshot = '{}'", "update deal_docs set job_id = job_id, extra = '{\"a\":1}'"):
        with pytest.raises(psycopg.errors.RaiseException, match="frozen"):
            raw(pg_url, q)
    with pytest.raises(psycopg.errors.RaiseException, match="cannot be deleted"):
        raw(pg_url, "delete from deal_docs")
    with pytest.raises(psycopg.Error):
        e.sql("delete from deal_docs")
    with pytest.raises(psycopg.Error):  # void needs a reason and a time, and a reason only means void
        e.sql("update deal_docs set status = 'void' where id=%s", (d,))
    e.sql("update deal_docs set status = 'signed' where id=%s", (d,))
    e.sql("update deal_docs set status = 'void', void_reason = 'wrong', voided_at = now() where id=%s", (d,))
    for to in ("issued", "signed"):
        with pytest.raises(psycopg.errors.RaiseException, match="status cannot go back"):
            raw(pg_url, f"update deal_docs set status = '{to}', void_reason = null, voided_at = null")
    ev = {x["event"] for x in e.sql("select event from audit_log where entity in ('deal_docs','payments')")}
    assert "insert" in ev and "update" in ev


def test_uniqueness_rules_one_live_proforma_and_invoice_many_delivery_orders_one_receipt_per_payment(env):
    e = env
    j = hand_job(e)
    for kind, no in (("proforma", "PF-2026-0001"), ("invoice", "INV-2026-0001")):
        d = mkdoc(e, j, kind, no)
        with pytest.raises(psycopg.errors.UniqueViolation):
            mkdoc(e, j, kind, no.replace("0001", "0002"))  # a second live one
        e.sql("update deal_docs set status='void', void_reason='redo', voided_at=now() where id=%s", (d,))
        assert mkdoc(e, j, kind, no.replace("0001", "0002"))  # a voided one frees the slot
    with pytest.raises(psycopg.errors.UniqueViolation):
        mkdoc(e, hand_job(e, title="Other"), "invoice", "INV-2026-0002")  # a number is unique per tenant and kind
    assert [mkdoc(e, j, "delivery_order", f"DO-2026-000{n}") for n in (1, 2, 3)]  # many delivery orders per order
    with pytest.raises(psycopg.errors.UniqueViolation):
        mkdoc(e, j, "delivery_order", "DO-2026-0001")
    e.sql("update jobs set order_total = 100")
    p = mkpay(e, j, 5, "rcpt-key-001")
    mk = lambda no: e.sql("""insert into deal_docs(tenant_id, job_id, kind, doc_no, subtotal, total, layout_snapshot, payment_id)
                             select tenant_id, id, 'receipt', %s, 5, 5, %s, %s from jobs where id=%s""", (no, LAYOUT, p, j))
    mk("RC-2026-0001")
    with pytest.raises(psycopg.errors.UniqueViolation):
        mk("RC-2026-0002")
    with pytest.raises(psycopg.errors.CheckViolation):  # a receipt needs its payment, and nothing else carries one
        mkdoc(e, j, "receipt", "RC-2026-0009")
    with pytest.raises(psycopg.Error):
        mkdoc(e, j, "credit_note", "CN-1")


def test_column_rules(env):
    e = env
    j = hand_job(e, "100.00")
    base = "insert into payments(tenant_id, job_id, amount, method, paid_on, purpose, idempotency_key) select tenant_id, id, {}, {}, current_date, {}, {} from jobs where id=%s"
    e.sql("update jobs set order_total = 100 where id=%s", (j,))
    for amount, method, purpose, key in ((0, "'cash'", "'deposit'", "'valid-key-1'"), (-1, "'cash'", "'deposit'", "'valid-key-1'"),
                                         (1, "'bitcoin'", "'deposit'", "'valid-key-1'"), (1, "'cash'", "'tip'", "'valid-key-1'"), (1, "'cash'", "'deposit'", "'short'")):
        with pytest.raises(psycopg.errors.CheckViolation):
            e.sql(base.format(amount, method, purpose, key), (j,))
    e.sql(base.format(1, "'cash'", "'deposit'", "'valid-key-1'"), (j,))
    with pytest.raises(psycopg.errors.UniqueViolation):  # the key is unique per tenant
        e.sql(base.format(1, "'cash'", "'deposit'", "'valid-key-1'"), (j,))
    for col, bad in (("doc_language", "fr"), ("proforma_prefix", "pf"), ("delivery_order_prefix", "TOOLONG123"), ("invoice_prefix", ""), ("receipt_prefix", "A B"),
                     ("doc_layouts", "[]")):
        with pytest.raises(psycopg.errors.CheckViolation):
            e.sql(f"update tenants set {col} = %s", (Jsonb([]) if col == "doc_layouts" else bad,))
    row = e.sql("select doc_language, doc_layouts, proforma_prefix, delivery_order_prefix, invoice_prefix, receipt_prefix from tenants")[0]
    assert row == {"doc_language": "en", "doc_layouts": {}, "proforma_prefix": "PF", "delivery_order_prefix": "DO", "invoice_prefix": "INV", "receipt_prefix": "RC"}


def test_delivery_signatures_exist_append_only_and_tenant_scoped(env, pg_url):
    e = env
    d = mkdoc(e, hand_job(e), "delivery_order", "DO-2026-0001")
    ins = lambda **kw: e.sql("""insert into delivery_signatures(tenant_id, deal_doc_id, signer_name, agreed, doc_sha256)
                                select tenant_id, id, %s, %s, 'abc' from deal_docs where id=%s returning id""", (kw.get("name", "Ali bin Abu"), kw.get("agreed", True), d))
    s = ins()[0]["id"]
    with pytest.raises(psycopg.errors.UniqueViolation):
        ins()  # one signature per delivery order
    for bad in ({"agreed": False}, {"name": "A"}):
        with pytest.raises(psycopg.errors.CheckViolation):
            ins(**bad)
    for q in ("update delivery_signatures set signer_name = 'Mallory'", "delete from delivery_signatures"):
        with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
            raw(pg_url, q)
    other_tenant(e)
    with db.tx("owner", tenant=e.sql("select id::text i from tenants where name='Other Shop'")[0]["i"]) as c:
        assert c.execute("select count(*) n from delivery_signatures").fetchone()["n"] == 0
    assert e.sql("select id from delivery_signatures")[0]["id"] == s


# ---------------------------------------------------------------- overpayment, in the database
def test_the_database_alone_stops_two_connections_overpaying(env):
    e = env
    j = hand_job(e, "1000.00")
    e.sql("update jobs set order_total = 1000 where id=%s", (j,))
    out, barrier = [], threading.Barrier(2)

    def go(n):
        barrier.wait()
        try:
            mkpay(e, j, 600, f"race-key-{n:04d}")
            out.append("ok")
        except psycopg.errors.RaiseException as x:
            out.append("overpayment" if "overpayment" in str(x) else str(x))
    ts = [threading.Thread(target=go, args=(n,)) for n in range(2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(out) == ["ok", "overpayment"]
    assert e.sql("select sum(amount) s from payments")[0]["s"] == Decimal("600.00")
    with pytest.raises(psycopg.errors.RaiseException, match="no total yet"):
        mkpay(e, hand_job(e, "10.00", title="Unfrozen"), 1, "nototal-key-1")  # no order_total: the API sets it first, the database insists on it
    e.sql("update jobs set order_total = 1000 where id=%s", (j,))  # unchanged value: the cap is the row's, not the caller's
    with pytest.raises(psycopg.errors.RaiseException, match="400.00 left"):
        mkpay(e, j, 400.01, "over-key-0001")


def test_the_schema_applies_twice_and_keeps_the_data(env, pg_url):
    e = env
    j = hand_job(e, "1000.00")
    pay(e, j, "300.00", key="dep-key-0001")
    db.apply_schema(seed=True)
    db.apply_schema(seed=True)
    assert count(e, "payments") == 1 and count(e, "deal_docs") == 1
    cols = {x[0] for x in raw(pg_url, "select column_name from information_schema.columns where table_name='tenants'")}
    assert {"doc_language", "doc_layouts", "proforma_prefix", "delivery_order_prefix", "invoice_prefix", "receipt_prefix"} <= cols
    forced = {x[0] for x in raw(pg_url, "select relname from pg_class where relforcerowsecurity and relname in ('payments','deal_docs','delivery_signatures')")}
    assert forced == {"payments", "deal_docs", "delivery_signatures"}
