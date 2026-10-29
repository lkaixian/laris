"""Background jobs. run_once() is the testable unit; start() wraps it in APScheduler (app lifespan, SCHEDULER=1).
Every step runs per tenant in its own transaction and try/except, so one broken tenant cannot roll back or block the others."""
import logging
import os
from datetime import datetime, time

from . import db, mailer, pipeline
from . import license as lic
from .templates import load_template

log = logging.getLogger("laris")
last_run = {"at": None, "ok": None, "errors": 0, "last_error": None}  # updated by every run_once; read it through status()


def status() -> dict:
    return dict(last_run)


def send_mail(*a, **kw) -> bool:
    """The one place the scheduler sends email (tests replace it or mailer.send). Never raises."""
    return mailer.send(*a, **kw)


def purge_old_chats(c) -> int:
    """Chat text carries phone numbers and prices: blank it after RETENTION_DAYS (default 180, 0 keeps everything).
    Quotes, lines and the audit log stay; only the stored message bodies and transcripts go."""
    days = int(os.environ.get("RETENTION_DAYS", "180"))
    if days <= 0:
        return 0
    return c.execute("""update messages set body = '[expired]', transcript = null, media_key = null
                        where created_at < now() - %s * interval '1 day' and (body is distinct from '[expired]' and body is distinct from '[erased]')""",
                     (days,)).rowcount


def purge_stale(c) -> int:
    """Housekeeping across all businesses (ages are in docs/deploy.md): spent or expired email codes (1 day), finished invites (30 days),
    signups never verified (7 days, with their otherwise empty business), supplier reply text (180 days) and catalog photos (90 days).
    Rows stay for replies and catalog items; only the text / image bytes go (empty bytea, the image columns are NOT NULL)."""
    from .api.signup import _drop_pending
    n = c.execute("delete from email_codes where coalesce(used_at, expires_at) < now() - interval '1 day'").rowcount
    n += c.execute("""delete from invites where coalesce(accepted_at, expires_at) < now() - interval '30 days'
                      and (status <> 'pending' or expires_at < now() - interval '30 days')""").rowcount
    for u in c.execute("""select id, tenant_id from users u where not active and email_verified_at is null and created_at < now() - interval '7 days'
                          and not exists (select 1 from users o where o.tenant_id=u.tenant_id and o.id<>u.id) for update""").fetchall():
        _drop_pending(c, u)
        n += 1
    n += c.execute("update rfq_replies set message_text = null where message_text is not null and created_at < now() - interval '180 days'").rowcount
    n += c.execute("update listing_items set crop = ''::bytea where length(crop) > 0 and listing_id in (select id from listings where created_at < now() - interval '90 days')").rowcount
    n += c.execute("update rfq_items set image = ''::bytea where length(image) > 0 and created_at < now() - interval '90 days'").rowcount  # the photo sent to suppliers
    n += c.execute("update listings set image = ''::bytea where length(image) > 0 and created_at < now() - interval '90 days'").rowcount
    return n


def expire_quotes(c, tid) -> int:
    return c.execute("""update documents set status='expired', decision_reason='validity period ended'
                        where tenant_id=%s and direction='out' and status in ('sent','read') and valid_until < current_date""", (tid,)).rowcount


def queue_followups(c, tid, template) -> int:
    hrs = load_template(template)["followup_hours"]
    return c.execute(
        """insert into followups(document_id, due_at, reason)
           select d.id, now(), 'no reply after ' || %s::text || 'h' from documents d
           where d.tenant_id=%s and d.direction='out' and d.status in ('sent','read')
             and d.sent_at < now() - %s * interval '1 hour'
             and not exists (select 1 from followups f where f.document_id=d.id)""", (hrs, tid, hrs)).rowcount


def remind_jobs(c, tid) -> int:
    """One email per person listing their jobs due today or overdue; a job is reminded at most once per Malaysian calendar day.
    Recipient: the assignee (verified email), else the active owners with a verified email. Returns the emails sent."""
    if lic.status(c, tid)["read_only"]:
        return 0
    today = pipeline.today_my()
    jobs = c.execute(
        """select j.id, j.assignee_id, coalesce(d.doc_no, j.title) as doc_no, coalesce(p.name, 'no customer') as customer,
                  (%s::date - j.due_on) as days_overdue
           from jobs j left join documents d on d.id = j.quote_id left join parties p on p.id = coalesce(d.party_id, j.party_id)
           where j.tenant_id=%s and j.status <> 'done' and j.due_on <= %s
             and (j.remind_sent_at is null or j.remind_sent_at < %s) order by j.due_on, coalesce(d.doc_no, j.title), j.id""",
        (today, tid, today, datetime.combine(today, time.min, pipeline.MY))).fetchall()
    if not jobs:
        return 0
    people = {u["id"]: u for u in c.execute(
        "select id, name, email, role::text as role from users where tenant_id=%s and active and email is not null and email_verified_at is not null", (tid,))}
    owners = [u for u in people.values() if u["role"] == "owner"]
    to: dict[str, dict] = {}  # lower-cased email -> {user, jobs}
    skipped = 0
    for j in jobs:
        who = [people[j["assignee_id"]]] if j["assignee_id"] in people else [] if j["assignee_id"] else owners
        skipped += not who
        for u in who:
            to.setdefault(u["email"].lower(), {"user": u, "jobs": []})["jobs"].append(j)
    base = (os.environ.get("APP_PUBLIC_URL") or "").rstrip("/")
    sent = 0
    for e in to.values():
        if send_mail(e["user"]["email"], *mailer.job_reminder_mail(e["user"]["name"], e["jobs"], f"{base}/#/jobs" if base else None), category="job_reminder"):
            c.execute("update jobs set remind_sent_at = now() where id = any(%s)", ([j["id"] for j in e["jobs"]],))
            sent += 1
    log.info("job reminders: %s email(s) sent, %s job(s) without a recipient", sent, skipped)
    return sent


SCHED_LOCK = 7412340002  # pg_try_advisory_lock key: with two instances running, only one does a pass at a time


def run_once() -> dict:
    """One pass, skipped (all zeros) when another instance holds the lock. See _run."""
    import psycopg
    with psycopg.connect(db.url(), autocommit=True, prepare_threshold=None, connect_timeout=15) as lk:
        if not lk.execute("select pg_try_advisory_lock(%s)", (SCHED_LOCK,)).fetchone()[0]:
            log.info("scheduler: another instance is running a pass, skipped")
            return {"expired": 0, "followups": 0, "purged": 0, "reminders": 0}
        return _run()  # the lock is released when `lk` closes


def _run() -> dict:
    """Per tenant: blank old chat text, expire sent quotes past valid_until (allowed transition, owner-level system actor), queue a
    follow-up for sent/read quotes with no decision after the template's followup_hours (once per quote), and email job reminders."""
    out, errors, last = {"expired": 0, "followups": 0, "purged": 0, "reminders": 0}, 0, None
    try:
        with db.tx("owner", "system:scheduler", tenant=db.ALL_TENANTS) as c:
            tenants = c.execute("select id, trade_template from tenants order by name, id").fetchall()
    except Exception as e:
        log.warning("scheduler: could not list tenants: %s", type(e).__name__)
        tenants, errors, last = [], 1, type(e).__name__
    try:
        with db.tx("owner", "system:scheduler", tenant=db.ALL_TENANTS) as c:
            log.info("scheduler: purged %s stale row(s)", purge_stale(c))
    except Exception as e:
        errors, last = errors + 1, type(e).__name__
        log.warning("scheduler: purge failed: %s %s", type(e).__name__, getattr(getattr(e, "diag", None), "message_primary", "") or "")  # a database error names the column or table, never row values
    for t in tenants:
        for key, step in (("purged", lambda c: purge_old_chats(c)), ("expired", lambda c: expire_quotes(c, t["id"])),
                          ("followups", lambda c: queue_followups(c, t["id"], t["trade_template"])), ("reminders", lambda c: remind_jobs(c, t["id"]))):
            try:
                with db.tx("owner", "system:scheduler", tenant=str(t["id"])) as c:  # its own transaction, scoped to the tenant
                    out[key] += step(c)
            except Exception as e:  # no row data in the log, only the exception type
                errors, last = errors + 1, type(e).__name__
                log.warning("scheduler: tenant %s failed: %s", str(t["id"])[:8], type(e).__name__)
    last_run.update(at=datetime.now(pipeline.MY).isoformat(), ok=not errors, errors=errors, last_error=last)
    return out


def start():
    from apscheduler.schedulers.background import BackgroundScheduler
    s = BackgroundScheduler()
    s.add_job(run_once, "interval", minutes=int(os.environ.get("SCHEDULER_MINUTES", "15")), max_instances=1)
    s.start()
    return s
