"""Trade template loader. Fails loudly on bad structure."""
import re
from pathlib import Path

import yaml

DIR = Path(__file__).resolve().parent.parent / "config" / "templates"
FIELD_TYPES = {"text", "number", "integer", "date", "select", "boolean"}
KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,40}$")


class TemplateError(ValueError):
    pass


def _need(cond, msg):
    if not cond:
        raise TemplateError(msg)


def load_template(key: str) -> dict:
    _need(KEY_RE.match(key or ""), f"bad template key {key!r}")
    path = DIR / f"{key}.yaml"
    _need(path.exists(), f"template not found: {key}")
    t = yaml.safe_load(path.read_text(encoding="utf-8"))
    _need(isinstance(t, dict), "template must be a mapping")
    for k in ("item_catalog", "recipes", "rate_card", "required_enquiry_fields",
              "followup_hours", "min_margin_pct", "fields"):
        _need(k in t, f"{key}: missing '{k}'")
    keys = set()
    for it in t["item_catalog"]:
        _need({"item_key", "uom", "aliases"} <= it.keys(), f"{key}: bad catalog entry {it}")
        _need(it["item_key"] not in keys, f"{key}: duplicate item_key {it['item_key']}")
        keys.add(it["item_key"])
    for name, r in t["recipes"].items():
        _need("uom" in r, f"{key}: recipe {name} needs uom")
        if "fixed_rate" in r:
            _need(r["fixed_rate"] in t["rate_card"], f"{key}: {name} unknown rate {r['fixed_rate']}")
            continue
        _need(r.get("markup_pct", -1) >= 0 and r.get("bom"), f"{key}: {name} needs bom and markup_pct")
        for b in r["bom"]:
            _need(b["item_key"] in keys and b["qty"] > 0, f"{key}: {name} bad bom row {b}")
        for h in r.get("hours", {}):
            _need(h in t["rate_card"], f"{key}: {name} unknown rate {h}")
    for f in t["fields"]:
        _need(KEY_RE.match(f.get("key", "")) and f.get("label"), f"{key}: bad field {f}")
        _need(f.get("type") in FIELD_TYPES, f"{key}: field {f['key']} bad type")
        _need(f["type"] != "select" or f.get("options"), f"{key}: select {f['key']} needs options")
        _need(f.get("applies_to") and set(f["applies_to"]) <= {"in", "out"}, f"{key}: field {f['key']} applies_to")
    return t
