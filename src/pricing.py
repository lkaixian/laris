"""Pure pricing rules. Decimal money, no DB. The AI supplies item_key + qty + attrs, never prices."""
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")
PRICE_KEYS = {"price", "unit_price", "total", "amount", "discount", "cost", "unit_cost", "markup", "markup_pct"}


class PriceInjection(ValueError):
    pass


class MissingCost(KeyError):
    pass


class OwnerRequired(PermissionError):
    pass


def D(x) -> Decimal:
    return x if isinstance(x, Decimal) else Decimal(str(x))


def _q(x: Decimal) -> Decimal:
    return x.quantize(CENT, ROUND_HALF_UP)


def _reject_price_keys(item: dict) -> None:
    bad = {k for k in item if k.lower() in PRICE_KEYS}
    bad |= {k for k in item.get("attrs") or {} if k.lower() in PRICE_KEYS}
    if bad:
        raise PriceInjection(f"price keys not allowed in input: {sorted(bad)}")


def price_quote(items, cost_lookup, template, tenant, owner_overrides=None) -> dict:
    """items: [{item_key (recipe key), qty, attrs?}]. cost_lookup: {item_key: (unit_cost, cost_item_id)}.
    owner_overrides: {index: unit_price}, trusted caller (owner-authenticated) only."""
    overrides = owner_overrides or {}
    lines = []
    for i, it in enumerate(items):
        _reject_price_keys(it)
        recipe = template["recipes"].get(it["item_key"])
        if recipe is None:
            raise KeyError(f"unknown recipe {it['item_key']}")
        qty = D(it["qty"])
        if qty <= 0:
            raise ValueError("qty must be > 0")
        basis, cost = [], None
        if "fixed_rate" in recipe:
            unit_price, source = _q(D(template["rate_card"][recipe["fixed_rate"]])), "fixed_rate_card"
        else:
            unit_cost = Decimal(0)
            for b in recipe["bom"]:
                if b["item_key"] not in cost_lookup:
                    raise MissingCost(b["item_key"])
                uc, cid = cost_lookup[b["item_key"]]
                basis.append((b["item_key"], D(b["qty"]) * qty, D(uc), cid))
                unit_cost += D(b["qty"]) * D(uc)
            for rate, hrs in recipe.get("hours", {}).items():
                rc = D(template["rate_card"][rate])
                basis.append((rate, D(hrs) * qty, rc, None))  # ponytail: rate card has no cost_item row yet
                unit_cost += D(hrs) * rc
            markup = D(tenant.get("markup_pct", recipe["markup_pct"]))
            unit_price, source = _q(unit_cost * (1 + markup / 100)), "cost_item_markup"
            cost = sum((q * u for _, q, u, _ in basis), Decimal(0))
        if i in overrides:
            unit_price, source = _q(D(overrides[i])), "owner_override"
        lines.append({"line_no": i + 1, "item_key": it["item_key"], "qty": qty, "uom": recipe["uom"],
                      "attrs": it.get("attrs") or {}, "unit_price": unit_price, "price_source": source,
                      "line_total": _q(unit_price * qty), "line_cost": cost, "basis": basis})
    return {"lines": lines, **_totals(lines)}


def _totals(lines) -> dict:
    sub = sum((l["line_total"] for l in lines), Decimal(0))
    costed = [l for l in lines if l["line_cost"] is not None]
    rev = sum((l["line_total"] for l in costed), Decimal(0))
    cost = sum((l["line_cost"] for l in costed), Decimal(0))
    return {"subtotal": sub, "cost": cost, "margin_pct": _pct(rev, cost)}


def _pct(rev: Decimal, cost: Decimal):
    return None if rev == 0 else ((rev - cost) / rev * 100).quantize(CENT, ROUND_HALF_UP)


def margin_guard(quote: dict, min_margin_pct) -> list:
    """Violations: lines (and the quote overall) whose margin is below the floor. Empty = ok."""
    floor, out = D(min_margin_pct), []
    for l in quote["lines"]:
        if l["line_cost"] is None:
            continue
        m = _pct(l["line_total"], l["line_cost"])
        if m is not None and m < floor:
            out.append({"line_no": l["line_no"], "margin_pct": m, "min_margin_pct": floor})
    if quote["margin_pct"] is not None and quote["margin_pct"] < floor:
        out.append({"line_no": None, "margin_pct": quote["margin_pct"], "min_margin_pct": floor})
    return out


def discount_guard(discount_pct, max_discount_pct, role: str) -> None:
    """Discount above the tenant cap needs role == 'owner'."""
    if D(discount_pct) < 0:
        raise ValueError("negative discount")
    if D(discount_pct) > D(max_discount_pct) and role != "owner":
        raise OwnerRequired(f"discount {discount_pct}% > cap {max_discount_pct}%: owner approval required")


def stale_check(quote: dict, current_costs: dict) -> list:
    """Per costed line: cost now vs cost snapshot. margin_delta (RM, negative = margin leaked)
    and margin_pct_delta (points). current_costs: {item_key: unit_cost}; missing keys keep snapshot."""
    out = []
    for l in quote["lines"]:
        if l["line_cost"] is None:
            continue
        new = sum((q * D(current_costs.get(k, u)) for k, q, u, _ in l["basis"]), Decimal(0))
        if new == l["line_cost"]:
            continue
        out.append({"line_no": l["line_no"], "old_cost": l["line_cost"], "new_cost": new,
                    "margin_delta": l["line_cost"] - new,
                    "margin_pct_delta": _pct(l["line_total"], new) - _pct(l["line_total"], l["line_cost"])})
    return out


def stl_grams(volume_mm3, infill=0.2, density_g_cm3=1.24) -> Decimal:
    """Rough print weight. Ignores shell thickness (ponytail: treats volume as infill-only)."""
    return _q(D(volume_mm3) / 1000 * D(infill) * D(density_g_cm3))
