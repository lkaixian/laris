"""Deterministic validation of LLM-extracted supplier quotes (the LLM never self-scores)."""
import difflib
import json
from datetime import date
from decimal import Decimal, InvalidOperation

TOL = Decimal("0.01")
OCR_MIN = 0.80
MATCH_CUTOFF = 0.8


def _num(x):
    if x is None or isinstance(x, bool):
        return None
    try:
        return Decimal(str(x).replace(",", "").strip())
    except InvalidOperation:
        return "bad"


def _date(s):
    try:
        return date.fromisoformat(s) if s else None
    except (ValueError, TypeError):
        return "bad"


def match_item(description, catalog):
    """-> (item_key, score, uom) best alias match, or (None, 0, None). score 1.0 = exact alias/item_key; fuzzy is always < 1."""
    if not catalog or not description:
        return None, 0.0, None
    names = {}
    for it in catalog:
        for a in [it["item_key"].replace("_", " "), *it["aliases"]]:
            names[a.lower()] = it
    d = description.lower().strip()
    hit = difflib.get_close_matches(d, names, n=1, cutoff=MATCH_CUTOFF)
    if not hit:
        return None, 0.0, None
    it = names[hit[0]]
    score = 1.0 if hit[0] == d else min(round(difflib.SequenceMatcher(None, d, hit[0]).ratio(), 3), 0.999)
    return it["item_key"], score, it["uom"]


def validate_extraction(data, catalog=None, today=None) -> dict:
    """data: dict or JSON str per recommended-pipeline schema.
    -> {ok, doc_flags, lines:[... needs_review, confidence, failed]}. ok=False when anything needs review."""
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError as e:
            return {"ok": False, "doc_flags": [f"parse_error: {e}"], "lines": []}
    if not isinstance(data, dict) or not isinstance(data.get("lines"), list):
        return {"ok": False, "doc_flags": ["parse_error: no lines list"], "lines": []}

    flags, out, sums = [], [], Decimal(0)
    for n, raw in enumerate(data["lines"], 1):
        if not isinstance(raw, dict):  # a junk row from the LLM must not sink the whole document
            flags.append(f"line_{n}_unreadable")
            continue
        failed = []
        qty, up, amt = (_num(raw.get(k)) for k in ("qty", "unit_price", "amount"))
        for name, v in (("qty", qty), ("unit_price", up), ("amount", amt)):
            if v == "bad":
                failed.append(f"{name}_not_numeric")
        qty, up, amt = (None if v == "bad" else v for v in (qty, up, amt))
        if qty is None:
            failed.append("null_qty")
        elif qty <= 0:
            failed.append("qty_not_positive")
        if up is None:
            failed.append("null_unit_price")
        arith_ok = True
        if qty is not None and up is not None and amt is not None and abs(qty * up - amt) > TOL:
            arith_ok = False
            failed.append("arith_mismatch")
        ocr = _num(raw.get("ocr_confidence"))
        ocr = None if ocr == "bad" or ocr is None else float(ocr)
        if ocr is not None and ocr < OCR_MIN:
            failed.append("low_ocr_confidence")
        key, score, cat_uom = match_item(str(raw.get("description") or ""), catalog)
        if catalog is not None:
            if key is None:
                failed.append("no_item_match")
            else:
                if score < 1.0:
                    failed.append("fuzzy_item_match")  # a fuzzy match is only a suggestion; a human confirms it
                if raw.get("uom") and str(raw["uom"]).lower() != cat_uom.lower():
                    failed.append("uom_mismatch")
        if not raw.get("uom"):
            failed.append("null_uom")
        conf = min(float(ocr) if ocr is not None else 1.0, 1.0 if arith_ok else 0.0)
        shown = amt if amt is not None else (qty * up if qty is not None and up is not None else None)
        sums += shown or 0
        out.append({**raw, "line_no": raw.get("line_no", n), "item_key_suggestion": key,
                    "item_key_score": score, "confidence": conf,
                    "needs_review": bool(failed), "failed": failed})

    t = data.get("totals") or {}
    sub, sst, grand = (_num(t.get(k)) for k in ("subtotal", "sst", "grand_total"))
    if sub is not None and sub != "bad" and abs(sums - sub) > TOL:
        # lines each consistent but total differs -> likely a dropped line; else a misread digit
        flags.append("subtotal_mismatch:" + ("missing_line?" if all("arith_mismatch" not in l["failed"] for l in out) else "misread_digit?"))
    if sub not in (None, "bad") and grand not in (None, "bad") and abs(sub + (sst if sst not in (None, "bad") else 0) - grand) > TOL:
        flags.append("grand_total_mismatch")

    issued, valid, today = _date(data.get("issued_on")), _date(data.get("valid_until")), today or date.today()
    for name, v in (("issued_on", issued), ("valid_until", valid)):
        if v == "bad":
            flags.append(f"{name}_unparseable")
    if isinstance(issued, date) and issued > today:
        flags.append("issued_on_in_future")
    if isinstance(issued, date) and isinstance(valid, date) and valid < issued:
        flags.append("valid_until_before_issued_on")

    return {"ok": not flags and not any(l["needs_review"] for l in out), "doc_flags": flags, "lines": out}
