"""Supplier engine: landed cost, guardrails, ranking, contract coverage, state machine, timeline dates. Pure, no DB."""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal as D

import pytest

from src import suppliers_engine as E

TODAY = date(2026, 10, 31)


def offer(id="a", name="A", price="100", pack=10, tiers=None, **kw):
    return {"id": id, "supplier_id": id, "supplier": name, "product_id": "oil", "pack_size": pack, "tiers": tiers or [(1, D(price))],
            "moq": None, "lead_days": 2, "delivery_fee": D(0), "sst_rate": 0, "valid_until": None, "stock": None, "payment_days": 30,
            "certs": [], "blocked": False, "reliability": 90, **kw}


def test_uom_to_base_and_unknown():
    assert E.to_base(500, "g") == (D("0.5"), "kg")
    assert E.to_base(2, "dozen") == (D(24), "pc")
    with pytest.raises(KeyError):
        E.to_base(1, "bushel")


def test_landed_cost_tier_delivery_sst():
    o = offer(price="100", tiers=[(1, D(100)), (5, D(90))], delivery_fee=D(20), sst_rate=D("0.06"), pack=10)
    l = E.landed_cost(o, 50)  # 5 packs -> tier 5 at 90
    assert l["packs"] == 5 and l["goods"] == D("450.00") and l["sst"] == D("27.00") and l["total"] == D("497.00")
    assert l["per_base_unit"] == D("9.9400")
    assert E.landed_cost(o, 40)["pack_price"] == D(100)  # 4 packs: below the tier


def test_landed_cost_free_delivery_discount_and_missing_fee():
    o = offer(price="100", delivery_fee=D(30), free_delivery_over=D(200), discount_pct=D(10))
    l = E.landed_cost(o, 30)  # 3 packs = 300, minus 10% = 270, free delivery
    assert l["discount"] == D("30.00") and l["delivery"] == D("0.00") and l["total"] == D("270.00")
    unk = E.landed_cost(offer(delivery_fee=None), 10)
    assert unk["missing"] == ["delivery_fee"]


def test_rounding_to_five_sen():
    o = offer(price="10.03", pack=1)
    assert E.landed_cost(o, 1)["total"] == D("10.03")
    assert E.landed_cost(o, 1, five_sen=True)["total"] == D("10.05")
    assert E.round_money(D("10.02"), True) == D("10.00")


def test_guardrails_each_reason():
    q = 50
    assert E.disqualify(offer(moq=100), q, None, TODAY) == ["below_moq"]
    assert E.disqualify(offer(stock=10), q, None, TODAY) == ["over_stock"]
    assert E.disqualify(offer(lead_days=10), q, TODAY + timedelta(days=5), TODAY) == ["too_slow"]
    assert E.disqualify(offer(valid_until=TODAY - timedelta(days=1)), q, None, TODAY) == ["expired"]
    assert E.disqualify(offer(blocked=True), q, None, TODAY) == ["blocked"]
    assert E.disqualify(offer(certs=[]), q, None, TODAY, require_certs=["halal"]) == ["missing_cert"]
    assert E.disqualify(offer(), q, None, TODAY) == []


def test_cheapest_disqualified_by_moq_expiry_and_lead_time():
    offers = [offer("cheap_moq", "Cheap", price="80", moq=500), offer("cheap_old", "Old", price="82", valid_until=TODAY - timedelta(days=3)),
              offer("slow", "Slow", price="85", lead_days=9), offer("ok", "Ok", price="95"), offer("ok2", "Ok2", price="99")]
    r = E.rank(offers, 50, TODAY + timedelta(days=3), TODAY)
    assert r["recommended"]["offer"]["id"] == "ok"
    assert {x["offer"]["id"]: x["why_not"] for x in r["disqualified"]} == {"cheap_moq": ["below_moq"], "cheap_old": ["expired"], "slow": ["too_slow"]}


def test_delivery_fee_flips_ranking():
    a = offer("a", "A", price="100", delivery_fee=D(60))  # 160
    b = offer("b", "B", price="120", delivery_fee=D(0))  # 120
    assert E.rank([a, b], 10, today=TODAY)["recommended"]["offer"]["id"] == "b"


def test_tier_changes_winner_with_quantity():
    a = offer("a", "A", tiers=[(1, D(100))])
    b = offer("b", "B", tiers=[(1, D(110)), (5, D(80))])
    assert E.rank([a, b], 10, today=TODAY)["recommended"]["offer"]["id"] == "a"  # 1 pack
    assert E.rank([a, b], 50, today=TODAY)["recommended"]["offer"]["id"] == "b"  # 5 packs


def test_pack_size_mismatch_compares_per_base_unit():
    carton = offer("c", "Carton", price="150", pack=10)  # RM15/kg
    kg = offer("k", "Loose", price="14", pack=1)  # RM14/kg
    r = E.rank([carton, kg], 10, today=TODAY)
    assert r["recommended"]["offer"]["id"] == "k"
    assert r["qualified"][0]["landed"]["per_base_unit"] < r["qualified"][1]["landed"]["per_base_unit"]


def test_ranking_is_deterministic_with_ties_and_badges():
    a = offer("b", "Beta", price="100", lead_days=3, reliability=80)
    b = offer("a", "Alfa", price="100", lead_days=1, reliability=95)
    r1, r2 = E.rank([a, b], 10, today=TODAY), E.rank([b, a], 10, today=TODAY)
    assert [x["offer"]["id"] for x in r1["qualified"]] == [x["offer"]["id"] for x in r2["qualified"]] == ["a", "b"]
    assert r1["badges"]["fastest"] == "a" and r1["badges"]["reliable"] == "a"


def test_no_qualified_offer():
    r = E.rank([offer(blocked=True)], 10, today=TODAY)
    assert r["recommended"] is None and E.explain(r) is None


def test_explain_has_inputs_and_flags_missing_data():
    r = E.rank([offer("a", price="100"), offer("b", price="130")], 10, today=TODAY)
    x = E.explain(r)
    assert x["code"] == "cheapest_delivered" and x["params"]["saving_vs_next"] == "30.00" and not x["ask_human"]
    r = E.rank([offer(delivery_fee=None)], 10, today=TODAY)
    assert E.explain(r)["ask_human"] is True


def test_weights_change_value_badge():
    cheap_unreliable = offer("c", "C", price="100", reliability=40)
    pricey_reliable = offer("p", "P", price="110", reliability=99)
    assert E.rank([cheap_unreliable, pricey_reliable], 10, today=TODAY, weights={"price": 90, "reliability": 5, "lead": 3, "terms": 2})["badges"]["value"] == "c"
    r = E.rank([cheap_unreliable, pricey_reliable], 10, today=TODAY, weights={"price": 5, "reliability": 90, "lead": 3, "terms": 2})
    assert r["badges"]["value"] == "p" and r["recommended"]["offer"]["id"] == "c"  # primary is always lowest price


def test_split_hint_when_cheapest_stock_is_short():
    r = E.rank([offer("a", "A", price="100", stock=D(50)), offer("b", "B", price="105")], 100, today=TODAY)
    assert r["recommended"]["offer"]["id"] == "b" and r["disqualified"][0]["why_not"] == ["over_stock"]
    h = E.split_hint(r, 100)
    assert h["suppliers"] == ["A", "B"] and h["qty"] == ["50", "50"] and D(h["saving"]) == D("25.00")
    r = E.rank([offer("a", price="100", stock=D(1000)), offer("b", price="105")], 100, today=TODAY)
    assert E.split_hint(r, 100) is None


def test_today_my_is_utc_plus_8():
    assert E.today_my(datetime(2026, 12, 31, 17, 0, tzinfo=timezone.utc)) == date(2027, 1, 1)
    assert E.today_my(datetime(2026, 12, 31, 15, 59, tzinfo=timezone.utc)) == date(2026, 12, 31)


# ---------- contracts ----------
def contract(id="c1", state="active", start=date(2026, 1, 1), end=date(2026, 12, 31), products=("oil",), supplier_id="a", **kw):
    return {"id": id, "state": state, "start": start, "end": end, "products": set(products), "supplier_id": supplier_id, "notice_days": 30, **kw}


def test_state_machine_allows_and_blocks():
    assert E.can_transition("draft", "pending_approval") and E.can_transition("pending_approval", "active")
    assert not E.can_transition("draft", "active") and not E.can_transition("expired", "active")
    with pytest.raises(E.ContractError):
        E.check_transition("active", "draft")
    with pytest.raises(E.ContractError):
        E.check_transition("active", "terminated")  # reason needed
    E.check_transition("active", "terminated", "supplier closed")


def test_approval_limits():
    assert E.may_approve("owner", 1_000_000, 5000)
    assert E.may_approve("manager", 4000, 5000) and not E.may_approve("manager", 6000, 5000)
    assert not E.may_approve("staff", 1, 5000)


def test_notice_deadline_leap_year_and_days_left():
    assert E.notice_deadline(date(2028, 3, 1), 30) == date(2028, 1, 31)  # 2028 is a leap year, Feb has 29 days
    assert E.notice_deadline(date(2027, 3, 1), 30) == date(2027, 1, 30)
    assert E.days_left(date(2026, 11, 20), TODAY) == 20


def test_effective_state_is_calendar_driven():
    c = contract(end=TODAY + timedelta(days=20))
    assert E.effective_state(c, TODAY) == "expiring"  # inside the 30-day notice window
    assert E.effective_state(contract(end=TODAY + timedelta(days=90)), TODAY) == "active"
    assert E.effective_state(contract(end=TODAY - timedelta(days=1)), TODAY) == "expired"
    assert E.effective_state(contract(state="draft"), TODAY) == "draft"


def test_milestones_sorted_and_reminders():
    c = contract(price_reviews=[date(2026, 6, 1)])
    kinds = [m["kind"] for m in E.milestones(c)]
    assert kinds == ["start", "price_review", "notice_deadline", "end"]
    assert len(E.reminder_dates(c)) == 8


def test_classify_in_not_expiring_partial():
    cs = [contract("c1", end=TODAY + timedelta(days=200), max_qty=100, used_qty=100),
          contract("c2", "active", start=TODAY + timedelta(days=30), end=TODAY + timedelta(days=400), products=("flour",))]
    assert E.classify(cs, "oil", TODAY)["status"] == "partial" and E.classify(cs, "oil", TODAY)["reasons"] == ["volume_cap"]
    assert E.classify(cs, "flour", TODAY)["reasons"] == ["starts_later"]
    assert E.classify(cs, "rice", TODAY)["status"] == "not_in_contract"
    ok = [contract("c3", end=TODAY + timedelta(days=200))]
    assert E.classify(ok, "oil", TODAY)["status"] == "in_contract"
    assert E.classify([contract("c4", end=TODAY + timedelta(days=20))], "oil", TODAY)["status"] == "expiring"
    assert E.classify([contract("c5", pack_size=10)], "oil", TODAY, pack_size=1)["reasons"] == ["pack_size"]
    assert E.classify([contract("c6", end=TODAY - timedelta(days=30), state="expired")], "oil", TODAY)["status"] == "not_in_contract"
    assert E.classify([contract("c7", state="draft")], "oil", TODAY)["status"] == "not_in_contract"


def test_off_contract_guard():
    cs = [contract(supplier_id="a", price=D("12"))]
    assert E.off_contract_guard(cs, "oil", "b", TODAY)["needs_approval"] is True
    assert E.off_contract_guard(cs, "oil", "a", TODAY) is None
    assert E.off_contract_guard(cs, "rice", "b", TODAY) is None


def test_coverage_gaps_and_overlaps():
    cs = [contract("c1", start=date(2026, 1, 1), end=date(2026, 3, 31)), contract("c2", start=date(2026, 3, 15), end=date(2026, 6, 30)),
          contract("c3", start=date(2026, 8, 1), end=date(2026, 12, 31))]
    g = E.coverage_gaps(cs, "oil", date(2026, 1, 1), date(2026, 12, 31))
    assert g["gaps"] == [(date(2026, 7, 1), date(2026, 7, 31))] and g["overlaps"] == [("c1", "c2")]
    assert E.coverage_gaps([], "oil", date(2026, 1, 1), date(2026, 1, 10))["gaps"] == [(date(2026, 1, 1), date(2026, 1, 10))]


def test_commitment_projection():
    c = contract(start=date(2026, 1, 1), end=date(2026, 12, 31), min_qty=1000, used_qty=D(100))
    k = E.commitment(c, date(2026, 4, 11))  # 100 days of 364
    assert k["shortfall"] is not None and k["overage"] is None


def test_market_insight_does_not_imply_breaking_contract():
    m = E.market_insight(D(100), D(85), 5, date(2026, 12, 1), TODAY)
    assert m["market_cheaper"] and m["review_in_days"] == 31
    assert not E.market_insight(D(100), D(98))["market_cheaper"]


def test_nudge():
    p = [(TODAY, D(700), "a")] * 6
    n = E.nudge(p)
    assert n["count"] == 6 and n["spend"] == D("4200.00") and n["est_saving"] == D("378.00")
    assert E.nudge(p[:2]) is None


def test_recompute_speed_200_offers():
    import time
    offers = [offer(str(i), f"S{i}", price=str(100 + i % 17)) for i in range(200)]
    t = time.perf_counter()
    E.rank(offers, 100, today=TODAY)
    assert time.perf_counter() - t < 0.15
