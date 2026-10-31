"""Business report (GET /api/reports): the key figures against their targets, an operations snapshot and the analytics behind it.
Every number is worked out from the records by fixed rules: money by src/revenue.py (the Revenue page's own definitions), counts here. The AI writes
none of it. What the records cannot know is left out rather than guessed: a KPI with no target has no variance or status ("no_target"), and Cash
Runway needs the cash on hand the owner records with the targets ("no_data" until then).

Needs view_business_report, view_costs and view_revenue (it shows costs, profit and what customers owe); changing targets needs set_report_targets."""
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from .. import chain, pipeline, revenue
from ..errors import ApiError
from .deps import Ctx, audit, read_ctx, reply, require_perm, write_ctx
from .revenue import EXPENSES, ORDERS, PAYMENTS

r = APIRouter(prefix="/api")
KL = "(%s at time zone 'Asia/Kuala_Lumpur')::date"
WEEK_OF_MONTH = Decimal(12) / Decimal(52)   # a week's share of a monthly target
LABEL = {"week": {"en": "This week", "ms": "Minggu ini", "zh": "本周", "ta": "இந்த வாரம்"},
         "last_week": {"en": "Last week", "ms": "Minggu lepas", "zh": "上周", "ta": "கடந்த வாரம்"},
         "month": {"en": "This month", "ms": "Bulan ini", "zh": "本月", "ta": "இந்த மாதம்"}}
LIMIT = {"%": 5.0, "mo": 1.0}   # how far short of target still reads "monitor": 5% (margin: 2 points), 1 month of runway; CAC may be 15% over


def monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def periods(key: str, today: date):
    """(start, end, previous start, previous end) for the report period: Monday-to-Sunday weeks, or the calendar month against the month before."""
    if key == "month":
        a = today.replace(day=1)
        end = (a.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        pe = a - timedelta(days=1)
        return a, end, pe.replace(day=1), pe
    a = monday(today) - timedelta(days=7 if key == "last_week" else 0)
    return a, a + timedelta(days=6), a - timedelta(days=7), a - timedelta(days=1)


def status(actual, target, higher_is_better=True, kind="%"):
    """Fixed rules, never the AI. Met or beaten = on_track; up to 5% short (margin 2 points, runway 1 month; for CAC up to 15% over) = monitor; worse = at_risk."""
    if actual is None:
        return None, "no_data"
    if target is None:
        return None, "no_target"
    v = round((actual - target) / target * 100, 1) if kind == "%" and target else round(actual - target, 1)
    if higher_is_better:
        limit = 2.0 if kind == "pts" else LIMIT.get(kind, 5.0)
        s = "on_track" if v >= 0 else "monitor" if v >= -limit else "at_risk"
    else:
        s = "on_track" if v <= 0 else "monitor" if v <= 15 else "at_risk"
    return v, s


def _f(x):
    return None if x is None else float(x)


def _targets(c, tid):
    return c.execute("select revenue_month, margin_pct, profit_month, cac, runway_months, cash_on_hand, cash_as_of from report_targets where tenant_id=%s", (tid,)).fetchone() or {}


def _supplier_spend(c, tid, a, b):
    """What the orders won in the period cost from each supplier, by the cost-book rows behind their quote lines."""
    return {x["supplier"]: Decimal(x["amount"]) for x in c.execute(
        f"""select sp.name as supplier, sum(ql.qty * bs.qty_consumed * bs.cost_snapshot) as amount
            from jobs j join document_lines ql on ql.document_id = j.quote_id
            join line_cost_basis bs on bs.out_line_id = ql.id join cost_items ci on ci.id = bs.cost_item_id join parties sp on sp.id = ci.supplier_id
            where j.tenant_id=%s and {KL % 'j.created_at'} between %s and %s group by sp.name""", (tid, a, b)).fetchall()}


def _may_read(ctx: Ctx):
    for k in ("view_business_report", "view_costs", "view_revenue"):
        require_perm(ctx, k)


@r.get("/reports")
def business_report(period: Literal["week", "last_week", "month"] = "week", lang: Literal["en", "ms", "zh", "ta"] = "en", ctx: Ctx = Depends(read_ctx)):
    _may_read(ctx)
    c, t = ctx.conn, ctx.tenant_id
    today = pipeline.today_my()
    a, b, pa, pb = periods(period, today)
    orders = c.execute(ORDERS, (t, t, t, pa, b)).fetchall()
    pays = c.execute(PAYMENTS, (t, pa, b)).fetchall()
    exps = c.execute(EXPENSES, (t, pa, b)).fetchall()
    now, before = revenue.summarise(orders, pays, exps, a, b), revenue.summarise(orders, pays, exps, pa, pb)
    tg = _targets(c, t)
    scale = WEEK_OF_MONTH if period != "month" else Decimal(1)

    # CAC = marketing spend / customers whose first order is in the period; Cash Runway = cash on hand / the period's running costs per month
    new_customers = c.execute(
        f"""select count(*) n from (select coalesce((select q.party_id from documents q where q.id = j.quote_id), j.party_id) as party,
                                          min({KL % 'j.created_at'}) as first_on
                                   from jobs j where j.tenant_id=%s group by 1) f where f.party is not null and f.first_on between %s and %s""", (t, a, b)).fetchone()["n"]
    marketing = sum((x["amount"] for x in now["expenses_by_category"] if x["category"] == "marketing"), Decimal(0))
    cac = float(marketing / new_customers) if new_customers and marketing else None
    days = (b - a).days + 1
    monthly_running = now["running"] / days * Decimal("30.4") if now["running"] else None
    runway = float(tg["cash_on_hand"] / monthly_running) if tg.get("cash_on_hand") is not None and monthly_running else None

    def kpi(key, actual, target, up=True, kind="%", vunit="%"):
        v, s = status(actual, target, up, kind)
        return {"key": key, "target": target, "actual": actual, "variance": v, "vunit": vunit, "status": s}
    rev_t = _f(tg["revenue_month"] * scale) if tg.get("revenue_month") is not None else None
    prof_t = _f(tg["profit_month"] * scale) if tg.get("profit_month") is not None else None
    kpis = [kpi("revenue", _f(now["sales"]), rev_t), kpi("margin", _f(now["gross_pct"]), _f(tg.get("margin_pct")), kind="pts"),
            kpi("profit", _f(now["net"]), prof_t), kpi("cac", cac, _f(tg.get("cac")), up=False),
            kpi("runway", runway, _f(tg.get("runway_months")), kind="mo", vunit="mo")]

    # the quote funnel: of the quotes sent in the period, how many were opened, accepted (an order exists) and paid
    f = c.execute(
        f"""select count(*) sent, count(*) filter (where d.read_at is not null) viewed,
                   count(*) filter (where exists (select 1 from jobs j where j.quote_id = d.id)) accepted,
                   count(*) filter (where exists (select 1 from jobs j join payments p on p.job_id = j.id and p.reverses_payment_id is null where j.quote_id = d.id)) paid
            from documents d where d.tenant_id=%s and d.direction='out' and d.sent_at is not null and {KL % 'd.sent_at'} between %s and %s""", (t, a, b)).fetchone()
    won = lambda s, e: c.execute(f"select count(*) n from jobs j where j.tenant_id=%s and j.quote_id is not null and {KL % 'j.created_at'} between %s and %s", (t, s, e)).fetchone()["n"]  # noqa: E731

    # receivables: what customers still owe, by how late (the same rule as the Customers page)
    ag = {k: {"count": 0, "amount": Decimal(0)} for k in ("current", "1-30", "31-60", "60+")}
    for x in c.execute("""select (d.extra->>'due_on')::date as due_on, coalesce(j.order_total, d.total) - s.paid as owed
                          from deal_docs d join jobs j on j.id = d.job_id and j.tenant_id = d.tenant_id
                          cross join lateral (select coalesce(sum(case when reverses_payment_id is null then amount else -amount end), 0) as paid from payments p where p.job_id = j.id) s
                          where d.tenant_id=%s and d.kind='invoice' and d.status <> 'void'""", (t,)).fetchall():
        if x["owed"] > 0:
            k = chain.ageing_bucket((today - x["due_on"]).days) if x["due_on"] else "current"
            ag[k]["count"] += 1
            ag[k]["amount"] += x["owed"]
    late = [v for k, v in ag.items() if k != "current"]

    sup_now, sup_before = _supplier_spend(c, t, a, b), _supplier_spend(c, t, pa, pb)
    by_cust: dict[str, Decimal] = {}
    for o in orders:
        if a <= o["on"] <= b and o["customer"]:
            by_cust[o["customer"]] = by_cust.get(o["customer"], Decimal(0)) + o["sales"]
    top = sorted(by_cust.items(), key=lambda kv: -kv[1])[:4]
    products = c.execute(
        f"""select coalesce(nullif(btrim(ql.description), ''), vm.item_key) as name, sum(vm.line_total) amount, sum(vm.line_cost) cost
            from jobs j join v_quote_margin vm on vm.quote_id = j.quote_id join document_lines ql on ql.id = vm.line_id
            where j.tenant_id=%s and {KL % 'j.created_at'} between %s and %s group by 1 having sum(vm.line_total) > 0 order by sum(vm.line_total) desc limit 4""", (t, a, b)).fetchall()
    g = "day" if period != "month" else "week"
    slices = revenue.buckets(a, b, g)
    sales_s, margin_s = [], []
    for x, y in slices:
        inn = [o for o in orders if x <= o["on"] <= y]
        s = sum((o["sales"] for o in inn), Decimal(0))
        cost = sum((o["cost"] for o in inn if o["cost"] is not None), Decimal(0))
        costed = sum((o["sales"] for o in inn if o["cost"] is not None), Decimal(0))
        sales_s.append(float(s))
        margin_s.append(float(round((costed - cost) / costed * 100, 1)) if costed else 0.0)
    name = (c.execute("select coalesce(display_name, name) n from tenants where id=%s", (t,)).fetchone() or {}).get("n", "")
    return reply(ctx, {
        "period": period, "label": LABEL[period][lang], "from": a, "to": b, "as_of": today, "org": {"name": name, "prepared_by": ctx.name}, "kpis": kpis,
        "ops": {"sales": float(now["sales"]), "sales_prev": float(before["sales"]), "quotes_sent": f["sent"], "quotes_accepted": won(a, b), "quotes_accepted_prev": won(pa, pb),
                "waiting": float(sum((v["amount"] for v in ag.values()), Decimal(0))), "late_count": sum(v["count"] for v in late), "late_amount": float(sum((v["amount"] for v in late), Decimal(0))),
                "supplier_spend": float(sum(sup_now.values(), Decimal(0))), "supplier_spend_prev": float(sum(sup_before.values(), Decimal(0)))},
        "analytics": {
            "labels": [(f"{x.day:02d}/{x.month:02d}" if g == "day" else f"W{i + 1}") for i, (x, _) in enumerate(slices)], "sales": sales_s, "margin": margin_s,
            "funnel": [{"k": "sent", "n": f["sent"]}, {"k": "viewed", "n": f["viewed"]}, {"k": "accepted", "n": f["accepted"]}, {"k": "paid", "n": f["paid"]}],
            "customers": [{"name": n, "amount": float(v), "pct": int(round(v / now["sales"] * 100)) if now["sales"] else 0} for n, v in top],
            "products": [{"name": p["name"], "margin": float(round((p["amount"] - p["cost"]) / p["amount"] * 100, 1)), "amount": float(p["amount"])} for p in products if p["cost"] is not None],
            "aging": [{"k": k, "count": v["count"], "amount": float(v["amount"])} for k, v in ag.items()],
            "suppliers": [{"name": n, "amount": float(v), "change": float(round((v - sup_before[n]) / sup_before[n] * 100, 1)) if sup_before.get(n) else 0.0}
                          for n, v in sorted(sup_now.items(), key=lambda kv: -kv[1])[:3]]},
        "notes": {"orders_without_cost": now["orders_without_cost"], "new_customers": new_customers, "marketing": float(marketing)}})


class TargetsIn(BaseModel, extra="forbid"):
    revenue_month: Decimal | None = Field(None, ge=0, max_digits=14, decimal_places=2)
    margin_pct: Decimal | None = Field(None, ge=0, le=100, max_digits=5, decimal_places=2)
    profit_month: Decimal | None = Field(None, max_digits=14, decimal_places=2)
    cac: Decimal | None = Field(None, ge=0, max_digits=14, decimal_places=2)
    runway_months: Decimal | None = Field(None, ge=0, max_digits=5, decimal_places=1)
    cash_on_hand: Decimal | None = Field(None, ge=0, max_digits=14, decimal_places=2)


@r.get("/reports/targets")
def get_targets(ctx: Ctx = Depends(read_ctx)):
    _may_read(ctx)
    return reply(ctx, {"revenue_month": None, "margin_pct": None, "profit_month": None, "cac": None, "runway_months": None, "cash_on_hand": None, "cash_as_of": None} | _targets(ctx.conn, ctx.tenant_id))


@r.put("/reports/targets")
def put_targets(body: TargetsIn, ctx: Ctx = Depends(write_ctx)):
    """Replace the targets (a field left out or null is cleared). The date cash on hand was entered is kept, so the report can say how old it is."""
    _may_read(ctx)
    require_perm(ctx, "set_report_targets")
    v = body.model_dump()
    ctx.conn.execute(
        """insert into report_targets(tenant_id, revenue_month, margin_pct, profit_month, cac, runway_months, cash_on_hand, cash_as_of, updated_at)
           values (%(t)s, %(revenue_month)s, %(margin_pct)s, %(profit_month)s, %(cac)s, %(runway_months)s, %(cash_on_hand)s,
                   case when %(cash_on_hand)s::numeric is null then null else %(today)s end, now())
           on conflict (tenant_id) do update set revenue_month=excluded.revenue_month, margin_pct=excluded.margin_pct, profit_month=excluded.profit_month, cac=excluded.cac,
             runway_months=excluded.runway_months, cash_on_hand=excluded.cash_on_hand, updated_at=now(),
             cash_as_of=case when excluded.cash_on_hand is null then null when report_targets.cash_on_hand is distinct from excluded.cash_on_hand then %(today)s else report_targets.cash_as_of end""",
        {**v, "t": ctx.tenant_id, "today": pipeline.today_my()})
    audit(ctx, "report_targets", ctx.tenant_id, "business report targets changed", None, {k: x for k, x in v.items() if x is not None})
    return get_targets(ctx)
