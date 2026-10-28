"""PDPA tools, all owner-only and audited: the data protection officer contact, the breach register, and a per-person export."""
import re
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator

from ..errors import ApiError
from .deps import Ctx, audit, guarded, read_ctx, reply, require_owner, write_ctx

r = APIRouter(prefix="/api")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
RULE_NOTE = ("Deadlines are 72 hours to the Commissioner and 7 days to the people affected, as we understand the Commissioner's guideline; "
             "confirm the current rule at pdp.gov.my before relying on them.")
SCALE = 1000  # people affected above this also count as notifiable (vault note, unverified)
CAP = 5000  # export: most rows of each kind


def now() -> datetime:  # tests patch this
    return datetime.now(timezone.utc)


# ---- DPO contact -------------------------------------------------------------------------------------------------
class PrivacyIn(BaseModel, extra="forbid"):
    dpo_name: str | None = Field(None, max_length=120)
    dpo_email: str | None = Field(None, max_length=254)
    dpo_phone: str | None = Field(None, max_length=40)
    notice_version: int | None = Field(None, ge=1, le=10000)  # bumped by the owner when the privacy notice text changes

    @field_validator("dpo_email")
    @classmethod
    def _email(cls, v):
        if v and not EMAIL.match(v):
            raise ValueError("not an email address")
        return v or None


def _privacy(ctx: Ctx) -> dict:
    row = ctx.conn.execute("select dpo_name, dpo_email, dpo_phone, notice_version from tenant_privacy where tenant_id=%s", (ctx.tenant_id,)).fetchone() \
        or {"dpo_name": None, "dpo_email": None, "dpo_phone": None, "notice_version": 1}
    return {**row, "configured": bool(row["dpo_name"] and (row["dpo_email"] or row["dpo_phone"]))}


@r.get("/settings/privacy")
def get_privacy(ctx: Ctx = Depends(read_ctx)):
    require_owner(ctx)
    return reply(ctx, _privacy(ctx))


@r.post("/settings/privacy")
def set_privacy(body: PrivacyIn, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    d = {k: (v.strip() or None) if isinstance(v, str) else v for k, v in body.model_dump().items()}
    with guarded():
        ctx.conn.execute(
            """insert into tenant_privacy(tenant_id, dpo_name, dpo_email, dpo_phone, notice_version)
               values (%(t)s, %(dpo_name)s, %(dpo_email)s, %(dpo_phone)s, coalesce(%(notice_version)s, 1))
               on conflict (tenant_id) do update set dpo_name=excluded.dpo_name, dpo_email=excluded.dpo_email, dpo_phone=excluded.dpo_phone,
                 notice_version=coalesce(%(notice_version)s, tenant_privacy.notice_version), updated_at=now()""",
            {**d, "t": ctx.tenant_id})
    audit(ctx, "tenant_privacy", ctx.tenant_id, "dpo contact changed")  # the contact is personal data: the event names no value
    return reply(ctx, _privacy(ctx))


# ---- breach register ---------------------------------------------------------------------------------------------
class BreachIn(BaseModel, extra="forbid"):
    detected_at: datetime
    summary: str = Field(min_length=1, max_length=1000)  # no names, numbers or message text
    data_types: list[str] = Field(default_factory=list, max_length=20)
    people_affected: int | None = Field(None, ge=0, le=100000000)
    significant_harm: bool = False
    commissioner_notified_at: datetime | None = None
    subjects_notified_at: datetime | None = None
    notes: str | None = Field(None, max_length=2000)

    @field_validator("detected_at", "commissioner_notified_at", "subjects_notified_at")
    @classmethod
    def _tz(cls, v):
        if v is not None and v.tzinfo is None:
            raise ValueError("include a time zone, for example +08:00")
        return v

    @field_validator("data_types")
    @classmethod
    def _types(cls, v):
        if any(not t.strip() or len(t) > 60 for t in v):
            raise ValueError("each data type is 1 to 60 characters")
        return [t.strip() for t in v]


class BreachEdit(BreachIn):
    detected_at: datetime | None = None
    summary: str | None = Field(None, min_length=1, max_length=1000)
    status: str | None = Field(None, pattern="^(open|closed)$")


def _view(b: dict) -> dict:
    t = now()
    notifiable = b["significant_harm"] or (b["people_affected"] or 0) > SCALE
    c_due = b["detected_at"] + timedelta(hours=72)
    s_due = b["commissioner_notified_at"] + timedelta(days=7) if b["significant_harm"] and b["commissioner_notified_at"] else None
    c_wait = notifiable and not b["commissioner_notified_at"] and b["status"] == "open"
    s_wait = bool(s_due) and not b["subjects_notified_at"] and b["status"] == "open"
    due = c_due if c_wait else s_due if s_wait else None
    return {**b, "notifiable": notifiable, "commissioner_due": c_due, "subjects_due": s_due,
            "commissioner_overdue": c_wait and t > c_due, "subjects_overdue": s_wait and t > s_due,
            "hours_left": round((due - t).total_seconds() / 3600, 1) if due else None, "rule_note": RULE_NOTE}


COLS = "id, detected_at, summary, data_types, people_affected, significant_harm, commissioner_notified_at, subjects_notified_at, status, notes, created_at"


@r.get("/privacy/breaches")
def list_breaches(ctx: Ctx = Depends(read_ctx)):
    require_owner(ctx)
    rows = ctx.conn.execute(f"select {COLS} from breach_incidents where tenant_id=%s order by detected_at desc, created_at desc limit 1000", (ctx.tenant_id,)).fetchall()
    return reply(ctx, {"incidents": [_view(b) for b in rows], "rule_note": RULE_NOTE})


@r.post("/privacy/breaches")
def add_breach(body: BreachIn, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    with guarded():
        b = ctx.conn.execute(
            f"""insert into breach_incidents(tenant_id, detected_at, summary, data_types, people_affected, significant_harm,
                  commissioner_notified_at, subjects_notified_at, notes, created_by)
                values (%(t)s, %(detected_at)s, %(summary)s, %(data_types)s, %(people_affected)s, %(significant_harm)s,
                  %(commissioner_notified_at)s, %(subjects_notified_at)s, %(notes)s, %(u)s) returning {COLS}""",
            {**body.model_dump(), "t": ctx.tenant_id, "u": ctx.user_id}).fetchone()
    audit(ctx, "breach_incidents", b["id"], "breach recorded", None, {"detected_at": b["detected_at"], "significant_harm": b["significant_harm"], "people_affected": b["people_affected"]})
    return reply(ctx, _view(b), 201)


@r.post("/privacy/breaches/{bid}")
def edit_breach(bid: UUID, body: BreachEdit, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    sets = body.model_dump(exclude_unset=True)
    if not sets:
        raise ApiError(422, "empty", "nothing to change")
    if any(sets[k] is None for k in sets.keys() & {"detected_at", "summary", "data_types", "significant_harm", "status"}):
        raise ApiError(422, "bad_value", "that field cannot be cleared")
    old = ctx.conn.execute(f"select {COLS} from breach_incidents where id=%s and tenant_id=%s for update", (bid, ctx.tenant_id)).fetchone()
    if not old:
        raise ApiError(404, "not_found", "incident not found")
    with guarded():
        b = ctx.conn.execute("update breach_incidents set " + ", ".join(f"{k}=%({k})s" for k in sets) + f" where id=%(id)s and tenant_id=%(t)s returning {COLS}",
                             {**sets, "id": bid, "t": ctx.tenant_id}).fetchone()
    plain = [k for k in sets if k not in ("summary", "notes", "data_types")]  # free text stays out of the audit trail
    audit(ctx, "breach_incidents", bid, "breach updated: " + ",".join(sorted(sets)), {k: old[k] for k in plain}, {k: b[k] for k in plain})
    return reply(ctx, _view(b))


# ---- per-person export -------------------------------------------------------------------------------------------
@r.get("/parties/{pid}/export")
def export_party(pid: UUID, ctx: Ctx = Depends(read_ctx)):
    """Access / portability: everything held about one contact. Sold prices only, never a cost or margin figure. Each list holds at most CAP rows."""
    require_owner(ctx)
    c, t = ctx.conn, ctx.tenant_id
    p = c.execute("select id, role, name, contact, email, attention, ssm_no, sst_no, address, notes from parties where id=%s and tenant_id=%s", (pid, t)).fetchone()
    if not p:
        raise ApiError(404, "not_found", "party not found")
    enq = c.execute("select id, channel, status, created_at from enquiries where party_id=%s and tenant_id=%s order by created_at limit %s", (pid, t, CAP)).fetchall()
    msgs = c.execute("""select m.direction, m.channel, m.body as text, m.transcript, m.created_at from messages m
                        where m.enquiry_id in (select id from enquiries where party_id=%(p)s) or m.document_id in (select id from documents where party_id=%(p)s)
                        order by m.created_at limit %(n)s""", {"p": pid, "n": CAP}).fetchall()
    docs = c.execute("""select id, direction, doc_no as number, status, issued_on, valid_until, sent_at, created_at from documents
                        where party_id=%s and tenant_id=%s order by created_at limit %s""", (pid, t, CAP)).fetchall()
    lines = c.execute("""select l.document_id, l.line_no, l.description, l.qty, l.uom, l.unit_price as price, l.discount_pct from document_lines l
                         where l.document_id = any(%s) and not l.is_header order by l.document_id, l.line_no limit %s""", ([d["id"] for d in docs], CAP * 5)).fetchall()
    for d in docs:
        d["lines"] = [{k: v for k, v in x.items() if k != "document_id"} for x in lines if x["document_id"] == d["id"]]
    replies = c.execute("""select rr.message_text as text, rr.unit_price as price, rr.min_qty, rr.status, rr.created_at from rfq_replies rr
                           join rfq_sends s on s.id = rr.send_id where s.supplier_id=%s and rr.tenant_id=%s order by rr.created_at limit %s""", (pid, t, CAP)).fetchall()
    audit(ctx, "parties", pid, "personal data exported", None, {"enquiries": len(enq), "messages": len(msgs), "documents": len(docs), "replies": len(replies)})
    return reply(ctx, {"party": p, "enquiries": enq, "messages": msgs, "quotes": docs, "replies": replies,
                       "truncated": any(len(x) >= CAP for x in (enq, msgs, docs, replies))})
