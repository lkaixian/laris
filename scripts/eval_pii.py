"""Measure what the model door's masking misses, on invented text (tests/fixtures/pii_eval.jsonl).
A sample is MISSED when a secret is still in the masked text; for kind KEEP (prices, document numbers) it is a FALSE POSITIVE when the
text was changed. Nothing here calls a model. Usage: python scripts/eval_pii.py [--json out.json] [--show]"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from src.parse_util import Mask  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "pii_eval.jsonl"


def evaluate(path=FIXTURE) -> dict:
    """-> {kind: {"n": samples, "bad": count, "bad_texts": [...]}}"""
    out = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        s = json.loads(line)
        masked = Mask(s["contacts"])(s["text"]).lower()
        hit = any(x.lower() in masked for x in s["secrets"])
        bad = (not hit) if s["kind"] == "KEEP" else hit
        k = out.setdefault(s["kind"], {"n": 0, "bad": 0, "bad_texts": []})
        k["n"] += 1
        if bad:
            k["bad"] += 1
            k["bad_texts"].append(s["text"])
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    ap.add_argument("--show", action="store_true", help="print the samples that were missed")
    a = ap.parse_args()
    res = evaluate()
    print(f"{'kind':8} {'samples':>7} {'missed':>6} {'rate':>6}")
    for kind, r in res.items():
        print(f"{kind:8} {r['n']:7} {r['bad']:6} {r['bad'] / r['n']:6.0%}" + ("   (false positives)" if kind == "KEEP" else ""))
        if a.show:
            for t in r["bad_texts"]:
                print("    -", t)
    if a.json:
        Path(a.json).write_text(json.dumps(res, indent=1), encoding="utf-8")
