"""Revenue and profit for a period. Pure: rows in, a fully worked answer out. No database, no clock.

The definitions (kept deliberately plain, and shown to the owner on the Revenue page):
  Sales          the value of the orders won in the period, without SST (a sale is counted on the day the quote was accepted)
  Cost of goods  what those same orders cost to make or buy, from the supplier cost book (the basis the margin report already uses)
  Untung kasar   (gross profit)  Sales - Cost of goods
  Running costs  rent, wages, bills and the like that the owner has recorded for the period
  Untung bersih  (net profit)    Untung kasar - Running costs. Income tax is not taken off unless the owner records it as a running cost.
  Money in       what customers actually paid in the period (deposits and balances, minus any payment that was reversed)
  Money out      Cost of goods + Running costs, on the day each was counted
  Left over      Money in - Money out
Profit counts what was SOLD; money in counts what was PAID. They differ by what customers still owe (`to_collect`).
An order whose cost is missing (a job made by hand) or only partly known (some quote lines have no cost-book price) counts what cost it does have,
which flatters the profit, so it is counted in `orders_without_cost` and the page says so."""
from collections import defaultdict
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")
ZERO = Decimal("0.00")
MAX_DAYS = 731                       # two years at most per question
CATEGORIES = ("rent", "wages", "utilities", "transport", "marketing", "tax", "other")
MAX_LIST = 100                       # rows returned for the "which orders and costs were counted" lists


class PeriodError(ValueError):
    """A period that cannot be answered. `code` is stable so the page can translate it."""
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def q(x) -> Decimal:
    return Decimal(str(x)).quantize(CENT, ROUND_HALF_UP)


def pct(part: Decimal, whole: Decimal):
    """part as a percent of whole to one decimal place, or None when there is no whole to compare with."""
    return None if not whole else (part / whole * 100).quantize(Decimal("0.1"), ROUND_HALF_UP)


def check_period(start: date, end: date) -> int:
    if not isinstance(start, date) or not isinstance(end, date):
        raise PeriodError("bad_period", "The period needs a start and an end date.")
    if end < start:
        raise PeriodError("end_before_start", "The end date is before the start date.")
    days = (end - start).days + 1
    if days > MAX_DAYS:
        raise PeriodError("too_long", f"The period is {days} days; the most is {MAX_DAYS}.")
    return days


def granularity(days: int) -> str:
    """How finely to split the graph so it stays readable: days for a month or less, weeks up to about four months, then months."""
    return "day" if days <= 31 else "week" if days <= 140 else "month"


def buckets(start: date, end: date, g: str) -> list[tuple[date, date]]:
    """Consecutive (from, to) slices that cover start..end exactly once: days, Monday-to-Sunday weeks, or calendar months, clipped to the period."""
    out: list[tuple[date, date]] = []
    d = start
    while d <= end:
        if g == "day":
            stop = d
        elif g == "week":
            stop = d + timedelta(days=6 - d.weekday())
        else:
            stop = (date(d.year + (d.month == 12), d.month % 12 + 1, 1)) - timedelta(days=1)
        stop = min(stop, end)
        out.append((d, stop))
        d = stop + timedelta(days=1)
    return out


def previous_period(start: date, end: date) -> tuple[date, date]:
    """The period of the same length that ends the day before this one starts."""
    days = (end - start).days + 1
    return start - timedelta(days=days), start - timedelta(days=1)


def _costed(o: dict) -> bool:
    """Is this order's cost fully known? False for a job made by hand and for a quote with a line that has no cost-book price."""
    return o["cost"] is not None and o.get("cost_complete", True)


def _in(rows, key, start: date, end: date):
    return [r for r in rows if start <= r[key] <= end]


def summarise(orders: list[dict], payments: list[dict], expenses: list[dict], start: date, end: date) -> dict:
    """Everything the Revenue page shows for start..end.
    orders:   {id, ref, customer, on, sales, cost (None when unknown), cost_complete (False when only some lines had a cost; default True),
              owed (what the customer owes incl. tax), paid (received so far)}
    payments: {on, amount}   (a reversal is a negative amount on its own date)
    expenses: {id, on, category, amount, note}
    Rows outside the period are ignored, so the caller can pass a wider window and ask twice (this period and the one before)."""
    days = check_period(start, end)
    g = granularity(days)
    os_, ps, es = _in(orders, "on", start, end), _in(payments, "on", start, end), _in(expenses, "on", start, end)

    sales = sum((q(o["sales"]) for o in os_), ZERO)
    goods = sum((q(o["cost"]) for o in os_ if o["cost"] is not None), ZERO)
    gross = sales - goods
    running = sum((q(e["amount"]) for e in es), ZERO)
    net = gross - running
    money_in = sum((q(p["amount"]) for p in ps), ZERO)
    money_out = goods + running

    series = []
    for a, b in buckets(start, end, g):
        s_in = sum((q(p["amount"]) for p in ps if a <= p["on"] <= b), ZERO)
        s_goods = sum((q(o["cost"]) for o in os_ if o["cost"] is not None and a <= o["on"] <= b), ZERO)
        s_run = sum((q(e["amount"]) for e in es if a <= e["on"] <= b), ZERO)
        series.append({"from": a, "to": b, "money_in": s_in, "goods": s_goods, "running": s_run, "money_out": s_goods + s_run, "left_over": s_in - s_goods - s_run})

    by_cat: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for e in es:
        by_cat[e["category"]] += q(e["amount"])
    rows = sorted(({"id": o["id"], "ref": o["ref"], "customer": o["customer"], "on": o["on"], "sales": q(o["sales"]),
                    "cost": None if o["cost"] is None else q(o["cost"]),
                    "gross": q(o["sales"]) - (q(o["cost"]) if o["cost"] is not None else ZERO), "cost_known": _costed(o)} for o in os_),
                  key=lambda r: (-r["sales"], r["ref"] or ""))
    return {
        "from": start, "to": end, "days": days, "granularity": g,
        "sales": sales, "goods": goods, "gross": gross, "gross_pct": pct(gross, sales),
        "running": running, "net": net, "net_pct": pct(net, sales),
        "money_in": money_in, "money_out": money_out, "left_over": money_in - money_out,
        "to_collect": sum((max(q(o["owed"]) - q(o["paid"]), ZERO) for o in os_), ZERO),
        "orders_counted": len(os_), "orders_without_cost": sum(1 for o in os_ if not _costed(o)),
        "series": series,
        "orders": rows[:MAX_LIST],
        "expenses_by_category": sorted(({"category": c, "amount": a} for c, a in by_cat.items()), key=lambda r: (-r["amount"], r["category"])),
        "expense_rows": sorted(({"id": e.get("id"), "on": e["on"], "category": e["category"], "amount": q(e["amount"]), "note": e.get("note")} for e in es),
                               key=lambda r: (r["on"], str(r["id"])), reverse=True)[:MAX_LIST],
    }


def compare(now: dict, before: dict) -> dict:
    """This period against the one before: the earlier figures and the change in percent (None when the earlier figure was zero)."""
    keys = ("sales", "gross", "net", "money_in", "money_out")
    return {"previous": {k: before[k] for k in keys} | {"from": before["from"], "to": before["to"]},
            "change_pct": {k: (None if not before[k] else ((now[k] - before[k]) / abs(before[k]) * 100).quantize(Decimal("0.1"), ROUND_HALF_UP)) for k in keys}}
