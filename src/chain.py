"""Customer PO, sales order and supplier PO rules, kept free of the database so they can be tested alone: totals, rounding, the state machines and which
document may be made from which. Proforma, delivery order, invoice and receipt are not here: they are deal_docs in api/chain.py. Preparation only: LARIS records payments and prepares documents, it never files or collects money."""
from decimal import ROUND_HALF_UP, Decimal

from .errors import ApiError

KINDS = {"cpo": ("CPO", "Customer PO (received)"), "so": ("SO", "Sales Order"), "spo": ("SPO", "Supplier PO (sent)")}
CENT, SEN5 = Decimal("0.01"), Decimal("0.05")
MAX_LINES, MAX_QTY, MAX_PRICE = 200, Decimal(10) ** 7, Decimal(10) ** 9

# status -> statuses it may move to by hand.
FLOW = {
    "cpo": {"received": {"confirmed", "cancelled"}, "confirmed": {"cancelled"}},
    "so": {"confirmed": {"cancelled"}},
    "spo": {"draft": {"pending_approval", "cancelled"}, "pending_approval": {"sent", "draft", "cancelled"},
            "sent": {"partially_received", "received", "cancelled"}, "partially_received": {"received", "cancelled"}},
}
START = {"cpo": "received", "so": "confirmed", "spo": "draft"}
# Moves only an owner may make (staff can draft and submit, not approve or reverse).
OWNER_ONLY = {("spo", "sent"), ("so", "cancelled"), ("cpo", "confirmed")}
# parent kind -> kinds that can be made from it with one click
CONVERT = {"quote": {"cpo", "so"}, "cpo": {"so"}, "so": set(), "spo": set()}
PARENT_OK_STATUS = {"cpo": {"received", "confirmed"}}


def money(x) -> Decimal:
    return Decimal(str(x)).quantize(CENT, ROUND_HALF_UP)


def clean_lines(lines) -> list[dict]:
    """Validate and normalise the lines. Quantities and prices stay as strings so no float ever touches money."""
    if not isinstance(lines, list) or not lines or len(lines) > MAX_LINES:
        raise ApiError(422, "bad_lines", f"give between 1 and {MAX_LINES} lines")
    out = []
    for n, ln in enumerate(lines, 1):
        try:
            qty, price = Decimal(str(ln["qty"])), Decimal(str(ln.get("unit_price", 0)))
        except Exception:
            raise ApiError(422, "bad_lines", f"line {n}: qty and unit_price must be numbers") from None
        desc = str(ln.get("description", "")).strip()
        if not desc or len(desc) > 300:
            raise ApiError(422, "bad_lines", f"line {n}: a description of 1 to 300 characters is needed")
        if not (0 < qty < MAX_QTY) or not (0 <= price < MAX_PRICE):
            raise ApiError(422, "bad_lines", f"line {n}: qty must be above 0 and price must not be negative")
        out.append({"description": desc, "qty": str(qty.normalize() if qty == qty.to_integral() else qty), "uom": str(ln.get("uom") or "unit")[:20],
                    "unit_price": str(money(price)), **({"src": ln["src"]} if ln.get("src") is not None else {})})
    return out


def totals(lines: list[dict], discount_pct=0, sst_rate=0, round5=False) -> dict:
    """The one shared calculation: subtotal, percentage discount, SST on the discounted amount, optional 5-sen rounding, total."""
    sub = sum((money(Decimal(ln["qty"]) * Decimal(ln["unit_price"])) for ln in lines), Decimal(0))
    disc = money(sub * Decimal(str(discount_pct)) / 100)
    sst = money((sub - disc) * Decimal(str(sst_rate)) / 100)
    pre = sub - disc + sst
    total = (pre / SEN5).quantize(Decimal(1), ROUND_HALF_UP) * SEN5 if round5 else pre
    total = money(total)
    return {"subtotal": money(sub), "discount": disc, "sst": sst, "rounding": total - money(pre), "total": total}


def check_move(kind: str, old: str, new: str, owner: bool) -> None:
    if new not in FLOW.get(kind, {}).get(old, set()):
        raise ApiError(409, "illegal_transition", f"a {KINDS[kind][1]} cannot go from {old} to {new}")
    if (kind, new) in OWNER_ONLY and not owner:
        raise ApiError(403, "owner_only", f"only the owner can move a {KINDS[kind][1]} to {new}")


def ageing_bucket(days_over: int) -> str:
    return "current" if days_over <= 0 else "1-30" if days_over <= 30 else "31-60" if days_over <= 60 else "60+"
