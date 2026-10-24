"""Job board and scheduling: one job per accepted quote, with a due date, an assignee, a priority and notes. Selling side only."""
from datetime import date, timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from .. import pipeline
from ..errors import ApiError
from .deps import Ctx, audit, read_ctx, reply, require_perm, write_ctx

r = APIRouter(prefix="/api")
STATUS = Literal["todo", "doing", "done"]
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
MAX_DAYS = 62  # agenda span, both ends included

SELECT = """select j.id, j.status, j.created_at, d.id as quote_id, d.doc_no as quote_no, p.name as customer,
                  (select coalesce(sum(round(l.qty * l.unit_price * (1 - coalesce(l.discount_pct, 0) / 100), 2)), 0)
                   from document_lines l where l.document_id = d.id and not l.is_header) as total,
                  (select string_agg(l.description || ' x ' || trim(trailing '.' from trim(trailing '0' from l.qty::text)), '; ' order by l.line_no)
                   from document_lines l where l.document_id = d.id and not l.is_header) as summary,
                  j.due_on, j.assignee_id, u.name as assignee_name, j.priority, j.notes, j.started_at, j.done_at
           from jobs j join documents d on d.id = j.quote_id join parties p on p.id = d.party_id
           left join users u on u.id = j.assignee_id where j.tenant_id = %(t)s"""
RANK = "case j.priority when 'high' then 0 when 'normal' then 1 else 2 end"


def shape(row: dict, today: date) -> dict:
    due = row["due_on"]
    out = {k: v for k, v in row.items() if k not in ("assignee_id", "assignee_name")}
    out["assignee"] = {"id": row["assignee_id"], "name": row["assignee_name"]} if row["assignee_id"] else None
    out["quote_total"] = row["total"]
    out["overdue"] = bool(due and due < today and row["status"] != "done")
    out["days_to_due"] = (due - today).days if due else None
    return out


def fetch(ctx: Ctx, where: str = "", params: dict | None = None, order: str = "j.created_at desc, j.id", limit: int = 500) -> list[dict]:
    today = pipeline.today_my()
    rows = ctx.conn.execute(f"{SELECT} {where} order by {order} limit %(n)s", {"t": ctx.tenant_id, "n": limit, **(params or {})}).fetchall()
    return [shape(x, today) for x in rows]


@r.get("/jobs")
def jobs(status: STATUS | None = None, assignee: str | None = Query(None, max_length=36), overdue: bool = False,
         due_before: date | None = None, limit: int = Query(200, ge=1, le=500), ctx: Ctx = Depends(read_ctx)):
    """Job board. Filters: status, assignee (a user id or 'me'), overdue=1, due_before=YYYY-MM-DD (jobs with a due date only)."""
    who = None
    if assignee:
        try:
            who = ctx.user_id if assignee == "me" else UUID(assignee)
        except ValueError:
            raise ApiError(422, "bad_param", "assignee is a user id or 'me'")
    where = ["(%(s)s::text is null or j.status = %(s)s)", "(%(a)s::uuid is null or j.assignee_id = %(a)s)",
             "(%(b)s::date is null or j.due_on < %(b)s)", "(not %(o)s or (j.due_on < %(today)s and j.status <> 'done'))"]
    return reply(ctx, fetch(ctx, "and " + " and ".join(where), {"s": status, "a": who, "b": due_before, "o": overdue, "today": pipeline.today_my()},
                            limit=limit))


@r.get("/jobs/agenda")
def agenda(from_: date | None = Query(None, alias="from"), to: date | None = None, ctx: Ctx = Depends(read_ctx)):
    """Jobs by due date over a range (default: this Monday to Sunday, Malaysia time), plus jobs with no date and jobs overdue from before the range."""
    today = pipeline.today_my()
    if from_ is None:
        from_ = to - timedelta(days=6) if to else today - timedelta(days=today.weekday())
    if to is None:
        to = from_ + timedelta(days=6)
    if to < from_ or (to - from_).days >= MAX_DAYS:
        raise ApiError(422, "bad_range", f"'to' must not be before 'from', and the range is at most {MAX_DAYS} days")
    by_day: dict[date, list] = {from_ + timedelta(days=i): [] for i in range((to - from_).days + 1)}
    for j in fetch(ctx, "and j.due_on between %(a)s and %(b)s", {"a": from_, "b": to}, f"j.due_on, {RANK}, j.created_at, j.id", 2000):
        by_day[j["due_on"]].append(j)
    open_ = "and j.status <> 'done'"
    return reply(ctx, {"from": from_, "to": to,
                       "days": [{"date": d, "weekday": WEEKDAYS[d.weekday()], "jobs": js} for d, js in by_day.items()],
                       "unscheduled": fetch(ctx, f"{open_} and j.due_on is null", None, f"{RANK}, j.created_at, j.id", 500),
                       "overdue": fetch(ctx, f"{open_} and j.due_on < %(a)s", {"a": from_}, f"j.due_on, {RANK}, j.id", 500)})


class JobEdit(BaseModel, extra="forbid"):
    status: STATUS | None = None
    due_on: date | None = None
    assignee_id: UUID | None = None
    priority: Literal["low", "normal", "high"] | None = None
    notes: str | None = Field(None, max_length=2000)


@r.post("/jobs/{job_id}")
def edit_job(job_id: UUID, body: JobEdit, ctx: Ctx = Depends(write_ctx)):
    """Move a job and/or set its due date, assignee (an active person of this business), priority and notes. Null clears due_on, assignee_id, notes."""
    require_perm(ctx, "manage_contacts")
    sets = body.model_dump(exclude_unset=True)
    if not sets:
        raise ApiError(422, "empty", "nothing to change")
    if sets.get("status", 1) is None or sets.get("priority", 1) is None:
        raise ApiError(422, "bad_param", "status and priority cannot be null")
    if sets.get("notes") == "":
        sets["notes"] = None
    c = ctx.conn
    old = c.execute("select status, due_on, assignee_id, priority, notes from jobs where id=%s and tenant_id=%s for update", (job_id, ctx.tenant_id)).fetchone()
    if not old:
        raise ApiError(404, "not_found", "job not found")
    sets = {k: v for k, v in sets.items() if v != old[k]}
    if sets.get("assignee_id") and not c.execute("select 1 from users where id=%s and tenant_id=%s and active", (sets["assignee_id"], ctx.tenant_id)).fetchone():
        raise ApiError(422, "bad_assignee", "the assignee must be an active person in your business")
    if sets:
        extra = ""
        if "status" in sets:
            extra = ", started_at = coalesce(started_at, now())" if sets["status"] == "doing" else \
                    ", done_at = now()" if sets["status"] == "done" else ", done_at = null"
        c.execute("update jobs set " + ", ".join(f"{k}=%({k})s" for k in sets) + extra + " where id=%(id)s",  # jobs_audit trigger records the row too
                  {**sets, "id": job_id})
        audit(ctx, "jobs", job_id, "job changed: " + ",".join(sorted(sets)), {k: old[k] for k in sets}, sets)
    return reply(ctx, fetch(ctx, "and j.id = %(id)s", {"id": job_id})[0])
