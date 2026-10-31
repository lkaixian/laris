"""Quote-to-cash chain (v2 slice): customer PO, sales order, proforma, delivery order, invoice, receipt, supplier PO.
Every document links to its parent and shares a deal id (the Document Trail). Preparation only: payments are recorded, never taken,
and nothing here is filed with any authority or sent to anyone."""
import json
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from .. import buyside, chain, pipeline
from ..errors import ApiError
from .deps import Ctx, Jsonb, audit, read_ctx, reply, require_perm, write_ctx

r = APIRouter(prefix="/api")
COLS = ("id, kind, doc_no, status, deal_id, parent_id, quote_id, party_id, ref, lines, discount_pct, sst_rate, round5, subtotal, discount, sst, "
        "rounding, total, deposit_pct, paid, due_on, note, void_reason, created_at")


class Line(BaseModel, extra="forbid"):
    description: str = Field(max_length=300)
    qty: Decimal
    uom: str = Field("unit", max_length=20)
    unit_price: Decimal = Decimal(0)


def shape(row: dict, today: date) -> dict:
    out = dict(row)
    out["kind_label"] = chain.KINDS[row["kind"]][1]
    out["status_effective"] = chain.effective_status(row["kind"], row["status"], row["due_on"], today)
    out["balance"] = row["total"] - row["paid"] if row["kind"] in ("inv", "pf") else None
    out["days_overdue"] = (today - row["due_on"]).days if out["status_effective"] == "overdue" else 0
    out["ageing"] = chain.ageing_bucket((today - row["due_on"]).days) if row["kind"] == "inv" and row["due_on"] and row["status"] in ("issued", "partially_paid") else None
    return out


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
         lines: list, discount_pct=0, sst_rate=0, round5=False, ref=None, deposit_pct=None, due_on=None, note=None, status=None) -> dict:
    lines = chain.clean_lines(lines)
    t = chain.totals(lines, discount_pct, sst_rate, round5)
    did = ctx.conn.execute(
        """insert into chain_docs(tenant_id, kind, doc_no, status, deal_id, parent_id, quote_id, party_id, ref, lines, discount_pct, sst_rate, round5,
                                  subtotal, discount, sst, rounding, total, deposit_pct, due_on, note, created_by)
           values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
        (ctx.tenant_id, kind, next_no(ctx, kind), status or chain.START[kind], deal_id or uuid4(), parent, quote_id, party_id, ref,
         Jsonb(lines), discount_pct, sst_rate, round5, t["subtotal"], t["discount"], t["sst"], t["rounding"], t["total"], deposit_pct, due_on, note,
         ctx.user_id)).fetchone()["id"]
    doc = load(ctx, did)
    audit(ctx, "chain_docs", did, f"{chain.KINDS[kind][1]} {doc['doc_no']} created", None,
          {"status": doc["status"], "total": doc["total"], "parent": parent, "ref": ref})
    return doc


def party(ctx: Ctx, pid: UUID, role: str) -> None:
    if not ctx.conn.execute("select 1 from parties where id=%s and tenant_id=%s and role=%s", (pid, ctx.tenant_id, role)).fetchone():
        raise ApiError(422, "bad_party", f"party_id is not one of your {role}s")


def quantities(ctx: Ctx, so: dict, kind: str) -> list[Decimal]:
    """Per sales-order line: how much is already covered by documents of this kind (cancelled / returned ones do not count)."""
    used = [Decimal(0)] * len(so["lines"])
    for d in ctx.conn.execute("select lines from chain_docs where parent_id=%s and kind=%s and status not in ('cancelled','returned','void')",
                              (so["id"], kind)).fetchall():
        for ln in d["lines"]:
            used[ln["src"]] += Decimal(ln["qty"])
    return used


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
        link = {"deal_id": order["deal_id"], "parent": order["id"]}
    doc = make(ctx, body.kind, party_id=body.customer_id, lines=[x.model_dump() for x in body.lines], discount_pct=body.discount_pct,
               sst_rate=body.sst_rate, round5=body.round5, ref=ref, note=(body.note or "").strip() or None, **link)
    return reply(ctx, shape(doc, pipeline.today_my()), 201)


class FromQuote(BaseModel, extra="forbid"):
    to: Literal["cpo", "so"] = "so"
    ref: str | None = Field(None, max_length=80)
    sst_rate: Decimal = Field(Decimal(0), ge=0, le=100)
    round5: bool = False


@r.post("/chain/from-quote/{quote_id}")
def from_quote(quote_id: UUID, body: FromQuote, ctx: Ctx = Depends(write_ctx)):
    """Start the chain from an accepted outgoing quote. A quote that expired, was rejected or is still a draft cannot be converted."""
    require_perm(ctx, "manage_contacts")
    c = ctx.conn
    q = c.execute("select id, doc_no, status, party_id from documents where id=%s and tenant_id=%s and direction='out' and kind='quotation'", (quote_id, ctx.tenant_id)).fetchone()
    if not q:
        raise ApiError(404, "not_found", "quote not found")
    if q["status"] != "accepted":
        raise ApiError(409, "quote_not_accepted", f"only an accepted quote can be converted (this one is {q['status']}); re-approve it first")
    if c.execute("select 1 from chain_docs where quote_id=%s and kind=%s and parent_id is null and status<>'cancelled'", (quote_id, body.to)).fetchone():
        raise ApiError(409, "already_converted", "this quote already has one")
    ref = (body.ref or "").strip() or None
    lines = [{"description": x["description"], "qty": x["qty"], "uom": x["uom"], "unit_price": x["unit_price"] * (Decimal(100) - (x["discount_pct"] or Decimal(0))) / 100}
             for x in c.execute("select description, qty, uom, unit_price, discount_pct from document_lines where document_id=%s and not is_header and qty is not null and unit_price is not null order by line_no", (quote_id,)).fetchall()]
    if not lines:
        raise ApiError(422, "no_lines", "the quote has no priced lines")
    doc = make(ctx, body.to, quote_id=quote_id, party_id=q["party_id"], lines=lines, sst_rate=body.sst_rate, round5=body.round5, ref=ref,
               note=f"From quote {q['doc_no']}")
    return reply(ctx, shape(doc, pipeline.today_my()), 201)


class Convert(BaseModel, extra="forbid"):
    to: Literal["so", "pf", "do", "inv"]
    deposit_pct: Decimal | None = Field(None, gt=0, le=100)  # proforma: share asked up front
    qty: dict[int, Decimal] | None = None  # delivery order: quantity per sales-order line number (1-based); omitted means everything still open
    due_in_days: int = Field(30, ge=0, le=365)  # invoice: credit terms


@r.post("/chain/{doc_id}/convert")
def convert(doc_id: UUID, body: Convert, ctx: Ctx = Depends(write_ctx)):
    """One click to the next document. The child copies the parent's lines, keeps a link to it and shares its deal id."""
    require_perm(ctx, "manage_contacts")
    p = load(ctx, doc_id, lock=True)
    if body.to not in chain.CONVERT.get(p["kind"], set()):
        raise ApiError(409, "illegal_conversion", f"a {chain.KINDS[p['kind']][1]} cannot be turned into that document")
    if p["status"] not in chain.PARENT_OK_STATUS.get(p["kind"], set()):
        raise ApiError(409, "parent_not_ready", f"the {chain.KINDS[p['kind']][1]} is {p['status']}")
    common = dict(deal_id=p["deal_id"], parent=p["id"], party_id=p["party_id"], discount_pct=p["discount_pct"], sst_rate=p["sst_rate"], round5=p["round5"], ref=p["ref"])
    if body.to == "so":
        doc = make(ctx, "so", **common, lines=p["lines"], note=p["note"])
        ctx.conn.execute("update chain_docs set status='confirmed' where id=%s", (p["id"],)) if p["status"] == "received" else None
        return reply(ctx, shape(doc, pipeline.today_my()), 201)
    if body.to == "pf":
        if not body.deposit_pct:
            raise ApiError(422, "deposit_required", "a proforma needs deposit_pct")
        doc = make(ctx, "pf", **common, lines=p["lines"], deposit_pct=body.deposit_pct)
        due = chain.money(doc["total"] * body.deposit_pct / 100)
        audit(ctx, "chain_docs", doc["id"], f"deposit asked: RM {due}", None, {"deposit": due})
        return reply(ctx, shape(doc, pipeline.today_my()), 201)
    if body.to == "do":
        sent = quantities(ctx, p, "do")
        lines = []
        for i, ln in enumerate(p["lines"]):
            open_ = Decimal(ln["qty"]) - sent[i]
            want = body.qty.get(i + 1, Decimal(0)) if body.qty is not None else open_
            if want < 0 or want > open_:
                raise ApiError(409, "over_delivery", f"line {i + 1}: only {open_} left to deliver")
            if want > 0:
                lines.append({**ln, "qty": str(want), "src": i})
        if not lines:
            raise ApiError(409, "nothing_to_deliver", "nothing is left to deliver, or no quantity was given")
        doc = make(ctx, "do", **common, lines=lines)
        ctx.conn.execute("update chain_docs set status='in_fulfilment' where id=%s and status='confirmed'", (p["id"],))
        return reply(ctx, shape(doc, pipeline.today_my()), 201)
    # invoice: from a delivered DO (only what was delivered), or from a sales order that has no delivery orders (services)
    due = pipeline.today_my() + timedelta(days=body.due_in_days)
    if p["kind"] == "do":
        so = load(ctx, p["parent_id"])
        if ctx.conn.execute("select 1 from chain_docs where parent_id=%s and kind='inv' and status<>'void'", (p["id"],)).fetchone():
            raise ApiError(409, "already_invoiced", "this delivery order is already invoiced")
        doc = make(ctx, "inv", **{**common, "parent": p["id"]}, lines=[{k: v for k, v in ln.items()} for ln in p["lines"]], due_on=due)
        return reply(ctx, shape(doc, pipeline.today_my()), 201)
    if ctx.conn.execute("select 1 from chain_docs where parent_id=%s and kind in ('do','inv') and status not in ('cancelled','void','returned')", (p["id"],)).fetchone():
        raise ApiError(409, "has_deliveries", "this order has delivery orders or an invoice: invoice from a delivery order")
    doc = make(ctx, "inv", **common, lines=p["lines"], due_on=due)
    return reply(ctx, shape(doc, pipeline.today_my()), 201)


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
    if body.to in ("partially_paid", "paid", "deposit_received"):
        raise ApiError(409, "use_payment", "record a payment instead: it issues the receipt and moves the status")
    c = ctx.conn
    if d["kind"] == "do" and body.to == "delivered":
        so_id = d["parent_id"]
        c.execute("update chain_docs set status=%s where id=%s", (body.to, doc_id))
        so = load(ctx, so_id, lock=True)
        delivered = [Decimal(0)] * len(so["lines"])
        for x in c.execute("select lines from chain_docs where parent_id=%s and kind='do' and status='delivered'", (so_id,)).fetchall():
            for ln in x["lines"]:
                delivered[ln["src"]] += Decimal(ln["qty"])
        if all(delivered[i] >= Decimal(ln["qty"]) for i, ln in enumerate(so["lines"])):
            c.execute("update chain_docs set status='fulfilled' where id=%s", (so_id,))
    else:
        c.execute("update chain_docs set status=%s, void_reason=coalesce(%s, void_reason) where id=%s", (body.to, (body.reason or "").strip() or None, doc_id))
    if d["kind"] == "rcp" and body.to == "void":  # voiding a receipt gives the money back to the invoice's balance
        _recompute_paid(ctx, d["parent_id"])
    audit(ctx, "chain_docs", doc_id, f"{d['doc_no']}: {d['status']} to {body.to}", {"status": d["status"]}, {"status": body.to, "reason": body.reason})
    return reply(ctx, shape(load(ctx, doc_id), pipeline.today_my()))


def _recompute_paid(ctx: Ctx, parent_id: UUID) -> None:
    c = ctx.conn
    inv = load(ctx, parent_id, lock=True)
    paid = c.execute("select coalesce(sum(total),0) s from chain_docs where parent_id=%s and kind='rcp' and status='issued'", (parent_id,)).fetchone()["s"]
    if inv["kind"] == "inv":
        status = "paid" if paid >= inv["total"] else "partially_paid" if paid > 0 else "issued"
    else:
        status = "deposit_received" if paid > 0 else "sent"
    c.execute("update chain_docs set paid=%s, status=%s where id=%s", (paid, status, parent_id))


class Pay(BaseModel, extra="forbid"):
    amount: Decimal = Field(gt=0, lt=Decimal(10) ** 10, decimal_places=2)
    method: Literal["cash", "bank_transfer", "cheque", "ewallet", "other"] = "bank_transfer"


@r.post("/chain/{doc_id}/payment")
def payment(doc_id: UUID, body: Pay, ctx: Ctx = Depends(write_ctx)):
    """Record a payment against an issued invoice (partial or full) or a sent proforma (the deposit). It issues an immutable receipt.
    LARIS only records what the owner says was received; it never takes or moves money."""
    require_perm(ctx, "manage_contacts")
    d = load(ctx, doc_id, lock=True)
    if d["kind"] not in ("inv", "pf") or d["status"] not in ("issued", "partially_paid", "sent"):
        raise ApiError(409, "not_payable", "payments go on an issued invoice or a sent proforma")
    owed = (d["total"] - d["paid"]) if d["kind"] == "inv" else chain.money(d["total"] * (d["deposit_pct"] or 100) / 100) - d["paid"]
    amount = chain.money(body.amount)
    if amount > owed:
        raise ApiError(409, "overpayment", f"RM {owed} is outstanding; the payment is more than that")
    rc = make(ctx, "rcp", deal_id=d["deal_id"], parent=d["id"], party_id=d["party_id"],
              lines=[{"description": f"Payment for {d['doc_no']} ({body.method.replace('_', ' ')})", "qty": 1, "unit_price": amount}], note=body.method)
    _recompute_paid(ctx, doc_id)
    audit(ctx, "chain_docs", doc_id, f"payment RM {amount} recorded, receipt {rc['doc_no']}", {"paid": d["paid"]}, {"paid": d["paid"] + amount})
    return reply(ctx, {"receipt": shape(rc, pipeline.today_my()), "document": shape(load(ctx, doc_id), pipeline.today_my())}, 201)


@r.get("/chain")
def listing(kind: Literal["cpo", "so", "pf", "do", "inv", "rcp", "spo"] | None = None, status: str | None = Query(None, max_length=30),
            limit: int = Query(100, ge=1, le=500), ctx: Ctx = Depends(read_ctx)):
    today = pipeline.today_my()
    rows = ctx.conn.execute(f"""select {COLS}, (select name from parties p where p.id = party_id) as party from chain_docs
                                where tenant_id=%s and (%s::text is null or kind=%s) order by created_at desc, id limit %s""",
                            (ctx.tenant_id, kind, kind, limit)).fetchall()
    out = [shape(x, today) for x in rows]
    if status:
        out = [x for x in out if status in (x["status"], x["status_effective"])]
    return reply(ctx, out)


@r.get("/chain/receivables")
def receivables(ctx: Ctx = Depends(read_ctx)):
    """Receivables ageing: what customers still owe, in buckets (current, 1-30, 31-60, 60+ days past due)."""
    today = pipeline.today_my()
    buckets = {k: {"count": 0, "outstanding": Decimal(0)} for k in ("current", "1-30", "31-60", "60+")}
    for x in ctx.conn.execute("select due_on, total, paid from chain_docs where tenant_id=%s and kind='inv' and status in ('issued','partially_paid')", (ctx.tenant_id,)).fetchall():
        b = buckets[chain.ageing_bucket((today - x["due_on"]).days) if x["due_on"] else "current"]
        b["count"] += 1
        b["outstanding"] += x["total"] - x["paid"]
    return reply(ctx, {"as_of": today, "buckets": buckets, "total": sum((b["outstanding"] for b in buckets.values()), Decimal(0)),
                       "note": "Reminders are drafts for the owner to send; LARIS sends nothing by itself."})


@r.get("/chain/{doc_id}")
def detail(doc_id: UUID, ctx: Ctx = Depends(read_ctx)):
    """One document and its Document Trail: every document of the same deal in order, with who made them."""
    today = pipeline.today_my()
    d = load(ctx, doc_id)
    trail = ctx.conn.execute(f"select {COLS} from chain_docs where tenant_id=%s and deal_id=%s order by created_at, id", (ctx.tenant_id, d["deal_id"])).fetchall()
    history = ctx.conn.execute("select at, event, actor from audit_log where tenant_id=%s and entity='chain_docs' and entity_id=%s order by at, id", (ctx.tenant_id, doc_id)).fetchall()
    return reply(ctx, {**shape(d, today), "trail": [shape(x, today) for x in trail], "history": history,
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
