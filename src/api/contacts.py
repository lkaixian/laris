"""Contact book: customers, suppliers and contractors with their details and document history."""
from typing import Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from ..errors import ApiError
from .deps import Ctx, audit, guarded, read_ctx, reply, write_ctx
from .routes import SUMMARY, summary

r = APIRouter(prefix="/api")
ROLE = Literal["customer", "supplier", "contractor"]
FIELDS = ("name", "contact", "email", "attention", "ssm_no", "sst_no", "address", "notes")

# The same text the search bar matches on.
MATCH = """(p.name ilike %(q)s or p.contact ilike %(q)s or p.email ilike %(q)s or p.attention ilike %(q)s
            or p.ssm_no ilike %(q)s or p.address ilike %(q)s or p.notes ilike %(q)s)"""


def like(q: str) -> str:
    return "%" + q.strip().replace("\\", "\\\\").replace("%", "\%").replace("_", "\_") + "%"


def list_contacts(ctx: Ctx, q: str = "", role: str | None = None, limit: int = 200):
    value = """(select coalesce(sum(round(l.qty * l.unit_price * (1 - coalesce(l.discount_pct, 0) / 100), 2)), 0)
                from documents d join document_lines l on l.document_id = d.id and not l.is_header
                where d.party_id = p.id and d.status not in ('cancelled', 'superseded', 'rejected'))""" if ctx.owner else "null"
    return ctx.conn.execute(
        f"""select p.id, p.role, p.name, p.contact, p.email, p.attention, p.ssm_no, p.address, p.notes,
                   (select count(*) from documents d where d.party_id = p.id) as documents,
                   (select max(d.created_at) from documents d where d.party_id = p.id) as last_activity,
                   {value} as value
            from parties p where p.tenant_id = %(t)s and (%(role)s::text is null or p.role::text = %(role)s)
              and (not %(has_q)s or {MATCH})
            order by p.role, p.name limit %(n)s""",
        {"t": ctx.tenant_id, "role": role, "has_q": bool(q.strip()), "q": like(q), "n": limit}).fetchall()


@r.get("/contacts")
def contacts(q: str = Query("", max_length=100), role: ROLE | None = None, ctx: Ctx = Depends(read_ctx)):
    return reply(ctx, list_contacts(ctx, q, role))


@r.get("/contacts/{pid}")
def contact(pid: UUID, ctx: Ctx = Depends(read_ctx)):
    row = next(iter(x for x in list_contacts(ctx, limit=100000) if x["id"] == pid), None)
    if not row:
        raise ApiError(404, "not_found", "contact not found")
    p = ctx.conn.execute("select sst_no from parties where id=%s", (pid,)).fetchone()
    docs = ctx.conn.execute(SUMMARY + " where d.party_id=%s and d.tenant_id=%s order by d.created_at desc limit 50",
                            (pid, ctx.tenant_id)).fetchall()
    out = {**row, "sst_no": p["sst_no"], "recent_documents": [summary(ctx, d) for d in docs]}
    if ctx.owner and row["role"] == "supplier":  # what this supplier currently charges us
        out["current_costs"] = ctx.conn.execute(
            """select item_key, uom, unit_cost, effective_date from cost_items
               where tenant_id=%s and supplier_id=%s and superseded_by is null order by item_key""", (ctx.tenant_id, pid)).fetchall()
    return reply(ctx, out)


class ContactIn(BaseModel, extra="forbid"):
    role: ROLE
    name: str = Field(min_length=1, max_length=120)
    contact: str | None = Field(None, max_length=60)  # chat number or id (WhatsApp / Telegram)
    email: str | None = Field(None, max_length=120)
    attention: str | None = Field(None, max_length=120)
    ssm_no: str | None = Field(None, max_length=40)
    sst_no: str | None = Field(None, max_length=40)
    address: str | None = Field(None, max_length=400)
    notes: str | None = Field(None, max_length=2000)


class ContactEdit(BaseModel, extra="forbid"):
    name: str | None = Field(None, min_length=1, max_length=120)
    contact: str | None = Field(None, max_length=60)
    email: str | None = Field(None, max_length=120)
    attention: str | None = Field(None, max_length=120)
    ssm_no: str | None = Field(None, max_length=40)
    sst_no: str | None = Field(None, max_length=40)
    address: str | None = Field(None, max_length=400)
    notes: str | None = Field(None, max_length=2000)


@r.post("/contacts")
def create_contact(body: ContactIn, ctx: Ctx = Depends(write_ctx)):
    d = body.model_dump()
    try:
        pid = ctx.conn.execute(
            "insert into parties(tenant_id, role, name, contact, email, attention, ssm_no, sst_no, address, notes) "
            "values (%(t)s, %(role)s, %(name)s, %(contact)s, %(email)s, %(attention)s, %(ssm_no)s, %(sst_no)s, %(address)s, %(notes)s) returning id",
            {**d, "t": ctx.tenant_id}).fetchone()["id"]
    except psycopg.errors.UniqueViolation:
        raise ApiError(409, "duplicate", f"you already have a {body.role} called {body.name}")
    audit(ctx, "parties", pid, f"contact added ({body.role})")
    return reply(ctx, {"id": pid}, 201)


@r.post("/contacts/{pid}")
def edit_contact(pid: UUID, body: ContactEdit, ctx: Ctx = Depends(write_ctx)):
    sets = body.model_dump(exclude_unset=True)
    if not sets:
        raise ApiError(422, "empty", "nothing to change")
    if "name" in sets and sets["name"] is None:
        raise ApiError(422, "bad_name", "a contact needs a name")
    with guarded():
        row = ctx.conn.execute("update parties set " + ", ".join(f"{k}=%({k})s" for k in sets)
                               + " where id=%(id)s and tenant_id=%(t)s returning id", {**sets, "id": pid, "t": ctx.tenant_id}).fetchone()
    if not row:
        raise ApiError(404, "not_found", "contact not found")
    audit(ctx, "parties", pid, "contact changed: " + ",".join(sorted(sets)))
    return reply(ctx, {"id": pid})


@r.get("/search")
def search(q: str = Query(..., min_length=2, max_length=100), ctx: Ctx = Depends(read_ctx)):
    """One box for contacts, documents (number, party, line text) and, for the owner, cost items."""
    pat = like(q)
    docs = ctx.conn.execute(
        SUMMARY + """ where d.tenant_id = %(t)s and (d.doc_no ilike %(q)s or p.name ilike %(q)s or exists (
                        select 1 from document_lines l where l.document_id = d.id and (l.description ilike %(q)s or l.item_key ilike %(q)s)))
                      order by d.created_at desc limit 10""", {"t": ctx.tenant_id, "q": pat}).fetchall()
    out = {"query": q, "contacts": list_contacts(ctx, q, limit=8), "documents": [summary(ctx, d) for d in docs]}
    if ctx.owner:
        out["cost_items"] = ctx.conn.execute(
            """select ci.id, ci.item_key, ci.uom, ci.unit_cost, p.name as supplier, p.id as supplier_id, ci.effective_date
               from cost_items ci join parties p on p.id = ci.supplier_id
               where ci.tenant_id = %(t)s and ci.superseded_by is null and (ci.item_key ilike %(q)s or p.name ilike %(q)s)
               order by ci.item_key limit 10""", {"t": ctx.tenant_id, "q": pat}).fetchall()
    return reply(ctx, out)
