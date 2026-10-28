"""Step 110: job scheduling. A job exists from acceptance, has a due date / assignee / priority / notes, shows on an agenda, and the
scheduler emails reminders. Nothing touches a network (emails are captured), and each tenant's scheduler work stands alone."""
import json
import logging
import re
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

import psycopg
import pytest

from src import db, mailer, pipeline, scheduler
from src import license as lic
from src.api.deps import STAFF_HIDE
from support.fixtures import env, pg_url  # noqa: F401
from test_api import keys, seed_quote, tr
from test_license import PUB, Net
from test_rfq import other_tenant
from test_roles import member, role

TODAY = date(2026, 3, 11)  # a Wednesday
COST_WORDS = ("1500", "margin", "cost", "supplier")


def d(n: int, base: date = TODAY) -> str:
    return (base + timedelta(days=n)).isoformat()


def mkjob(e, no, due=None, status="todo", assignee=None):
    """A job on a fresh accepted quote of the owner's business (same customer as the seeded quote). Returns the job id."""
    return e.sql("""with q as (insert into documents(tenant_id, direction, kind, party_id, status, doc_no)
                      select tenant_id, 'out', 'quotation', party_id, 'accepted', %(no)s from documents
                      where direction='out' and tenant_id = (select tenant_id from users where id=%(o)s) limit 1 returning id, tenant_id)
                    insert into jobs(tenant_id, quote_id, status, due_on, assignee_id) select tenant_id, id, %(s)s, %(d)s, %(a)s from q returning id""",
                 {"no": no, "s": status, "d": due, "a": assignee, "o": e.owner})[0]["id"]


def accept(e):
    q = seed_quote(e)
    assert tr(e, q, "accepted").status_code == 200
    return q, e.sql("select id from jobs where quote_id=%s", (q,))[0]["id"]


def jobs(e, qs="", who=None):
    r = e.c.get("/api/jobs" + qs, headers=who or e.O)
    assert r.status_code == 200, r.text
    return r.json()


def post(e, jid, who=None, **body):
    return e.c.post(f"/api/jobs/{jid}", json=body, headers=who or e.O)


def err(r, status, code):
    assert r.status_code == status and r.json()["error"]["code"] == code, r.text


def n_audit(e):
    return e.sql("select count(*) n from audit_log")[0]["n"]


@pytest.fixture
def today(monkeypatch):
    monkeypatch.setattr(pipeline, "today_my", lambda: TODAY)


# ---------------------------------------------------------------- auto-create
def test_accepting_a_quote_creates_the_job_once_and_job_created_is_safe(env):
    e = env
    q = seed_quote(e)
    e.stock_costs()  # an inbound document accepted into the cost book is not a job
    assert jobs(e) == []
    assert tr(e, q, "accepted").status_code == 200
    (j,) = jobs(e)
    assert j["quote_id"] == str(q) and j["status"] == "todo" and j["due_on"] is None and j["assignee"] is None and j["priority"] == "normal"
    assert e.sql("select created_by from jobs")[0]["created_by"] == uuid.UUID(e.owner)
    assert tr(e, q, "job_created").status_code == 200  # still a valid owner step: no duplicate, no failure
    assert [x["id"] for x in jobs(e)] == [j["id"]]
    assert any(x["event"] == "insert" and x["entity"] == "jobs" for x in e.c.get("/api/audit", headers=e.O).json())


# ---------------------------------------------------------------- fields
def test_job_fields_validation_and_audit(env):
    e = env
    q, jid = accept(e)
    r = post(e, jid, due_on="2026-04-01", assignee_id=e.staff, priority="high", notes="  bring ladder ", status="doing")
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["due_on"] == "2026-04-01" and j["assignee"]["id"] == e.staff and j["assignee"]["name"] and j["priority"] == "high"
    assert j["notes"] == "  bring ladder " and j["status"] == "doing" and j["started_at"] and j["done_at"] is None and j["quote_no"]
    assert jobs(e)[0]["assignee"]["id"] == e.staff
    n = n_audit(e)
    assert post(e, jid, due_on="2026-04-01", priority="high").status_code == 200  # nothing changes: no new audit entry
    assert n_audit(e) == n
    assert post(e, jid, due_on=None, assignee_id=None, notes="").json()["due_on"] is None
    j = jobs(e)[0]
    assert j["due_on"] is None and j["assignee"] is None and j["notes"] is None
    ev = [x["event"] for x in e.sql("select event from audit_log where entity='jobs'")]
    assert "job changed: assignee_id,due_on,notes,priority,status" in ev and "job changed: assignee_id,due_on,notes" in ev

    other = other_tenant(e)
    ou = e.sql("select id from users where name='Other Owner'")[0]["id"]
    gone = e.sql("insert into users(tenant_id,name,role,active) select tenant_id,'Gone','staff',false from users where id=%s returning id", (e.owner,))[0]["id"]
    for bad in (uuid.uuid4(), ou, gone):
        err(post(e, jid, assignee_id=str(bad)), 422, "bad_assignee")
    assert jobs(e)[0]["assignee"] is None
    for body in ({}, {"status": None}, {"priority": None}, {"priority": "urgent"}, {"status": "bogus"}, {"due_on": "2026-02-30"}, {"due_on": "tomorrow"},
                 {"assignee_id": "x"}, {"notes": "x" * 2001}, {"colour": "red"}, {"quote_id": str(q)}):
        assert post(e, jid, **body).status_code == 422, body
    err(post(e, uuid.uuid4(), priority="low"), 404, "not_found")
    err(post(e, jid, who=other, priority="low"), 404, "not_found")
    assert post(e, jid, notes="x" * 2000).status_code == 200
    assert post(e, jid, assignee_id=e.staff).status_code == 200
    e.sql("update users set active=false where id=%s", (e.staff,))  # an assignee who later leaves stays on the job while other fields change
    assert post(e, jid, priority="low").json()["assignee"]["id"] == e.staff
    assert post(e, jid, assignee_id=e.owner).status_code == 200
    err(post(e, jid, assignee_id=e.staff), 422, "bad_assignee")


def test_started_and_done_timestamps_and_reopening(env):
    e = env
    _, jid = accept(e)
    row = lambda i=jid: e.sql("select status, started_at, done_at from jobs where id=%s", (i,))[0]
    assert row()["started_at"] is None
    assert post(e, jid, status="doing").json()["started_at"]
    s1 = row()["started_at"]
    assert post(e, jid, status="done").json()["done_at"] and row()["done_at"] and row()["started_at"] == s1
    assert post(e, jid, status="todo").json()["done_at"] is None and row()["done_at"] is None and row()["started_at"] == s1  # reopened
    assert post(e, jid, status="doing").status_code == 200 and row()["started_at"] == s1  # only the first move to doing counts
    jid2 = mkjob(e, "JB-2")
    assert post(e, jid2, status="done").json()["done_at"] and row(jid2)["started_at"] is None


# ---------------------------------------------------------------- list, agenda, dashboard
@pytest.fixture
def board(env, today):
    e = env
    ids = {"A": mkjob(e, "JB-A", d(-2)), "B1": mkjob(e, "JB-B1", d(0)), "B2": mkjob(e, "JB-B2", d(0)), "C": mkjob(e, "JB-C", d(5)),
           "D": mkjob(e, "JB-D", d(-6), status="doing"), "E": mkjob(e, "JB-E"), "F": mkjob(e, "JB-F", d(-1), status="done"),
           "G": mkjob(e, "JB-G", d(-10), status="done", assignee=e.staff)}
    e.sql("update jobs set priority='high' where id=%s", (ids["B2"],))
    e.sql("update jobs set assignee_id=%s where id in (%s, %s)", (e.owner, ids["A"], ids["B1"]))
    return e


def test_list_fields_and_filters(board):
    e = board
    by = {x["quote_no"][3:]: x for x in jobs(e)}
    assert len(by) == 8
    assert (by["A"]["overdue"], by["A"]["days_to_due"]) == (True, -2) and (by["B1"]["overdue"], by["B1"]["days_to_due"]) == (False, 0)
    assert by["C"]["days_to_due"] == 5 and by["E"]["days_to_due"] is None and by["E"]["overdue"] is False
    assert by["F"]["overdue"] is False and by["D"]["overdue"] is True  # done is never overdue
    assert {"total", "quote_total", "summary", "customer", "started_at", "done_at", "notes", "priority"} <= by["A"].keys()
    ids = lambda qs, who=None: sorted(x["quote_no"][3:] for x in jobs(e, qs, who))
    assert ids("?status=doing") == ["D"] and ids("?status=done") == ["F", "G"]
    assert ids("?assignee=me") == ["A", "B1"] and ids(f"?assignee={e.staff}") == ["G"] and ids("?assignee=me", e.S) == ["G"]
    assert ids("?overdue=1") == ["A", "D"] and ids("?overdue=true&status=doing") == ["D"]
    assert ids(f"?due_before={d(-1)}") == ["A", "D", "G"]  # strictly before; jobs with no date never match
    assert len(jobs(e, "?limit=3")) == 3
    for qs in ("?limit=0", "?limit=501", "?status=bogus", "?due_before=nope", "?overdue=maybe"):
        assert e.c.get("/api/jobs" + qs, headers=e.O).status_code == 422, qs
    err(e.c.get("/api/jobs?assignee=junk", headers=e.O), 422, "bad_param")


def test_agenda(board):
    e = board
    get = lambda qs="": e.c.get("/api/jobs/agenda" + qs, headers=e.O)
    a = get().json()  # default: Monday 9 March to Sunday 15 March
    assert (a["from"], a["to"]) == ("2026-03-09", "2026-03-15")
    assert [x["date"] for x in a["days"]] == [d(i, date(2026, 3, 9)) for i in range(7)]
    assert [x["weekday"] for x in a["days"]][:3] == ["Monday", "Tuesday", "Wednesday"] and a["days"][6]["weekday"] == "Sunday"
    names = lambda js: [x["quote_no"][3:] for x in js]
    assert [names(x["jobs"]) for x in a["days"]] == [["A"], ["F"], ["B2", "B1"], [], [], [], []]  # high priority first; C (16 March) is outside
    assert names(a["unscheduled"]) == ["E"] and names(a["overdue"]) == ["D"]  # G is done; D is due before the range
    b = get("?from=2026-03-01&to=2026-03-02").json()
    assert [x["date"] for x in b["days"]] == ["2026-03-01", "2026-03-02"] and names(b["overdue"]) == []
    c = get("?from=2026-03-16").json()
    assert c["to"] == "2026-03-22" and names(c["days"][0]["jobs"]) == ["C"] and names(c["overdue"]) == ["D", "A", "B2", "B1"]
    assert get("?to=2026-03-15").json()["from"] == "2026-03-09"
    assert len(get("?from=2026-01-01&to=2026-03-03").json()["days"]) == 62
    for qs in ("?from=2026-01-01&to=2026-03-04", "?from=2026-03-05&to=2026-03-04", "?from=bad", "?to=2026-13-01"):
        assert get(qs).status_code == 422, qs
    err(get("?from=2026-01-01&to=2026-03-04"), 422, "bad_range")
    assert e.c.get("/api/jobs/agenda", headers=e.S).status_code == 200  # staff read it too


def test_dashboard_counters(board):
    e = board
    dash = e.c.get("/api/dashboard", headers=e.S).json()
    assert dash["jobs_overdue"] == 2 and dash["jobs_due_today"] == 2  # A and D; B1 and B2
    assert dash["jobs"] == {"todo": 5, "doing": 1, "done": 2}


# ---------------------------------------------------------------- permissions, isolation
def test_permissions_and_scrubbed_reads(env):
    e = env
    q, jid = accept(e)
    nobody = member(e, role(e, "Nobody", []), "Nobody")
    err(post(e, jid, who=nobody, priority="low"), 403, "permission_required")
    assert jobs(e, who=nobody)[0]["id"] == str(jid) and e.c.get("/api/jobs/agenda", headers=nobody).status_code == 200
    for who in (e.S, nobody):
        got = [jobs(e, who=who), e.c.get("/api/jobs/agenda", headers=who).json()]
        assert not (keys(got) & STAFF_HIDE) and not any(w in json.dumps(got).lower() for w in COST_WORDS), who
    assert Decimal(jobs(e, who=nobody)[0]["total"]) == 2400  # the selling total only
    assert post(e, jid, who=e.S, priority="low").status_code == 200  # staff default has manage_contacts
    assert e.c.post(f"/api/jobs/{jid}", json={"priority": "low"}).status_code == 401


def test_other_tenants_never_see_or_touch_jobs(env, today):
    e = env
    _, jid = accept(e)
    mkjob(e, "JB-X", d(-3))
    other = other_tenant(e)
    assert jobs(e, who=other) == [] and e.c.get("/api/jobs/agenda", headers=other).json()["overdue"] == []
    err(post(e, jid, who=other, status="done"), 404, "not_found")
    dash = e.c.get("/api/dashboard", headers=other).json()
    assert dash["jobs_overdue"] == 0 and dash["jobs_due_today"] == 0
    assert e.c.get("/api/dashboard", headers=e.O).json()["jobs_overdue"] == 1


# ---------------------------------------------------------------- reminders
@pytest.fixture
def mails(monkeypatch):
    """Captures what the scheduler would email; mails.ok = False makes every send fail."""
    class M(list):
        ok = True
    m = M()
    monkeypatch.setattr(scheduler, "send_mail", lambda to, subject, text, html=None, category=None, attachments=None:
                        (m.append((to, subject, text, html)), m.ok)[1])
    return m


def verified(e, uid, email):
    e.sql("update users set email=%s, email_verified_at=now() where id=%s", (email, uid))


def sent_at(e, jid):
    return e.sql("select remind_sent_at s from jobs where id=%s", (jid,))[0]["s"]


def test_reminder_to_owners_lists_due_and_overdue_once_per_day(env, mails, monkeypatch):
    e = env
    verified(e, e.owner, "owner@shop.test")
    t = pipeline.today_my()
    due, late = mkjob(e, "JB-DUE", str(t)), mkjob(e, "JB-LATE", str(t - timedelta(days=3)))
    mkjob(e, "JB-FUTURE", str(t + timedelta(days=1)))
    mkjob(e, "JB-DONE", str(t), status="done")
    mkjob(e, "JB-NODATE")
    e.sql("update parties set name='A & <B> Sdn Bhd' where id=(select party_id from documents where direction='out' limit 1)")
    monkeypatch.delenv("APP_PUBLIC_URL", raising=False)
    assert scheduler.run_once()["reminders"] == 1
    ((to, subject, text, html),) = mails
    assert to == "owner@shop.test" and "2" in subject
    assert "JB-DUE   A & <B> Sdn Bhd  due today" in text and "JB-LATE" in text and "3 days overdue" in text
    assert "JB-FUTURE" not in text and "JB-DONE" not in text and "JB-NODATE" not in text and "http" not in text
    assert "A &amp; &lt;B&gt; Sdn Bhd" in html and "<B>" not in html
    assert not any(w in (text + re.sub(r"<style>.*?</style>|<[^>]+>", " ", html)).lower() for w in COST_WORDS)
    assert sent_at(e, due) and sent_at(e, late)
    assert scheduler.run_once()["reminders"] == 0 and len(mails) == 1  # once per job per day
    midnight = datetime.combine(t, datetime.min.time(), pipeline.MY)
    e.sql("update jobs set remind_sent_at=%s where id=%s", (midnight - timedelta(minutes=1), late))  # reminded yesterday
    monkeypatch.setenv("APP_PUBLIC_URL", "https://app.example.test/")
    assert scheduler.run_once()["reminders"] == 1 and len(mails) == 2
    assert "JB-LATE" in mails[1][2] and "JB-DUE" not in mails[1][2] and "Open the job board: https://app.example.test/#/jobs" in mails[1][2]
    assert "1 job is" in mails[1][2]


def test_reminder_goes_to_the_assignee_or_nobody(env, mails):
    e = env
    verified(e, e.owner, "owner@shop.test")
    today = str(pipeline.today_my())
    mine, hers, mine_owner, unassigned = (mkjob(e, "JB-1", today, assignee=e.staff), mkjob(e, "JB-2", today, assignee=e.staff),
                                          mkjob(e, "JB-3", today, assignee=e.owner), mkjob(e, "JB-4", today))
    e.sql("update users set email='staff@shop.test' where id=%s", (e.staff,))  # set but not verified
    scheduler.run_once()
    assert [(m[0], "JB-3" in m[2], "JB-4" in m[2], "JB-1" in m[2]) for m in mails] == [("owner@shop.test", True, True, False)]  # staff jobs skipped
    assert sent_at(e, mine) is None and sent_at(e, hers) is None and sent_at(e, mine_owner) and sent_at(e, unassigned)
    e.sql("update users set email_verified_at=now() where id=%s", (e.staff,))
    mails.clear()
    scheduler.run_once()
    assert [(m[0], "JB-1" in m[2] and "JB-2" in m[2] and "JB-3" not in m[2]) for m in mails] == [("staff@shop.test", True)]  # one email, both jobs
    assert sent_at(e, mine) and sent_at(e, hers)
    e.sql("update users set email=null, email_verified_at=null where id=%s", (e.owner,))  # no email anywhere: skipped, nothing recorded
    e.sql("update jobs set remind_sent_at=null")
    e.sql("update users set active=false where id=%s", (e.staff,))
    mails.clear()
    assert scheduler.run_once()["reminders"] == 0 and not mails and sent_at(e, unassigned) is None


def test_failed_email_is_retried_and_blocked_licence_is_skipped(env, mails, monkeypatch):
    e = env
    verified(e, e.owner, "owner@shop.test")
    jid = mkjob(e, "JB-1", str(pipeline.today_my()))
    mails.ok = False
    assert scheduler.run_once()["reminders"] == 0 and len(mails) == 1 and sent_at(e, jid) is None and scheduler.status()["ok"] is True
    mails.clear()
    monkeypatch.setenv("LICENSE_PUBLIC_KEY", PUB)
    Net().adopt(monkeypatch)
    lic.invalidate()
    try:
        mails.ok = True
        assert scheduler.run_once()["reminders"] == 0 and not mails and sent_at(e, jid) is None  # enforced, no licence: writes are paused
    finally:
        monkeypatch.delenv("LICENSE_PUBLIC_KEY")
        lic.invalidate()
    assert scheduler.run_once()["reminders"] == 1 and sent_at(e, jid)


def test_mailer_builds_the_reminder_without_cost_data():
    s, text, html = mailer.job_reminder_mail("Ann", [{"doc_no": "QT-1", "customer": "Acme", "days_overdue": 0},
                                                     {"doc_no": "QT-2", "customer": "Bo", "days_overdue": 1}], None)
    assert "2 jobs are due" in text and "due today" in text and "1 day overdue" in text and "Hello Ann," in html and "http" not in text


# ---------------------------------------------------------------- one tenant failing never stops another
def test_a_broken_tenant_does_not_stop_the_others_and_status_reports_it(env, mails, caplog):
    e = env
    first = e.sql("select tenant_id t from users where id=%s", (e.owner,))[0]["t"]
    e.sql("update tenants set name='A-first', trade_template='no_such_trade' where id=%s", (first,))  # sorts first; its template cannot load
    other_tenant(e)
    t2 = e.sql("select tenant_id t from users where name='Other Owner'")[0]["t"]
    uid = e.sql("select id from users where name='Other Owner'")[0]["id"]
    verified(e, uid, "other@shop.test")
    verified(e, e.owner, "owner@shop.test")
    mkjob(e, "JB-1", str(pipeline.today_my()))
    p = e.sql("insert into parties(tenant_id,role,name) values (%s,'customer','Zed') returning id", (t2,))[0]["id"]
    qd = e.sql("""insert into documents(tenant_id,direction,kind,party_id,status,doc_no,valid_until,sent_at,approved_by,approved_at)
                  values (%s,'out','quotation',%s,'sent','Z-1',current_date - 1,now(),%s,now()) returning id""", (t2, p, uid))[0]["id"]
    jid = e.sql("insert into jobs(tenant_id, quote_id, due_on) values (%s, %s, current_date) returning id", (t2, qd))[0]["id"]
    with caplog.at_level(logging.WARNING, logger="laris"):
        out = scheduler.run_once()
    assert out["reminders"] == 2 and out["expired"] == 1  # the broken tenant still gets its reminder; the other tenant's expiry is not blocked
    assert {m[0] for m in mails} == {"owner@shop.test", "other@shop.test"} and sent_at(e, jid)
    assert e.sql("select status::text s from documents where id=%s", (qd,))[0]["s"] == "expired"
    st = scheduler.status()
    assert st["ok"] is False and st["errors"] == 1 and st["last_error"] == "TemplateError" and st["at"]
    assert f"scheduler: tenant {str(first)[:8]} failed: TemplateError" in caplog.text
    st["errors"] = 99
    assert scheduler.status()["errors"] == 1  # a copy
    e.sql("update tenants set trade_template='made_to_order' where id=%s", (first,))
    scheduler.run_once()
    assert scheduler.status() == {"at": scheduler.status()["at"], "ok": True, "errors": 0, "last_error": None}


# ---------------------------------------------------------------- schema
def test_schema_is_idempotent_and_an_old_jobs_table_migrates(env, pg_url):
    e = env
    old = mkjob(e, "JB-OLD", status="done")
    db.apply_schema()
    db.apply_schema()
    new_cols = ("due_on", "assignee_id", "priority", "notes", "created_by", "started_at", "done_at", "remind_sent_at")
    with psycopg.connect(pg_url, autocommit=True) as c:
        c.execute("select set_config('laris.tenant', '*', false)")
        for col in new_cols:
            c.execute(f"alter table jobs drop column {col}")
        c.execute("alter table users drop constraint users_tenant_id_id_uq")
        db.apply_schema()
        cols = {x[0] for x in c.execute("select column_name from information_schema.columns where table_name='jobs'")}
        assert set(new_cols) <= cols
        assert c.execute("select done_at = created_at, priority from jobs where id=%s", (old,)).fetchone() == (True, "normal")
        assert c.execute("select count(*) from pg_constraint where conname in ('users_tenant_id_id_uq', 'jobs_assignee_fk')").fetchone()[0] == 2
        c.execute("update jobs set done_at = created_at + interval '1 day' where id=%s", (old,))
        db.apply_schema()
        assert c.execute("select done_at > created_at from jobs where id=%s", (old,)).fetchone()[0] is True  # the backfill runs once
        with pytest.raises(psycopg.errors.ForeignKeyViolation):  # an assignee must be a user of the job's own tenant
            c.execute("update jobs set assignee_id = %s where id = %s", (uuid.uuid4(), old))
