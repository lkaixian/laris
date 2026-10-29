"""Activity log: the feed, the filtered search, the facets and the CSV/PDF export."""
import csv
import io
from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from .. import pipeline, quote_pdf
from ..errors import ApiError
from ..safe import safe
from .deps import Ctx, audit, read_ctx, reply, require_perm

r = APIRouter(prefix="/api")


AUDIT_COLS = """select a.id, a.at, coalesce(u.name, a.actor) as actor, a.entity, a.entity_id,
                  case when %(o)s or a.entity <> 'document_lines' then a.event else split_part(a.event, ' (price', 1) end as event,
                  case when a.event = 'insert' then 'created' when a.event like 'status %%->%%' then 'status' else 'other' end as action
           from audit_log a left join users u on u.id::text = a.actor
           where a.tenant_id=%(t)s and (%(o)s or a.entity <> 'cost_items')"""  # the same scrubbing for the feed, the search and the export


@r.get("/audit")
def audit_feed(after: int = Query(0, ge=0), ctx: Ctx = Depends(read_ctx)):
    require_perm(ctx, "view_audit")
    return reply(ctx, ctx.conn.execute(AUDIT_COLS + " and a.id > %(after)s order by a.id limit 500",
                                       {"t": ctx.tenant_id, "after": after, "o": ctx.costs}).fetchall())


AuditAction = Literal["created", "status", "other"]


def _audit_where(after, before, from_, to, actor, module, action, q) -> tuple[str, dict]:
    """Filters for the activity log search and export. Dates are Malaysian calendar days, both ends included."""
    w, p = [], {}
    if after:
        w.append("a.id > %(after)s"); p["after"] = after
    if before:
        w.append("a.id < %(before)s"); p["before"] = before
    if from_:
        w.append("a.at >= %(from)s"); p["from"] = datetime.combine(from_, datetime.min.time(), pipeline.MY)
    if to:
        w.append("a.at < %(to)s"); p["to"] = datetime.combine(to, datetime.min.time(), pipeline.MY) + timedelta(days=1)
    if actor:
        w.append("(a.actor = %(actor)s or u.name = %(actor)s)"); p["actor"] = actor
    if module:
        w.append("a.entity = %(module)s"); p["module"] = module
    if action:
        w.append({"created": "a.event = 'insert'", "status": "a.event like 'status %%->%%'",
                  "other": "a.event <> 'insert' and a.event not like 'status %%->%%'"}[action])
    if q.strip():
        w.append("a.event ilike %(q)s"); p["q"] = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    return "".join(" and " + x for x in w), p


@r.get("/audit/search")
def audit_search(after: int = Query(0, ge=0), before: int = Query(0, ge=0), from_: date | None = Query(None, alias="from"), to: date | None = None,
                 actor: str = Query("", max_length=120), module: str = Query("", max_length=40), action: AuditAction | None = None,
                 q: str = Query("", max_length=100), limit: int = Query(100, ge=1, le=500), ctx: Ctx = Depends(read_ctx)):
    """Activity log, newest first, filtered. Page back with before=<smallest id shown>; poll for new rows with after=<largest id>."""
    require_perm(ctx, "view_audit")
    if from_ and to and to < from_:
        raise ApiError(422, "bad_range", "'to' must not be before 'from'")
    where, p = _audit_where(after, before, from_, to, actor, module, action, q)
    rows = ctx.conn.execute(AUDIT_COLS + where + " order by a.id desc limit %(n)s", {"t": ctx.tenant_id, "o": ctx.costs, "n": limit + 1, **p}).fetchall()
    return reply(ctx, {"items": rows[:limit], "has_more": len(rows) > limit})


@r.get("/audit/facets")
def audit_facets(ctx: Ctx = Depends(read_ctx)):
    """Who and which modules appear in this business's activity log: the choices for the filters."""
    require_perm(ctx, "view_audit")
    p = {"t": ctx.tenant_id, "o": ctx.costs}
    people = ctx.conn.execute("select distinct actor from (" + AUDIT_COLS + ") x order by actor limit 200", p).fetchall()
    modules = ctx.conn.execute("select distinct entity from (" + AUDIT_COLS + ") x order by entity limit 100", p).fetchall()
    return reply(ctx, {"people": [x["actor"] for x in people], "modules": [x["entity"] for x in modules]})


@r.get("/audit/days")
def audit_days(limit: int = Query(60, ge=1, le=366), ctx: Ctx = Depends(read_ctx)):
    """The activity log grouped by Malaysian calendar day, newest day first: how many entries each day has. Click a day to search it."""
    require_perm(ctx, "view_audit")
    rows = ctx.conn.execute("select (x.at at time zone 'Asia/Kuala_Lumpur')::date as day, count(*)::int as entries, count(distinct x.actor)::int as people, "
                            "count(distinct x.entity)::int as modules from (" + AUDIT_COLS + ") x group by 1 order by 1 desc limit %(n)s",
                            {"t": ctx.tenant_id, "o": ctx.costs, "n": limit}).fetchall()
    return reply(ctx, [{**r, "day": r["day"].isoformat()} for r in rows])


_ALWAYS_HIDDEN = ("token", "password", "secret", "logo", "key_hash")
_MONEY = ("cost", "margin", "price")


def _scrub(v, costs: bool):
    """Before/after values for the detail view: never secrets or images, and no money fields for someone without view_costs."""
    if isinstance(v, dict):
        out = {}
        for k, x in list(v.items())[:80]:
            lk = k.lower()
            out[k] = "[hidden]" if any(h in lk for h in _ALWAYS_HIDDEN) or (not costs and any(h in lk for h in _MONEY)) else _scrub(x, costs)
        return out
    if isinstance(v, list):
        return [_scrub(x, costs) for x in v[:50]]
    if isinstance(v, str) and len(v) > 500:
        return v[:500] + "..."
    return v


@r.get("/audit/{entry:int}")
def audit_entry(entry: int, ctx: Ctx = Depends(read_ctx)):
    """One activity log entry in full: who, when, which module and record, and what changed (before and after), scrubbed."""
    require_perm(ctx, "view_audit")
    row = ctx.conn.execute(AUDIT_COLS + " and a.id = %(id)s", {"t": ctx.tenant_id, "o": ctx.costs, "id": entry}).fetchone()
    if not row:
        raise ApiError(404, "not_found", "no such entry")
    ba = ctx.conn.execute("select before, after from audit_log where id=%s and tenant_id=%s", (entry, ctx.tenant_id)).fetchone()
    return reply(ctx, {**row, "entity_id": str(row["entity_id"]), "before": _scrub(ba["before"], ctx.costs), "after": _scrub(ba["after"], ctx.costs)})


MAX_EXPORT = 1000


@r.get("/audit/export")
def audit_export(format: Literal["csv", "pdf"] = "csv", ids: str = Query("", max_length=12000), from_: date | None = Query(None, alias="from"),
                 to: date | None = None, actor: str = Query("", max_length=120), module: str = Query("", max_length=40),
                 action: AuditAction | None = None, q: str = Query("", max_length=100), ctx: Ctx = Depends(read_ctx)):
    """Download chosen activity log entries (ids=1,2,3) or, with no ids, every entry matching the filters, newest first, up to 1000."""
    require_perm(ctx, "view_audit")
    require_perm(ctx, "export_data")
    try:
        chosen = sorted({int(x) for x in ids.split(",") if x.strip()}, reverse=True)
    except ValueError:
        raise ApiError(422, "bad_param", "ids is a comma-separated list of entry numbers")
    if len(chosen) > MAX_EXPORT:
        raise ApiError(422, "too_many", f"choose at most {MAX_EXPORT} entries")
    where, p = _audit_where(0, 0, from_, to, actor, module, action, q)
    if chosen:
        where += " and a.id = any(%(ids)s)"; p["ids"] = chosen
    rows = ctx.conn.execute(AUDIT_COLS + where + " order by a.id desc limit %(n)s", {"t": ctx.tenant_id, "o": ctx.costs, "n": MAX_EXPORT, **p}).fetchall()
    if not rows:
        raise ApiError(404, "nothing_to_export", "no entries match; choose some entries or widen the filters")
    audit(ctx, "audit_log", ctx.tenant_id, f"activity log exported: {len(rows)} entries as {format}")
    head = ["entry", "time (Malaysia)", "person", "module", "action", "event"]
    table = [[x["id"], x["at"].astimezone(pipeline.MY).strftime("%Y-%m-%d %H:%M"), x["actor"], x["entity"], x["action"], x["event"]] for x in rows]
    name = f"activity-log-{pipeline.today_my().isoformat()}"
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(head)
        w.writerows([[safe(v) for v in r] for r in table])
        return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})
    return Response(quote_pdf.table_pdf("Activity log", f"{len(rows)} entries, exported {pipeline.today_my().isoformat()}", head, table),
                    media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}.pdf"'})
