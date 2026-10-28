"""Customer accept link: a SIMULATED e-signature. The link holder has no account; db/accept.sql functions do the guarded steps. No network."""
import json
import logging
import re
import time
from datetime import datetime, timezone

import psycopg
import pytest

from src import clock
from support.fixtures import env, pg_url, same  # noqa: F401
from test_api import keys
from test_quotes import approved, send

COST_WORDS = ("1500", "1,500", "900.00", "37.5", "margin", "cost", "supplier", "unit_cost", "tenant_id", "party")
NAME = "Aisyah binti Tan"


@pytest.fixture
def e(env, monkeypatch):
    monkeypatch.setenv("APP_PUBLIC_URL", "https://shop.test")
    return env


def sent(e):
    d = approved(e, email="cust@shop.test")
    assert send(e, d).status_code == 200
    return d


def link(e, d, who=None):
    r = e.c.post(f"/api/documents/{d}/accept-link", headers=who or e.O)
    assert r.status_code == 200, r.text
    return r.json()["url"].rsplit("/", 1)[1]


def get(e, tok):
    return e.c.get(f"/api/public/quote/{tok}")


def accept(e, tok, **kw):
    return e.c.post(f"/api/public/quote/{tok}/accept", json={"name": NAME, "agree": True, **kw})


def decline(e, tok, **kw):
    return e.c.post(f"/api/public/quote/{tok}/decline", json=kw)


def status(e, d):
    return e.sql("select status::text s from documents where id=%s", (d,))[0]["s"]


def jobs(e, d):
    return e.sql("select count(*) n from jobs where quote_id=%s", (d,))[0]["n"]


def test_accept_creates_one_job_and_replay_is_idempotent(e):
    d = sent(e)
    tok = link(e, d)
    g = get(e, tok)
    assert g.status_code == 200 and g.headers["cache-control"] == "no-store"
    j = g.json()
    assert j["simulated"] is True and j["can_accept"] is True and j["decided"] is None
    assert set(j) >= {"simulated", "issuer", "quote", "can_accept", "decided"} and set(j["issuer"]) == {"name", "logo_url"}
    assert set(j["quote"]) == {"doc_no", "valid_until", "status", "currency", "total", "note", "lines"} and j["quote"]["currency"] == "RM"
    assert j["quote"]["status"] == "read" and status(e, d) == "read"  # opening it moved sent -> read
    assert set(j["quote"]["lines"][0]) == {"description", "qty", "uom", "unit_price", "line_total"}
    assert float(j["quote"]["total"]) > 0
    blob = json.dumps(j).lower()
    assert not [w for w in COST_WORDS if w.lower() in blob] and not keys(j) & ({"cost", "margin", "supplier", "id", "tenant_id"})
    r = accept(e, tok)
    assert r.status_code == 200 and r.json() == {"status": "accepted", "job_created": True, "simulated": True}
    assert status(e, d) == "accepted" and jobs(e, d) == 1
    again = accept(e, tok)
    assert again.status_code == 200 and again.json() == r.json() and jobs(e, d) == 1
    after = get(e, tok).json()
    assert after["can_accept"] is False and after["decided"]["decision"] == "accepted" and after["decided"]["name"] == NAME
    c = decline(e, tok)
    assert c.status_code == 409 and c.json()["error"]["code"] == "already_decided" and c.json()["error"]["decided"]["decision"] == "accepted"
    assert status(e, d) == "accepted"


def test_owner_sees_the_event_the_job_and_the_audit(e):
    d = sent(e)
    tok = link(e, d)
    assert accept(e, tok).status_code == 200
    ev = e.c.get(f"/api/documents/{d}/timeline", headers=e.O).json()["events"]
    assert f"Accepted by {NAME} via link (simulated e-signature)" in [x["title"] for x in ev]
    rows = e.sql("select actor, event from audit_log where entity='documents' and entity_id=%s", (d,))
    assert ("customer:link", "accepted by link (simulated e-signature)") in {(x["actor"], x["event"]) for x in rows}
    assert ("customer:link", "status sent->accepted") in {(x["actor"], x["event"]) for x in rows}
    assert e.sql("select count(*) n from audit_log where entity='jobs' and actor='customer:link'")[0]["n"] == 1
    assert e.sql("select count(*) n from audit_log where event='customer accept link created' and entity_id=%s", (d,))[0]["n"] >= 2  # send + explicit
    doc_no = e.c.get(f"/api/documents/{d}", headers=e.O).json()["doc"]["doc_no"]
    assert doc_no in e.c.get("/api/jobs", headers=e.O).text


def test_decline_path(e):
    d = sent(e)
    tok = link(e, d)
    assert decline(e, tok, reason="x" * 301).status_code == 422
    r = decline(e, tok, reason="  too dear  ")
    assert r.status_code == 200 and r.json() == {"status": "rejected", "simulated": True}
    assert status(e, d) == "rejected" and jobs(e, d) == 0
    assert e.sql("select decision_reason r from documents where id=%s", (d,))[0]["r"] == "too dear"
    assert decline(e, tok).status_code == 200  # same decision again: same answer
    a = accept(e, tok)
    assert a.status_code == 409 and a.json()["error"]["decided"]["decision"] == "declined" and jobs(e, d) == 0
    ev = e.c.get(f"/api/documents/{d}/timeline", headers=e.O).json()["events"]
    assert "Declined by customer via link (simulated)" in [x["title"] for x in ev]


def test_unknown_revoked_and_short_tokens_all_get_the_same_404(e):
    d = sent(e)
    old = link(e, d)
    new = link(e, d)  # a new link revokes the older unused ones
    assert get(e, new).status_code == 200
    bad = [get(e, old), get(e, "A" * 32), get(e, "short"), get(e, "x" * 200), get(e, "a%20b" + "c" * 20)]
    assert all(r.status_code == 404 and r.json()["error"]["code"] == "not_found" for r in bad) and same(*bad)
    posts = [accept(e, old), accept(e, "A" * 32), decline(e, "short")]
    assert all(r.status_code == 404 for r in posts) and same(*posts)
    assert status(e, d) == "read" and jobs(e, d) == 0
    assert e.sql("select count(*) n from quote_accept_links where quote_id=%s and revoked_at is not null", (d,))[0]["n"] >= 1


def test_token_is_never_stored_or_logged(e, caplog):
    caplog.set_level(logging.DEBUG)
    d = sent(e)
    tok = link(e, d)
    get(e, tok), accept(e, tok), get(e, "Z" * 32)
    rows = json.dumps(e.sql("select * from quote_accept_links"), default=str)
    assert tok not in rows and "Z" * 32 not in rows
    assert re.search(r"[0-9a-f]{64}", rows)  # the sha256 of the token is
    every = json.dumps(e.sql("select * from audit_log"), default=str) + json.dumps(e.sql("select body from messages"), default=str)
    assert tok not in every and tok not in caplog.text and NAME not in caplog.text
    mails = " ".join(m[3] for m in e.svc.outbox)
    assert "https://shop.test/#/q/" in mails and "Review and accept" in mails and "not a legal e-signature" in mails


def test_expired_by_valid_until_and_by_the_clock(e, monkeypatch):
    d = sent(e)
    e.sql("update documents set valid_until='2030-01-15' where id=%s", (d,))
    r = e.c.post(f"/api/documents/{d}/accept-link", headers=e.O).json()
    exp = datetime.fromisoformat(r["expires_at"]).astimezone(timezone.utc)
    assert exp == datetime(2030, 1, 15, 16, 0, tzinfo=timezone.utc)  # end of 15 Jan, Kuala Lumpur
    tok = r["url"].rsplit("/", 1)[1]
    assert get(e, tok).status_code == 200
    monkeypatch.setattr(clock, "ntp_time", lambda: None)
    monkeypatch.setattr(clock, "system_time", lambda: exp.timestamp() + 60)
    clock.reset()
    assert get(e, tok).status_code == 404 and accept(e, tok).status_code == 404 and decline(e, tok).status_code == 404
    assert status(e, d) == "read" and jobs(e, d) == 0
    clock.reset()


def test_only_open_quotes_and_only_the_owner_make_links(e):
    d = approved(e)
    assert e.c.post(f"/api/documents/{d}/accept-link", headers=e.S).json()["error"]["code"] == "owner_only"
    tok = link(e, d)  # approved is fine
    assert get(e, tok).status_code == 404  # but nothing to sign until it is sent
    e.sql("update documents set status='sent' where id=%s", (d,))
    assert get(e, tok).status_code == 200
    e.sql("update documents set status='expired' where id=%s", (d,))
    assert get(e, tok).status_code == 404
    assert e.c.post(f"/api/documents/{d}/accept-link", headers=e.O).status_code == 409


def test_without_a_public_url_there_is_no_link_and_no_button(env, monkeypatch):
    monkeypatch.delenv("APP_PUBLIC_URL", raising=False)
    e = env
    d = approved(e, email="cust@shop.test")
    assert e.c.post(f"/api/documents/{d}/accept-link", headers=e.O).json()["error"]["code"] == "public_url_missing"
    assert send(e, d).status_code == 200 and "Review and accept" not in e.svc.outbox[-1][3]
    assert e.sql("select count(*) n from quote_accept_links")[0]["n"] == 0


def test_chat_send_adds_one_line_with_the_link_but_never_stores_it(e):
    d = approved(e, contact="60123456789")
    assert send(e, d, "whatsapp").status_code == 200
    ch, to, fn, caption, data, pn = e.svc.docs[-1]
    tok = re.search(r"https://shop.test/#/q/([A-Za-z0-9_-]+)", caption).group(1)
    assert "Review and accept:" in caption and get(e, tok).status_code == 200
    assert tok not in json.dumps(e.sql("select body from messages"), default=str)


def test_the_owner_guard_is_unchanged_for_everyone_else(e):
    d = sent(e)
    assert e.c.post(f"/api/documents/{d}/transition", json={"to": "accepted"}, headers=e.S).status_code == 403
    assert e.c.post(f"/api/documents/{d}/transition", json={"to": "accepted"}).status_code == 401
    with pytest.raises(psycopg.errors.RaiseException):
        e.sql("update documents set status='accepted' where id=%s", (d,), role="staff")
    with pytest.raises(psycopg.errors.RaiseException):
        e.sql("update documents set status='accepted' where id=%s", (d,), role="")
    assert status(e, d) == "sent" and jobs(e, d) == 0
    # the function itself refuses anything but a valid link
    assert e.sql("select accept_link_decide('nope','accepted','Some One','h',null,now()) r", role="staff")[0]["r"] == {"result": "not_found"}
    assert status(e, d) == "sent"
    assert e.c.post(f"/api/documents/{d}/transition", json={"to": "accepted"}, headers=e.O).status_code == 200  # the owner path still works


def test_another_business_cannot_touch_the_link_or_the_quote(e):
    from test_public_api import other_tenant_owner
    d = sent(e)
    tok = link(e, d)
    other = other_tenant_owner(e)
    assert e.c.post(f"/api/documents/{d}/accept-link", headers=other).status_code == 404
    assert accept(e, tok).status_code == 200
    ot = e.sql("select tenant_id from users where id=%s", (other["X-User"],))[0]["tenant_id"]
    assert e.sql("select count(*) n from jobs where tenant_id=%s", (ot,))[0]["n"] == 0
    assert e.sql("select tenant_id from jobs where quote_id=%s", (d,))[0]["tenant_id"] == e.sql("select tenant_id from documents where id=%s", (d,))[0]["tenant_id"]


def test_name_and_body_validation(e):
    d = sent(e)
    tok = link(e, d)
    for bad in ("", " ", "A", "x" * 81, "\x07\x00 \x1b"):
        r = accept(e, tok, name=bad)
        assert r.status_code == 422 and r.json()["error"]["code"] == "bad_name", bad
    r = accept(e, tok, agree=False)
    assert r.status_code == 422 and r.json()["error"]["code"] == "must_agree"
    assert e.c.post(f"/api/public/quote/{tok}/accept", json={"name": NAME, "agree": True, "extra": 1}).status_code == 422
    assert e.c.post(f"/api/public/quote/{tok}/accept", json={"name": NAME}).status_code == 422
    assert e.c.post(f"/api/public/quote/{tok}/accept", json={"name": "N" * 5000, "agree": True}).status_code == 422  # the model caps the field
    assert status(e, d) == "sent" and jobs(e, d) == 0
    assert accept(e, tok, name="  Aisyah\x07\n <b>Tan</b>  ").status_code == 200  # control characters out, the rest as typed
    assert e.sql("select signer_name n from quote_accept_links where decision='accepted'")[0]["n"] == "Aisyah <b>Tan</b>"
    assert get(e, tok).json()["decided"]["name"] == "Aisyah <b>Tan</b>"
    assert e.sql("select signer_ip_hash h from quote_accept_links where decision='accepted'")[0]["h"] not in (None, "testclient")


def test_rate_limits(e):
    d = sent(e)
    tok = link(e, d)
    codes = [get(e, tok).status_code for _ in range(32)]
    assert codes[:30] == [200] * 30 and codes[30:] == [429, 429]
    assert get(e, tok).json()["error"]["code"] == "rate_limited"
    from src.api import deps
    deps.HITS.clear()
    codes = [decline(e, "q" * 32).status_code for _ in range(12)]
    assert codes[:10] == [404] * 10 and codes[10:] == [429, 429]
    assert accept(e, tok).json()["error"]["code"] == "rate_limited"
    assert status(e, d) == "read"
