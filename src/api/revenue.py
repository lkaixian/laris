"""Revenue and profit (src/revenue.py defines every number and says how it is worked out), and the running costs behind untung bersih.
GET /api/revenue needs view_revenue AND view_costs: it shows costs and margins. Recording a running cost needs record_expenses; voiding one is
the owner's. Selling-side figures come from orders (the jobs row), payments and the cost book (v_quote_margin); nothing here is priced by the AI."""
from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from .. import pipeline, revenue
from ..errors import ApiError
from .deps import Ctx, audit, guarded, read_ctx, reply, require_owner, require_perm, write_ctx

r = APIRouter(prefix="/api")

# One row per order won. Sales come from the quote's own lines (without SST); cost from the cost book, and `complete` says whether EVERY priced line
# had a cost (v_quote_margin only holds lines that do, so a quote with an uncosted line must not look cheaper than it is).
# A job made by hand has an agreed amount and no cost. The day an order counts is the day it was accepted, in Malaysia time.
ORDERS = """
select j.id, coalesce(q.doc_no, j.title) as ref, coalesce(pq.name, pj.name) as customer,
       (j.created_at at time zone 'Asia/Kuala_Lumpur')::date as "on",
       case when j.quote_id is null then coalesce(j.amount, j.order_total, 0) else coalesce(l.sales, 0) end as sales,
       case when j.quote_id is null then null else l.cost end as cost,
       case when j.quote_id is null then false else coalesce(l.complete, false) end as cost_complete,
       coalesce(j.order_total, case when j.quote_id is null then j.amount else l.sales end, 0) as owed,
       coalesce(pay.paid, 0) as paid
from jobs j
left join documents q on q.id = j.quote_id
left join parties pq on pq.id = q.party_id
left join parties pj on pj.id = j.party_id
left join lateral (
  select sum(dl.qty * dl.unit_price * (1 - coalesce(dl.discount_pct, 0) / 100)) as sales, sum(vm.line_cost) as cost, bool_and(vm.line_id is not null) as complete
  from document_lines dl left join v_quote_margin vm on vm.line_id = dl.id
  where dl.document_id = j.quote_id and not dl.is_header and dl.qty is not null and dl.unit_price is not null) l on true
left join (select job_id, sum(case when reverses_payment_id is null then amount else -amount end) as paid from payments where tenant_id = %s group by job_id) pay on pay.job_id = j.id
where j.tenant_id = %s and (j.created_at at time zone 'Asia/Kuala_Lumpur')::date between %s and %s
"""
PAYMENTS = """select paid_on as "on", case when reverses_payment_id is null then amount else -amount end as amount
              from payments where tenant_id = %s and paid_on between %s and %s"""
EXPENSES = """select id, spent_on as "on", category, amount, note from expenses where tenant_id = %s and voided_at is null and spent_on between %s and %s"""
EXPENSE_COLS = "id, spent_on, category, amount, note, created_at"


@r.get("/revenue")
def revenue_report(start: date = Query(alias="from"), end: date = Query(alias="to"), ctx: Ctx = Depends(read_ctx)):
    """Money in and out, untung kasar and untung bersih for start..end, next to the period of the same length just before it."""
    require_perm(ctx, "view_revenue")
    require_perm(ctx, "view_costs")
    try:
        revenue.check_period(start, end)
    except revenue.PeriodError as e:
        raise ApiError(422, e.code, str(e)) from e
    before_start, before_end = revenue.previous_period(start, end)
    c, t = ctx.conn, ctx.tenant_id
    orders = c.execute(ORDERS, (t, t, before_start, end)).fetchall()
    payments = c.execute(PAYMENTS, (t, before_start, end)).fetchall()
    expenses = c.execute(EXPENSES, (t, before_start, end)).fetchall()
    out = revenue.summarise(orders, payments, expenses, start, end)
    out |= revenue.compare(out, revenue.summarise(orders, payments, expenses, before_start, before_end))
    out |= {"categories": list(revenue.CATEGORIES), "can_record": "record_expenses" in ctx.perms, "can_void": bool(ctx.owner), "today": pipeline.today_my()}
    return reply(ctx, out)


class ExpenseIn(BaseModel, extra="forbid"):
    spent_on: date
    category: Literal["rent", "wages", "utilities", "transport", "marketing", "tax", "other"]
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    note: str | None = Field(None, max_length=200)


@r.post("/expenses")
def record_expense(body: ExpenseIn, ctx: Ctx = Depends(write_ctx)):
    """Record a running cost (rent, wages, a bill). It counts toward untung bersih for the day it was spent."""
    require_perm(ctx, "record_expenses")
    if body.spent_on > pipeline.today_my():
        raise ApiError(422, "future_date", "spent_on cannot be in the future")
    with guarded():
        e = ctx.conn.execute(f"""insert into expenses(tenant_id, spent_on, category, amount, note, created_by) values (%s,%s,%s,%s,%s,%s)
                                 returning {EXPENSE_COLS}""",
                             (ctx.tenant_id, body.spent_on, body.category, body.amount, (body.note or "").strip() or None, ctx.user_id)).fetchone()
    audit(ctx, "expenses", e["id"], f"running cost of RM{e['amount']:,.2f} recorded ({e['category']}, {e['spent_on']})", None, {"expense_id": e["id"]})
    return reply(ctx, e, 201)


class VoidIn(BaseModel, extra="forbid"):
    reason: str = Field(min_length=3, max_length=300)


@r.post("/expenses/{expense_id}/void")
def void_expense(expense_id: UUID, body: VoidIn, ctx: Ctx = Depends(write_ctx)):
    """Take a running cost out of the figures (a mistake or a duplicate). The row stays, marked void with the reason; owner only."""
    require_owner(ctx)
    c = ctx.conn
    e = c.execute("select id, amount, category, voided_at from expenses where id=%s and tenant_id=%s for update", (expense_id, ctx.tenant_id)).fetchone()
    if not e:
        raise ApiError(404, "not_found", "no such running cost")
    if e["voided_at"]:
        raise ApiError(409, "already_void", "this running cost is already voided")
    with guarded():
        c.execute("update expenses set void_reason=%s, voided_at=now(), voided_by=%s where id=%s", (body.reason.strip(), ctx.user_id, expense_id))
    audit(ctx, "expenses", expense_id, f"running cost of RM{e['amount']:,.2f} ({e['category']}) voided: {body.reason.strip()}", None, {"expense_id": expense_id})
    return reply(ctx, {"id": expense_id, "voided": True})
