"""Pure pricing rules. Decimal money, no DB. The AI supplies item_key + qty + attrs, never prices."""
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")
PRICE_KEYS = {"price", "unit_price", "total", "amount", "discount", "cost", "unit_cost", "markup", "markup_pct"}


class PriceInjection(ValueError):
    pass


class MissingCost(KeyError):
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


def pick_tier(entry, qty):
    """entry: (unit_cost, id) or a list of tiers [(min_qty, unit_cost, id)]. -> (unit_cost, id, min_qty or None).
    The tier with the largest min_qty <= qty; below the lowest tier (an MOQ, min_qty > 1) the lowest tier is used and
    its min_qty is returned so the caller can flag the line."""
    if isinstance(entry, tuple):
        return entry[0], entry[1], None
    tiers = sorted(entry, key=lambda t: t[0])
    ok = [t for t in tiers if t[0] <= qty]
    if ok:
        return ok[-1][1], ok[-1][2], None
    return tiers[0][1], tiers[0][2], tiers[0][0] if tiers[0][0] > 1 else None


def catalog_price(base_price, tiers, qty, size=None) -> dict:
    """Customer price of a confirmed catalog item, through the same pick_tier rule as supplier tiers.
    base_price: listing_items.price (the price for 1 when no size is named, may be None). tiers: listing_items.price_tiers
    [{size or None, min_qty, price}]; a size-less tier applies to every size that has none of its own. size: what the customer asked for.
    -> {unit_price: Decimal or None, size, tier_min_qty, below_moq: Decimal or None, why: str or None}.
    unit_price is None, with a reason, when no rule applies. Never a guess."""
    qty = D(qty)
    if qty <= 0:
        raise ValueError("qty must be > 0")
    own = {}  # lower-cased size -> its tiers
    for t in tiers:
        if t.get("size"):
            own.setdefault(t["size"].lower(), []).append(t)
    plain = [t for t in tiers if not t.get("size")]
    if base_price is not None and not any(D(t["min_qty"]) == 1 for t in plain):
        plain = plain + [{"min_qty": 1, "price": base_price}]
    if size and size.lower() in own:
        pick = own[size.lower()]
    elif not size and not plain and len(own) == 1:  # only one size is priced: nothing to ask
        pick = next(iter(own.values()))
        size = pick[0]["size"]
    elif own and not plain:
        why = "no price for size " + size if size else "size not given"
        return {"unit_price": None, "size": size, "tier_min_qty": None, "below_moq": None, "why": why}
    else:
        pick = plain
    if not pick:
        return {"unit_price": None, "size": size, "tier_min_qty": None, "below_moq": None, "why": "no price set"}
    uc, mq, moq = pick_tier([(D(t["min_qty"]), D(t["price"]), D(t["min_qty"])) for t in pick], qty)
    return {"unit_price": _q(uc), "size": size, "tier_min_qty": mq, "below_moq": None if moq is None else D(moq), "why": None}


def resolve(template, key):
    """The recipe for an enquiry item: a real recipe, or a raw material from item_catalog sold as it is (cost x resale_markup_pct, the same rules
    and margin guard as any recipe). None when the key is neither, or the template sets no resale_markup_pct (then raw materials are not quoted)."""
    if key in template["recipes"]:
        return template["recipes"][key]
    c = next((x for x in template["item_catalog"] if x["item_key"] == key), None)
    if c is None or template.get("resale_markup_pct") is None:
        return None
    return {"description": key.replace("_", " "), "uom": c["uom"], "markup_pct": template["resale_markup_pct"], "bom": [{"item_key": key, "qty": 1}]}


def price_quote(items, cost_lookup, template, tenant, owner_overrides=None) -> dict:
    """items: [{item_key (recipe key), qty, attrs?}]. cost_lookup: {item_key: (unit_cost, cost_item_id) or [(min_qty, unit_cost, cost_item_id)] price tiers}.
    owner_overrides: {index: unit_price}, trusted caller (owner-authenticated) only."""
    overrides = owner_overrides or {}
    lines = []
    for i, it in enumerate(items):
        _reject_price_keys(it)
        recipe = resolve(template, it["item_key"])
        if recipe is None:
            raise KeyError(f"unknown recipe {it['item_key']}")
        qty = D(it["qty"])
        if qty <= 0:
            raise ValueError("qty must be > 0")
        basis, cost, below = [], None, []
        if "fixed_rate" in recipe:
            unit_price, source = _q(D(template["rate_card"][recipe["fixed_rate"]])), "fixed_rate_card"
        else:
            unit_cost = Decimal(0)
            for b in recipe["bom"]:
                if b["item_key"] not in cost_lookup:
                    raise MissingCost(b["item_key"])
                need = D(b["qty"]) * qty  # the amount of that material this order buys picks the tier
                uc, cid, moq = pick_tier(cost_lookup[b["item_key"]], need)
                if moq is not None:
                    below.append((b["item_key"], need, D(moq)))
                basis.append((b["item_key"], need, D(uc), cid))
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
                      "line_total": _q(unit_price * qty), "line_cost": cost, "basis": basis,
                      "below_moq": below})
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
