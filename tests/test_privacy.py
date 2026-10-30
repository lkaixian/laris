"""PDPA tools: DPO contact, breach register (clock, no delete), per-person export, erase, retention of request photos."""
from datetime import datetime, timedelta, timezone

import psycopg
import pytest

from src import scheduler
from src.api import privacy
from src.api.deps import STAFF_HIDE
from support.fixtures import env, pg_url  # noqa: F401
from test_api import make_draft
from test_rfq import other_tenant

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
BREACH = {"detected_at": T0.isoformat(), "summary": "Laptop lost", "data_types": ["names"], "people_affected": 5, "significant_harm": True}


def keys(x):
    if isinstance(x, dict):
        for k, v in x.items():
            yield k
            yield from keys(v)
    elif isinstance(x, list):
        for v in x:
            yield from keys(v)


def at(s):
    return datetime.fromisoformat(s)


def test_owner_only_and_validation(env):
    e = env
    for m, u, kw in (("get", "/api/settings/privacy", {}), ("post", "/api/settings/privacy", {"json": {}}), ("get", "/api/privacy/breaches", {}),
                     ("post", "/api/privacy/breaches", {"json": BREACH})):
        assert getattr(e.c, m)(u, headers=e.S, **kw).status_code == 403
    assert e.c.get("/api/settings/privacy", headers=e.O).json() == {"dpo_name": None, "dpo_email": None, "dpo_phone": None, "notice_version": 1, "require_optin": False, "configured": False}
    assert e.c.post("/api/settings/privacy", json={"dpo_name": "A", "dpo_email": "nope"}, headers=e.O).status_code == 422
    r = e.c.post("/api/settings/privacy", json={"dpo_name": "Aida", "dpo_email": "dpo@example.com"}, headers=e.O)
    assert r.status_code == 200 and r.json()["configured"] is True and r.json()["notice_version"] == 1
    assert e.c.post("/api/settings/privacy", json={"dpo_name": "Aida", "dpo_phone": "012", "notice_version": 2}, headers=e.O).json()["notice_version"] == 2
    assert e.c.post("/api/settings/privacy", json={"dpo_name": "Aida"}, headers=e.O).json()["notice_version"] == 2  # not bumped by itself
    log = e.sql("select event, before, after from audit_log where entity='tenant_privacy'")
    assert log and all("Aida" not in str(x) and "example.com" not in str(x) for x in log)
    bad = dict(BREACH, detected_at="2026-01-01T00:00:00")
    assert e.c.post("/api/privacy/breaches", json=bad, headers=e.O).status_code == 422
    assert e.c.post("/api/privacy/breaches", json=dict(BREACH, summary="x" * 1001), headers=e.O).status_code == 422


def test_deadline_math(env, monkeypatch):
    e = env
    bid = e.c.post("/api/privacy/breaches", json=BREACH, headers=e.O).json()["id"]
    state = {"t": T0 + timedelta(hours=10)}
    monkeypatch.setattr(privacy, "now", lambda: state["t"])
    row = lambda: e.c.get("/api/privacy/breaches", headers=e.O).json()["incidents"][0]
    r = row()
    assert at(r["commissioner_due"]) == T0 + timedelta(hours=72) and r["hours_left"] == 62.0 and not r["commissioner_overdue"] and r["subjects_due"] is None
    assert "Circular 2/2025" in r["rule_note"] and "Circular 2/2025" in e.c.get("/api/privacy/breaches", headers=e.O).json()["rule_note"]
    state["t"] = T0 + timedelta(hours=73)
    assert row()["commissioner_overdue"] is True and row()["hours_left"] == -1.0
    sent = T0 + timedelta(hours=80)
    r = e.c.post(f"/api/privacy/breaches/{bid}", json={"commissioner_notified_at": sent.isoformat()}, headers=e.O).json()
    assert at(r["subjects_due"]) == sent + timedelta(days=7) and not r["commissioner_overdue"] and r["hours_left"] == 175.0
    state["t"] = sent + timedelta(days=7, hours=1)
    assert row()["subjects_overdue"] is True
    r = e.c.post(f"/api/privacy/breaches/{bid}", json={"subjects_notified_at": state["t"].isoformat(), "status": "closed", "notes": "done"}, headers=e.O).json()
    assert r["subjects_overdue"] is False and r["hours_left"] is None and r["status"] == "closed"
    assert e.c.post(f"/api/privacy/breaches/{bid}", json={"summary": None}, headers=e.O).status_code == 422
    ev = [x["event"] for x in e.sql("select event from audit_log where entity='breach_incidents' order by at")]
    assert len(ev) == 3 and "done" not in str(e.sql("select before, after from audit_log where entity='breach_incidents'"))


def test_not_significant_has_no_subject_clock(env):
    e = env
    r = e.c.post("/api/privacy/breaches", json=dict(BREACH, significant_harm=False, commissioner_notified_at=T0.isoformat()), headers=e.O).json()
    assert r["subjects_due"] is None and r["notifiable"] is False


def test_register_cannot_be_deleted_and_is_tenant_scoped(env):
    e = env
    bid = e.c.post("/api/privacy/breaches", json=BREACH, headers=e.O).json()["id"]
    with pytest.raises(psycopg.Error):
        e.sql("delete from breach_incidents where id=%s", (bid,))
    assert e.sql("select count(*) n from breach_incidents")[0]["n"] == 1
    assert e.c.delete(f"/api/privacy/breaches/{bid}", headers=e.O).status_code in (404, 405)
    other = other_tenant(e)
    assert e.c.get("/api/privacy/breaches", headers=other).json()["incidents"] == []
    assert e.c.post(f"/api/privacy/breaches/{bid}", json={"notes": "x"}, headers=other).status_code == 404
    e.c.post("/api/settings/privacy", json={"dpo_name": "Aida", "dpo_email": "dpo@example.com"}, headers=e.O)
    assert e.c.get("/api/settings/privacy", headers=other).json()["configured"] is False


def codes(e):
    return {i["code"]: i["level"] for i in e.c.get("/api/system/health", headers=e.O).json()["items"]}


def test_health_checks(env):
    e = env
    assert codes(e)["privacy_dpo_missing"] == "warn" and "breach_overdue" not in codes(e)
    e.c.post("/api/settings/privacy", json={"dpo_name": "Aida", "dpo_email": "dpo@example.com"}, headers=e.O)
    old = (datetime.now(timezone.utc) - timedelta(hours=80)).isoformat()
    bid = e.c.post("/api/privacy/breaches", json=dict(BREACH, detected_at=old), headers=e.O).json()["id"]
    c = codes(e)
    assert "privacy_dpo_missing" not in c and c["breach_overdue"] == "critical"
    e.c.post(f"/api/privacy/breaches/{bid}", json={"commissioner_notified_at": datetime.now(timezone.utc).isoformat()}, headers=e.O)
    assert "breach_overdue" not in codes(e)
    fresh = e.c.post("/api/privacy/breaches", json=dict(BREACH, detected_at=datetime.now(timezone.utc).isoformat()), headers=e.O).json()
    assert "breach_overdue" not in codes(e) and fresh["hours_left"] > 70


def test_export_and_erase(env):
    e = env
    d = make_draft(e)
    cust = e.sql("select party_id from documents where id=%s", (d,))[0]["party_id"]
    e.sql("update parties set contact='+60123456789', email='c@example.com', notes='likes red' where id=%s", (cust,))
    e.sql("update documents set extraction='{\"name\":\"Cust\"}' where id=%s", (d,))
    assert e.c.get(f"/api/parties/{cust}/export", headers=e.S).status_code == 403
    other = other_tenant(e)
    assert e.c.get(f"/api/parties/{cust}/export", headers=other).status_code == 404
    j = e.c.get(f"/api/parties/{cust}/export", headers=e.O).json()
    assert j["party"]["contact"] == "+60123456789" and j["party"]["email"] == "c@example.com"
    assert j["messages"] and set(j["messages"][0]) == {"direction", "channel", "text", "transcript", "created_at"}
    assert j["quotes"] and j["quotes"][0]["lines"] and j["truncated"] is False
    assert not set(keys(j)) & STAFF_HIDE and not any("cost" in k or "margin" in k for k in keys(j))
    assert e.sql("select count(*) n from audit_log where event='personal data exported'")[0]["n"] == 1
    assert e.c.post(f"/api/parties/{cust}/erase", headers=e.O).status_code == 200
    p = e.sql("select name, contact, email, notes from parties where id=%s", (cust,))[0]
    assert p["contact"] is None and p["email"] is None and p["notes"] is None
    assert e.sql("select extraction from documents where id=%s", (d,))[0]["extraction"] is None
    j = e.c.get(f"/api/parties/{cust}/export", headers=e.O).json()
    assert all(m["text"] == "[erased]" for m in j["messages"]) and j["quotes"]
    assert "+60123456789" not in str(e.sql("select before, after from audit_log where entity='parties' and event like '%%erased%%'"))


def test_request_photo_purged_after_90_days(env):
    e = env
    tid = e.sql("select tenant_id from users where id=%s", (e.owner,))[0]["tenant_id"]
    for age in (10, 100):
        e.sql("insert into rfq_items(tenant_id, description, note, image, image_mime, created_at) values (%s,'d','n','\\x01','image/png', now() - %s * interval '1 day')", (tid, age))
    scheduler.run_once()
    assert e.sql("select length(image) l from rfq_items order by created_at desc") == [{"l": 1}, {"l": 0}]


def test_commissioner_clock_runs_from_the_earlier_of_occurred_and_detected(env):
    e = env
    occ = T0 - timedelta(hours=30)
    r = e.c.post("/api/privacy/breaches", json=dict(BREACH, occurred_at=occ.isoformat()), headers=e.O).json()
    assert datetime.fromisoformat(r["commissioner_due"]) == occ + timedelta(hours=72)
    late = e.c.post("/api/privacy/breaches", json=dict(BREACH, occurred_at=(T0 + timedelta(hours=5)).isoformat()), headers=e.O).json()
    assert datetime.fromisoformat(late["commissioner_due"]) == T0 + timedelta(hours=72)  # a later "occurred" never pushes the clock out


def test_harm_factors_make_harm_significant_and_start_the_people_clock(env):
    e = env
    r = e.c.post("/api/privacy/breaches", json=dict(BREACH, significant_harm=False, harm_factors=["identity_fraud"], commissioner_notified_at=T0.isoformat()), headers=e.O).json()
    assert r["notifiable"] and datetime.fromisoformat(r["subjects_due"]) == T0 + timedelta(days=7)
    assert e.c.post("/api/privacy/breaches", json=dict(BREACH, harm_factors=["nonsense"]), headers=e.O).status_code == 422
    big = e.c.post("/api/privacy/breaches", json=dict(BREACH, significant_harm=False, people_affected=5000, commissioner_notified_at=T0.isoformat()), headers=e.O).json()
    assert big["notifiable"] and big["subjects_due"] is None  # more than 1,000 people: tell the Commissioner, not necessarily the people
