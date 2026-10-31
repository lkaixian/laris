"""Customers: the six customer documents as one flow (purchase order, sales order, proforma invoice, delivery order, invoice, receipt), with a count at
each stage, the documents behind each count, and a file for any of them. Also the Admin side: the owner's own Word template per document type.
A document is generated from the owner's template when one is uploaded (a filled-in .docx), otherwise as LARIS's standard PDF. The figures never
change here: this reads the documents and orders that api/chain.py and api/deals.py already issue, and prepares a file. Nothing is sent to anyone."""
import hashlib
import os
import re
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import Response

from .. import doc_layout, doc_template, quote_pdf
from ..errors import ApiError
from .chain import _job, _order_model, _spec, deal_doc_model, money
from .deps import Ctx, audit, read_ctx, reply, require_owner, require_perm, write_ctx
from .routes import read_capped

r = APIRouter(prefix="/api")
# stage -> (where the document lives, its kind there). The first two are chain_docs (api/deals.py); the rest are deal_docs (api/chain.py).
STAGES = {"purchase_order": ("chain", "cpo"), "sales_order": ("chain", "so"), "proforma": ("deal", "proforma"), "delivery_order": ("deal", "delivery_order"),
          "invoice": ("deal", "invoice"), "receipt": ("deal", "receipt")}
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
SEE = {"record_payments", "manage_contacts", "issue_delivery"}  # any of these may see the flow and its files


def _stage(stage: str) -> str:
    if stage not in STAGES:
        raise ApiError(404, "not_found", f"unknown document type; one of {', '.join(STAGES)}")
    return stage


def _may_see(ctx: Ctx) -> None:
    if not ctx.perms & SEE:
        require_perm(ctx, "record_payments")


# ---------------------------------------------------------------- the flow
@r.get("/customers/flow")
def flow(ctx: Ctx = Depends(read_ctx)):
    """One entry per stage: how many live documents there are, and how many of them need someone to act (attention): a purchase order not yet turned into
    an order, a sales order with no proforma, a proforma whose deposit is unpaid, a delivery order not yet signed, an invoice not fully paid."""
    _may_see(ctx)
    c, t = ctx.conn, ctx.tenant_id
    count = {s: 0 for s in STAGES}
    for x in c.execute("select kind, count(*) as n from chain_docs where tenant_id=%s and kind in ('cpo','so') and status <> 'cancelled' group by kind", (t,)):
        count["purchase_order" if x["kind"] == "cpo" else "sales_order"] = x["n"]
    for x in c.execute("select kind, count(*) as n from deal_docs where tenant_id=%s and kind in ('proforma','delivery_order','invoice','receipt') and status <> 'void' group by kind", (t,)):
        count[x["kind"]] = x["n"]
    one = lambda sql: c.execute(sql, (t,)).fetchone()["n"]  # noqa: E731
    paid = """(select coalesce(sum(case when reverses_payment_id is null then amount else -amount end), 0) from payments p where p.job_id = d.job_id"""
    attention = {
        "purchase_order": one("select count(*) as n from chain_docs where tenant_id=%s and kind='cpo' and status='received'"),
        "sales_order": one("""select count(*) as n from chain_docs c where c.tenant_id=%s and c.kind='so' and c.status='confirmed' and c.job_id is not null
                              and not exists (select 1 from deal_docs d where d.job_id = c.job_id and d.kind='proforma' and d.status <> 'void')"""),
        "proforma": one(f"select count(*) as n from deal_docs d where d.tenant_id=%s and d.kind='proforma' and d.status <> 'void' and {paid} and p.purpose='deposit') < (d.extra->>'deposit_amount')::numeric"),
        "delivery_order": one("select count(*) as n from deal_docs where tenant_id=%s and kind='delivery_order' and status='issued'"),
        "invoice": one(f"""select count(*) as n from deal_docs d join jobs j on j.id = d.job_id and j.tenant_id = d.tenant_id
                           where d.tenant_id=%s and d.kind='invoice' and d.status <> 'void' and coalesce(j.order_total, d.total) - {paid}) > 0"""),
        "receipt": 0,
    }
    have = {x["stage"]: x for x in c.execute("select stage, filename, uploaded_at from doc_templates where tenant_id=%s", (t,))}
    return reply(ctx, {"stages": [{"stage": s, "count": count[s], "attention": attention[s],
                                   "template": {"filename": have[s]["filename"], "uploaded_at": have[s]["uploaded_at"]} if s in have else None} for s in STAGES]})


@r.get("/customers/docs")
def docs(stage: Literal["purchase_order", "sales_order", "proforma", "delivery_order", "invoice", "receipt"], limit: int = Query(200, ge=1, le=500), ctx: Ctx = Depends(read_ctx)):
    """The documents of one stage, newest first: number, customer, status, total, date and the order they belong to (including void ones, marked by status)."""
    _may_see(ctx)
    where, kind = STAGES[stage]
    if where == "chain":
        rows = ctx.conn.execute("""select c.id, c.doc_no, c.status, c.total, c.created_at as made_at, c.job_id, c.ref, p.name as customer from chain_docs c
                                   left join parties p on p.id = c.party_id where c.tenant_id=%s and c.kind=%s order by c.created_at desc, c.id limit %s""",
                                (ctx.tenant_id, kind, limit)).fetchall()
    else:
        rows = ctx.conn.execute("""select d.id, d.doc_no, d.status, d.total, d.issued_at as made_at, d.job_id, null as ref, coalesce(p.name, qp.name, j.title) as customer
                                   from deal_docs d join jobs j on j.id = d.job_id and j.tenant_id = d.tenant_id
                                   left join parties p on p.id = j.party_id left join documents q on q.id = j.quote_id left join parties qp on qp.id = q.party_id
                                   where d.tenant_id=%s and d.kind=%s order by d.issued_at desc, d.id limit %s""", (ctx.tenant_id, kind, limit)).fetchall()
    return reply(ctx, [{**x, "stage": stage} for x in rows])


# ---------------------------------------------------------------- a file for one document
def _chain_model(ctx: Ctx, d: dict) -> dict:
    """The quote_doc model of a customer PO or sales order: issuer and terms live, customer and lines from the document itself."""
    c = ctx.conn
    if not d["job_id"]:
        raise ApiError(409, "no_order", "this document has no order yet")
    m = _order_model(ctx, _job(ctx, d["job_id"]))
    p = c.execute("select name, attention, address, email from parties where id=%s", (d["party_id"],)).fetchone() if d["party_id"] else None
    lines = []
    for n, ln in enumerate(d["lines"], 1):
        q, u = Decimal(str(ln["qty"])), Decimal(str(ln["unit_price"]))
        lines.append({"no": n, "description": ln["description"], "qty": q, "uom": ln.get("uom") or "unit", "unit_price": u, "discount_pct": None, "amount": money(q * u), "is_header": False})
    m.update(doc_no=d["doc_no"], status=d["status"], issued_on=d["created_at"].date(), valid_until=None, lines=lines, subtotal=d["subtotal"] - d["discount"],
             tax_total=d["sst"] or None, total=d["total"], reference=d["ref"])
    if p:
        m["customer"] = {"name": p["name"], "attention": p["attention"], "address": p["address"], "email": p["email"]}
    return m


def _fmt(x) -> str:
    return "" if x is None else f"{Decimal(x):,.2f}"


def _on(x) -> str:
    return x.strftime("%d/%m/%Y") if hasattr(x, "strftime") else ("" if x is None else str(x))


def values_for(m: dict, stage: str, title: str, reference: str | None) -> tuple[dict, list[dict]]:
    """The placeholders (doc_template.FIELDS) and item rows of a document, as plain text. A delivery order carries no prices."""
    priced = stage != "delivery_order"
    i, cu, dep, pay, sig = m["issuer"], m["customer"], m.get("deposit") or {}, m.get("payment") or {}, m.get("signature") or {}
    cur = m.get("currency") or "RM"
    v = {"doc_no": m["doc_no"], "doc_type": title, "date": _on(m["issued_on"]), "due_date": _on(m.get("due_on")), "reference": reference or "", "status": m.get("status") or "",
         "customer_name": cu.get("name"), "customer_attention": cu.get("attention"), "customer_address": cu.get("address"), "customer_email": cu.get("email"),
         "company_name": i.get("name"), "company_address": i.get("address"), "company_ssm": i.get("ssm_no"), "company_sst": i.get("sst_no"),
         "company_email": i.get("email"), "company_phone": i.get("phone"), "bank_details": i.get("bank_details"), "currency": cur,
         "subtotal": _fmt(m["subtotal"]) if priced else "", "tax": _fmt(m["tax_total"] or 0) if priced else "", "total": _fmt(m["total"]) if priced else "",
         "payment_terms": m.get("payment_terms"), "terms": m.get("terms_text"),
         "deposit_percent": f"{Decimal(dep['pct']):g}" if dep.get("pct") is not None else "", "deposit_amount": _fmt(dep.get("amount")) if dep.get("amount") is not None else "",
         "deposit_paid": _fmt(dep.get("paid")) if dep.get("paid") is not None else "", "balance_due": _fmt(m.get("balance_due")),
         "amount_paid": _fmt(pay.get("amount")), "payment_method": pay.get("method"), "payment_reference": pay.get("reference"),
         "signed_by": sig.get("name"), "signed_at": _on(sig.get("at"))}
    items = [{"no": "" if ln["no"] is None else str(ln["no"]), "description": ln["description"], "qty": "" if ln["qty"] is None else str(ln["qty"]), "uom": ln["uom"] or "",
              "unit_price": _fmt(ln["unit_price"]) if priced else "", "amount": _fmt(ln["amount"]) if priced else ""} for ln in m["lines"]]
    return {k: ("" if x is None else str(x)) for k, x in v.items()}, items


@r.get("/customers/{stage}/{doc_id}/file")
def file(stage: str, doc_id: UUID, format: Literal["auto", "pdf"] = "auto", ctx: Ctx = Depends(read_ctx)):
    """The document as a file. `auto` is the owner's Word template filled in when one is uploaded for this stage, otherwise LARIS's standard PDF;
    `pdf` is always the standard PDF. Header X-Doc-Source says which one you got (template or standard)."""
    _stage(stage)
    _may_see(ctx)
    c = ctx.conn
    where, kind = STAGES[stage]
    if where == "chain":
        d = c.execute("select * from chain_docs where id=%s and tenant_id=%s and kind=%s", (doc_id, ctx.tenant_id, kind)).fetchone()
        if not d:
            raise ApiError(404, "not_found", "document not found")
        m, layout = _chain_model(ctx, d), _spec(c, ctx.tenant_id, stage)
        reference = d["ref"]
    else:
        d = c.execute("select * from deal_docs where id=%s and tenant_id=%s and kind=%s", (doc_id, ctx.tenant_id, kind)).fetchone()
        if not d:
            raise ApiError(404, "not_found", "document not found")
        m, layout = deal_doc_model(ctx, d), d["layout_snapshot"]
        reference = (c.execute("select ref from chain_docs where job_id=%s and kind='cpo' and ref is not null order by created_at limit 1", (d["job_id"],)).fetchone() or {}).get("ref")
    lang = c.execute("select doc_language from tenants where id=%s", (ctx.tenant_id,)).fetchone()["doc_language"]
    name = re.sub(r"[^A-Za-z0-9_-]", "_", d["doc_no"])
    tpl = c.execute("select content from doc_templates where tenant_id=%s and stage=%s", (ctx.tenant_id, stage)).fetchone() if format == "auto" else None
    warn = {}
    if tpl:
        title = (layout.get("title") or {}).get(lang) or (layout.get("title") or {}).get("en") or stage
        vals, items = values_for(m, stage, title, reference)
        try:
            body = doc_template.fill(bytes(tpl["content"]), vals, items, m["issuer"].get("logo_url"))
            return Response(body, media_type=DOCX, headers={"Content-Disposition": f'attachment; filename="{name}.docx"', "X-Doc-Source": "template"})
        except doc_template.TemplateError:
            warn = {"X-Doc-Warning": "template-unusable"}  # a stored file that no longer fills: give the standard PDF rather than nothing
    return Response(quote_pdf.render(doc_layout.default_spec(stage)["kind"] if where == "chain" else d["kind"], m, layout, lang), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{name}.pdf"', "X-Doc-Source": "standard", **warn})


# ---------------------------------------------------------------- Admin: the owner's own templates
@r.get("/settings/doc-templates")
def list_templates(ctx: Ctx = Depends(read_ctx)):
    """Owner only. Each document type with the template uploaded for it (or none), and the placeholders a template may use."""
    require_owner(ctx)
    have = {x["stage"]: x for x in ctx.conn.execute("select stage, filename, uploaded_at, octet_length(content) as size from doc_templates where tenant_id=%s", (ctx.tenant_id,))}
    return reply(ctx, {"stages": [{"stage": s, **({k: have[s][k] for k in ("filename", "uploaded_at", "size")} if s in have else {"filename": None, "uploaded_at": None, "size": None})}
                                  for s in STAGES],
                       "fields": [{"name": k, "help": h} for k, h in doc_template.FIELDS.items()]})


@r.put("/settings/doc-templates/{stage}")
def upload_template(stage: str, file: UploadFile = File(...), ctx: Ctx = Depends(write_ctx)):
    """Owner only. Upload (or replace) the Word template for a document type. The file is checked (a real .docx, no macros or embedded objects, under 2 MB)
    and the reply lists the placeholders it uses, those LARIS does not know, and anything that will print nothing (for example no item row)."""
    require_owner(ctx)
    _stage(stage)
    raw = os.path.basename((file.filename or "").replace("\\", "/"))
    name = re.sub(r"[^\w .()\-]", "_", raw)[:120]
    if not name.lower().endswith(".docx"):
        raise ApiError(422, "bad_template", "upload a Word file ending in .docx")
    data = read_capped(file, doc_template.MAX_BYTES, "file over 2 MB")
    try:
        info = doc_template.check(data)
    except doc_template.TemplateError as e:
        raise ApiError(422, "bad_template", str(e)) from None
    sha = hashlib.sha256(data).hexdigest()
    row = ctx.conn.execute("""insert into doc_templates(tenant_id, stage, filename, content, sha256, uploaded_by) values (%s,%s,%s,%s,%s,%s)
                              on conflict (tenant_id, stage) do update set filename=excluded.filename, content=excluded.content, sha256=excluded.sha256,
                                                                          uploaded_by=excluded.uploaded_by, uploaded_at=now()
                              returning id, uploaded_at""", (ctx.tenant_id, stage, name, data, sha, ctx.user_id)).fetchone()
    audit(ctx, "doc_templates", row["id"], f"template for {stage} uploaded: {name} ({len(data):,} bytes)", None, {"sha256": sha, "filename": name})
    warnings = [f"{{{{{k}}}}} is not a placeholder LARIS knows; it will print as typed" for k in info["unknown"]]
    if stage != "receipt" and not info["repeats_lines"]:
        warnings.append("no table row holds {{line.description}}, so the items will not be printed")
    if not info["placeholders"]:
        warnings.append("the file has no {{placeholders}}, so every document made from it will look the same")
    return reply(ctx, {"stage": stage, "filename": name, "size": len(data), "uploaded_at": row["uploaded_at"], **info, "warnings": warnings}, 201)


@r.delete("/settings/doc-templates/{stage}")
def remove_template(stage: str, ctx: Ctx = Depends(write_ctx)):
    """Owner only. Go back to LARIS's standard layout for this document type."""
    require_owner(ctx)
    _stage(stage)
    row = ctx.conn.execute("delete from doc_templates where tenant_id=%s and stage=%s returning id, filename", (ctx.tenant_id, stage)).fetchone()
    if not row:
        raise ApiError(404, "not_found", "no template is uploaded for this document type")
    audit(ctx, "doc_templates", row["id"], f"template for {stage} removed: {row['filename']}", None, None)
    return reply(ctx, {"stage": stage, "removed": True})


@r.get("/settings/doc-templates/{stage}/starter")
def starter_template(stage: str, ctx: Ctx = Depends(read_ctx)):
    """Owner only. A ready-to-edit Word file for the document type, with the placeholders already in place: restyle it in Word and upload it back."""
    require_owner(ctx)
    _stage(stage)
    return Response(doc_template.starter(stage), media_type=DOCX, headers={"Content-Disposition": f'attachment; filename="{stage}-template.docx"'})
