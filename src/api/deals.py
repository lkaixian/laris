"""Customer PO, sales order and supplier PO (v2 slice), plus the supplier-side helpers. Every document links to its parent and shares a deal id
(the Document Trail). The money and the paper of an order (proforma, delivery order, invoice, receipt, payments) are NOT here: they are in
chain.py and delivery.py against the order's jobs row, and chain_docs.job_id points at that row, so an order has one place for its money.
Preparation only: nothing here is filed with any authority or sent to anyone."""
from decimal import Decimal
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from .. import buyside, chain, pipeline
from ..errors import ApiError
from .deps import Ctx, Jsonb, audit, read_ctx, reply, require_perm, write_ctx

r = APIRouter(prefix="/api")
COLS = ("id, kind, doc_no, status, deal_id, parent_id, job_id, quote_id, party_id, ref, lines, discount_pct, sst_rate, round5, subtotal, discount, sst, "
        "rounding, total, note, void_reason, created_at")


class Line(BaseModel, extra="forbid"):
    description: str = Field(max_length=300)
    qty: Decimal
    uom: str = Field("unit", max_length=20)
    unit_price: Decimal = Decimal(0)


def shape(row: dict) -> dict:
    return {**row, "kind_label": chain.KINDS[row["kind"]][1]}


def load(ctx: Ctx, doc_id: UUID, lock: bool = False) -> dict:
    row = ctx.conn.execute(f"select {COLS} from chain_docs where id=%s and tenant_id=%s" + (" for update" if lock else ""), (doc_id, ctx.tenant_id)).fetchone()
    if not row:
        raise ApiError(404, "not_found", "document not found")
    return row


def next_no(ctx: Ctx, kind: str) -> str:
    year = pipeline.today_my().year
    n = ctx.conn.execute("""insert into chain_counters(tenant_id, kind, yr, last) values (%s,%s,%s,1)
                            on conflict (tenant_id, kind, yr) do update set last = chain_counters.last + 1 returning last""",
                         (ctx.tenant_id, kind, year)).fetchone()["last"]
    return f"{chain.KINDS[kind][0]}-{year}-{n:04d}"


def make(ctx: Ctx, kind: str, *, deal_id: UUID | None = None, parent: UUID | None = None, quote_id: UUID | None = None, party_id: UUID,
         lines: list, discount_pct=0, sst_rate=0, round5=False, ref=None, note=None, job_id: UUID | None = None, new_job=False) -> dict:
    lines = chain.clean_lines(lines)
    t = chain.totals(lines, discount_pct, sst_rate, round5)
    no = next_no(ctx, kind)
    if new_job:  # a hand-typed customer PO or sales order IS an order: its jobs row is where the money, proforma and delivery will live
        # ponytail: the job carries the document total as one "lot" line (jobs.amount); the PDFs of such an order show that line, not the PO's lines
        title = f"{chain.KINDS[kind][1]} {no}"[:200]
        job_id = ctx.conn.execute("insert into jobs(tenant_id, title, party_id, amount, created_by) values (%s,%s,%s,%s,%s) returning id",
                                  (ctx.tenant_id, title, party_id, t["total"], ctx.user_id)).fetchone()["id"]
        audit(ctx, "jobs", job_id, f"job created from {chain.KINDS[kind][1]} {no}", None, {"title": title})
    did = ctx.conn.execute(
        """insert into chain_docs(tenant_id, kind, doc_no, status, deal_id, parent_id, job_id, quote_id, party_id, ref, lines, discount_pct, sst_rate, round5,
                                  subtotal, discount, sst, rounding, total, note, created_by)
           values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
        (ctx.tenant_id, kind, no, chain.START[kind], deal_id or uuid4(), parent, job_id, quote_id, party_id, ref,
         Jsonb(lines), discount_pct, sst_rate, round5, t["subtotal"], t["discount"], t["sst"], t["rounding"], t["total"], note,
         ctx.user_id)).fetchone()["id"]
    doc = load(ctx, did)
    audit(ctx, "chain_docs", did, f"{chain.KINDS[kind][1]} {doc['doc_no']} created", None,
          {"status": doc["status"], "total": doc["total"], "parent": parent, "ref": ref})
    return doc


def party(ctx: Ctx, pid: UUID, role: str) -> None:
    if not ctx.conn.execute("select 1 from parties where id=%s and tenant_id=%s and role=%s", (pid, ctx.tenant_id, role)).fetchone():
        raise ApiError(422, "bad_party", f"party_id is not one of your {role}s")


class NewDoc(BaseModel, extra="forbid"):
    kind: Literal["cpo", "so", "spo"]
    customer_id: UUID  # the customer, or the supplier for a supplier PO
    lines: list[Line] = Field(min_length=1, max_length=chain.MAX_LINES)
    ref: str | None = Field(None, max_length=80)
    discount_pct: Decimal = Field(Decimal(0), ge=0, le=100)
    sst_rate: Decimal = Field(Decimal(0), ge=0, le=100)
    round5: bool = False
    note: str | None = Field(None, max_length=2000)
    serves: UUID | None = None  # demand pass-through: the customer order this supplier PO is for (shares its deal trail)


@r.post("/chain")
def create(body: NewDoc, ctx: Ctx = Depends(write_ctx)):
    """A customer PO, sales order or supplier PO typed in by hand (quotes are converted with /chain/from-quote/{id})."""
    require_perm(ctx, "manage_contacts")
    party(ctx, body.customer_id, "supplier" if body.kind == "spo" else "customer")
    ref = (body.ref or "").strip() or None
    if body.kind == "cpo" and ref and ctx.conn.execute("select 1 from chain_docs where tenant_id=%s and kind='cpo' and party_id=%s and lower(ref)=lower(%s) and status<>'cancelled'",
                                                       (ctx.tenant_id, body.customer_id, ref)).fetchone():
        raise ApiError(409, "duplicate_po", "this customer's PO number is already recorded")
    link = {}
    if body.serves:
        if body.kind != "spo":
            raise ApiError(422, "serves_spo_only", "only a supplier PO can serve a customer order")
        order = load(ctx, body.serves)
        if order["kind"] not in ("so", "cpo") or order["status"] in ("cancelled", "void"):
            raise ApiError(409, "bad_parent", "a supplier PO can serve an open customer order or sales order")
        link = {"deal_id": order["deal_id"], "parent": order["id"], "job_id": order["job_id"]}
    doc = make(ctx, body.kind, party_id=body.customer_id, lines=[x.model_dump() for x in body.lines], discount_pct=body.discount_pct,
               sst_rate=body.sst_rate, round5=body.round5, ref=ref, note=(body.note or "").strip() or None, new_job=body.kind != "spo", **link)
    return reply(ctx, shape(doc), 201)


class FromQuote(BaseModel, extra="forbid"):
    to: Literal["cpo", "so"] = "so"
    ref: str | None = Field(None, max_length=80)


@r.post("/chain/from-quote/{quote_id}")
def from_quote(quote_id: UUID, body: FromQuote, ctx: Ctx = Depends(write_ctx)):
    """Start from an accepted outgoing quote. The document joins the quote's order (the jobs row Accept made), where its money lives.
    A quote that expired, was rejected or is still a draft cannot be converted."""
    require_perm(ctx, "manage_contacts")
    c = ctx.conn
    q = c.execute("select id, doc_no, status, party_id from documents where id=%s and tenant_id=%s and direction='out' and kind='quotation'", (quote_id, ctx.tenant_id)).fetchone()
    if not q:
        raise ApiError(404, "not_found", "quote not found")
    if q["status"] != "accepted":
        raise ApiError(409, "quote_not_accepted", f"only an accepted quote can be converted (this one is {q['status']}); re-approve it first")
    if c.execute("select 1 from chain_docs where quote_id=%s and kind=%s and parent_id is null and status<>'cancelled'", (quote_id, body.to)).fetchone():
        raise ApiError(409, "already_converted", "this quote already has one")
    job = c.execute("select id from jobs where quote_id=%s and tenant_id=%s", (quote_id, ctx.tenant_id)).fetchone()
    if not job:
        raise ApiError(409, "no_order", "this quote has no order yet; it is made when the customer accepts")
    ref = (body.ref or "").strip() or None
    lines = [{"description": x["description"], "qty": x["qty"], "uom": x["uom"], "unit_price": x["unit_price"] * (Decimal(100) - (x["discount_pct"] or Decimal(0))) / 100}
             for x in c.execute("select description, qty, uom, unit_price, discount_pct from document_lines where document_id=%s and not is_header and qty is not null and unit_price is not null order by line_no", (quote_id,)).fetchall()]
    if not lines:
        raise ApiError(422, "no_lines", "the quote has no priced lines")
    doc = make(ctx, body.to, quote_id=quote_id, job_id=job["id"], party_id=q["party_id"], lines=lines, ref=ref, note=f"From quote {q['doc_no']}")
    return reply(ctx, shape(doc), 201)


class Convert(BaseModel, extra="forbid"):
    to: Literal["so"]


@r.post("/chain/{doc_id}/convert")
def convert(doc_id: UUID, body: Convert, ctx: Ctx = Depends(write_ctx)):
    """A customer PO into a sales order of the same order (job), sharing its deal id. Proforma, delivery order, invoice and receipt are made on the order:
    POST /api/jobs/{id}/proforma, /delivery-orders, /invoice, /payments."""
    require_perm(ctx, "manage_contacts")
    p = load(ctx, doc_id, lock=True)
    if body.to not in chain.CONVERT.get(p["kind"], set()):
        raise ApiError(409, "illegal_conversion", f"a {chain.KINDS[p['kind']][1]} cannot be turned into that document")
    if p["status"] not in chain.PARENT_OK_STATUS.get(p["kind"], set()):
        raise ApiError(409, "parent_not_ready", f"the {chain.KINDS[p['kind']][1]} is {p['status']}")
    doc = make(ctx, "so", deal_id=p["deal_id"], parent=p["id"], job_id=p["job_id"], party_id=p["party_id"], discount_pct=p["discount_pct"], sst_rate=p["sst_rate"],
               round5=p["round5"], ref=p["ref"], lines=p["lines"], note=p["note"])
    if p["status"] == "received":
        ctx.conn.execute("update chain_docs set status='confirmed' where id=%s", (p["id"],))
    return reply(ctx, shape(doc), 201)


class Move(BaseModel, extra="forbid"):
    to: str = Field(max_length=30)
    reason: str | None = Field(None, max_length=300)


@r.post("/chain/{doc_id}/transition")
def transition(doc_id: UUID, body: Move, ctx: Ctx = Depends(write_ctx)):
    """Move a document along its state machine. Illegal moves are refused here, not only in the screen; approvals and reversals are owner-only."""
    require_perm(ctx, "manage_contacts")
    d = load(ctx, doc_id, lock=True)
    chain.check_move(d["kind"], d["status"], body.to, ctx.owner)
    if body.to in ("void", "cancelled", "returned") and not (body.reason or "").strip():
        raise ApiError(422, "reason_required", "give a reason")
    if body.to == "cancelled" and d["job_id"] and ctx.conn.execute("select 1 from payments where job_id=%s limit 1", (d["job_id"],)).fetchone():
        raise ApiError(409, "has_payments", "money has been recorded on this order; reverse the payments first")
    ctx.conn.execute("update chain_docs set status=%s, void_reason=coalesce(%s, void_reason) where id=%s", (body.to, (body.reason or "").strip() or None, doc_id))
    audit(ctx, "chain_docs", doc_id, f"{d['doc_no']}: {d['status']} to {body.to}", {"status": d["status"]}, {"status": body.to, "reason": body.reason})
    return reply(ctx, shape(load(ctx, doc_id)))


@r.get("/chain")
def listing(kind: Literal["cpo", "so", "spo"] | None = None, status: str | None = Query(None, max_length=30),
            limit: int = Query(100, ge=1, le=500), ctx: Ctx = Depends(read_ctx)):
    rows = ctx.conn.execute(f"""select {COLS}, (select name from parties p where p.id = party_id) as party from chain_docs
                                where tenant_id=%s and (%s::text is null or kind=%s) and (%s::text is null or status=%s) order by created_at desc, id limit %s""",
                            (ctx.tenant_id, kind, kind, status, status, limit)).fetchall()
    return reply(ctx, [shape(x) for x in rows])


@r.get("/chain/receivables")
def receivables(ctx: Ctx = Depends(read_ctx)):
    """Receivables ageing from the order chain: each live invoice's order total minus the payments received (reversals taken off), in buckets
    (current, 1-30, 31-60, 60+ days past due; no due date counts as current). Needs record_payments, like the order's own chain view."""
    require_perm(ctx, "record_payments")
    today = pipeline.today_my()
    buckets = {k: {"count": 0, "outstanding": Decimal(0)} for k in ("current", "1-30", "31-60", "60+")}
    for x in ctx.conn.execute("""select (d.extra->>'due_on')::date as due_on, coalesce(j.order_total, d.total) - s.paid as owed
                                 from deal_docs d join jobs j on j.id = d.job_id and j.tenant_id = d.tenant_id
                                 cross join lateral (select coalesce(sum(case when reverses_payment_id is null then amount else -amount end), 0) as paid
                                                     from payments p where p.job_id = j.id) s
                                 where d.tenant_id=%s and d.kind='invoice' and d.status <> 'void'""", (ctx.tenant_id,)).fetchall():
        if x["owed"] > 0:
            b = buckets[chain.ageing_bucket((today - x["due_on"]).days) if x["due_on"] else "current"]
            b["count"] += 1
            b["outstanding"] += x["owed"]
    waiting = ctx.conn.execute("""select count(*) as n from deal_docs d where d.tenant_id=%s and d.kind='proforma' and d.status <> 'void'
                                  and (select coalesce(sum(case when reverses_payment_id is null then amount else -amount end), 0) from payments p
                                       where p.job_id = d.job_id and p.purpose = 'deposit') < (d.extra->>'deposit_amount')::numeric""", (ctx.tenant_id,)).fetchone()["n"]
    return reply(ctx, {"as_of": today, "deposits_waiting": waiting, "buckets": buckets, "total": sum((b["outstanding"] for b in buckets.values()), Decimal(0)),
                       "note": "Reminders are drafts for the owner to send; LARIS sends nothing by itself."})


@r.get("/chain/{doc_id}")
def detail(doc_id: UUID, ctx: Ctx = Depends(read_ctx)):
    """One document and its Document Trail: every document of the same deal in order, with who made them."""
    d = load(ctx, doc_id)
    trail = ctx.conn.execute(f"select {COLS} from chain_docs where tenant_id=%s and deal_id=%s order by created_at, id", (ctx.tenant_id, d["deal_id"])).fetchall()
    history = ctx.conn.execute("select at, event, actor from audit_log where tenant_id=%s and entity='chain_docs' and entity_id=%s order by at, id", (ctx.tenant_id, doc_id)).fetchall()
    return reply(ctx, {**shape(d), "trail": [shape(x) for x in trail], "history": history,
                       "party": (ctx.conn.execute("select name from parties where id=%s", (d["party_id"],)).fetchone() or {}).get("name")})


class BuyQuote(BaseModel, extra="forbid"):
    supplier: str = Field(max_length=80)
    total: Decimal
    lead_days: int = Field(0, ge=0, le=365)
    on_time_pct: int = Field(0, ge=0, le=100)


class Compare(BaseModel, extra="forbid"):
    quotes: list[BuyQuote] = Field(max_length=4)
    last_paid: dict[str, Decimal] | None = None


class Margin(BaseModel, extra="forbid"):
    sell_total: Decimal
    cost_total: Decimal
    target_pct: Decimal = Decimal(20)


@r.post("/chain/buy/compare")
def buy_compare(body: Compare, ctx: Ctx = Depends(write_ctx)):
    """Rank 2 to 4 supplier quotes a person typed in. Pure rules, nothing is stored or ordered."""
    require_perm(ctx, "manage_contacts")
    return reply(ctx, buyside.compare_quotes([q.model_dump() for q in body.quotes], body.last_paid))


@r.post("/chain/buy/margin")
def buy_margin(body: Margin, ctx: Ctx = Depends(write_ctx)):
    """Deal profit ring: customer price against supplier cost."""
    require_perm(ctx, "manage_contacts")
    return reply(ctx, buyside.margin(body.sell_total, body.cost_total, body.target_pct))
