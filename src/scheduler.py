"""Background jobs. run_once() is the testable unit; start() wraps it in APScheduler (app lifespan, SCHEDULER=1)."""
import os

from . import db
from .templates import load_template


def run_once() -> dict:
    """Expire sent quotes past valid_until (allowed transition, owner-level system actor), then queue a
    follow-up for sent/read quotes with no decision after the template's followup_hours (once per quote)."""
    with db.tx("owner", "system:scheduler") as c:
        expired = c.execute("""update documents set status='expired', decision_reason='validity period ended'
                               where direction='out' and status in ('sent','read') and valid_until < current_date""").rowcount
        queued = 0
        for t in c.execute("select id, trade_template from tenants").fetchall():
            hrs = load_template(t["trade_template"])["followup_hours"]
            queued += c.execute(
                """insert into followups(document_id, due_at, reason)
                   select d.id, now(), 'no reply after ' || %s::text || 'h' from documents d
                   where d.tenant_id=%s and d.direction='out' and d.status in ('sent','read')
                     and d.sent_at < now() - %s * interval '1 hour'
                     and not exists (select 1 from followups f where f.document_id=d.id)""",
                (hrs, t["id"], hrs)).rowcount
    return {"expired": expired, "followups": queued}


def start():
    from apscheduler.schedulers.background import BackgroundScheduler
    s = BackgroundScheduler()
    s.add_job(run_once, "interval", minutes=int(os.environ.get("SCHEDULER_MINUTES", "15")), max_instances=1)
    s.start()
    return s
