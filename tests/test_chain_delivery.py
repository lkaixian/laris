"""Order chain steps 3-4 over the API and the database: delivery orders (partial, never over-delivered, deposit gate), the customer's tap-to-sign
link (db/delivery.sql), the invoice, the final payment and its receipt, and the two overdue rules. No network; PGlite."""
import base64
import io
import json
import logging
import re
import struct
import threading
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import psycopg
import pytest
from PIL import Image
from pypdf import PdfReader

from src import db, doc_layout, logsetup
from src import track_rules as tr
from src.api import chain, deps
from support.fixtures import env, pg_url, same  # noqa: F401
from test_chain_api import chain_of, count, err, hand_job, pay, pdf_of, proforma, quote_job, quote_job_second, text
from test_public_api import other_tenant_owner
from test_roles import member, role

NAME = "Aisyah binti Tan"


@pytest.fixture
def e(env, monkeypatch):
    monkeypatch.setenv("APP_PUBLIC_URL", "https://shop.test")
    return env


def ready_hand(e, amount="1000.00", pct=30, title="Shopfront sign"):
    """A hand-made job (one line, quantity 1) with its proforma and deposit recorded."""
    j = hand_job(e, amount, title=title)
    assert proforma(e, j, deposit_pct=pct).status_code == 201
    assert pay(e, j, str((Decimal(amount) * pct / 100).quantize(Decimal("0.01"), "ROUND_HALF_UP")), key=f"dep-key-{j}").status_code == 201
    return j


def ready_banners(e):
    """A quote job of 3 x Banner at 33.33 (total 99.99, 10% deposit = 10.00 recorded)."""
    j = quote_job_second(e)
    assert proforma(e, j).status_code == 201
    assert pay(e, j, "10.00", key=f"dep-key-{j}").status_code == 201
    return j


def do(e, job, who=None, **body):
    return e.c.post(f"/api/jobs/{job}/delivery-orders", json=body, headers=who or e.O)


def mk_do(e, job, **body):
    r = do(e, job, **body)
    assert r.status_code == 201, r.text
    return r.json()


def link(e, doc, who=None):
    r = e.c.post(f"/api/deal-docs/{doc}/delivery-link", headers=who or e.O)
    assert r.status_code == 200, r.text
    assert r.json()["url"].startswith("https://shop.test/#/d/")
    return r.json()["url"].rsplit("/", 1)[1]


def get(e, tok):
    return e.c.get(f"/api/public/delivery/{tok}")


def sign(e, tok, **kw):
    return e.c.post(f"/api/public/delivery/{tok}/sign", json={"name": NAME, "agree": True, **kw})


def signed_do(e, job, **body):
    d = mk_do(e, job, **body)
    assert sign(e, link(e, d["id"])).status_code == 200
    return d


def png(w=60, h=30, noise=False):
    im = Image.frombytes("RGBA", (w, h), __import__("os").urandom(w * h * 4)) if noise else Image.new("RGBA", (w, h), (10, 20, 30, 255))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def events(e, like):
    return [x["event"] for x in e.sql("select event from audit_log where event like %s", (like,))]


# ---------------------------------------------------------------- issuing: partial, never over, deposit gate
def test_partial_deliveries_never_exceed_the_order_and_a_void_frees_the_quantity(e):
    j = ready_banners(e)
    first = mk_do(e, j, lines=[{"no": 1, "qty": "2"}])
    assert first["doc_no"].startswith("DO-") and first["doc_no"].endswith("-0001") and first["status"] == "issued"
    assert first["lines"] == [{"no": 1, "description": "Banner", "qty": "2", "uom": "pcs"}]
    assert "unit_price" not in json.dumps(first) and "33.33" not in json.dumps(first)  # this response carries no price
    err(do(e, j, lines=[{"no": 1, "qty": "1.001"}]), 409, "conflict")  # 3 ordered, 2 on a delivery order: 1 left
    r = do(e, j, lines=[{"no": 1, "qty": "2"}])
    assert r.status_code == 409 and "only 1.000 of 3.000 ordered is left" in r.json()["error"]["message"]
    second = mk_do(e, j)  # default: everything still to deliver
    assert second["lines"][0]["qty"] == "1" and second["doc_no"].endswith("-0002")
    err(do(e, j), 409, "nothing_to_deliver")
    c = chain_of(e, j)
    assert c["delivery"] == {"lines": [{"no": 1, "ordered": "3.000", "issued": "3.000", "signed": "0.000"}], "complete": False}
    e.c.post(f"/api/deal-docs/{first['id']}/void", json={"reason": "wrong address"}, headers=e.O)
    assert chain_of(e, j)["delivery"]["lines"][0]["issued"] == "1.000"  # the voided one no longer counts
    assert mk_do(e, j, lines=[{"no": 1, "qty": "2"}])["lines"][0]["qty"] == "2"
    for bad, code in (({"lines": [{"no": 9, "qty": "1"}]}, "bad_line"), ({"lines": [{"no": 1, "qty": "1"}, {"no": 1, "qty": "1"}]}, "duplicate_line")):
        err(do(e, j, **bad), 422, code)
    for bad in ({"lines": []}, {"lines": [{"no": 1, "qty": "0"}]}, {"lines": [{"no": 1, "qty": "-1"}]}, {"lines": [{"no": 1, "qty": "1.0001"}]}, {"surprise": 1}):
        assert do(e, j, **bad).status_code == 422, bad
    assert count(e, "deal_docs", "kind='delivery_order' and status <> 'void'") == 2


def test_two_requests_racing_for_the_same_quantity_cannot_both_land(e):
    j = ready_banners(e)
    out, barrier = [], threading.Barrier(2)

    def go():
        barrier.wait()
        out.append(do(e, j, lines=[{"no": 1, "qty": "2"}]).status_code)
    ts = [threading.Thread(target=go) for _ in range(2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(out) == [201, 409]
    assert e.sql("select coalesce(sum((x->>'qty')::numeric), 0) q from deal_docs, jsonb_array_elements(lines) x where kind='delivery_order'")[0]["q"] == 2


def test_the_database_alone_refuses_over_delivery_from_two_connections(e):
    j = ready_banners(e)
    ins = lambda n: e.sql("""insert into deal_docs(tenant_id, job_id, kind, doc_no, lines, subtotal, total, layout_snapshot)
                             select tenant_id, id, 'delivery_order', %s, %s, 0, 0, %s from jobs where id=%s""",
                          (f"DO-RACE-{n}", psycopg.types.json.Jsonb([{"no": 1, "qty": "2", "is_header": False}]),
                           psycopg.types.json.Jsonb(doc_layout.default_spec("delivery_order")), j))
    out, barrier = [], threading.Barrier(2)

    def go(n):
        barrier.wait()
        try:
            ins(n)
            out.append("ok")
        except psycopg.errors.RaiseException as x:
            out.append("delivery" if "delivery: line 1 would deliver" in str(x) else str(x))
    ts = [threading.Thread(target=go, args=(n,)) for n in range(2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(out) == ["delivery", "ok"] and count(e, "deal_docs", "kind='delivery_order'") == 1
    for lines, msg in (([], "nothing to deliver"), ([{"no": 7, "qty": "1"}], "not on this order"), ([{"no": 1, "qty": "0"}], "above zero"),
                       ([{"no": 1, "qty": "0.1"}, {"no": 1, "qty": "0.1"}], "listed twice")):
        with pytest.raises(psycopg.errors.RaiseException, match=msg):
            e.sql("""insert into deal_docs(tenant_id, job_id, kind, doc_no, lines, subtotal, total, layout_snapshot)
                     select tenant_id, id, 'delivery_order', 'DO-BAD', %s, 0, 0, %s from jobs where id=%s""",
                  (psycopg.types.json.Jsonb(lines), psycopg.types.json.Jsonb(doc_layout.default_spec("delivery_order")), j))


def test_the_deposit_gate_and_the_owners_override_is_stored_and_audited(e):
    j = hand_job(e, "1000.00")
    proforma(e, j, deposit_pct=30)
    err(do(e, j), 409, "deposit_missing")
    pay(e, j, "100.00", key="part-key-001")  # a part of the deposit is not the deposit
    err(do(e, j), 409, "deposit_missing")
    clerk = member(e, role(e, "Driver", ["issue_delivery"]), "Driver")
    err(do(e, j, who=clerk, override_reason="customer is waiting"), 403, "owner_only")
    err(do(e, j, override_reason="x"), 422, "invalid_request")
    d = mk_do(e, j, override_reason="  regular customer, pays on delivery  ")
    assert d["override"] is True
    assert e.sql("select extra from deal_docs where id=%s", (d["id"],))[0]["extra"] == {"override_reason": "regular customer, pays on delivery"}
    assert events(e, "delivery order DO-% issued (deposit not recorded, override: regular customer, pays on delivery)")
    assert chain_of(e, j)["delivery_orders"][0]["override_reason"] == "regular customer, pays on delivery"
    pay(e, j, "200.00", key="rest-key-001")  # the deposit is in now: no gate, and an override is not stored
    j2 = ready_hand(e, "50.00", title="Paid up")
    d2 = mk_do(e, j2, override_reason="not needed here")
    assert d2["override"] is False and e.sql("select extra from deal_docs where id=%s", (d2["id"],))[0]["extra"] == {}
    j3 = hand_job(e, "70.00", title="No proforma")  # no proforma: any money at all lifts the gate
    err(do(e, j3), 409, "deposit_missing")
    pay(e, j3, "1.00", key="any-key-0001")
    assert do(e, j3).status_code == 201


# ---------------------------------------------------------------- who may do what
def test_roles_for_delivery_orders_links_invoices_and_the_pdf(e):
    j = ready_hand(e)
    nobody = member(e, role(e, "Nothing", []), "Nobody")
    driver = member(e, role(e, "Driver", ["issue_delivery"]), "Driver")
    d = mk_do(e, j)
    for who in (e.S, nobody):
        err(do(e, j, who=who), 403, "permission_required")
        err(e.c.post(f"/api/deal-docs/{d['id']}/delivery-link", headers=who), 403, "permission_required")
    d2 = do(e, j, who=driver)
    assert d2.status_code == 409  # the one line is already on a delivery order: the driver's call reached the rules
    j2 = ready_hand(e, "20.00", title="Second")
    mine = mk_do(e, j2, who=driver)
    assert "unit_price" not in json.dumps(mine) and "amount" not in json.dumps(mine)
    assert link(e, mine["id"], who=driver)
    assert pdf_of(e, mine["id"], driver)  # its own paper, prices off
    err(e.c.get(f"/api/jobs/{j2}/chain", headers=driver), 403, "permission_required")
    err(e.c.post(f"/api/jobs/{j2}/invoice", json={}, headers=driver), 403, "owner_only")
    err(e.c.post(f"/api/deal-docs/{mine['id']}/void", json={"reason": "mine now"}, headers=driver), 403, "owner_only")
    err(e.c.post(f"/api/jobs/{j2}/invoice", json={}, headers=e.S), 403, "owner_only")
    assert count(e, "deal_docs", "kind='delivery_order'") == 2


def test_another_business_cannot_see_or_touch_orders_links_or_signatures(e):
    j = ready_hand(e)
    d = mk_do(e, j)
    tok = link(e, d["id"])
    b = other_tenant_owner(e)
    bj = e.c.post("/api/jobs", json={"title": "B job", "amount": "10.00"}, headers=b).json()["id"]
    for m, url, kw in [("POST", f"/api/jobs/{j}/delivery-orders", {"json": {}}), ("POST", f"/api/deal-docs/{d['id']}/delivery-link", {}),
                       ("POST", f"/api/jobs/{j}/invoice", {"json": {}}), ("GET", f"/api/deal-docs/{d['id']}/pdf", {})]:
        r = e.c.request(m, url, headers=b, **kw)
        assert r.status_code == 404 and r.json()["error"]["code"] == "not_found", (m, url, r.status_code)
    err(do(e, bj, who=b), 409, "deposit_missing")  # B's own job is B's business: the gate answers, not a leak of A's
    assert sign(e, tok).status_code == 200
    tenant_a = e.sql("select tenant_id::text t from jobs where id=%s", (j,))[0]["t"]
    tenant_b = e.sql("select id::text t from tenants where name='Other Shop'")[0]["t"]
    for t in ("delivery_links", "delivery_signatures"):
        with db.tx("owner", tenant=tenant_b) as c:
            assert c.execute(f"select count(*) n from {t}").fetchone()["n"] == 0
        with db.tx("owner", tenant=tenant_a) as c:
            assert c.execute(f"select count(*) n from {t}").fetchone()["n"] == 1
    with pytest.raises(psycopg.Error), db.tx("owner", tenant=tenant_b) as c:  # B cannot write a link for A's document
        c.execute("insert into delivery_links(tenant_id, deal_doc_id, token_hash, expires_at) values (%s,%s,'h',now())", (tenant_a, d["id"]))
    assert "delivery_links" in {x["relname"] for x in e.sql("select relname from pg_class where relforcerowsecurity")}


# ---------------------------------------------------------------- the link
def test_the_token_is_never_stored_or_logged_and_every_bad_link_gets_the_same_404(e, caplog):
    caplog.set_level(logging.DEBUG)
    j = ready_hand(e)
    d = mk_do(e, j)
    old = link(e, d["id"])
    tok = link(e, d["id"])  # a new link revokes the older unused ones
    assert get(e, tok).status_code == 200
    get(e, tok), sign(e, tok, problems="one box dented"), get(e, "Z" * 32)
    rows = json.dumps(e.sql("select * from delivery_links"), default=str)
    assert tok not in rows and old not in rows and "Z" * 32 not in rows and len(e.sql("select token_hash from delivery_links")[0]["token_hash"]) == 64
    every = json.dumps(e.sql("select * from audit_log"), default=str) + json.dumps(e.sql("select * from delivery_signatures"), default=str)
    assert tok not in every and old not in every and tok not in caplog.text and NAME not in caplog.text and "dented" not in caplog.text
    bad = [get(e, old), get(e, "A" * 32), get(e, "short"), get(e, "x" * 200), get(e, "a%20b" + "c" * 20)]
    assert all(r.status_code == 404 and r.json()["error"]["code"] == "not_found" for r in bad) and same(*bad)
    posts = [sign(e, old), sign(e, "A" * 32), sign(e, "short")]
    assert all(r.status_code == 404 for r in posts) and same(*posts)
    assert logsetup.PUBLIC_TOKEN.sub(r"\1***", f"/api/public/delivery/{tok}/sign") == "/api/public/delivery/***/sign"
    rec = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d', ("c", "GET", f"/api/public/delivery/{tok}?x=1", "1.1", 200), None)
    logsetup.MaskQuery().filter(rec)
    assert tok not in str(rec.args)


def test_expired_void_and_unsigned_links_and_the_creation_rules(e):
    j = ready_hand(e)
    d = mk_do(e, j)
    tok = link(e, d["id"])
    e.sql("update delivery_links set expires_at = now() - interval '1 minute'")
    gone = [get(e, tok), sign(e, tok)]
    assert all(r.status_code == 404 for r in gone) and same(*gone, get(e, "q" * 32))
    assert e.sql("select status from deal_docs where id=%s", (d["id"],))[0]["status"] == "issued"
    tok2 = link(e, d["id"])
    assert get(e, tok2).status_code == 200
    e.c.post(f"/api/deal-docs/{d['id']}/void", json={"reason": "wrong goods"}, headers=e.O)
    assert get(e, tok2).status_code == 404 and sign(e, tok2).status_code == 404  # a void delivery order cannot be signed
    err(e.c.post(f"/api/deal-docs/{d['id']}/delivery-link", headers=e.O), 409, "not_linkable")
    pf = e.sql("select id from deal_docs where kind='proforma'")[0]["id"]
    err(e.c.post(f"/api/deal-docs/{pf}/delivery-link", headers=e.O), 404, "not_found")  # only delivery orders
    r = e.c.post(f"/api/deal-docs/{'0' * 8}-0000-0000-0000-{'0' * 12}/delivery-link", headers=e.O)
    assert r.status_code == 404


def test_without_a_public_url_there_is_no_link(env, monkeypatch):
    monkeypatch.delenv("APP_PUBLIC_URL", raising=False)
    e = env
    d = mk_do(e, ready_hand(e))
    err(e.c.post(f"/api/deal-docs/{d['id']}/delivery-link", headers=e.O), 409, "public_url_missing")
    assert count(e, "delivery_links") == 0


def test_an_expired_link_still_shows_a_signed_order_but_cannot_sign_it_again_differently(e):
    d = mk_do(e, ready_hand(e))
    tok = link(e, d["id"])
    assert sign(e, tok).status_code == 200
    e.sql("update delivery_links set expires_at = now() - interval '1 day'")
    assert get(e, tok).status_code == 200 and get(e, tok).json()["signed"]["name"] == NAME
    assert sign(e, tok).status_code == 200 and sign(e, tok, name="Someone Else").status_code == 409


def test_public_rate_limits(e):
    d = mk_do(e, ready_hand(e))
    tok = link(e, d["id"])
    codes = [get(e, tok).status_code for _ in range(32)]
    assert codes[:30] == [200] * 30 and codes[30:] == [429, 429] and get(e, tok).json()["error"]["code"] == "rate_limited"
    deps.HITS.clear()
    codes = [sign(e, "q" * 32).status_code for _ in range(12)]
    assert codes[:10] == [404] * 10 and codes[10:] == [429, 429]
    assert sign(e, tok).json()["error"]["code"] == "rate_limited" and e.sql("select status from deal_docs where kind='delivery_order'")[0]["status"] == "issued"


# ---------------------------------------------------------------- the customer's page and the signature
def test_the_page_shows_what_is_delivered_without_prices_and_signing_is_recorded(e):
    j = ready_banners(e)
    d = mk_do(e, j, lines=[{"no": 1, "qty": "2"}])
    tok = link(e, d["id"])
    g = get(e, tok)
    assert g.status_code == 200 and g.headers["cache-control"] == "no-store"
    p = g.json()
    assert p["can_sign"] is True and p["signed"] is None and p["language"] == "en" and p["notice"] == doc_layout.WORDS["do_notice"]["en"]
    assert "legal" not in p["notice"].lower() and "simulated" not in p["notice"].lower()
    assert set(p) == {"notice", "language", "issuer", "delivery_order", "can_sign", "signed"} and set(p["issuer"]) == {"name", "logo_url"}
    assert p["delivery_order"]["lines"] == [{"description": "Banner", "qty": "2", "uom": "pcs"}] and p["delivery_order"]["show_prices"] is False
    blob = json.dumps(p).lower()
    assert not [w for w in ("33.33", "99.99", "66.66", "unit_price", "total", "margin", "cost", "supplier", "tenant_id") if w in blob]
    r = sign(e, tok)
    assert r.status_code == 200 and r.json()["status"] == "signed" and r.json()["problems_reported"] is False
    assert sign(e, tok).json() == r.json()  # a double tap: the same answer, nothing changes
    assert sign(e, tok, name=NAME.upper()).status_code == 200  # same person, different case
    c = sign(e, tok, name="Somebody Else")
    assert c.status_code == 409 and c.json()["error"]["code"] == "already_signed" and c.json()["error"]["signed"]["name"] == NAME
    assert sign(e, tok, problems="late").status_code == 409  # a different statement on a signed order is a conflict
    s = e.sql("select * from delivery_signatures")
    assert len(s) == 1 and s[0]["signer_name"] == NAME and s[0]["agreed"] is True and s[0]["problems_note"] is None and s[0]["mark"] is None
    assert s[0]["signer_ip_hash"] not in (None, "testclient") and len(s[0]["doc_sha256"]) == 64
    assert s[0]["doc_sha256"] == e.sql("""select encode(sha256(convert_to(jsonb_build_object('doc_no', doc_no, 'job_id', job_id, 'lines', lines, 'subtotal', subtotal,
        'tax_total', tax_total, 'total', total, 'extra', extra, 'layout', layout_snapshot)::text, 'UTF8')), 'hex') h from deal_docs where kind='delivery_order'""")[0]["h"]
    assert e.sql("select status from deal_docs where id=%s", (d["id"],))[0]["status"] == "signed"
    after = get(e, tok).json()
    assert after["can_sign"] is False and after["signed"]["name"] == NAME and after["delivery_order"]["status"] == "signed"
    assert any(x["actor"] == "customer:link" for x in e.sql("select actor from audit_log where event like %s", ("delivery order DO-% signed by link",)))
    assert e.sql("select status from jobs where id=%s", (j,))[0]["status"] != "done"  # 2 of 3 are signed: not finished
    c = chain_of(e, j)
    assert c["stage"] == "in_production" and c["delivery"]["complete"] is False and c["delivery"]["lines"][0]["signed"] == "2.000"
    assert c["delivery_orders"][0]["signature"] == {"name": NAME, "at": c["delivery_orders"][0]["signature"]["at"], "problems": None, "has_mark": False}
    # the rest, signed: the job is done and the stage is delivered
    rest = mk_do(e, j)
    assert sign(e, link(e, rest["id"]), name="Ali bin Abu").status_code == 200
    job = e.sql("select status, done_at from jobs where id=%s", (j,))[0]
    assert job["status"] == "done" and job["done_at"] is not None
    c = chain_of(e, j)
    assert c["stage"] == "delivered" and c["delivery"]["complete"] is True and c["job"]["status"] == "done"
    assert events(e, "job done: every ordered item is on a signed delivery order") and e.sql("select count(*) n from audit_log where entity='jobs' and actor='customer:link'")[0]["n"] >= 3
    assert e.sql("select count(*) n from audit_log where entity='delivery_signatures'")[0]["n"] == 2
    assert "Aisyah" not in json.dumps(e.sql("select after from audit_log where entity='delivery_signatures'"), default=str)  # names stay out of the audit rows


def test_a_job_already_done_stays_done_without_a_second_event(e):
    j = ready_hand(e)
    e.sql("update jobs set status='done', done_at=now() where id=%s", (j,))
    signed_do(e, j)
    assert e.sql("select status from jobs where id=%s", (j,))[0]["status"] == "done" and not events(e, "job done:%")


def test_a_problem_report_is_stored_flagged_on_the_job_and_shown_in_the_chain(e):
    j = ready_hand(e)
    e.c.post(f"/api/jobs/{j}", json={"notes": "Call before delivering"}, headers=e.O)
    d = mk_do(e, j)
    tok = link(e, d["id"])
    assert sign(e, tok, problems="x" * 301).status_code == 422
    r = sign(e, tok, problems="  Frame\x07 is\n scratched,  one letter missing ")
    assert r.status_code == 200 and r.json()["problems_reported"] is True
    assert e.sql("select problems_note from delivery_signatures")[0]["problems_note"] == "Frame is scratched, one letter missing"
    notes = e.sql("select notes from jobs where id=%s", (j,))[0]["notes"]
    assert notes == f"Delivery problem reported on {d['doc_no']}: Frame is scratched, one letter missing\nCall before delivering"
    assert events(e, f"delivery problem reported on {d['doc_no']}")
    assert sign(e, tok, problems="Frame is scratched, one letter missing").status_code == 200  # the same statement again
    c = chain_of(e, j)
    assert c["problems"] == [{"doc_no": d["doc_no"], "note": "Frame is scratched, one letter missing", "at": c["problems"][0]["at"]}]
    assert c["delivery_orders"][0]["signature"]["problems"] == "Frame is scratched, one letter missing"
    assert get(e, tok).json()["signed"]["problems"] == "Frame is scratched, one letter missing"
    assert "scratched" in pdf_of(e, d["id"]) and "Reported on receipt" in pdf_of(e, d["id"])
    assert e.sql("select count(*) n from audit_log where entity='delivery_signatures' and after::text like %s", ("%scratched%",))[0]["n"] == 1  # the note is audited


def test_name_agree_and_body_checks(e):
    d = mk_do(e, ready_hand(e))
    tok = link(e, d["id"])
    for bad in ("", " ", "A", "x" * 81, "\x07\x00 \x1b"):
        r = sign(e, tok, name=bad)
        assert r.status_code == 422 and r.json()["error"]["code"] == "bad_name", bad
    assert sign(e, tok, agree=False).json()["error"]["code"] == "must_agree"
    for body in ({"name": NAME}, {"name": NAME, "agree": True, "extra": 1}, {"name": "N" * 5000, "agree": True}):
        assert e.c.post(f"/api/public/delivery/{tok}/sign", json=body).status_code == 422
    assert e.sql("select status from deal_docs where kind='delivery_order'")[0]["status"] == "issued" and count(e, "delivery_signatures") == 0


def test_the_drawn_mark_is_a_small_real_png_or_it_is_refused(e):
    d = mk_do(e, ready_hand(e))
    tok = link(e, d["id"])
    header_only = bytearray(base64.b64decode(png().split(",", 1)[1]))
    header_only[16:24] = struct.pack(">II", 60000, 60000)  # a tiny file that claims a huge bitmap: refused from the header, never decoded
    bad = {"a jpeg": "data:image/jpeg;base64," + png().split(",", 1)[1], "not base64": "data:image/png;base64,@@@@",
           "a gif in a png url": "data:image/png;base64," + base64.b64encode(b"GIF89a" + b"\x00" * 40).decode(),
           "svg": "data:image/svg+xml;base64," + base64.b64encode(b"<svg onload=alert(1)/>").decode(), "plain text": "hello",
           "too many pixels": png(700, 400), "bomb header": "data:image/png;base64," + base64.b64encode(bytes(header_only)).decode(),
           "over 100 KB": png(190, 140, noise=True), "truncated": png()[:-40], "empty": "data:image/png;base64,"}
    for why, v in bad.items():
        r = sign(e, tok, mark=v)
        assert r.status_code == 422 and r.json()["error"]["code"] in ("bad_mark", "invalid_request"), (why, r.status_code, r.text[:120])
    assert sign(e, tok, mark="x" * 200_000).status_code == 422
    assert count(e, "delivery_signatures") == 0
    deps.HITS.clear()
    ok = sign(e, tok, mark=png(200, 80))
    assert ok.status_code == 200
    stored = e.sql("select mark from delivery_signatures")[0]["mark"]
    assert stored.startswith("data:image/png;base64,") and len(stored) < 200_000
    assert Image.open(io.BytesIO(base64.b64decode(stored.split(",", 1)[1]))).size == (200, 80)
    assert "data:image" not in json.dumps(e.sql("select after from audit_log where entity='delivery_signatures'"), default=str)
    r = e.c.get(f"/api/deal-docs/{d['id']}/pdf", headers=e.O)
    assert len(PdfReader(io.BytesIO(r.content)).pages[0].images) == 1  # the mark is printed on the signature block
    assert chain_of(e, e.sql("select job_id from deal_docs where id=%s", (d["id"],))[0]["job_id"])["delivery_orders"][0]["signature"]["has_mark"] is True


def test_a_signed_delivery_order_cannot_be_edited_and_a_void_is_loud(e):
    j = ready_hand(e)
    d = signed_do(e, j)
    for q in ("update deal_docs set lines = '[]' where kind='delivery_order'", "update deal_docs set total = 1 where kind='delivery_order'",
              "update deal_docs set doc_no = 'DO-X' where kind='delivery_order'"):
        with pytest.raises(psycopg.errors.RaiseException, match="frozen"):
            e.sql(q)
    with pytest.raises(psycopg.errors.RaiseException, match="status cannot go back"):
        e.sql("update deal_docs set status='issued' where kind='delivery_order'")
    for q in ("update delivery_signatures set signer_name = 'Mallory'", "delete from delivery_signatures", "update delivery_signatures set problems_note = 'x'"):
        with pytest.raises(psycopg.Error):
            e.sql(q)
    err(e.c.post(f"/api/deal-docs/{d['id']}/void", json={"reason": "undo it"}, headers=e.S), 403, "owner_only")
    assert e.sql("select status from deal_docs where id=%s", (d["id"],))[0]["status"] == "signed"
    assert e.c.post(f"/api/deal-docs/{d['id']}/void", json={"reason": "goods were returned"}, headers=e.O).status_code == 200
    assert events(e, f"SIGNED delivery_order {d['doc_no']} voided: goods were returned")  # not silent
    assert count(e, "delivery_signatures") == 1  # the proof itself stays
    c = chain_of(e, j)
    assert c["stage"] == "in_production" and c["delivery"]["lines"][0]["signed"] == "0.000"  # the stage follows the live signed documents
    assert mk_do(e, j)["doc_no"].endswith("-0002")


# ---------------------------------------------------------------- the PDF
@pytest.mark.parametrize("lang,title", [("en", "Delivery Order"), ("ms", "Order Penghantaran"), ("zh", "送货单"), ("ta", None)])
def test_the_delivery_order_pdf_renders_unsigned_and_signed_in_every_language(e, lang, title):
    j = ready_hand(e)
    assert e.c.post("/api/settings", json={"doc_language": lang}, headers=e.O).status_code == 200
    d = mk_do(e, j)
    un = e.c.get(f"/api/deal-docs/{d['id']}/pdf", headers=e.O)
    assert un.status_code == 200 and un.content[:5] == b"%PDF-"
    assert sign(e, link(e, d["id"]), problems="Kotak kemek 箱子损坏").status_code == 200
    sg = e.c.get(f"/api/deal-docs/{d['id']}/pdf", headers=e.O)
    assert sg.status_code == 200 and sg.content[:5] == b"%PDF-" and sg.content != un.content
    assert d["doc_no"] in text(sg.content)
    if title:  # shaped Tamil has no text layer to read back
        assert title in text(un.content) and title in text(sg.content)
        assert NAME in text(sg.content) and "1,000.00" not in text(sg.content)
        assert doc_layout.WORDS["do_problems"][lang] in text(sg.content)
    assert NAME not in text(un.content)


def test_prices_on_the_delivery_order_follow_the_layout_switch(e):
    j = ready_banners(e)
    assert e.c.put("/api/settings/doc-layout/delivery_order", json={"show_prices": True}, headers=e.O).status_code == 200
    d = mk_do(e, j, lines=[{"no": 1, "qty": "2"}])
    t = pdf_of(e, d["id"])
    assert "66.66" in t and "33.33" in t  # 2 x 33.33 at the quote's price, before SST
    e.c.put("/api/settings/doc-layout/delivery_order", json={"show_prices": False}, headers=e.O)
    assert "66.66" in pdf_of(e, d["id"])  # the issued paper keeps the layout it was issued with
    page = get(e, link(e, d["id"])).json()["delivery_order"]
    assert page["show_prices"] is True and page["lines"][0]["unit_price"] == "33.3300" and page["lines"][0]["line_total"] == "66.66" and page["total"] == "66.66"


def test_the_public_functions_are_closed_to_everyone_but_the_app_role(e):
    d = mk_do(e, ready_hand(e))
    for fn in ("delivery_link_open", "delivery_link_sign"):
        acl = e.sql("select proacl::text a from pg_proc where proname=%s", (fn,))[0]["a"]
        assert not re.search(r"[{,]=X/", acl) and "laris_app=X/" in acl, acl  # no PUBLIC execute (an entry with no role name), the app role only
    assert e.sql("select delivery_link_open('nope', now()) r", role="staff")[0]["r"] is None
    assert e.sql("select delivery_link_sign('nope', 'Some One', 'h', null, null, now()) r", role="staff")[0]["r"] == {"result": "not_found"}
    assert e.sql("select status from deal_docs where id=%s", (d["id"],))[0]["status"] == "issued"


# ---------------------------------------------------------------- invoice, final payment, receipt
def inv(e, job, who=None, **body):
    return e.c.post(f"/api/jobs/{job}/invoice", json=body, headers=who or e.O)


def test_the_invoice_is_blocked_before_delivery_unless_the_owner_overrides(e):
    j = ready_hand(e)
    err(inv(e, j), 409, "not_delivered")
    mk_do(e, j)
    err(inv(e, j), 409, "not_delivered")  # issued is not signed
    r = inv(e, j, override_reason="  customer collected it  ")
    assert r.status_code == 201, r.text
    assert e.sql("select extra->>'override_reason' o from deal_docs where kind='invoice'")[0]["o"] == "customer collected it"
    assert events(e, "invoice INV-% issued, RM700.00 due (before delivery, override: customer collected it)")
    j2 = ready_hand(e, "10.00", title="Delivered")
    signed_do(e, j2)
    r2 = inv(e, j2)
    assert r2.status_code == 201 and "override_reason" not in e.sql("select extra from deal_docs where id=%s", (r2.json()["id"],))[0]["extra"]


def test_invoice_amount_is_the_total_minus_the_deposit_to_the_cent(e):
    j = ready_hand(e, "1000.01", pct=30)  # deposit 300.00 (300.003 rounds down)
    signed_do(e, j)
    r = inv(e, j)
    assert r.status_code == 201, r.text
    x = r.json()
    assert x["kind"] == "invoice" and x["doc_no"].startswith("INV-") and x["total"] == "1000.01" and x["tax_total"] is None
    assert x["extra"]["deposit_paid"] == "300.00" and x["extra"]["balance_due"] == "700.01"
    t = pdf_of(e, x["id"])
    assert "Invoice" in t and "Tax Invoice" not in t and "Deposit paid" in t and "300.00" in t and "Balance due" in t and "700.01" in t and "1,000.01" in t
    assert chain_of(e, j)["invoice"]["balance_due"] == "700.01"
    err(inv(e, j), 409, "already_issued")


def test_a_tax_invoice_only_for_an_sst_registered_business_and_the_balance_includes_the_tax(e):
    e.sql("update tenants set sst_registered=true, sst_no='W10-1234567-89'")
    j = quote_job(e, pct=30)
    e.sql("update document_lines set tax_rate=8 where document_id=(select quote_id from jobs where id=%s)", (j,))
    pf = proforma(e, j).json()
    total, tax, sub = Decimal(pf["total"]), Decimal(pf["tax_total"]), Decimal(pf["subtotal"])
    assert tax > 0 and total == sub + tax
    dep = Decimal(pf["extra"]["deposit_amount"])
    assert pay(e, j, str(dep), key="dep-key-sst01").status_code == 201
    signed_do(e, j)
    x = inv(e, j).json()
    assert Decimal(x["total"]) == total and Decimal(x["tax_total"]) == tax
    assert Decimal(x["extra"]["balance_due"]) == total - dep and Decimal(x["extra"]["deposit_paid"]) == dep
    t = pdf_of(e, x["id"])
    assert "Tax Invoice" in t and f"{total - dep:,.2f}" in t and f"{tax:,.2f}" in t



def test_the_invoice_due_date_comes_from_the_body_or_the_payment_terms(e):
    j = ready_hand(e)
    signed_do(e, j)
    err(inv(e, j, due_on="2020-01-01"), 422, "bad_due")
    e.sql("update tenants set quote_payment_terms='Net 14, bank transfer'")
    x = inv(e, j).json()
    assert x["extra"]["due_on"] == (datetime.now(timezone(timedelta(hours=8))).date() + timedelta(days=14)).isoformat()
    assert f"Due date: {x['extra']['due_on']}" in pdf_of(e, x["id"])
    e.c.post(f"/api/deal-docs/{x['id']}/void", json={"reason": "wrong terms"}, headers=e.O)
    assert inv(e, j, due_on="2099-12-31").json()["extra"]["due_on"] == "2099-12-31"
    assert chain._due("30 days from invoice", datetime(2026, 1, 1).date()).isoformat() == "2026-01-31"
    assert chain._due("on delivery", datetime(2026, 1, 1).date()) is None and chain._due(None, datetime(2026, 1, 1).date()) is None


def test_paying_the_balance_pays_the_order_and_the_receipt_says_paid_and_names_the_invoice(e):
    j = ready_hand(e, "1000.00")
    signed_do(e, j)
    x = inv(e, j).json()
    c = chain_of(e, j)
    assert c["stage"] == "awaiting_payment" and c["invoice"]["balance_due"] == "700.00" and c["invoice"]["receipts"] == []
    part = pay(e, j, "200.00", key="bal-key-0001", purpose="balance", method="cash").json()
    c = chain_of(e, j)
    assert c["stage"] == "awaiting_payment" and c["invoice"]["balance_due"] == "500.00"
    t = pdf_of(e, part["receipt"]["id"])
    assert "PAID" not in t and "500.00" in t and x["doc_no"] in t
    last = pay(e, j, "500.00", key="bal-key-0002", purpose="balance", method="duitnow", reference="REF 77").json()
    c = chain_of(e, j)
    assert c["stage"] == "paid" and c["balance"] == "0.00" and c["invoice"]["balance_due"] == "0.00"
    assert [r["doc_no"] for r in c["invoice"]["receipts"]] == [part["receipt"]["doc_no"], last["receipt"]["doc_no"]]
    assert all(r["payment_id"] for r in c["invoice"]["receipts"])
    t = pdf_of(e, last["receipt"]["id"])
    assert "PAID" in t and "REF 77" in t and x["doc_no"] in t and "Deposit receipt" not in t
    dep_receipt = next(d for d in c["documents"] if d["kind"] == "receipt" and d["payment_id"] not in {r["payment_id"] for r in c["invoice"]["receipts"]})
    assert "invoice_id" not in dep_receipt["extra"]  # the deposit receipt came before the invoice
    err(pay(e, j, "0.01", key="bal-key-0003", purpose="balance"), 409, "conflict")  # nothing left to pay


def test_an_invoice_is_voidable_only_while_no_balance_payment_exists(e):
    j = ready_hand(e, "1000.00")
    signed_do(e, j)
    x = inv(e, j).json()
    void = lambda doc, why="reissue it": e.c.post(f"/api/deal-docs/{doc}/void", json={"reason": why}, headers=e.O)
    p = pay(e, j, "100.00", key="bal-key-0001", purpose="balance").json()
    err(void(x["id"]), 409, "has_payments")
    assert e.c.post(f"/api/payments/{p['payment']['id']}/reverse", json={"reason": "bounced"}, headers=e.O).status_code == 201
    assert void(x["id"]).status_code == 200  # the deposit alone does not stop it; a reversed balance payment no longer counts
    assert chain_of(e, j)["invoice"] is None and chain_of(e, j)["stage"] == "delivered"
    y = inv(e, j).json()  # the slot is free; the deposit is still on it
    assert y["doc_no"].endswith("-0002") and y["extra"]["balance_due"] == "700.00"
    pf = e.sql("select id from deal_docs where kind='proforma'")[0]["id"]
    err(void(pf), 409, "has_payments")  # the proforma still stops at any money


# ---------------------------------------------------------------- overdue rules
def test_overdue_rules_are_exact_at_their_edges():
    now = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)
    at = lambda days: now - timedelta(days=days)
    assert tr.overdue_reason("order", "awaiting_deposit", at(tr.DEPOSIT_CHASE_DAYS), now) is None
    assert tr.overdue_reason("order", "awaiting_deposit", at(tr.DEPOSIT_CHASE_DAYS + 1), now) == "deposit not received"
    assert tr.overdue_reason("order", "in_production", at(99), now) is None
    today = now.date()
    assert tr.overdue_reason("order", "awaiting_payment", at(40), now, valid_until=today) is None  # due today is not late yet
    assert tr.overdue_reason("order", "awaiting_payment", at(40), now, valid_until=today - timedelta(days=1)) == "invoice unpaid past its due date"
    assert tr.overdue_reason("order", "awaiting_payment", at(40), now) is None  # no due date, no rule
    assert tr.overdue_reason("order", "paid", at(40), now, valid_until=today - timedelta(days=9)) is None
    assert "order" not in tr.KINDS  # not on the tracker list yet


def test_the_chain_reports_the_two_overdue_reasons(e, monkeypatch):
    later = lambda days: type("Later", (datetime,), {"now": classmethod(lambda cls, tz=None: datetime.now(tz) + timedelta(days=days))})
    j = hand_job(e, "1000.00")
    proforma(e, j, deposit_pct=30)
    assert chain_of(e, j)["overdue"] is None
    monkeypatch.setattr(chain, "datetime", later(tr.DEPOSIT_CHASE_DAYS + 1))
    assert chain_of(e, j)["overdue"] == "deposit not received"
    monkeypatch.setattr(chain, "datetime", datetime)
    pay(e, j, "300.00", key="dep-key-0001")
    signed_do(e, j)
    today = datetime.now(timezone(timedelta(hours=8))).date()
    inv(e, j, due_on=today.isoformat())
    assert chain_of(e, j)["overdue"] is None
    monkeypatch.setattr(chain, "datetime", later(2))
    c = chain_of(e, j)
    assert c["stage"] == "awaiting_payment" and c["overdue"] == "invoice unpaid past its due date"
