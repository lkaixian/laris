"""Buy side of the trade loop (Business <-> Supplier), kept free of the database so it can be tested alone.
Supplier quote comparison, deal margin, and the simplified three-way match. Rules only: the AI never sets a price or picks a supplier;
this ranks what a person typed in and explains why, and a person still approves the purchase order."""
from decimal import ROUND_HALF_UP, Decimal

from .errors import ApiError

CENT = Decimal("0.01")
# State machines for the supplier documents (persistence of these is roadmap; the rules are fixed here and tested).
BUY_FLOW = {
    "rfq": {"draft": {"sent", "cancelled"}, "sent": {"answered", "cancelled"}, "answered": {"closed"}},
    "sq": {"received": {"accepted", "declined"}},
    "spo": {"draft": {"pending_approval", "cancelled"}, "pending_approval": {"sent", "draft", "cancelled"},
            "sent": {"partially_received", "received", "cancelled"}, "partially_received": {"received", "cancelled"}},
    "grn": {"received": {"checked", "disputed"}, "checked": {"matched", "disputed"}},
    "sinv": {"received": {"matched", "disputed"}, "matched": {"approved"}, "approved": {"paid"}},
}


def d(x, field: str = "value") -> Decimal:
    try:
        v = Decimal(str(x))
    except Exception:
        raise ApiError(422, "bad_number", f"{field} must be a number") from None
    if not v.is_finite() or v < 0 or v > Decimal(10) ** 9:
        raise ApiError(422, "bad_number", f"{field} must be between 0 and 1,000,000,000")
    return v


def compare_quotes(quotes: list[dict], last_paid: dict | None = None) -> dict:
    """Rank 2 to 4 supplier quotes. Cheapest total wins; a faster quote wins a tie. Each row says how it differs from the best one, in
    plain numbers, so the person can see why. Reliability (0 to 100) is shown, never hidden inside the rank."""
    if not isinstance(quotes, list) or not 2 <= len(quotes) <= 4:
        raise ApiError(422, "need_2_to_4", "Compare between 2 and 4 supplier quotes")
    rows = []
    for q in quotes:
        name = str(q.get("supplier", "")).strip()[:80]
        if not name:
            raise ApiError(422, "no_supplier", "Every quote needs a supplier name")
        rel = d(q.get("on_time_pct", 0), "on_time_pct")
        if rel > 100:
            raise ApiError(422, "bad_number", "on_time_pct must be 0 to 100")
        days = int(d(q.get("lead_days", 0), "lead_days"))
        rows.append({"supplier": name, "total": d(q.get("total"), "total").quantize(CENT, ROUND_HALF_UP), "lead_days": days, "on_time_pct": int(rel)})
    order = sorted(rows, key=lambda r: (r["total"], r["lead_days"], -r["on_time_pct"]))
    best = order[0]
    out = []
    for i, r in enumerate(order):
        dp, dd = r["total"] - best["total"], r["lead_days"] - best["lead_days"]
        if i == 0:
            why = "Lowest price" + (f", and {best['on_time_pct']}% on time" if best["on_time_pct"] else "")
        else:
            bits = [f"RM {dp:.2f} dearer"] if dp > 0 else ["same price"]
            bits.append(f"{abs(dd)} day{'s' if abs(dd) != 1 else ''} {'slower' if dd > 0 else 'faster' if dd < 0 else 'the same'}".replace("0 days the same", "same lead time"))
            why = ", ".join(bits)
        lp = (last_paid or {}).get(r["supplier"])
        out.append({**r, "total": f"{r['total']:.2f}", "rank": i + 1, "best": i == 0, "why": why,
                    "vs_last_paid": None if lp is None else f"{r['total'] - d(lp, 'last_paid'):+.2f}"})
    fastest = min(rows, key=lambda r: (r["lead_days"], r["total"]))
    return {"quotes": out, "best": best["supplier"], "fastest": fastest["supplier"],
            "note": "Ranked by price, then speed. You choose; nothing is ordered until the owner approves the purchase order."}


def margin(sell_total, cost_total, target_pct=20) -> dict:
    """Deal profit ring: customer price against supplier cost. Warns below target and on a loss."""
    s, c, t = d(sell_total, "sell_total"), d(cost_total, "cost_total"), d(target_pct, "target_pct")
    profit = s - c
    pct = Decimal(0) if s == 0 else (profit / s * 100)
    state = "loss" if profit < 0 else "below_target" if pct < t else "ok"
    return {"sell": f"{s:.2f}", "cost": f"{c:.2f}", "profit": f"{profit:.2f}", "margin_pct": f"{pct:.1f}", "target_pct": f"{t:.0f}", "state": state}


def three_way(ordered, received, invoiced, price_ok: bool = True) -> dict:
    """Simplified match of purchase order, goods received and supplier invoice (quantities). A mismatch becomes a friendly 'needs a look'."""
    o, r, i = d(ordered, "ordered"), d(received, "received"), d(invoiced, "invoiced")
    issues = []
    if r < o:
        issues.append("short_delivery")
    if r > o:
        issues.append("over_delivery")
    if i > r:
        issues.append("billed_for_more_than_received")
    if not price_ok:
        issues.append("price_differs")
    return {"match": not issues, "issues": issues}


def check_buy_move(kind: str, frm: str, to: str) -> None:
    if to not in BUY_FLOW.get(kind, {}).get(frm, set()):
        raise ApiError(409, "bad_move", f"A {kind} cannot go from {frm} to {to}")
