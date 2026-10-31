import copy
import itertools
from decimal import Decimal as D

import pytest

from src.pricing import PriceInjection
from src.print3d import samples
from src.print3d.pricing import (ConfigError, QuoteInputError, choose_printer, customer_view, load_config, normalise, price_quote,
                                 round_five_sen)
from src.print3d.stl import analyse, parse_stl

# A small, round-number shop so every expected figure below can be checked by hand.
SMALL = {
    "currency": "MYR", "target_margin_pct": 50, "margin_floor_pct": 45, "estimate_accuracy_pct": 20,
    "wall_mm": 1.2, "support_fraction": 0.5, "failure_buffer_pct": 10, "setup_minutes": 12, "labour_rate_hour": 20, "design_rate_hour": 60,
    "min_order_charge": 0, "packaging": {"pickup": 0, "courier": 5},
    "quantity_tiers": [{"min_qty": 1, "pct": 0}, {"min_qty": 10, "pct": 10}],
    "rush": {"standard": {"multiplier": 1.0, "label_days": 5}, "rush": {"multiplier": 1.5, "label_days": 2}},
    "sst": {"enabled": False, "rate_pct": 8}, "rounding": "none", "approvals": {"quote_value_above": 1000, "discount_pct_above": 10},
    "loyalty_max_pct": 30,
    "print_time": {"reference_layer_mm": 0.2, "layer_overhead_s": 5, "support_time_factor": 0.2, "warmup_hours": 0.1, "plate_fill": 0.7, "max_per_plate": 24},
    "materials": {"pla": {"name": "PLA", "technology": "fdm", "density": 1.0, "price_per_kg": 100, "waste_pct": 0, "flow_mm3_s": 10, "spool_g": 1000,
                          "layer_heights": [0.2, 0.3], "colours": ["white", "black"]}},
    "printers": {"small": {"name": "Small", "technology": "fdm", "build_mm": [100, 100, 100], "rate_hour": 3, "materials": ["pla"]},
                 "big": {"name": "Big", "technology": "fdm", "build_mm": [220, 220, 250], "rate_hour": 6, "materials": ["pla"]}},
    "finishing": {"sanding": {"minutes_base": 6, "minutes_per_100cm2": 0, "consumable_per_100cm2": 0}},
}
CUBE = analyse(parse_stl(samples.sample("cube")))            # 20 mm cube: 8000 mm3, 2400 mm2, 20 mm tall
HAND = {"infill_pct": 25}                                          # the spec the hand-worked figures use
BIG = {"volume_mm3": 500000.0, "area_mm2": 40000.0, "size_mm": (160.0, 60.0, 60.0), "watertight": True}


def cfg(**kw):
    c = copy.deepcopy(SMALL)
    for k, v in kw.items():
        c[k] = v
    return c


def line(q, key):
    return next(l["amount"] for l in q["lines"] if l["key"] == key)


def test_cube_price_worked_by_hand():
    # shell = min(8000, 2400 x 1.2) = 2880; inside = 5120 x 25% = 1280; printed 4160 mm3 = 4.16 g at density 1 -> RM0.416 -> 0.42
    # time: 10 mm3/s at 0.2 mm -> 416 s; 100 layers x 5 s = 500 s; 916 s = 0.254444 h + 0.1 warm-up = 0.3544 h at RM6 -> 2.13 on the big printer
    # (the 20 mm cube also fits the RM3 small printer, which is cheaper: 0.3544 x 3 = 1.0632 -> 1.06)
    q = price_quote(cfg(), CUBE, HAND)
    assert q["printer"] == "small"
    assert q["weight_g"] == 4.2                                     # 4.16 g, shown to one decimal
    assert line(q, "material") == D("0.42")
    assert line(q, "machine") == D("1.06")
    assert line(q, "failure_buffer") == D("0.04") + D("0.11")        # 10% of 0.42 and of 1.06, each rounded
    assert line(q, "setup") == D("4.00")                            # 12 min at RM20/h
    assert q["cost_total"] == D("0.42") + D("1.06") + D("0.15") + D("4.00") == D("5.63")
    assert line(q, "margin") == q["price_ex_tax"] - q["cost_total"]
    assert q["price_ex_tax"] == D("11.26")                          # 5.63 / (1 - 50%)
    assert q["total"] == D("11.26") and q["margin_pct"] == 50.0


def test_lines_always_add_up_to_the_total():
    c = cfg(sst={"enabled": True, "rate_pct": 8}, rounding="five_sen", min_order_charge=30)
    for qty, rush, fin, disc in itertools.product([1, 7, 10, 33], ["standard", "rush"], [[], ["sanding"]], [0, 12.5]):
        q = price_quote(c, CUBE, {"quantity": qty, "rush": rush, "finishing": fin, "discount_pct": disc, "delivery": "courier"})
        assert sum(l["amount"] for l in q["lines"]) == q["total"], (qty, rush, fin, disc)
        assert sum(q["breakdown"].values()) == q["price_ex_tax"]


def test_quantity_tier_discount_and_unit_price():
    one = price_quote(cfg(), CUBE, {"quantity": 1})
    ten = price_quote(cfg(), CUBE, {"quantity": 10})
    assert line(ten, "quantity_discount") < 0 and "quantity_discount" not in [l["key"] for l in one["lines"]]
    assert ten["unit_price"] < one["unit_price"]
    assert ten["unit_price"] == (ten["price_ex_tax"] / 10).quantize(D("0.01"))
    assert ten["plates"] == 1 and ten["per_plate"] == 17            # floor(70% of a 100 x 100 bed / 20 x 20) = 17, so ten copies share one plate


def test_rush_multiplies_the_price():
    base = price_quote(cfg(), CUBE, {})
    rush = price_quote(cfg(), CUBE, {"rush": "rush"})
    assert rush["price_ex_tax"] == (base["price_ex_tax"] * D("1.5")).quantize(D("0.01"))
    assert line(rush, "rush") == rush["price_ex_tax"] - base["price_ex_tax"]
    assert rush["lead_days"] <= base["lead_days"]


def test_discount_below_the_floor_needs_an_approver():
    ok = price_quote(cfg(), CUBE, {"discount_pct": 0})
    assert ok["margin_pct"] == 50.0 and not ok["requires_approval"] and ok["warnings"] == []
    low = price_quote(cfg(), CUBE, {"discount_pct": 10})            # margin falls to about 44.4%, floor is 45
    assert 44 < low["margin_pct"] < 45 and "below_margin_floor" in low["warnings"]
    assert set(low["approval_reasons"]) == {"margin_floor"}         # 10% is exactly the limit, not above it
    big = price_quote(cfg(), CUBE, {"discount_pct": 20})
    assert set(big["approval_reasons"]) == {"margin_floor", "discount"}


def test_selling_below_cost_is_flagged():
    c = cfg(target_margin_pct=20, margin_floor_pct=10)
    q = price_quote(c, CUBE, {"discount_pct": 30})                  # 1.25 x 0.7 = 0.875 of cost
    assert q["price_ex_tax"] < q["cost_total"] and "below_cost" in q["warnings"] and "below_cost" in q["approval_reasons"]
    assert line(q, "margin") > 0 and line(q, "discount") < 0


def test_big_orders_need_an_approver():
    q = price_quote(cfg(approvals={"quote_value_above": 50, "discount_pct_above": 10}), CUBE, {"quantity": 30})
    assert q["total"] > 50 and "value" in q["approval_reasons"] and q["requires_approval"]


def test_minimum_order_charge_tops_up_small_jobs():
    q = price_quote(cfg(min_order_charge=20), CUBE, HAND)
    assert q["price_ex_tax"] == D("20.00") and "minimum_order_applied" in q["warnings"]
    assert line(q, "minimum_order") == D("20.00") - D("11.26")


def test_sst_and_five_sen_rounding():
    q = price_quote(cfg(sst={"enabled": True, "rate_pct": 8}, rounding="five_sen"), CUBE, HAND)
    assert q["tax"] == D("0.90")                                    # 8% of 11.26 = 0.9008
    assert q["total"] == D("12.15")                                 # 11.26 + 0.90 = 12.16 -> nearest 5 sen is 12.15
    assert line(q, "rounding") == D("-0.01")
    none = price_quote(cfg(sst={"enabled": True, "rate_pct": 8}, rounding="none"), CUBE, HAND)
    assert none["total"] == D("12.16") and "rounding" not in [l["key"] for l in none["lines"]]


@pytest.mark.parametrize("x,want", [("14.62", "14.60"), ("14.63", "14.65"), ("14.625", "14.65"), ("14.60", "14.60"), ("0.02", "0.00"), ("0.03", "0.05")])
def test_five_sen_rounding_half_up(x, want):
    assert round_five_sen(D(x)) == D(want)


def test_finishing_and_delivery_and_design_add_cost():
    base = price_quote(cfg(), CUBE, {})
    with_fin = price_quote(cfg(), CUBE, {"finishing": ["sanding"]})
    assert line(with_fin, "finishing") == D("2.00")                 # 6 min at RM20/h
    assert with_fin["price_ex_tax"] > base["price_ex_tax"]
    assert line(price_quote(cfg(), CUBE, {"delivery": "courier"}), "packaging") == D("5.00")
    assert line(price_quote(cfg(), CUBE, {"design_hours": 1.5}), "design") == D("90.00")


def test_supports_and_infill_raise_weight_and_time():
    plain = price_quote(cfg(), CUBE, {"infill_pct": 20})
    dense = price_quote(cfg(), CUBE, {"infill_pct": 80})
    sup = price_quote(cfg(), CUBE, {"infill_pct": 20, "supports": True})
    assert dense["weight_g"] > plain["weight_g"] and dense["print_hours"] > plain["print_hours"]
    assert sup["weight_g"] > plain["weight_g"] and sup["print_hours"] > plain["print_hours"]
    fine = price_quote(cfg(), CUBE, {"layer_height": 0.2})
    coarse = price_quote(cfg(), CUBE, {"layer_height": 0.3})
    assert coarse["print_hours"] < fine["print_hours"]


def test_printer_choice_cheapest_that_fits_then_turns_then_gives_up():
    assert choose_printer(cfg(), "pla", (20, 20, 20))[0] == "small"
    k, f = choose_printer(cfg(), "pla", (150, 150, 150))
    assert k == "big" and f["as_is"]
    k, f = choose_printer(cfg(), "pla", (240, 100, 100))
    assert k == "big" and f["rotated"] == "yzx"
    k, f = choose_printer(cfg(), "pla", (400, 400, 400))
    assert not f["fits"] and f["split"]
    with pytest.raises(QuoteInputError):
        choose_printer(cfg(), "pla", (10, 10, 10), forced="nope")
    q = price_quote(cfg(), {**BIG, "size_mm": (240.0, 100.0, 100.0)}, {})
    assert "turn_to_fit" in q["warnings"] and q["printable"]
    q = price_quote(cfg(), {**BIG, "size_mm": (400.0, 400.0, 400.0)}, {})
    assert not q["printable"] and "no_printer_fits" in q["warnings"] and q["total"] > 0     # still priced so the owner sees a number


def test_open_models_carry_a_holes_warning():
    holey = analyse(samples.cube(20.0)[:-1])
    assert "model_may_have_holes" in price_quote(cfg(), holey, {})["warnings"]
    assert "model_may_have_holes" not in price_quote(cfg(), CUBE, {})["warnings"]


def test_operator_can_override_print_hours_and_it_is_logged():
    q = price_quote(cfg(), CUBE, {}, overrides={"print_hours": 10})
    assert q["print_hours"] == 10.0 and line(q, "machine") == D("30.00")         # RM3 x 10 h on the small printer
    assert q["overrides_applied"][0]["field"] == "print_hours" and q["overrides_applied"][0]["to"] == 10
    for bad in (0, -1, 9999, True, "3"):
        with pytest.raises(QuoteInputError):
            price_quote(cfg(), CUBE, {}, overrides={"print_hours": bad})


@pytest.mark.parametrize("raw,field", [
    ({"material": "gold"}, "material"), ({"layer_height": 0.15}, "layer_height"), ({"colour": "pink"}, "colour"),
    ({"infill_pct": 3}, "infill_pct"), ({"infill_pct": True}, "infill_pct"), ({"infill_pct": 101}, "infill_pct"),
    ({"quantity": 0}, "quantity"), ({"quantity": 1.5}, "quantity"), ({"quantity": True}, "quantity"), ({"quantity": 10001}, "quantity"),
    ({"finishing": ["sanding", "sanding"]}, "finishing"), ({"finishing": ["gilding"]}, "finishing"), ({"finishing": "sanding"}, "finishing"),
    ({"rush": "yesterday"}, "rush"), ({"delivery": "drone"}, "delivery"), ({"design_hours": -1}, "design_hours"),
    ({"design_hours": 500}, "design_hours"), ({"discount_pct": 31}, "discount_pct"), ({"discount_pct": -5}, "discount_pct"),
])
def test_bad_choices_name_the_control(raw, field):
    with pytest.raises(QuoteInputError) as e:
        normalise(cfg(), raw)
    assert e.value.field == field


@pytest.mark.parametrize("bad", [{"unit_price": 1}, {"Total": 5}, {"price": 0}, {"discount": 99}, {"cost": 1}])
def test_the_ai_cannot_set_a_price(bad):
    with pytest.raises(PriceInjection):
        price_quote(cfg(), CUBE, bad)


def test_empty_model_is_refused():
    with pytest.raises(QuoteInputError):
        price_quote(cfg(), {"volume_mm3": 0, "area_mm2": 0, "size_mm": (1, 1, 1)}, {})


def test_customer_view_hides_cost_and_margin():
    full = price_quote(cfg(), CUBE, {"finishing": ["sanding"]})
    v = customer_view(full)
    flat = repr(v)
    for secret in ("lines", "cost_total", "margin_pct", "breakdown", "printer", "rate_hour", "approval_reasons", "why"):
        assert secret not in v and secret not in flat.replace("'warnings'", ""), secret
    assert v["total"] == full["total"] and v["lead_days"] == full["lead_days"]


# ---------------------------------------------------------------- the shipped config, end to end

REAL = load_config()


def test_shipped_config_loads_and_prices_every_sample_in_every_material():
    for name in samples.SAMPLES:
        a = analyse(parse_stl(samples.sample(name)))
        for mk, m in REAL["materials"].items():
            q = price_quote(REAL, a, {"material": mk, "layer_height": m["layer_heights"][-1], "colour": m["colours"][0]})
            assert q["total"] > 0 and q["weight_g"] > 0 and q["print_hours"] > 0, (name, mk)
            assert sum(l["amount"] for l in q["lines"]) == q["total"], (name, mk)


def test_real_shop_behaves_like_a_print_shop():
    a = analyse(parse_stl(samples.sample("phone_stand")))
    pla = price_quote(REAL, a, {"material": "pla"})
    petg = price_quote(REAL, a, {"material": "petg", "colour": "black"})
    nylon = price_quote(REAL, a, {"material": "nylon", "colour": "black", "layer_height": 0.2})
    assert pla["total"] < nylon["total"] and nylon["weight_g"] < pla["weight_g"] * 1.2
    assert petg["weight_g"] > pla["weight_g"] * 0.99                # denser filament, same shape
    assert 0 < pla["margin_pct"] and abs(pla["margin_pct"] - REAL["target_margin_pct"]) < 0.5
    assert pla["total"] % D("0.05") == 0                            # five-sen rounding is on in the shipped config
    five = price_quote(REAL, a, {"material": "pla", "quantity": 50})
    assert five["unit_price"] < pla["unit_price"]


def test_resin_time_follows_height_not_volume_and_copies_share_a_plate():
    cube = analyse(parse_stl(samples.sample("cube")))                # 20 mm tall
    cyl = analyse(parse_stl(samples.sample("cylinder")))             # also 20 mm tall, much more material removed from the footprint
    c1 = price_quote(REAL, cube, {"material": "resin_standard"})
    c2 = price_quote(REAL, cyl, {"material": "resin_standard"})
    assert c1["print_hours_per_part"] == c2["print_hours_per_part"]
    many = price_quote(REAL, cube, {"material": "resin_standard", "quantity": 4})
    assert many["plates"] == 1 and many["print_hours"] == c1["print_hours"]


def test_resin_ignores_infill_and_fdm_only_layer_heights_are_refused():
    cube = analyse(parse_stl(samples.sample("cube")))
    a = price_quote(REAL, cube, {"material": "resin_standard", "infill_pct": 10})
    b = price_quote(REAL, cube, {"material": "resin_standard", "infill_pct": 90})
    assert a["weight_g"] == b["weight_g"]
    with pytest.raises(QuoteInputError):
        price_quote(REAL, cube, {"material": "resin_standard", "layer_height": 0.2})


@pytest.mark.parametrize("mutate,msg", [
    (lambda c: c["printers"]["printer_a"].update(materials=["pla", "unobtainium"]), "unknown material"),
    (lambda c: c["printers"]["printer_a"].update(materials=["resin_standard"]), "different technology"),
    (lambda c: c.update(quantity_tiers=[{"min_qty": 5, "pct": 0}]), "min_qty 1"),
    (lambda c: c.update(quantity_tiers=[{"min_qty": 1, "pct": 0}, {"min_qty": 1, "pct": 5}]), "must rise"),
    (lambda c: c.update(rounding="banker"), "rounding"),
    (lambda c: c.update(margin_floor_pct=90, target_margin_pct=40), "margin_floor"),
    (lambda c: c["materials"]["pla"].pop("flow_mm3_s"), "flow_mm3_s"),
    (lambda c: c["rush"].pop("standard"), "standard"),
    (lambda c: c.pop("wall_mm"), "wall_mm"),
])
def test_bad_config_fails_loudly(tmp_path, mutate, msg):
    import yaml
    c = copy.deepcopy(REAL)
    mutate(c)
    p = tmp_path / "p.yaml"
    p.write_text(yaml.safe_dump(c), encoding="utf-8")
    with pytest.raises(ConfigError, match=msg):
        load_config(p)
