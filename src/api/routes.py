"""/api/* per docs/api-contract.md. Plain def endpoints (psycopg is sync; FastAPI runs them in a threadpool)."""
import csv
from datetime import date
import io
import logging
import os
import re
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import Response
from openpyxl import Workbook
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .. import pipeline, quote_pdf
from ..errors import ApiError
from .deps import Ctx, audit, guarded, read_ctx, reply, require_owner, svc, write_ctx

log = logging.getLogger("laris")
r = APIRouter(prefix="/api")

STATUSES = Literal["received", "draft", "parsed", "reviewed", "accepted", "in_cost_book", "approved", "sent", "read",
                   "job_created", "expired", "rejected", "cancelled", "superseded"]
MAX_UPLOAD = 10_000_000  # app.py also refuses bigger Content-Length before the body is read
MAGIC = ((b"%PDF", "application/pdf"), (b"\xff\xd8\xff", "image/jpeg"), (b"\x89PNG\r\n\x1a\n", "image/png"),
         (b"RIFF", "image/webp"))  # the client-sent content type is not trusted: sniff
REVIEWABLE = ("received", "parsed")  # 'in' statuses where staff may still edit lines (and see supplier prices)

SUMMARY = """
select d.id, d.direction, d.kind, d.doc_no, d.party_id, p.name as party_name, d.status, d.issued_on, d.valid_until,
  d.currency, d.created_at,
  coalesce(d.stated_total, (select sum(round(l.qty * l.unit_price * (1 - coalesce(l.discount_pct, 0) / 100), 2))
                            from document_lines l where l.document_id = d.id and not l.is_header)) as total,
  coalesce((select max(a.at) from audit_log a where a.entity = 'documents' and a.entity_id = d.id), d.created_at) as updated_at,
  exists(select 1 from v_stale_alerts s where s.quote_id = d.id) as cost_is_stale,
  (exists(select 1 from document_lines l where l.document_id = d.id and l.needs_review)
   or (d.status in ('received','parsed') and coalesce(jsonb_array_length(d.extraction->'doc_flags'), 0) > 0)) as needs_review
from documents d join parties p on p.id = d.party_id
"""


def summary(ctx: Ctx, d: dict) -> dict:
    flags = {"needs_review": d["needs_review"]}
    if ctx.owner:
        flags["cost_is_stale"] = d["cost_is_stale"]
    return {"id": d["id"], "direction": d["direction"], "kind": d["kind"], "doc_no": d["doc_no"],
            "party": {"id": d["party_id"], "name": d["party_name"]}, "status": d["status"],
            "issued_on": d["issued_on"], "valid_until": d["valid_until"],
            "total": None if (d["direction"] == "in" and not ctx.owner) else d["total"],  # supplier prices: owner only
            "currency": d["currency"], "updated_at": d["updated_at"], "flags": flags}


def get_doc(ctx: Ctx, doc_id: UUID, lock=False) -> dict:
    d = ctx.conn.execute(SUMMARY + " where d.id = %s and d.tenant_id = %s" + (" for update of d" if lock else ""),
                         (doc_id, ctx.tenant_id)).fetchone()
    if not d:
        raise ApiError(404, "not_found", "document not found")
    return d


def hidden_attr_keys(ctx: Ctx) -> set:
    if ctx.owner:
        return set()
    return {x["key"] for x in ctx.conn.execute("select key from tenant_fields where tenant_id=%s and owner_only",
                                               (ctx.tenant_id,))}


def line_json(ctx: Ctx, l: dict, doc: dict, hide: set) -> dict:
    show_price = ctx.owner or doc["direction"] == "out" or doc["status"] in REVIEWABLE
    return {"id": l["id"], "line_no": l["line_no"], "item_key": l["item_key"], "description": l["description"],
            "qty": l["qty"], "uom": l["uom"], "unit_price": l["unit_price"] if show_price else None,
            "discount_pct": l["discount_pct"] if show_price else None, "tax_rate": l["tax_rate"],
            "section": l["section"], "is_header": l["is_header"], "needs_review": l["needs_review"],
            "ocr_confidence": l["ocr_confidence"],
            "attrs": {k: v for k, v in l["attrs"].items() if k not in hide},
            "attrs_unmapped": {k: v for k, v in l["attrs_unmapped"].items() if k not in hide} if ctx.owner else {}}


@r.get("/me")
def me(ctx: Ctx = Depends(read_ctx)):
    t = ctx.conn.execute("select name from tenants where id=%s", (ctx.tenant_id,)).fetchone()
    # tenants has no logo column yet: ORG_LOGO_URL env, else null (UI shows initials)
    return reply(ctx, {"role": ctx.role, "name": ctx.name, "id": ctx.user_id,
                       "org": {"name": t["name"], "logo_url": os.environ.get("ORG_LOGO_URL") or None}})


@r.get("/tracker")
def tracker(ctx: Ctx = Depends(read_ctx)):
    rows = ctx.conn.execute(SUMMARY + " where d.tenant_id = %s order by updated_at desc", (ctx.tenant_id,)).fetchall()
    return reply(ctx, {"received": [summary(ctx, d) for d in rows if d["direction"] == "in"],
                       "sent": [summary(ctx, d) for d in rows if d["direction"] == "out"]})


@r.get("/documents/{doc_id}")
def document(doc_id: UUID, ctx: Ctx = Depends(read_ctx)):
    d = get_doc(ctx, doc_id)
    full = ctx.conn.execute(
        """select payment_terms, lead_time_days, deposit_pct, terms_text, customer_ref, tax_inclusive, tax_total,
                  sent_at, read_at, decided_at, decision_reason, approved_at, parent_id from documents where id=%s""",
        (doc_id,)).fetchone()
    if not ctx.owner:
        full.pop("tax_total")
    hide = hidden_attr_keys(ctx)
    lines = ctx.conn.execute("select * from document_lines where document_id=%s order by line_no", (doc_id,)).fetchall()
    out = {"doc": {**summary(ctx, d), **full},
           "lines": [line_json(ctx, l, d, hide) for l in lines],
           "messages": ctx.conn.execute(  # supplier chat text carries their prices: owner only
               "select direction, channel, body, created_at as at from messages where document_id=%s order by created_at, id",
               (doc_id,)).fetchall() if ctx.owner or d["direction"] == "out" else []}
    if ctx.owner and d["direction"] == "out":
        out["provenance"] = ctx.conn.execute(
            """select line_id, cost_item_id, supplier, source_doc_id, source_doc_no, source_line_id, cost_date, unit_cost,
                      cost_snapshot, current_unit_cost, cost_is_stale, line_margin
               from v_quote_provenance where quote_id=%s order by line_id, source_doc_no""", (doc_id,)).fetchall()
    return reply(ctx, out)


@r.get("/documents/{doc_id}/pdf")
def document_pdf(doc_id: UUID, ctx: Ctx = Depends(read_ctx)):
    """Quotation PDF for the customer (selling prices only, so staff may download it too)."""
    d = get_doc(ctx, doc_id)
    if d["direction"] != "out":
        raise ApiError(404, "not_found", "only customer quotes have a PDF")
    doc = ctx.conn.execute("select doc_no, currency, issued_on, created_at, valid_until, payment_terms, terms_text from documents where id=%s",
                           (doc_id,)).fetchone()
    lines = ctx.conn.execute("select * from document_lines where document_id=%s order by line_no", (doc_id,)).fetchall()
    org = ctx.conn.execute("select name, ssm_no, address, bank_details, sst_registered, sst_no from tenants where id=%s",
                           (ctx.tenant_id,)).fetchone()
    pdf = quote_pdf.render(org, doc, d["party_name"], lines)
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{re.sub(r"[^A-Za-z0-9_-]", "_", doc["doc_no"] or "quote")}.pdf"'})


class Transition(BaseModel, extra="forbid"):
    to: STATUSES
    reason: str | None = Field(None, max_length=500)


@r.post("/documents/{doc_id}/transition")
def transition(doc_id: UUID, body: Transition, request: Request, ctx: Ctx = Depends(write_ctx)):
    d = get_doc(ctx, doc_id, lock=True)
    c, to = ctx.conn, body.to
    if to == d["status"]:  # the DB guard treats same-status as a no-op; we must not re-send / re-stamp
        raise ApiError(409, "conflict", f"document is already {to}")
    with guarded():  # the DB guard decides legality and role; we only map its errors to 409 / 403
        if to == "in_cost_book" and d["direction"] == "in":
            if d["status"] == "reviewed":  # receipts shortcut: accept (owner) then promote
                c.execute("update documents set status='accepted', decided_at=now() where id=%s", (doc_id,))
            c.execute("select promote_document(%s)", (doc_id,))
        else:
            extra = {"approved": "approved_by=%(u)s, approved_at=now()", "sent": "sent_at=now()",
                     "read": "read_at=coalesce(read_at, now())",
                     "accepted": "decided_at=now(), decision_reason=%(r)s",
                     "rejected": "decided_at=now(), decision_reason=%(r)s"}.get(to, "")
            c.execute("update documents set status=%(to)s::doc_status" + (", " + extra if extra else "") + " where id=%(id)s",
                      {"to": to, "u": ctx.user_id, "r": body.reason, "id": doc_id})
            if to == "job_created":
                c.execute("insert into jobs(tenant_id, quote_id) values (%s, %s)", (ctx.tenant_id, doc_id))
    out = summary(ctx, get_doc(ctx, doc_id))
    if to == "sent":
        try:  # the customer gets the SELLING price only; a send failure must not undo the owner's decision
            out["delivery"] = "delivered" if pipeline.send_quote(c, svc(request).send, doc_id) else "not_sent"
        except Exception:
            log.exception("could not send quote %s", doc_id)
            out["delivery"] = "failed"  # surfaced so the owner can resend by hand
    return reply(ctx, out)


class LineEdit(BaseModel, extra="forbid"):
    item_key: str | None = Field(None, pattern=r"^[a-z][a-z0-9_]{0,60}$")
    qty: Decimal | None = Field(None, gt=0, lt=Decimal(10) ** 10)
    unit_price: Decimal | None = Field(None, ge=0, lt=Decimal(10) ** 10)
    needs_review: bool | None = None


@r.post("/documents/{doc_id}/lines/{line_id}")
def edit_line(doc_id: UUID, line_id: UUID, body: LineEdit, ctx: Ctx = Depends(write_ctx)):
    d = get_doc(ctx, doc_id, lock=True)
    sets = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not sets:
        raise ApiError(422, "empty", "nothing to change")
    if d["direction"] == "out":
        if "unit_price" in sets:
            raise ApiError(403, "rules_only", "out-line prices are set by the pricing rules, not by hand")
        if set(sets) != {"needs_review"} or not ctx.owner:
            raise ApiError(403, "rules_only", "out lines are rules-engine output; only the owner may clear needs_review")
    elif d["status"] not in REVIEWABLE:
        raise ApiError(409, "locked", f"document is {d['status']}; lines can only be edited while received/parsed")
    old = ctx.conn.execute("select * from document_lines where id=%s and document_id=%s for update", (line_id, doc_id)).fetchone()
    if not old:
        raise ApiError(404, "not_found", "line not found")
    with guarded():
        new = ctx.conn.execute(
            "update document_lines set " + ", ".join(f"{k}=%({k})s" for k in sets) + " where id=%(id)s returning *",
            {**sets, "id": line_id}).fetchone()
    audit(ctx, "document_lines", line_id, "review edit: " + ",".join(sorted(sets)),
          {k: old[k] for k in sets}, {k: new[k] for k in sets})
    return reply(ctx, line_json(ctx, new, d, hidden_attr_keys(ctx)))


@r.get("/alerts/stale-costs")
def stale_costs(ctx: Ctx = Depends(read_ctx)):
    require_owner(ctx)
    return reply(ctx, ctx.conn.execute(
        """select quote_id, quote_no, customer, item_key, old_cost, current_cost, margin_delta, status
           from v_stale_alerts where tenant_id=%s order by margin_delta, quote_no""", (ctx.tenant_id,)).fetchall())


@r.get("/reports/margin")
def margin_report(days: int = Query(7, ge=1, le=366), ctx: Ctx = Depends(read_ctx)):
    """Owner summary of quotes created in the last N days: money quoted, cost, margin, outcomes, margin lost to stale costs."""
    require_owner(ctx)
    c = ctx.conn
    t = c.execute(
        """select count(distinct m.quote_id) quotes, coalesce(sum(m.line_total), 0) revenue, coalesce(sum(m.line_cost), 0) cost
           from v_quote_margin m join documents d on d.id = m.quote_id
           where m.tenant_id=%s and d.created_at >= now() - %s * interval '1 day'
             and d.status not in ('cancelled', 'superseded')""", (ctx.tenant_id, days)).fetchone()
    outcome = {x["status"]: x["n"] for x in c.execute(
        """select status::text, count(*) n from documents where tenant_id=%s and direction='out'
             and created_at >= now() - %s * interval '1 day' group by status""", (ctx.tenant_id, days))}
    low = c.execute(
        """select m.quote_id, m.quote_no, sum(m.line_total) revenue, sum(m.line_total - m.line_cost) margin,
                  round(sum(m.line_total - m.line_cost) / nullif(sum(m.line_total), 0) * 100, 2) margin_pct
           from v_quote_margin m join documents d on d.id = m.quote_id
           where m.tenant_id=%s and d.created_at >= now() - %s * interval '1 day' and d.status not in ('cancelled', 'superseded')
           group by m.quote_id, m.quote_no order by margin_pct nulls last, m.quote_no limit 3""", (ctx.tenant_id, days)).fetchall()
    stale = c.execute("select count(distinct quote_id) n, coalesce(sum(margin_delta), 0) lost from v_stale_alerts where tenant_id=%s",
                      (ctx.tenant_id,)).fetchone()
    won, lost = (sum(outcome.get(k, 0) for k in ks) for ks in (("accepted", "job_created"), ("rejected", "expired")))
    return reply(ctx, {"days": days, "quotes": t["quotes"], "revenue": t["revenue"], "cost": t["cost"],
                       "margin": t["revenue"] - t["cost"],
                       "margin_pct": round((t["revenue"] - t["cost"]) / t["revenue"] * 100, 2) if t["revenue"] else None,
                       "outcomes": outcome, "won": won, "lost": lost,
                       "lowest_margin": low, "stale_quotes": stale["n"], "stale_margin_lost": stale["lost"]})


@r.get("/cost-items")
def cost_items(ctx: Ctx = Depends(read_ctx)):
    require_owner(ctx)
    return reply(ctx, ctx.conn.execute(
        """select ci.id, ci.item_key, ci.uom, ci.unit_cost, p.name as supplier, d.doc_no as source_doc_no, ci.effective_date
           from cost_items ci join parties p on p.id=ci.supplier_id
           join document_lines l on l.id=ci.source_line_id join documents d on d.id=l.document_id
           where ci.tenant_id=%s and ci.superseded_by is null order by ci.item_key, ci.effective_date desc""",
        (ctx.tenant_id,)).fetchall())


SETTINGS = ("min_margin_pct", "ssm_no", "address", "bank_details", "sst_registered", "sst_no")


@r.get("/settings")
def settings(ctx: Ctx = Depends(read_ctx)):
    require_owner(ctx)
    return reply(ctx, ctx.conn.execute(f"select {', '.join(SETTINGS)} from tenants where id=%s", (ctx.tenant_id,)).fetchone())


class SettingsEdit(BaseModel, extra="forbid"):
    min_margin_pct: Decimal | None = Field(None, ge=0, lt=100)
    ssm_no: str | None = Field(None, max_length=40)
    address: str | None = Field(None, max_length=400)
    bank_details: str | None = Field(None, max_length=400)
    sst_registered: bool | None = None
    sst_no: str | None = Field(None, max_length=40)


@r.post("/settings")
def edit_settings(body: SettingsEdit, ctx: Ctx = Depends(write_ctx)):
    """Margin floor and the issuer details printed on the quote PDF. Owner only; the change is audited."""
    require_owner(ctx)
    sets = body.model_dump(exclude_unset=True)
    if not sets:
        raise ApiError(422, "empty", "nothing to change")
    old = ctx.conn.execute(f"select {', '.join(SETTINGS)} from tenants where id=%s for update", (ctx.tenant_id,)).fetchone()
    if (sets.get("sst_registered") or (old["sst_registered"] and "sst_registered" not in sets)) and not (sets.get("sst_no") or old["sst_no"]):
        raise ApiError(422, "sst_no_needed", "an SST-registered business must give its SST number")
    new = ctx.conn.execute("update tenants set " + ", ".join(f"{k}=%({k})s" for k in sets) + " where id=%(t)s returning " + ", ".join(SETTINGS),
                           {**sets, "t": ctx.tenant_id}).fetchone()
    audit(ctx, "tenants", ctx.tenant_id, "settings changed: " + ",".join(sorted(sets)), {k: old[k] for k in sets}, {k: new[k] for k in sets})
    return reply(ctx, new)


@r.get("/jobs")
def jobs(ctx: Ctx = Depends(read_ctx)):
    """Job board: one card per accepted quote (selling side only, so staff see it too)."""
    return reply(ctx, ctx.conn.execute(
        """select j.id, j.status, j.created_at, d.id as quote_id, d.doc_no as quote_no, p.name as customer,
                  (select coalesce(sum(round(l.qty * l.unit_price * (1 - coalesce(l.discount_pct, 0) / 100), 2)), 0)
                   from document_lines l where l.document_id = d.id and not l.is_header) as total,
                  (select string_agg(l.description || ' x ' || trim(trailing '.' from trim(trailing '0' from l.qty::text)), '; ' order by l.line_no)
                   from document_lines l where l.document_id = d.id and not l.is_header) as summary
           from jobs j join documents d on d.id = j.quote_id join parties p on p.id = d.party_id
           where j.tenant_id=%s order by j.created_at desc, j.id""", (ctx.tenant_id,)).fetchall())


class JobMove(BaseModel, extra="forbid"):
    status: Literal["todo", "doing", "done"]


@r.post("/jobs/{job_id}")
def move_job(job_id: UUID, body: JobMove, ctx: Ctx = Depends(write_ctx)):
    old = ctx.conn.execute("select status from jobs where id=%s and tenant_id=%s for update", (job_id, ctx.tenant_id)).fetchone()
    if not old:
        raise ApiError(404, "not_found", "job not found")
    if old["status"] != body.status:
        ctx.conn.execute("update jobs set status=%s where id=%s", (body.status, job_id))  # jobs_audit trigger records it
    return reply(ctx, {"id": job_id, "status": body.status})


@r.get("/followups")
def followups(ctx: Ctx = Depends(read_ctx)):
    """Quotes with no answer after the template's follow-up window, each with the suggested chase message."""
    rows = ctx.conn.execute(
        """select f.id, f.document_id, d.doc_no, p.name as customer, d.status, f.due_at, f.reason
           from followups f join documents d on d.id=f.document_id join parties p on p.id=d.party_id
           where d.tenant_id=%s and f.state='pending' and d.direction='out' order by f.due_at, f.id""", (ctx.tenant_id,)).fetchall()
    return reply(ctx, [{**x, "suggested_text": pipeline.followup_text(ctx.conn, x["document_id"])} for x in rows])


class FollowupAct(BaseModel, extra="forbid"):
    action: Literal["send", "skip"]


@r.post("/followups/{fid}")
def followup_act(fid: UUID, body: FollowupAct, request: Request, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)  # nothing goes to a customer without the owner
    c = ctx.conn
    f = c.execute("""select f.id, f.document_id from followups f join documents d on d.id=f.document_id
                     where f.id=%s and d.tenant_id=%s and f.state='pending' for update of f""", (fid, ctx.tenant_id)).fetchone()
    if not f:
        raise ApiError(404, "not_found", "no pending follow-up with that id")
    if body.action == "send":
        try:
            ok = pipeline.send_followup(c, svc(request).send, f["document_id"])
        except Exception:
            log.exception("follow-up %s not delivered", fid)
            raise ApiError(502, "delivery_failed", "could not reach the customer; follow-up stays pending")
        if not ok:
            raise ApiError(409, "no_contact", "no chat contact on file for this customer; skip it or call them")
    state = "sent" if body.action == "send" else "skipped"
    c.execute("update followups set state=%s where id=%s", (state, fid))
    audit(ctx, "followups", fid, f"follow-up {state}")
    return reply(ctx, {"id": fid, "state": state})


@r.get("/fields")
def fields(ctx: Ctx = Depends(read_ctx)):
    return reply(ctx, ctx.conn.execute(
        """select key, label, type, unit, options, show_in_grid, sort_order from tenant_fields
           where tenant_id=%s and (%s or not owner_only) order by sort_order, key""", (ctx.tenant_id, ctx.owner)).fetchall())


@r.get("/field-proposals")
def field_proposals(ctx: Ctx = Depends(read_ctx)):
    require_owner(ctx)
    return reply(ctx, ctx.conn.execute(
        "select id, key, sample_values, status from field_proposals where tenant_id=%s order by status, key",
        (ctx.tenant_id,)).fetchall())


class Decision(BaseModel, extra="forbid"):
    decision: Literal["approve", "ignore"]
    type: Literal["text", "number", "integer", "date", "select", "boolean"] = "text"
    label: str | None = Field(None, min_length=1, max_length=80)


@r.post("/field-proposals/{pid}/decide")
def decide_proposal(pid: UUID, body: Decision, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    c = ctx.conn
    p = c.execute("select * from field_proposals where id=%s and tenant_id=%s for update", (pid, ctx.tenant_id)).fetchone()
    if not p:
        raise ApiError(404, "not_found", "proposal not found")
    if p["status"] != "pending":
        raise ApiError(409, "decided", f"proposal already {p['status']}")
    filled = 0
    if body.decision == "approve":
        c.execute("""insert into tenant_fields(tenant_id,key,label,type,approved_by) values (%s,%s,%s,%s,%s)
                     on conflict (tenant_id,key) do nothing""",
                  (ctx.tenant_id, p["key"], body.label or p["key"].replace("_", " ").capitalize(), body.type, ctx.user_id))
        # back-fill: move the value from attrs_unmapped to attrs on every line that carried it
        # ponytail: values copied as seen (no type coercion); owner fixes odd ones in review
        filled = c.execute(
            """update document_lines l set attrs = l.attrs || jsonb_build_object(%(k)s::text, l.attrs_unmapped -> %(k)s),
                      attrs_unmapped = l.attrs_unmapped - %(k)s
               from documents d where d.id = l.document_id and d.tenant_id = %(t)s and jsonb_exists(l.attrs_unmapped, %(k)s)""",
            {"k": p["key"], "t": ctx.tenant_id}).rowcount
    c.execute("update field_proposals set status=%s, decided_by=%s, decided_at=now() where id=%s",
              ("approved" if body.decision == "approve" else "ignored", ctx.user_id, pid))
    audit(ctx, "field_proposals", pid, f"field {body.decision}: {p['key']}", None, {"lines_backfilled": filled})
    return reply(ctx, c.execute("select id, key, sample_values, status from field_proposals where id=%s", (pid,)).fetchone())


@r.get("/audit")
def audit_feed(after: int = Query(0, ge=0), ctx: Ctx = Depends(read_ctx)):
    return reply(ctx, ctx.conn.execute(
        """select a.id, a.at, coalesce(u.name, a.actor) as actor, a.entity, a.entity_id, a.event
           from audit_log a left join users u on u.id::text = a.actor
           where a.tenant_id=%s and a.id > %s and (%s or a.entity <> 'cost_items') order by a.id limit 500""",
        (ctx.tenant_id, after, ctx.owner)).fetchall())


class Enquiry(BaseModel, extra="forbid"):
    channel: Literal["telegram", "whatsapp", "web", "upload"]
    text: str = Field(min_length=1, max_length=4000)
    customer: str | None = Field(None, min_length=1, max_length=120)


@r.post("/enquiries/simulate")
def simulate(body: Enquiry, request: Request, ctx: Ctx = Depends(write_ctx)):
    cust = pipeline.party(ctx.conn, ctx.tenant_id, "customer", body.customer or "Walk-in customer (simulated)")
    res = pipeline.handle_enquiry(ctx.conn, ctx.tenant_id, cust, body.channel, body.text, actor=ctx.user_id,
                                  ilmu_client=svc(request).ilmu)
    return reply(ctx, summary(ctx, get_doc(ctx, res["doc_id"])), 201)


@r.post("/documents/ingest")
def ingest(request: Request, file: UploadFile | None = File(None), text: str | None = Form(None),
           supplier: str | None = Form(None), kind: Literal["quotation", "receipt", "invoice"] = Form("quotation"),
           ctx: Ctx = Depends(write_ctx)):
    """Extra (not in the contract): upload a supplier PDF/photo or paste its text."""
    data = file.file.read(MAX_UPLOAD + 1) if file else None
    if data is not None and len(data) > MAX_UPLOAD:
        raise ApiError(413, "too_large", "file over 10 MB")
    if not data and not text:
        raise ApiError(422, "empty", "send a file or text")
    mime = None
    if data:
        mime = next((m for sig, m in MAGIC if data.startswith(sig)), None)
        if not mime:
            raise ApiError(415, "unsupported_media", "upload a PDF, JPEG, PNG or WebP")
    res = pipeline.ingest_supplier_document(
        ctx.conn, ctx.tenant_id, data=data, mime=mime, text=text,
        supplier_name=supplier, kind=kind, actor=ctx.user_id, ilmu_client=svc(request).ilmu, ocr=svc(request).ocr)
    return reply(ctx, summary(ctx, get_doc(ctx, res["doc_id"])), 201)


@r.post("/parties/{party_id}/erase")
def erase_party(party_id: UUID, ctx: Ctx = Depends(write_ctx)):
    """PDPA erasure request for a customer: identity and chat text go, the quote rows stay (financial record)."""
    require_owner(ctx)
    c = ctx.conn
    p = c.execute("select id, role from parties where id=%s and tenant_id=%s for update", (party_id, ctx.tenant_id)).fetchone()
    if not p:
        raise ApiError(404, "not_found", "party not found")
    if p["role"] != "customer":
        raise ApiError(409, "not_customer", "only customer records can be erased here")
    c.execute("""update parties set name = 'Erased customer ' || left(id::text, 8), contact = null, address = null,
                   attention = null, ssm_no = null, sst_no = null where id=%s""", (party_id,))
    n = c.execute("""update messages set body = '[erased]', transcript = null, media_key = null
                     where enquiry_id in (select id from enquiries where party_id=%s)
                        or document_id in (select id from documents where party_id=%s)""", (party_id, party_id)).rowcount
    audit(ctx, "parties", party_id, "personal data erased on request", None, {"messages_erased": n})
    return reply(ctx, {"id": party_id, "messages_erased": n})


class ManualLine(BaseModel, extra="forbid"):
    description: str = Field(min_length=1, max_length=500)
    qty: Decimal = Field(gt=0, lt=Decimal(10) ** 10)
    uom: str = Field(min_length=1, max_length=20)
    unit_price: Decimal = Field(ge=0, lt=Decimal(10) ** 10)
    item_key: str | None = Field(None, pattern=r"^[a-z][a-z0-9_]{0,60}$")


class ManualDoc(BaseModel, extra="forbid"):
    supplier: str = Field(min_length=1, max_length=120)
    kind: Literal["quotation", "receipt", "invoice"] = "quotation"
    doc_no: str | None = Field(None, min_length=1, max_length=100)
    issued_on: date | None = None
    lines: list[ManualLine] = Field(min_length=1, max_length=200)


@r.post("/documents/manual")
def ingest_manual(body: ManualDoc, ctx: Ctx = Depends(write_ctx)):
    """Fallback when OCR or the model cannot read a document: key it in. Goes through the same review as an extracted one."""
    raw = {"supplier_name": body.supplier, "doc_no": body.doc_no,
           "issued_on": body.issued_on.isoformat() if body.issued_on else None,
           "lines": [{"description": l.description, "qty": str(l.qty), "uom": l.uom, "unit_price": str(l.unit_price),
                      "amount": str(l.qty * l.unit_price), "item_key": l.item_key} for l in body.lines]}
    with guarded():
        res = pipeline.ingest_supplier_document(ctx.conn, ctx.tenant_id, raw=raw, supplier_name=body.supplier, kind=body.kind,
                                                channel="upload", actor=ctx.user_id)
    return reply(ctx, summary(ctx, get_doc(ctx, res["doc_id"])), 201)


# ---- exports (owner: they carry supplier cost)
def _safe(v):
    """Neutralise spreadsheet formula injection from supplier-controlled text."""
    return "'" + v if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r") else v


def _bom_rows(ctx: Ctx, quote_id: UUID):
    q = ctx.conn.execute("select doc_no, status from documents where id=%s and tenant_id=%s and direction='out'",
                         (quote_id, ctx.tenant_id)).fetchone()
    if not q:
        raise ApiError(404, "not_found", "quote not found")
    if q["status"] not in ("accepted", "sent", "read", "job_created"):
        raise ApiError(409, "not_exportable", f"quote is {q['status']}; export needs a sent or accepted quote")
    rows = ctx.conn.execute(
        """select ql.line_no, ql.description as line, ql.qty as line_qty, ci.item_key, ci.uom, sp.name as supplier,
                  sd.doc_no as source_doc_no, ql.qty * b.qty_consumed as need_qty, b.cost_snapshot as unit_cost,
                  ql.qty * b.qty_consumed * b.cost_snapshot as amount
           from document_lines ql join line_cost_basis b on b.out_line_id = ql.id
           join cost_items ci on ci.id = b.cost_item_id join parties sp on sp.id = ci.supplier_id
           join document_lines sl on sl.id = ci.source_line_id join documents sd on sd.id = sl.document_id
           where ql.document_id = %s order by sp.name, ci.item_key, ql.line_no""", (quote_id,)).fetchall()
    return q["doc_no"], rows


@r.get("/export/bom.xlsx")
def export_bom(quote_id: UUID, ctx: Ctx = Depends(read_ctx)):
    require_owner(ctx)
    no, rows = _bom_rows(ctx, quote_id)
    wb = Workbook()
    ws = wb.active
    ws.title = "BOM"
    ws.append(["Quote", "Line", "Sold item", "Material", "Qty needed", "UOM", "Supplier", "Source doc",
               "Unit cost", "Amount"])
    for x in rows:
        ws.append([_safe(v) if isinstance(v, str) else (float(v) if isinstance(v, Decimal) else v) for v in (
            no, x["line_no"], x["line"], x["item_key"], x["need_qty"], x["uom"], x["supplier"], x["source_doc_no"],
            x["unit_cost"], x["amount"])])
    ws.append(["", "", "", "", "", "", "", "Total", "", float(sum((x["amount"] for x in rows), Decimal(0)))])
    buf = io.BytesIO()
    wb.save(buf)
    return Response(buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="bom-{re.sub(r"[^A-Za-z0-9_-]", "_", no or "quote")}.xlsx"'})


@r.get("/export/po.csv")
def export_po(quote_id: UUID, ctx: Ctx = Depends(read_ctx)):
    require_owner(ctx)
    no, rows = _bom_rows(ctx, quote_id)
    agg: dict = {}
    for x in rows:  # one PO line per supplier + material + price
        k = (x["supplier"], x["item_key"], x["uom"], x["unit_cost"])
        agg[k] = agg.get(k, Decimal(0)) + x["need_qty"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["quote_no", "supplier", "item_key", "uom", "qty", "unit_cost", "amount"])
    for (sup, key, uom, uc), qty in sorted(agg.items()):
        w.writerow([_safe(no), _safe(sup), _safe(key), _safe(uom), f"{qty:.3f}", f"{uc:.4f}", f"{qty * uc:.4f}"])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="po-{re.sub(r"[^A-Za-z0-9_-]", "_", no or "quote")}.csv"'})
