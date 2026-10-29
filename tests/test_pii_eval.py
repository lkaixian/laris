"""The masking miss rate on invented text (scripts/eval_pii.py). The ceilings below are today's measured misses, all listed in
docs/technical-debt.md. A higher number is a regression and fails; a lower one means update the ceiling and the debt note."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import eval_pii  # noqa: E402

from src.parse_util import Mask  # noqa: E402

CEILING = {"EMAIL": 1, "PHONE": 2, "ID": 1, "CARD": 0, "ACCT": 1, "NAME": 3, "ADDRESS": 2, "KEEP": 0}


def test_misses_do_not_exceed_the_measured_ceiling():
    res = eval_pii.evaluate()
    assert set(res) == set(CEILING)
    over = {k: (r["bad"], CEILING[k], r["bad_texts"]) for k, r in res.items() if r["bad"] > CEILING[k]}
    assert not over, over


def test_prices_and_document_numbers_are_never_changed():
    assert eval_pii.evaluate()["KEEP"]["bad"] == 0


def test_hostile_text_is_masked_in_linear_time():
    t0 = time.perf_counter()
    for s in ("acct " + "1 " * 100_000, "maybank " * 50_000, "1" * 200_000, "0" + "1-" * 100_000, "a@" + "b." * 50_000, "+60 " * 50_000):
        Mask(["Ali Trading"])(s)
    assert time.perf_counter() - t0 < 5
