import hashlib
import importlib.util
import json
import os
import re
from datetime import date
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("make_samples", ROOT / "scripts" / "make_samples.py")
ms = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ms)
from src.validate import validate_extraction  # noqa: E402

DOCS = ROOT / "tests" / "fixtures" / "docs"
MAN = json.loads((DOCS / "manifest.json").read_text("utf-8"))


def _hashes(d):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(Path(d).iterdir())}


def test_deterministic(tmp_path):
    ms.build(tmp_path / "a")
    ms.build(tmp_path / "b")
    assert _hashes(tmp_path / "a") == _hashes(tmp_path / "b")
    assert _hashes(tmp_path / "a") == _hashes(DOCS), "committed fixtures stale: rerun scripts/make_samples.py"


@pytest.mark.parametrize("name", [n for n, m in MAN.items() if "validate" in m])
def test_expected_validates(name):
    m = MAN[name]
    r = validate_extraction(json.loads((DOCS / m["expected"]).read_text("utf-8")), today=date(2026, 10, 22))
    if m["validate"] == "ok":
        assert r["ok"], r
    else:
        assert not r["ok"]
        assert m["expected_flags"]["doc_flags"] == r["doc_flags"]
        assert m["expected_flags"]["line_failed"] == r["lines"][0]["failed"]


def test_images_watermarked_in_manifest():
    imgs = [m for m in MAN.values() if m["file"].endswith((".png", ".pdf"))]
    assert len(imgs) >= 10
    assert all(m["watermark"] is True for m in imgs)
    assert {p.name for p in DOCS.glob("*.png")} <= {m["file"] for m in imgs}


def test_stale_cost_pair():
    old = json.loads((DOCS / "06a_acrylic_old_rm100.expected.json").read_text())
    new = json.loads((DOCS / "06b_acrylic_new_rm140.expected.json").read_text())
    assert (old["lines"][0]["unit_price"], new["lines"][0]["unit_price"]) == (100.0, 140.0)
    assert old["issued_on"] < new["issued_on"]


def test_enquiries_have_no_prices():
    for n in ("enquiry_bm", "enquiry_en", "enquiry_manglish"):
        e = json.loads((DOCS / f"{n}.expected.json").read_text())
        assert e["items"] and all(set(i) == {"item_key", "qty", "uom"} for i in e["items"])


def test_ocr_overlap_report():
    if not os.path.isdir(r"C:\Program Files\Tesseract-OCR"):
        pytest.skip("Tesseract not installed")
    from src.ocr import ocr_image
    m = MAN["01_clean_quote_raster"]
    got = " ".join(i["text"] for i in ocr_image((DOCS / m["file"]).read_bytes())).lower()
    want = re.findall(r"\S+", " ".join(m["text"]).lower())
    hit = sum(w in got for w in want)
    print(f"\nOCR overlap on 01 raster: {hit}/{len(want)} = {hit / len(want):.2f}")  # reported, not asserted
