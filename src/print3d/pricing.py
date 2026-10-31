"""The 3D printing price engine. Pure: a mesh analysis plus the customer's choices in, a fully itemised price out. No database.
Decimal money rounded to the cent at every step, so the lines always add up to the total exactly. All constants come from
config/print3d.yaml (nothing hidden in code). Print time and weight are ESTIMATES (see config `estimate_accuracy_pct`).
The AI may read specs out of a message but never supplies a price: price-looking keys in the input are refused (same rule as src/pricing.py)."""
import math
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

import yaml

from src.pricing import PRICE_KEYS, PriceInjection

from .stl import fits

CONFIG_PATH = Path(__file__).resolve().parent.parent.parent / "config" / "print3d.yaml"
CENT = Decimal("0.01")
FIVE_SEN = Decimal("0.05")
HOURS_PER_DAY = 16            # printers run long days; used only for the quick lead time (the scheduler gives the real date later)
ROUNDINGS = {"five_sen", "none"}


class ConfigError(ValueError):
    pass


class QuoteInputError(ValueError):
    """A choice the customer or staff made that the shop cannot do. `code` is stable for translation; `field` names the control."""
    def __init__(self, code: str, field: str, message: str):
        super().__init__(message)
        self.code, self.field = code, field


def D(x) -> Decimal:
    return x if isinstance(x, Decimal) else Decimal(str(x))


def q(x) -> Decimal:
    return D(x).quantize(CENT, ROUND_HALF_UP)


def round_five_sen(x: Decimal) -> Decimal:
    return (x / FIVE_SEN).quantize(Decimal("1"), ROUND_HALF_UP) * FIVE_SEN


# ---------------------------------------------------------------- config

def _need(cond, msg):
    if not cond:
        raise ConfigError(msg)


def load_config(path: Path | None = None) -> dict:
    cfg = yaml.safe_load((path or CONFIG_PATH).read_text(encoding="utf-8"))
    _need(isinstance(cfg, dict), "print3d config must be a mapping")
    for k in ("target_margin_pct", "margin_floor_pct", "wall_mm", "support_fraction", "failure_buffer_pct", "setup_minutes", "labour_rate_hour",
              "design_rate_hour", "min_order_charge", "packaging", "quantity_tiers", "rush", "sst", "rounding", "approvals", "print_time",
              "materials", "printers", "finishing", "estimate_accuracy_pct"):
        _need(k in cfg, f"print3d: missing '{k}'")
    _need(0 <= cfg["target_margin_pct"] < 90, "print3d: target_margin_pct must be 0 to 89")
    _need(0 <= cfg["margin_floor_pct"] <= cfg["target_margin_pct"], "print3d: margin_floor_pct must be between 0 and the target margin")
    _need(cfg["rounding"] in ROUNDINGS, f"print3d: rounding must be one of {sorted(ROUNDINGS)}")
    _need("standard" in cfg["rush"], "print3d: rush needs a 'standard' level")
    for k, r in cfg["rush"].items():
        _need(r["multiplier"] >= 1 and r["label_days"] >= 1, f"print3d: rush {k} needs multiplier >= 1 and label_days >= 1")
    tiers = cfg["quantity_tiers"]
    _need(tiers and tiers[0]["min_qty"] == 1, "print3d: quantity_tiers must start at min_qty 1")
    _need(all(a["min_qty"] < b["min_qty"] for a, b in zip(tiers, tiers[1:])), "print3d: quantity_tiers must rise")
    _need(all(0 <= t["pct"] < 100 for t in tiers), "print3d: tier pct must be 0 to 99")
    for k, m in cfg["materials"].items():
        _need(m["technology"] in ("fdm", "sla"), f"print3d: material {k} technology must be fdm or sla")
        _need(m["density"] > 0 and m["price_per_kg"] > 0 and m["layer_heights"] and m["colours"], f"print3d: material {k} is incomplete")
        _need(m["technology"] != "fdm" or m.get("flow_mm3_s", 0) > 0, f"print3d: fdm material {k} needs flow_mm3_s")
        _need(m["technology"] != "sla" or m.get("sla_layer_s", 0) > 0, f"print3d: sla material {k} needs sla_layer_s")
    for k, p in cfg["printers"].items():
        _need(len(p["build_mm"]) == 3 and all(v > 0 for v in p["build_mm"]) and p["rate_hour"] >= 0, f"print3d: printer {k} is incomplete")
        for m in p["materials"]:
            _need(m in cfg["materials"], f"print3d: printer {k} lists unknown material {m}")
            _need(cfg["materials"][m]["technology"] == p["technology"], f"print3d: printer {k} cannot run {m} (different technology)")
    for k, f in cfg["finishing"].items():
        _need(f["minutes_base"] >= 0 and f["minutes_per_100cm2"] >= 0 and f["consumable_per_100cm2"] >= 0, f"print3d: finishing {k} is incomplete")
    return cfg


# ---------------------------------------------------------------- input

def _m(a, key):
    return a[key] if isinstance(a, dict) else getattr(a, key)


def _watertight(a):
    """True, False, or None when the analysis does not say."""
    return a.get("watertight") if isinstance(a, dict) else getattr(a, "watertight", None)


def _bad(code, field, msg):
    raise QuoteInputError(code, field, msg)


def normalise(cfg: dict, raw: dict) -> dict:
    """Check the customer's choices against the shop's list. Returns a clean spec or raises QuoteInputError."""
    if not isinstance(raw, dict):
        _bad("bad_input", "spec", "The choices must be an object.")
    bad = {k for k in raw if str(k).lower() in PRICE_KEYS}
    if bad:
        raise PriceInjection(f"price keys not allowed in input: {sorted(bad)}")
    mats = cfg["materials"]
    mk = raw.get("material", "pla")
    if mk not in mats:
        _bad("unknown_material", "material", f"We do not print in {mk!r}.")
    mat = mats[mk]
    layer = float(raw.get("layer_height", 0.2 if mat["technology"] == "fdm" else 0.1))
    if layer not in [float(x) for x in mat["layer_heights"]]:
        _bad("bad_layer_height", "layer_height", f"{mat['name']} prints at {mat['layer_heights']} mm.")
    colour = raw.get("colour", mat["colours"][0])
    if colour not in mat["colours"]:
        _bad("unknown_colour", "colour", f"{mat['name']} comes in {mat['colours']}.")
    infill = raw.get("infill_pct", 20)
    if isinstance(infill, bool) or not isinstance(infill, (int, float)) or not 5 <= infill <= 100:
        _bad("bad_infill", "infill_pct", "Infill must be from 5 to 100 percent.")
    qty = raw.get("quantity", 1)
    if isinstance(qty, bool) or not isinstance(qty, int) or not 1 <= qty <= 10000:
        _bad("bad_quantity", "quantity", "Quantity must be a whole number from 1 to 10,000.")
    fin = raw.get("finishing", [])
    if not isinstance(fin, list) or len(set(fin)) != len(fin) or any(f not in cfg["finishing"] for f in fin):
        _bad("bad_finishing", "finishing", f"Finishing must be a list without repeats, from {sorted(cfg['finishing'])}.")
    rush = raw.get("rush", "standard")
    if rush not in cfg["rush"]:
        _bad("bad_rush", "rush", f"Rush must be one of {sorted(cfg['rush'])}.")
    delivery = raw.get("delivery", "pickup")
    if delivery not in cfg["packaging"]:
        _bad("bad_delivery", "delivery", f"Delivery must be one of {sorted(cfg['packaging'])}.")
    design = raw.get("design_hours", 0)
    if isinstance(design, bool) or not isinstance(design, (int, float)) or not 0 <= design <= 200:
        _bad("bad_design_hours", "design_hours", "Design hours must be from 0 to 200.")
    disc = raw.get("discount_pct", 0)
    if isinstance(disc, bool) or not isinstance(disc, (int, float)) or not 0 <= disc <= cfg["loyalty_max_pct"]:
        _bad("bad_discount", "discount_pct", f"A discount must be from 0 to {cfg['loyalty_max_pct']} percent.")
    return {"material": mk, "colour": colour, "layer_height": layer, "infill_pct": infill, "supports": bool(raw.get("supports", False)),
            "quantity": qty, "finishing": list(fin), "rush": rush, "delivery": delivery, "design_hours": design, "discount_pct": disc,
            "printer": raw.get("printer")}


# ---------------------------------------------------------------- physics (estimates)

def _orient(size: tuple, fit: dict) -> tuple:
    if not fit.get("rotated"):
        return tuple(size)
    d = dict(zip("xyz", size))
    return tuple(d[c] for c in fit["rotated"])


def choose_printer(cfg: dict, material_key: str, size_mm: tuple, forced: str | None = None):
    """The cheapest printer that can run this material and holds the part (turning it if needed).
    Returns (key, fit). If nothing holds it, the cheapest compatible printer and a fit with split=True."""
    mat = cfg["materials"][material_key]
    ok = {k: p for k, p in cfg["printers"].items() if material_key in p["materials"] and p["technology"] == mat["technology"]}
    if forced is not None:
        if forced not in ok:
            _bad("printer_cannot", "printer", f"{forced!r} cannot print {mat['name']}.")
        ok = {forced: ok[forced]}
    if not ok:
        _bad("no_printer", "material", f"No printer in the shop can run {mat['name']}.")
    fitting = [(p["rate_hour"], k, f) for k, p in ok.items() if (f := fits(size_mm, tuple(p["build_mm"])))["fits"]]
    if fitting:
        _, k, f = min(fitting, key=lambda t: (t[0], t[1]))
        return k, f
    k = min(ok, key=lambda k: (ok[k]["rate_hour"], k))
    return k, fits(size_mm, tuple(ok[k]["build_mm"]))


def estimate(cfg: dict, mat: dict, volume_mm3: float, area_mm2: float, size: tuple, layer: float, infill_pct: float, supports: bool,
             build_mm: tuple) -> dict:
    """Weight and print time of ONE part, plus how many fit on a plate. Heuristics, documented in config; good to about the configured accuracy."""
    pt = cfg["print_time"]
    sup = cfg["support_fraction"] if supports else 0.0
    if mat["technology"] == "fdm":
        shell = min(volume_mm3, area_mm2 * cfg["wall_mm"])
        printed = shell + (volume_mm3 - shell) * (infill_pct / 100.0)
    else:
        printed = volume_mm3                       # resin parts are printed solid
    total = printed * (1 + sup)
    weight_g = total / 1000.0 * mat["density"]
    layers = max(1, math.ceil(size[2] / layer))
    if mat["technology"] == "fdm":
        flow = mat["flow_mm3_s"] * layer / pt["reference_layer_mm"]
        seconds = total / flow + layers * pt["layer_overhead_s"]
        seconds *= 1 + (pt["support_time_factor"] if supports else 0.0)
    else:
        seconds = layers * mat["sla_layer_s"]       # resin time follows height, not volume; copies on one plate share it
    foot = max(size[0] * size[1], 1e-6)
    per_plate = int(max(1, min(pt["max_per_plate"], math.floor(pt["plate_fill"] * build_mm[0] * build_mm[1] / foot))))
    return {"weight_g": weight_g, "seconds_per_part": seconds, "layers": layers, "per_plate": per_plate,
            "printed_mm3": total, "shell_mm3": shell if mat["technology"] == "fdm" else 0.0, "technology": mat["technology"]}


# ---------------------------------------------------------------- price

def price_quote(cfg: dict, analysis, raw_spec: dict, overrides: dict | None = None) -> dict:
    """Full, itemised price. `analysis` is an stl.Analysis or a dict with volume_mm3, area_mm2, size_mm.
    `overrides` (operator only, logged in the result): {'print_hours': total hours for the job}."""
    spec = normalise(cfg, raw_spec)
    mat = cfg["materials"][spec["material"]]
    volume, area, size = float(_m(analysis, "volume_mm3")), float(_m(analysis, "area_mm2")), tuple(float(v) for v in _m(analysis, "size_mm"))
    if volume <= 0:
        _bad("empty_model", "model", "The model has no volume to print.")
    pkey, fit = choose_printer(cfg, spec["material"], size, spec["printer"])
    printer = cfg["printers"][pkey]
    oriented = _orient(size, fit)
    e = estimate(cfg, mat, volume, area, oriented, spec["layer_height"], spec["infill_pct"], spec["supports"], tuple(printer["build_mm"]))
    qty = spec["quantity"]
    plates = math.ceil(qty / e["per_plate"])
    pt = cfg["print_time"]
    if mat["technology"] == "fdm":
        hours = qty * e["seconds_per_part"] / 3600.0 + plates * pt["warmup_hours"]
    else:
        hours = plates * (e["seconds_per_part"] / 3600.0 + pt["warmup_hours"])
    applied = []
    if overrides and "print_hours" in overrides:
        oh = overrides["print_hours"]
        if isinstance(oh, bool) or not isinstance(oh, (int, float)) or not 0 < oh <= 5000:
            _bad("bad_override", "print_hours", "Print hours must be more than 0 and at most 5000.")
        applied.append({"field": "print_hours", "from": round(hours, 2), "to": oh})
        hours = float(oh)
    total_weight = e["weight_g"] * qty
    labour_rate, area_cm2 = D(cfg["labour_rate_hour"]), area / 100.0

    material = q(D(total_weight) / 1000 * D(mat["price_per_kg"]) * (1 + D(mat["waste_pct"]) / 100))
    machine = q(D(round(hours, 4)) * D(printer["rate_hour"]))
    fbuf = D(cfg["failure_buffer_pct"]) / 100
    f_mat, f_mach = q(material * fbuf), q(machine * fbuf)
    setup = q(D(cfg["setup_minutes"]) * labour_rate / 60)
    fin_labour = fin_cons = Decimal("0")
    for f in spec["finishing"]:
        spec_f = cfg["finishing"][f]
        minutes = D(spec_f["minutes_base"]) + D(spec_f["minutes_per_100cm2"]) * D(round(area_cm2 / 100.0, 6))
        fin_labour += minutes * labour_rate / 60 * qty
        fin_cons += D(spec_f["consumable_per_100cm2"]) * D(round(area_cm2 / 100.0, 6)) * qty
    finishing = q(fin_labour + fin_cons)
    design = q(D(spec["design_hours"]) * D(cfg["design_rate_hour"]))
    packaging = q(cfg["packaging"][spec["delivery"]])
    cost_lines = [("material", material), ("machine", machine), ("failure_buffer", f_mat + f_mach), ("setup", setup),
                  ("finishing", finishing), ("design", design), ("packaging", packaging)]
    cost_total = sum((a for _, a in cost_lines), Decimal("0"))

    # price: cost lifted to the target margin, then each adjustment is the difference between two rounded prices so the lines add up exactly
    p0 = q(cost_total / (1 - D(cfg["target_margin_pct"]) / 100))
    tier_pct = max(t["pct"] for t in cfg["quantity_tiers"] if t["min_qty"] <= qty)
    p1 = q(p0 * (1 - D(tier_pct) / 100))
    r = cfg["rush"][spec["rush"]]
    p2 = q(p1 * D(r["multiplier"]))
    p3 = q(p2 * (1 - D(spec["discount_pct"]) / 100))
    p4 = max(p3, q(cfg["min_order_charge"]))
    adjust = [("margin", p0 - cost_total), ("quantity_discount", p1 - p0), ("rush", p2 - p1), ("discount", p3 - p2), ("minimum_order", p4 - p3)]
    tax = q(p4 * D(cfg["sst"]["rate_pct"]) / 100) if cfg["sst"]["enabled"] else Decimal("0.00")
    raw_total = p4 + tax
    total = round_five_sen(raw_total) if cfg["rounding"] == "five_sen" else raw_total
    lines = ([{"key": k, "kind": "cost", "amount": a} for k, a in cost_lines]
             + [{"key": k, "kind": "adjust", "amount": a} for k, a in adjust if a != 0 or k == "margin"]
             + ([{"key": "sst", "kind": "tax", "amount": tax}] if tax else [])
             + ([{"key": "rounding", "kind": "round", "amount": total - raw_total}] if total != raw_total else []))

    margin_pct = float((p4 - cost_total) / p4 * 100) if p4 else 0.0
    warnings, reasons = [], []
    if not fit["fits"]:
        warnings.append("no_printer_fits")
    elif not fit["as_is"]:
        warnings.append("turn_to_fit")
    if _watertight(analysis) is False:
        warnings.append("model_may_have_holes")
    if p4 < cost_total:
        warnings.append("below_cost"); reasons.append("below_cost")
    elif margin_pct < cfg["margin_floor_pct"]:
        warnings.append("below_margin_floor"); reasons.append("margin_floor")
    if total > D(cfg["approvals"]["quote_value_above"]):
        reasons.append("value")
    if spec["discount_pct"] > cfg["approvals"]["discount_pct_above"]:
        reasons.append("discount")
    if p4 > p3:
        warnings.append("minimum_order_applied")
    # quick lead time: print days plus one day to prepare and finish. A rush level promises at most its label days, but nothing can come
    # off the printers faster than they run. The scheduler (later) replaces this with a date from the real queue.
    run_days = math.ceil(hours / HOURS_PER_DAY)
    lead_days = run_days + 1 if spec["rush"] == "standard" else max(run_days, min(run_days + 1, r["label_days"]))
    ring = {"material": material + f_mat, "machine": machine + f_mach, "labour": setup + design, "finishing": finishing, "packaging": packaging,
            "margin": p4 - cost_total}
    return {
        "currency": cfg.get("currency", "MYR"), "spec": spec, "printer": pkey, "printer_name": printer["name"], "fit": fit, "printable": bool(fit["fits"]),
        "weight_g": round(e["weight_g"], 1), "total_weight_g": round(total_weight, 1), "print_hours": round(hours, 2),
        "print_hours_per_part": round(e["seconds_per_part"] / 3600.0, 3), "plates": plates, "per_plate": e["per_plate"], "layers": e["layers"],
        "lead_days": lead_days, "estimate_accuracy_pct": cfg["estimate_accuracy_pct"],
        "lines": lines, "cost_total": cost_total, "price_ex_tax": p4, "tax": tax, "total": total, "unit_price": q(p4 / qty), "margin_pct": round(margin_pct, 1),
        "breakdown": ring, "warnings": warnings, "requires_approval": bool(reasons), "approval_reasons": reasons, "overrides_applied": applied,
        "why": [
            {"code": "weight", "grams": round(e["weight_g"], 1), "infill_pct": spec["infill_pct"] if mat["technology"] == "fdm" else 100, "supports": spec["supports"]},
            {"code": "time", "hours": round(hours, 2), "layers": e["layers"], "layer_height": spec["layer_height"], "plates": plates, "per_plate": e["per_plate"]},
            {"code": "printer", "name": printer["name"], "rate_hour": float(printer["rate_hour"])},
            {"code": "margin", "target_pct": cfg["target_margin_pct"], "actual_pct": round(margin_pct, 1)},
            *([{"code": "tier", "pct": tier_pct, "quantity": qty}] if tier_pct else []),
        ],
    }


def customer_view(quote: dict) -> dict:
    """What a customer, a viewer or a print operator without cost rights may see: the price and the plan, never cost lines, margin or printer rates."""
    sp = quote["spec"]
    return {"currency": quote["currency"], "spec": {k: sp[k] for k in ("material", "colour", "layer_height", "infill_pct", "supports", "quantity",
                                                                          "finishing", "rush", "delivery")},
            "weight_g": quote["weight_g"], "print_hours": quote["print_hours"], "lead_days": quote["lead_days"], "unit_price": quote["unit_price"],
            "price_ex_tax": quote["price_ex_tax"], "tax": quote["tax"], "total": quote["total"], "printable": quote["printable"],
            "estimate_accuracy_pct": quote["estimate_accuracy_pct"], "warnings": [w for w in quote["warnings"] if w in ("no_printer_fits", "turn_to_fit", "model_may_have_holes")]}
