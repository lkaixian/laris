"""On-track tracker for inbound and outbound: per-document timeline, one list of everything in flight with how long it has sat in
its stage, and the dashboard counters. Read-only. Rules live in src/track_rules.py (docs/tracker.md)."""
import logging
from datetime import datetime, timezone
from functools import lru_cache
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from .. import track_rules as tr
from ..errors import ApiError
from ..templates import load_template
from .contacts import like
from .deps import Ctx, read_ctx, reply, require_perm

log = logging.getLogger("laris")
r = APIRouter(prefix="/api")

CAP = 1000  # rows read per kind before sorting; terminal items sort last, so a tenant's open work is never cut off by old closed rows
TOTAL = """coalesce(d.stated_total, (select sum(round(l.qty * l.unit_price * (1 - coalesce(l.discount_pct, 0) / 100), 2))
                                  from document_lines l where l.document_id = d.id and not l.is_header))"""
STAGE = "(%(stage)s::text is null or (%(stage)s::text = 'open' and {c}::text <> all(%(term)s::text[])) or {c}::text = %(stage)s)"
LAST = "({c}::text = any(%(term)s::text[])), {s}, {i}"  # order by: open first, then oldest in stage
ZERO = {"outbound": ("draft", "approved", "sent", "read", "accepted", "job_created", "rejected", "expired", "superseded", "cancelled"),
        "inbound": ("received", "parsed", "reviewed", "accepted", "in_cost_book", "rejected", "expired", "superseded", "cancelled"),
        "rfq": ("waiting", "needs_review", "ready", "accepted"), "listing": ("needs_review", "confirmed", "discarded")}
TITLES = {"out": {"approved": "Approved", "sent": "Sent to customer", "read": "Opened by customer", "accepted": "Accepted by customer",
                  "rejected": "Rejected by customer", "expired": "Expired", "superseded": "Replaced by a newer quote",
                  "cancelled": "Cancelled", "job_created": "Job created", "draft": "Back to draft"},
          "in": {"parsed": "Supplier quote read", "reviewed": "Supplier quote reviewed", "accepted": "Supplier quote accepted",
                 "in_cost_book": "Added to the cost book", "rejected": "Rejected", "expired": "Expired", "superseded": "Superseded",
                 "cancelled": "Cancelled"}}


@lru_cache(maxsize=16)
def _tpl_hours(key: str) -> int:
    return int(load_template(key)["followup_hours"])


def followup_hours(ctx: Ctx) -> int:
    """The tenant's trade-template follow-up window (same one the scheduler uses); the module default if the template is unreadable."""
    t = ctx.conn.execute("select trade_template from tenants where id=%s", (ctx.tenant_id,)).fetchone()
    try:
        return _tpl_hours(t["trade_template"])
    except Exception:
        log.warning("tracker: template unreadable, using %sh", tr.NO_REPLY_HOURS)
        return tr.NO_REPLY_HOURS


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- timeline
@r.get("/documents/{doc_id}/timeline")
def timeline(doc_id: UUID, ctx: Ctx = Depends(read_ctx)):
    """What happened to one document, oldest first (newest 200), plus how long it has sat in its current stage."""
    require_perm(ctx, "view_audit")
    c = ctx.conn
    d = c.execute("""select direction::text as direction, status::text as status, status_changed_at as since, sent_at, read_at, decided_at,
                            approved_at, valid_until, created_at from documents where id=%s and tenant_id=%s""", (doc_id, ctx.tenant_id)).fetchone()
    if not d:
        raise ApiError(404, "not_found", "document not found")
    titles, ev = TITLES[d["direction"]], []
    rows = c.execute(
        """select a.at, a.event, a.after->>'decision_reason' as reason, a.actor = 'customer:link' as via_link,
                  case when a.actor like 'system%%' then 'system' else u.name end as actor
           from audit_log a left join users u on u.id::text = a.actor and u.tenant_id = a.tenant_id
           where a.tenant_id=%s and a.entity='documents' and a.entity_id=%s
             and (a.event = 'insert' or a.event like 'status %%' or a.event like 'quote send by %%: failed') order by a.at, a.id limit 400""",
        (ctx.tenant_id, doc_id)).fetchall()
    seen = set()
    for a in rows:
        if a["event"] == "insert":
            ev.append({"at": a["at"], "kind": "created", "title": "Received from supplier" if d["direction"] == "in" else "Quote drafted", "actor": a["actor"]})
        elif a["event"].startswith("status "):
            to = a["event"].split("->")[-1]
            seen.add(to)
            title = titles.get(to, tr.label(to))
            if a["via_link"] and to == "accepted":  # the customer signed on the link (db/accept.sql): their typed name, shown as text
                n = c.execute("select signer_name from quote_accept_links where quote_id=%s and tenant_id=%s and decision='accepted'", (doc_id, ctx.tenant_id)).fetchone()
                title = f"Accepted by {n['signer_name'] if n else 'customer'} via link (simulated e-signature)"
            elif a["via_link"] and to == "rejected":
                title = "Declined by customer via link (simulated)"
            ev.append({"at": a["at"], "kind": "sent" if to == "sent" else "decision" if to in ("accepted", "rejected") else "status",
                       "title": title, "actor": a["actor"], **({"detail": a["reason"]} if a["reason"] and to in ("accepted", "rejected") else {})})
        else:
            ev.append({"at": a["at"], "kind": "sent", "title": "Sending to the customer failed", "actor": a["actor"], "detail": a["event"].removeprefix("quote ")})
    if not any(e["kind"] == "created" for e in ev):
        ev.append({"at": d["created_at"], "kind": "created", "title": "Received from supplier" if d["direction"] == "in" else "Quote drafted", "actor": None})
    for col, to in (("approved_at", "approved"), ("sent_at", "sent"), ("read_at", "read"),  # older rows with no audit event for the step
                    ("decided_at", d["status"] if d["status"] in ("accepted", "rejected") else None)):
        if to and d[col] and to not in seen:
            ev.append({"at": d[col], "kind": "sent" if to == "sent" else "decision" if to in ("accepted", "rejected") else "status",
                       "title": titles.get(to, tr.label(to)), "actor": None})
    show = d["direction"] == "out" or ctx.costs  # supplier chat text carries their prices: view_costs only
    for m in c.execute("select direction::text as direction, body, created_at from messages where document_id=%s order by created_at, id limit 200", (doc_id,)):
        if show:
            who = ("customer" if d["direction"] == "out" else "supplier")
            ev.append({"at": m["created_at"], "kind": "message", "actor": None, "title": f"Message received from {who}" if m["direction"] == "in" else f"Message sent to {who}",
                       **({"detail": m["body"][:300]} if m["body"] else {})})
        else:
            ev.append({"at": m["created_at"], "kind": "message", "actor": None, "title": "Message received" if m["direction"] == "in" else "Message sent"})
    ev.sort(key=lambda e: e["at"])
    kind, now = ("quote" if d["direction"] == "out" else "supplier_doc"), _now()
    why = tr.overdue_reason(kind, d["status"], d["since"], now, sent_at=d["sent_at"], valid_until=d["valid_until"], followup_hours=followup_hours(ctx))
    return reply(ctx, {"events": ev[-200:], "stage": {"status": d["status"], "label": tr.label(d["status"]), "since": d["since"],
                                                        "days_in_stage": tr.days_in_stage(d["since"], now), "overdue": bool(why), "reason": why}})


# ---------------------------------------------------------------- list
def _docs(ctx: Ctx, kind: str, p: dict) -> list[dict]:
    """Quotes (out) or supplier documents (in). A supplier document's total is a supplier price: only with view_costs."""
    total = TOTAL if kind == "quote" or ctx.costs else "null"
    return ctx.conn.execute(
        f"""select d.id, d.doc_no as ref, p.name as party, d.status::text as status, d.status_changed_at as since, d.sent_at, d.valid_until,
                   {total} as total, d.id as link_id
            from documents d join parties p on p.id = d.party_id
            where d.tenant_id = %(t)s and d.direction = %(dir)s and {STAGE.format(c='d.status')}
              and (not %(has_q)s or d.doc_no ilike %(q)s or p.name ilike %(q)s)
            order by {LAST.format(c='d.status', s='d.status_changed_at', i='d.id')} limit %(cap)s""",
        {**p, "dir": "out" if kind == "quote" else "in"}).fetchall()


def _rfq(ctx: Ctx, p: dict) -> list[dict]:
    """One row per supplier asked. Without view_replies_prices you learn only who has answered (as GET /api/rfq): no price, and every
    answered state shows as needs_review. The stage filter therefore runs on the shown status, in Python."""
    rows = ctx.conn.execute(
        f"""select x.id, i.description as ref, p.name as party, x.status, x.status_changed_at as since, x.unit_price as total, x.id as link_id
            from rfq_replies x join rfq_sends s on s.id = x.send_id join rfq_items i on i.id = s.rfq_item_id join parties p on p.id = s.supplier_id
            where x.tenant_id = %(t)s and (not %(has_q)s or i.description ilike %(q)s or p.name ilike %(q)s)
            order by {LAST.format(c='x.status', s='x.status_changed_at', i='x.id')} limit %(cap)s""", p).fetchall()
    o = "view_replies_prices" in ctx.perms
    for x in rows:
        if not o:
            x["status"], x["total"] = ("waiting" if x["status"] == "waiting" else "needs_review"), None
    st = p["stage"]
    return [x for x in rows if st is None or (st == "open" and x["status"] not in tr.TERMINAL) or x["status"] == st]


def _listings(ctx: Ctx, p: dict) -> list[dict]:
    return ctx.conn.execute(
        f"""select li.id, coalesce(nullif(li.description, ''), 'Catalog item ' || (li.position + 1)) as ref, p.name as party, li.status,
                   li.status_changed_at as since, case when %(costs)s then li.price end as total, li.listing_id as link_id
            from listing_items li join listings l on l.id = li.listing_id left join parties p on p.id = l.party_id
            where li.tenant_id = %(t)s and {STAGE.format(c='li.status')}
              and (not %(has_q)s or li.description ilike %(q)s or p.name ilike %(q)s)
            order by {LAST.format(c='li.status', s='li.status_changed_at', i='li.id')} limit %(cap)s""", p).fetchall()


def _counts(ctx: Ctx) -> dict:
    out = {k: dict.fromkeys(v, 0) for k, v in ZERO.items()}
    for x in ctx.conn.execute(
            """select 'outbound' as k, status::text as s, count(*)::int as n from documents where tenant_id = %(t)s and direction = 'out' group by status
               union all select 'inbound', status::text, count(*)::int from documents where tenant_id = %(t)s and direction = 'in' group by status
               union all select 'rfq', status, count(*)::int from rfq_replies where tenant_id = %(t)s group by status
               union all select 'listing', status, count(*)::int from listing_items where tenant_id = %(t)s group by status""", {"t": ctx.tenant_id}):
        s = x["s"] if x["k"] != "rfq" or "view_replies_prices" in ctx.perms or x["s"] == "waiting" else "needs_review"
        out[x["k"]][s] = out[x["k"]].get(s, 0) + x["n"]
    return out


def _stats(ctx: Ctx) -> dict:
    """Average days spent in each stage, from status moves in the last 90 days (time since the document's previous move, or its creation)."""
    return {x["stage"]: {"avg_days": round(x["avg_days"], 2), "n": x["n"]} for x in ctx.conn.execute(
        """select frm as stage, avg(extract(epoch from dur) / 86400.0)::float as avg_days, count(*)::int as n from (
             select split_part(substr(a.event, 8), '->', 1) as frm, a.at,
                    a.at - coalesce(lag(a.at) over (partition by a.entity_id order by a.at, a.id), d.created_at) as dur
             from audit_log a join documents d on d.id = a.entity_id and d.tenant_id = a.tenant_id
             where a.tenant_id = %s and a.entity = 'documents' and a.event like 'status %%') x
           where at >= now() - interval '90 days' group by frm order by frm""", (ctx.tenant_id,))}


@r.get("/track")
def track(kind: Literal["all", "quote", "supplier_doc", "rfq", "listing"] = "all", stage: str | None = Query(None, max_length=30),
          overdue: int = Query(0, ge=0, le=1), q: str = Query("", max_length=100), limit: int = Query(50, ge=1, le=200),
          offset: int = Query(0, ge=0), ctx: Ctx = Depends(read_ctx)):
    """Everything in flight, overdue first then oldest in its stage. counts and stats cover the whole tenant; overdue_total counts
    the overdue items that match kind, stage and q (before the overdue flag and paging)."""
    p = {"t": ctx.tenant_id, "stage": stage or None, "term": sorted(tr.TERMINAL), "has_q": bool(q.strip()), "q": like(q),
         "cap": CAP, "costs": ctx.costs}
    kinds, hours, now = (tr.KINDS if kind == "all" else (kind,)), followup_hours(ctx), _now()
    rows = [("quote", x) for x in _docs(ctx, "quote", p)] if "quote" in kinds else []
    rows += [("supplier_doc", x) for x in _docs(ctx, "supplier_doc", p)] if "supplier_doc" in kinds else []
    rows += [("rfq", x) for x in _rfq(ctx, p)] if "rfq" in kinds else []
    rows += [("listing", x) for x in _listings(ctx, p)] if "listing" in kinds else []
    items = []
    for k, x in rows:
        why = tr.overdue_reason(k, x["status"], x["since"], now, sent_at=x.get("sent_at"), valid_until=x.get("valid_until"), followup_hours=hours)
        link = {"quote": "#/doc/", "supplier_doc": "#/doc/", "rfq": "#/ask", "listing": "#/catalog/"}[k] + (str(x["link_id"]) if k != "rfq" else "")
        items.append({"kind": k, "id": x["id"], "ref": x["ref"] or "", "party": x["party"], "status": x["status"], "stage_label": tr.label(x["status"]),
                      "since": x["since"], "days_in_stage": tr.days_in_stage(x["since"], now), "overdue": bool(why), "overdue_reason": why,
                      "due_on": x.get("valid_until"), "total": x["total"], "link": link})
    overdue_total = sum(i["overdue"] for i in items)
    items.sort(key=lambda i: (not i["overdue"], i["status"] in tr.TERMINAL, i["since"], str(i["id"])))
    if overdue:
        items = [i for i in items if i["overdue"]]
    out = {"items": items[offset:offset + limit], "counts": _counts(ctx), "overdue_total": overdue_total, "has_more": len(items) > offset + limit}
    if "view_audit" in ctx.perms:
        out["stats"] = _stats(ctx)
    return reply(ctx, out)


# ---------------------------------------------------------------- dashboard
def dashboard_track(ctx: Ctx) -> dict | None:
    """{overdue, waiting_supplier, waiting_approval} for the home page: one query over the open rows, the same rules as /api/track.
    Never breaks the dashboard: a failure is logged and gives None."""
    try:
        with ctx.conn.transaction():  # savepoint: a failure here must not poison the rest of the request
            now, hours = _now(), followup_hours(ctx)
            rows = ctx.conn.execute(
                """select * from (
                     select 'quote' as k, status::text as status, status_changed_at as since, sent_at, valid_until from documents
                       where tenant_id = %(t)s and direction = 'out' and status::text <> all(%(term)s::text[])
                     union all select 'supplier_doc', status::text, status_changed_at, null::timestamptz, null::date from documents
                       where tenant_id = %(t)s and direction = 'in' and status::text <> all(%(term)s::text[])
                     union all select 'rfq', status, status_changed_at, null::timestamptz, null::date from rfq_replies
                       where tenant_id = %(t)s and status::text <> all(%(term)s::text[])
                     union all select 'listing', status, status_changed_at, null::timestamptz, null::date from listing_items
                       where tenant_id = %(t)s and status::text <> all(%(term)s::text[])) x limit 5000""",
                {"t": ctx.tenant_id, "term": sorted(tr.TERMINAL)}).fetchall()
            return {"overdue": sum(bool(tr.overdue_reason(x["k"], x["status"], x["since"], now, sent_at=x["sent_at"], valid_until=x["valid_until"],
                                                           followup_hours=hours)) for x in rows),
                    "waiting_supplier": sum(x["k"] == "rfq" and x["status"] == "waiting" for x in rows),
                    "waiting_approval": sum(x["k"] == "quote" and x["status"] == "draft" for x in rows)}
    except Exception:
        log.exception("dashboard track counters failed")
        return None
