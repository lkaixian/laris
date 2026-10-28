import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import eval_enquiries as ee  # noqa: E402
import eval_wer as ew  # noqa: E402
from src.templates import load_template  # noqa: E402


@pytest.mark.parametrize("ref,hyp,errs,n", [
    ("a b c", "a b c", 0, 3),
    ("A, b. C!", "a b c", 0, 3),          # case and punctuation ignored
    ("a b c", "a x c", 1, 3),             # substitution = 1/3
    ("a b c", "a b c d", 1, 3),           # insertion
    ("a b c", "a c", 1, 3),               # deletion
    ("a b c", "", 3, 3),
])
def test_wer(ref, hyp, errs, n):
    assert ew.wer(ref, hyp) == (errs, n)


def test_cer_and_report():
    assert ew.cer("kitten", "sitting") == (3, 6)
    w, c, worst = ew.report([("1", "a b c", "a b c"), ("2", "a b c", "a x c")])
    assert w == pytest.approx(1 / 6) and 0 < c < w and worst[0][1] == "2"


def test_fixture_valid():
    rows = ee.load_rows()
    tpl = load_template("made_to_order")
    valid = {c["item_key"] for c in tpl["item_catalog"]} | set(tpl["recipes"])
    assert len(rows) == 60 and len({r["id"] for r in rows}) == 60
    assert {r["kind"] for r in rows} == {"order", "availability", "unclear", "not_an_order"}
    for r in rows:
        assert all(i["item_key"] in valid for i in r["expected"])
        assert (r["kind"] in ee.NOT_ORDER) == (r["expected"] == [])
    assert chr(0x2014) not in Path(ee.FIXTURE).read_text(encoding="utf-8")


def test_fake_mode_end_to_end(capsys):
    assert ee.main(["--fake", "--noise", "0"])["full_line"] == 40
    m = ee.main(["--fake", "--noise", "0.3", "--json", str(ROOT / "tests" / "_eval_tmp.json")])
    (ROOT / "tests" / "_eval_tmp.json").unlink()
    assert 0 < m["full_line"] < 40 and m["price_key_outputs"] == 0
    assert "| Full line correct |" in capsys.readouterr().out


def test_price_key_detected():
    rows = ee.load_rows()[:2]
    leak = lambda t: {"items": [{"item_key": "pla_1kg_black", "qty": 1, "unit_price": 1}]}
    assert ee.score(rows, leak)["price_key_outputs"] == 2
    assert ee.score(rows, lambda t: {"items": [{"item_key": "x", "qty": 1, "attrs": {"Price": 1}}]})["price_key_outputs"] == 2


def test_live_without_key_exits(monkeypatch):
    monkeypatch.delenv("ILMU_API_KEY", raising=False)
    with pytest.raises(SystemExit):
        ee.main(["--live"])
