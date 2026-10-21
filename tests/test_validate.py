import copy
import json
from datetime import date
from pathlib import Path

from src.templates import load_template
from src.validate import validate_extraction

Q = json.loads((Path(__file__).parent / "fixtures" / "supplier_quote.json").read_text())
CAT = load_template("made_to_order")["item_catalog"]
TODAY = date(2026, 10, 22)


def run(d):
    return validate_extraction(d, CAT, today=TODAY)


def test_clean_quote_passes():
    r = run(Q)
    assert r["ok"] and r["doc_flags"] == []
    assert [l["item_key_suggestion"] for l in r["lines"]] == ["pla_1kg_black", "screw_m4"]
    assert all(l["confidence"] >= 0.95 for l in r["lines"])


def test_wrong_digit_flagged_each_position():
    for field, bad in (("unit_price", 56.00), ("qty", 16), ("amount", 650.00)):
        d = copy.deepcopy(Q)
        d["lines"][0][field] = bad
        r = run(d)
        assert not r["ok"], field
        if field != "amount":
            assert "arith_mismatch" in r["lines"][0]["failed"]
        else:  # amount alone is also caught by the line check and the subtotal
            assert any(f.startswith("subtotal_mismatch") for f in r["doc_flags"])


def test_consistent_misread_caught_by_subtotal():
    d = copy.deepcopy(Q)
    d["lines"][0].update(unit_price=65.00, amount=650.00)  # line self-consistent, wrong
    r = run(d)
    assert not r["ok"] and any("subtotal_mismatch" in f for f in r["doc_flags"])


def test_dropped_line_hint():
    d = copy.deepcopy(Q)
    d["lines"].pop()
    assert any("missing_line" in f for f in run(d)["doc_flags"])


def test_null_qty_needs_review():
    d = copy.deepcopy(Q)
    d["lines"][1]["qty"] = None
    l = run(d)["lines"][1]
    assert l["needs_review"] and "null_qty" in l["failed"]


def test_grand_total_and_dates():
    d = copy.deepcopy(Q)
    d["totals"]["grand_total"] = 700
    d["valid_until"] = "2026-09-01"
    d["issued_on"] = "2027-01-01"
    f = run(d)["doc_flags"]
    assert "grand_total_mismatch" in f and "valid_until_before_issued_on" in f and "issued_on_in_future" in f
    d["issued_on"] = "31/13/2026"
    assert "issued_on_unparseable" in run(d)["doc_flags"]


def test_ocr_confidence_min_rule():
    d = copy.deepcopy(Q)
    d["lines"][0]["ocr_confidence"] = 0.6
    l = run(d)["lines"][0]
    assert l["confidence"] == 0.6 and l["needs_review"]
    d["lines"][1]["unit_price"] = 0.5  # arith fails -> confidence 0
    assert run(d)["lines"][1]["confidence"] == 0.0


def test_unknown_item_and_parse_error():
    d = copy.deepcopy(Q)
    d["lines"][0]["description"] = "Titanium widget"
    l = run(d)["lines"][0]
    assert l["item_key_suggestion"] is None and "no_item_match" in l["failed"]
    assert not validate_extraction("{not json", CAT)["ok"]
    assert validate_extraction(json.dumps(Q), CAT, today=TODAY)["ok"]
