import json
from decimal import Decimal as D
from pathlib import Path

import pytest

from src.pricing import (MissingCost, PriceInjection, margin_guard, price_quote)
from src.templates import TemplateError, load_template

FX = json.loads((Path(__file__).parent / "fixtures" / "material_heavy.json").read_text())
COSTS = {k: (D(v[0]), v[1]) for k, v in FX["costs"].items()}
T = load_template("made_to_order")


def test_templates_load_and_bad_key_fails():
    assert load_template("fnb_catering")["min_margin_pct"] == 30
    for bad in ("nope", "../x", ""):
        with pytest.raises(TemplateError):
            load_template(bad)


def test_price_from_cost_markup_and_basis():
    q = price_quote(FX["items"], COSTS, T, {})
    l = q["lines"][0]
    assert l["unit_price"] == D("58.20") and l["price_source"] == "cost_item_markup"
    assert l["line_total"] == D("582.00") and l["line_cost"] == D("388.00")
    assert ("plywood_12mm_sheet", D("5.0"), D("40.00"), 1) in l["basis"]
    assert q["margin_pct"] == D("33.33")


def test_fixed_rate_card_and_owner_override():
    q = price_quote([{"item_key": "design_service", "qty": 2}], {}, T, {})
    assert q["lines"][0]["unit_price"] == D("18.00") and q["lines"][0]["price_source"] == "fixed_rate_card"
    q = price_quote(FX["items"], COSTS, T, {}, owner_overrides={0: "70"})
    assert q["lines"][0]["price_source"] == "owner_override" and q["lines"][0]["unit_price"] == D("70.00")


@pytest.mark.parametrize("bad", [{"unit_price": 1}, {"Price": 1}, {"attrs": {"total": 5}}, {"discount": 10}])
def test_price_key_injection_rejected(bad):
    with pytest.raises(PriceInjection):
        price_quote([{"item_key": "plywood_shelf", "qty": 1, **bad}], COSTS, T, {})


def test_missing_cost_fails_loudly():
    with pytest.raises(MissingCost):
        price_quote(FX["items"], {}, T, {})


def test_margin_guard_blocks_underpricing():
    ok = price_quote(FX["items"], COSTS, T, {})
    assert margin_guard(ok, T["min_margin_pct"]) == []
    low = price_quote(FX["items"], COSTS, T, {"markup_pct": 10})
    v = margin_guard(low, T["min_margin_pct"])
    assert v and v[0]["margin_pct"] < D(25)
    cheap = price_quote(FX["items"], COSTS, T, {}, owner_overrides={0: "30"})
    assert margin_guard(cheap, 25)


# ---- catalog items: per-size prices and quantity tiers (same pick_tier rule as supplier tiers)
from src.pricing import catalog_price  # noqa: E402

TIERS = [{"size": None, "min_qty": "10", "price": "40"}, {"size": None, "min_qty": "50", "price": "36.5"},
         {"size": "3kg", "min_qty": "1", "price": "120"}, {"size": "3kg", "min_qty": "20", "price": "110"}]


@pytest.mark.parametrize("qty,size,want", [
    (1, None, "45.00"), (9.999, None, "45.00"), (10, None, "40.00"), (49, None, "40.00"), (50, None, "36.50"), (5000, None, "36.50"),
    (1, "3kg", "120.00"), (19, "3KG", "120.00"), (20, "3kg", "110.00"),
    (10, "1kg", "40.00"),  # a size without its own tiers takes the size-less ones
])
def test_catalog_tier_boundaries_and_sizes(qty, size, want):
    p = catalog_price(D("45"), TIERS, qty, size)
    assert p["unit_price"] == D(want) and p["why"] is None and p["below_moq"] is None


def test_catalog_size_rules_moq_and_no_guess():
    sized = [{"size": "S", "min_qty": "1", "price": "10"}, {"size": "L", "min_qty": "5", "price": "14"}]
    assert catalog_price(None, sized, 3)["why"] == "size not given" and catalog_price(None, sized, 3)["unit_price"] is None
    assert catalog_price(None, sized, 3, "XL")["why"] == "no price for size XL"
    p = catalog_price(None, sized, 2, "L")  # below the lowest tier of L: priced at that tier and flagged
    assert (p["unit_price"], p["below_moq"], p["size"]) == (D("14.00"), D("5"), "L")
    one = catalog_price(None, sized[1:], 6)  # only one size has prices: it is used without asking
    assert (one["unit_price"], one["size"], one["below_moq"]) == (D("14.00"), "L", None)
    assert catalog_price(None, [], 1)["why"] == "no price set" and catalog_price(D("8"), [], 3)["unit_price"] == D("8.00")
    with pytest.raises(ValueError):
        catalog_price(D("8"), [], 0)
