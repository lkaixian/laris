"""Pure supplier rules: landed cost, guardrails, ranking, contract coverage, contract state machine, timeline maths.
No DB, no AI, no I/O. Decimal money. Every result carries the inputs and rule codes so the UI can explain it (docs/suppliers.md).
An offer is a dict: id, supplier_id, supplier, product_id, pack_size (base units per sold pack), tiers [(min_packs, price_per_pack)],
moq (base units), lead_days, delivery_fee (None = unknown), free_delivery_over, sst_rate, discount_pct, valid_until (date or None),
stock (base units or None), payment_days, certs [str], blocked, reliability (0-100)."""
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, ROUND_CEILING, Decimal

CENT, FIVE_SEN = Decimal("0.01"), Decimal("0.05")
MY_TZ = timezone(timedelta(hours=8))
DEFAULT_WEIGHTS = {"price": 50, "reliability": 25, "lead": 15, "terms": 10}


def D(x) -> Decimal:
    return x if isinstance(x, Decimal) else Decimal(str(x))


def today_my(now: datetime | None = None) -> date:
    """Today's date in Malaysia (UTC+8), whatever the server clock says."""
    return (now or datetime.now(timezone.utc)).astimezone(MY_TZ).date()


# ---------- units ----------
# base unit and factor to it. Pack sizes (a carton of 10 kg) are per offer: pack_size, not here.
UOM = {"kg": ("kg", D(1)), "g": ("kg", D("0.001")), "l": ("l", D(1)), "litre": ("l", D(1)), "ml": ("l", D("0.001")),
       "pc": ("pc", D(1)), "piece": ("pc", D(1)), "dozen": ("pc", D(12)), "box": ("pc", D(1))}


def to_base(qty, uom: str) -> tuple[Decimal, str]:
    """-> (quantity in the base unit, base unit). Unknown unit raises KeyError: never guess a conversion."""
    base, f = UOM[uom.strip().lower()]
    return D(qty) * f, base


def round_money(x: Decimal, five_sen: bool = False) -> Decimal:
    if five_sen:
        return (x / FIVE_SEN).quantize(Decimal(1), ROUND_HALF_UP) * FIVE_SEN
    return x.quantize(CENT, ROUND_HALF_UP)


# ---------- landed cost ----------
def packs_needed(offer: dict, qty_base) -> int:
    return int((D(qty_base) / D(offer["pack_size"])).to_integral_value(ROUND_CEILING))


def pick_pack_price(tiers, packs: int):
    """The tier with the largest min_packs <= packs. Below the lowest tier the lowest tier applies (the MOQ guard flags it)."""
    ts = sorted(((D(m), D(p)) for m, p in tiers), key=lambda t: t[0])
    ok = [t for t in ts if t[0] <= packs]
    return (ok[-1] if ok else ts[0])[1], (ok[-1] if ok else ts[0])[0]


def landed_cost(offer: dict, qty_base, five_sen: bool = False) -> dict:
    """Total cost delivered for qty_base of the product. missing lists inputs we do not have (the UI asks the human; we never guess)."""
    packs = packs_needed(offer, qty_base)
    price, tier_min = pick_pack_price(offer["tiers"], packs)
    goods = price * packs
    disc = goods * D(offer.get("discount_pct") or 0) / 100
    net = goods - disc
    missing, fee = [], offer.get("delivery_fee")
    if fee is None:
        missing.append("delivery_fee")
        fee = D(0)
    fee = D(fee)
    free = offer.get("free_delivery_over")
    if free is not None and net >= D(free):
        fee = D(0)
    sst = net * D(offer.get("sst_rate") or 0)
    total = round_money(net + fee + sst, five_sen)
    base_qty = packs * D(offer["pack_size"])
    return {"packs": packs, "pack_price": price, "tier_min_packs": tier_min, "goods": round_money(goods), "discount": round_money(disc),
            "delivery": round_money(fee), "sst": round_money(sst), "total": total, "per_base_unit": (total / base_qty).quantize(Decimal("0.0001")),
            "base_qty": base_qty, "missing": missing}


# ---------- guardrails ----------
def disqualify(offer: dict, qty_base, needed_by: date | None, today: date, require_certs=(), min_reliability=None) -> list[str]:
    """Reason codes; empty = qualified."""
    why, q = [], D(qty_base)
    if offer.get("blocked"):
        why.append("blocked")
    if offer.get("moq") is not None and q < D(offer["moq"]):
        why.append("below_moq")
    if offer.get("stock") is not None and q > D(offer["stock"]):
        why.append("over_stock")
    if needed_by is not None and today + timedelta(days=int(offer["lead_days"])) > needed_by:
        why.append("too_slow")
    if offer.get("valid_until") is not None and offer["valid_until"] < today:
        why.append("expired")
    if any(c not in (offer.get("certs") or []) for c in require_certs):
        why.append("missing_cert")
    if min_reliability is not None and D(offer.get("reliability") or 0) < D(min_reliability):
        why.append("low_reliability")
    return why


# ---------- ranking ----------
def _tiebreak(r):  # cheapest, then faster, then more reliable, then name, then id: same input always gives the same order
    return (r["landed"]["total"], r["offer"]["lead_days"], -D(r["offer"].get("reliability") or 0), r["offer"].get("supplier") or "", str(r["offer"]["id"]))


def rank(offers, qty_base, needed_by=None, today=None, require_certs=(), min_reliability=None, weights=None, five_sen=False) -> dict:
    """-> {qualified: [row], disqualified: [row], recommended: row|None, badges: {fastest,reliable,value,closest -> offer id}, rules: [...]}.
    Recommended = lowest landed cost among qualified offers. Badges are alternatives, never a re-rank of the primary."""
    today = today or today_my()
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    rows = [{"offer": o, "landed": landed_cost(o, qty_base, five_sen),
             "why_not": disqualify(o, qty_base, needed_by, today, require_certs, min_reliability)} for o in offers]
    ok = sorted((r for r in rows if not r["why_not"]), key=_tiebreak)
    bad = sorted((r for r in rows if r["why_not"]), key=_tiebreak)
    badges: dict = {}
    if ok:
        best = ok[0]["landed"]["total"]
        for r in ok:
            r["delta_vs_lowest"] = r["landed"]["total"] - best
        lead_min = min(r["offer"]["lead_days"] for r in ok) or 1
        pay_max = max(D(r["offer"].get("payment_days") or 0) for r in ok) or 1
        for r in ok:
            o = r["offer"]
            parts = {"price": best / r["landed"]["total"] if r["landed"]["total"] else D(1),
                     "reliability": D(o.get("reliability") or 0) / 100,
                     "lead": D(lead_min) / D(max(o["lead_days"], 1)) if o["lead_days"] else D(1),
                     "terms": D(o.get("payment_days") or 0) / pay_max}
            r["score"] = (sum(parts[k] * D(w[k]) for k in parts) / sum(D(v) for v in w.values())).quantize(Decimal("0.0001"))
        badges = {"fastest": min(ok, key=lambda r: (r["offer"]["lead_days"],) + _tiebreak(r))["offer"]["id"],
                  "reliable": max(ok, key=lambda r: (D(r["offer"].get("reliability") or 0), -r["landed"]["total"]))["offer"]["id"],
                  "value": max(ok, key=lambda r: (r["score"], -r["landed"]["total"]))["offer"]["id"]}
        dist = [r for r in ok if r["offer"].get("distance_km") is not None]
        if dist:
            badges["closest"] = min(dist, key=lambda r: (r["offer"]["distance_km"],) + _tiebreak(r))["offer"]["id"]
    return {"qualified": ok, "disqualified": bad, "recommended": ok[0] if ok else None, "badges": badges, "weights": w,
            "rules": ["guardrails: blocked, MOQ, stock, needed-by date, quote validity, certification", "primary = lowest landed cost", "tie: lead time, reliability, name"]}


def explain(res: dict) -> dict | None:
    """Language-free explanation: the UI renders `code` + `params` through its four-language string table."""
    rec = res["recommended"]
    if not rec:
        return None
    nxt = res["qualified"][1] if len(res["qualified"]) > 1 else None
    o, l = rec["offer"], rec["landed"]
    return {"code": "cheapest_delivered", "params": {"supplier": o.get("supplier"), "total": str(l["total"]), "qty": str(l["base_qty"]),
            "saving_vs_next": str(nxt["landed"]["total"] - l["total"]) if nxt else None, "lead_days": o["lead_days"],
            "reliability": str(o.get("reliability")) if o.get("reliability") is not None else None},
            "breakdown": {k: str(l[k]) for k in ("goods", "discount", "delivery", "sst", "total")},
            "missing": l["missing"], "ask_human": bool(l["missing"])}


def split_hint(res: dict, qty_base) -> dict | None:
    """The cheapest offer is out only because its stock is short: suggest taking all its stock and the rest from the recommended offer,
    when that costs less than buying everything from the recommended offer."""
    rec = res["recommended"]
    short = [r for r in res["disqualified"] if r["why_not"] == ["over_stock"] and D(r["offer"].get("stock") or 0) > 0]
    if not rec or not short:
        return None
    first = min(short, key=_tiebreak)["offer"]
    a = D(first["stock"])
    if a >= D(qty_base) or landed_cost(first, a)["per_base_unit"] >= rec["landed"]["per_base_unit"]:
        return None
    ta, tb = landed_cost(first, a), landed_cost(rec["offer"], D(qty_base) - a)
    total = ta["total"] + tb["total"]
    if total >= rec["landed"]["total"]:
        return None
    return {"suppliers": [first.get("supplier"), rec["offer"].get("supplier")], "qty": [str(a), str(D(qty_base) - a)], "total": str(total),
            "saving": str(rec["landed"]["total"] - total)}


# ---------- contracts ----------
STATES = ("draft", "pending_approval", "active", "expiring", "renewal", "renewed", "expired", "terminated")
TRANSITIONS = {"draft": {"pending_approval"}, "pending_approval": {"active", "draft"}, "active": {"expiring", "terminated", "expired"},
               "expiring": {"renewal", "expired", "terminated"}, "renewal": {"renewed", "expired", "terminated"},
               "renewed": set(), "expired": set(), "terminated": set()}
NEEDS_REASON = {"terminated", "draft"}  # draft = sent back by the approver


class ContractError(ValueError):
    pass


def can_transition(frm: str, to: str) -> bool:
    return to in TRANSITIONS.get(frm, ())


def check_transition(frm: str, to: str, reason: str | None = None) -> None:
    if not can_transition(frm, to):
        raise ContractError(f"{frm} -> {to} is not allowed")
    if to in NEEDS_REASON and not (reason or "").strip():
        raise ContractError(f"a reason is needed to move to {to}")


def may_approve(role_class: str, value, owner_limit) -> bool:
    """Owner approves anything. A manager-level approver may approve only below the configured value; staff never."""
    if role_class == "owner":
        return True
    return role_class == "manager" and D(value) <= D(owner_limit)


def notice_deadline(end: date, notice_days: int) -> date:
    """Last day to give notice: notice_days before the end date."""
    return end - timedelta(days=int(notice_days))


def days_left(end: date, today: date) -> int:
    return (end - today).days


def effective_state(c: dict, today: date) -> str:
    """The stored state, advanced by the calendar: an active contract is expiring from its notice deadline and expired after its end."""
    s = c["state"]
    if s in ("active", "expiring"):
        if today > c["end"]:
            return "expired"
        if today >= notice_deadline(c["end"], c.get("notice_days") or 0):
            return "expiring"
    return s


def milestones(c: dict) -> list[dict]:
    ms = [{"kind": "start", "date": c["start"]}]
    ms += [{"kind": "price_review", "date": d} for d in sorted(c.get("price_reviews") or [])]
    ms += [{"kind": "notice_deadline", "date": notice_deadline(c["end"], c.get("notice_days") or 0)}, {"kind": "end", "date": c["end"]}]
    return sorted(ms, key=lambda m: m["date"])


def reminder_dates(c: dict, offsets=(90, 60, 30, 7)) -> list[dict]:
    """Drafts for the 'Needs you' strip: before the notice deadline and before the end. Nothing is sent automatically."""
    nd = notice_deadline(c["end"], c.get("notice_days") or 0)
    return sorted([{"kind": "notice", "days_before": n, "date": nd - timedelta(days=n)} for n in offsets] +
                  [{"kind": "expiry", "days_before": n, "date": c["end"] - timedelta(days=n)} for n in offsets], key=lambda r: r["date"])


LIVE = ("active", "expiring", "renewal")


def covering(contracts, product_id, on: date, qty=None) -> list[dict]:
    return [c for c in contracts if c["state"] in LIVE and product_id in c["products"] and c["start"] <= on <= c["end"]]


def classify(contracts, product_id, on: date, qty=None, pack_size=None) -> dict:
    """Single source of truth for In contract / Not in contract. -> {status, contract_id, reasons}.
    status: in_contract | expiring | partial | not_in_contract. Partial = covered but the volume cap is spent, the pack size differs,
    or a contract only starts later (reasons say which)."""
    live = covering(contracts, product_id, on)
    reasons, later = [], [c for c in contracts if c["state"] in ("active", "pending_approval") and product_id in c["products"] and c["start"] > on]
    for c in live:
        r = []
        cap, used = c.get("max_qty"), D(c.get("used_qty") or 0)
        if cap is not None and (used >= D(cap) or (qty is not None and used + D(qty) > D(cap))):
            r.append("volume_cap")
        if pack_size is not None and c.get("pack_size") is not None and D(c["pack_size"]) != D(pack_size):
            r.append("pack_size")
        if not r:
            st = effective_state(c, on)
            return {"status": "expiring" if st == "expiring" else "in_contract", "contract_id": c["id"], "reasons": []}
        reasons += r
    if live:
        return {"status": "partial", "contract_id": live[0]["id"], "reasons": reasons}
    if later:
        return {"status": "not_in_contract", "contract_id": None, "reasons": ["starts_later"], "starts": min(c["start"] for c in later)}
    return {"status": "not_in_contract", "contract_id": None, "reasons": []}


def off_contract_guard(contracts, product_id, supplier_id, on: date) -> dict | None:
    """Ordering a contracted product from another supplier needs a manager's approval with a reason. None = no guard."""
    live = covering(contracts, product_id, on)
    if live and all(c["supplier_id"] != supplier_id for c in live):
        return {"needs_approval": True, "contract_id": live[0]["id"], "contract_price": live[0].get("price")}
    return None


def coverage_gaps(contracts, product_id, start: date, end: date) -> dict:
    """Days in [start, end] with no live-or-pending contract, and pairs of contracts that overlap, for one product."""
    cs = sorted((c for c in contracts if c["state"] in LIVE + ("pending_approval",) and product_id in c["products"]), key=lambda c: c["start"])
    gaps, cur = [], start
    for c in cs:
        if c["start"] > cur:
            gaps.append((cur, min(c["start"] - timedelta(days=1), end)))
        cur = max(cur, c["end"] + timedelta(days=1))
        if cur > end:
            break
    if cur <= end:
        gaps.append((cur, end))
    gaps = [g for g in gaps if g[0] <= g[1] and g[0] <= end]
    overlaps = [(a["id"], b["id"]) for i, a in enumerate(cs) for b in cs[i + 1:] if b["start"] <= a["end"]]
    return {"gaps": gaps, "overlaps": overlaps}


def commitment(c: dict, today: date) -> dict:
    """Used vs committed and a straight-line projection to the end date."""
    total_days = max((c["end"] - c["start"]).days, 1)
    elapsed = min(max((today - c["start"]).days, 0), total_days)
    used = D(c.get("used_qty") or 0)
    projected = used * total_days / elapsed if elapsed else None
    mn, mx = c.get("min_qty"), c.get("max_qty")
    return {"progress": elapsed / total_days, "used": used, "projected": projected,
            "shortfall": (D(mn) - projected) if mn is not None and projected is not None and projected < D(mn) else None,
            "overage": (projected - D(mx)) if mx is not None and projected is not None and projected > D(mx) else None}


def market_insight(contract_price, market_lowest, threshold_pct=5, next_review: date | None = None, today: date | None = None) -> dict:
    """Contract vs open-market lowest. Never implies the contract can be broken: the action is 'review at the next price review'."""
    cp, mk = D(contract_price), D(market_lowest)
    gap = (cp - mk) / cp * 100 if cp else D(0)
    out = {"gap_pct": gap.quantize(Decimal("0.1")), "market_cheaper": gap > D(threshold_pct)}
    if out["market_cheaper"] and next_review and today:
        out["review_in_days"] = (next_review - today).days
    return out


def nudge(purchases, window_days=90, min_count=4, tier_saving_pct=Decimal("9")) -> dict | None:
    """purchases: [(date, amount, supplier_id)] of one product, no contract. Suggest a contract when bought often from one supplier."""
    if len(purchases) < min_count:
        return None
    by: dict = {}
    for _, amt, sid in purchases:
        by.setdefault(sid, []).append(D(amt))
    sid, amts = max(by.items(), key=lambda kv: len(kv[1]))
    if len(amts) < min_count:
        return None
    spend = sum(amts)
    return {"supplier_id": sid, "count": len(amts), "spend": round_money(spend), "est_saving": round_money(spend * tier_saving_pct / 100), "window_days": window_days}
