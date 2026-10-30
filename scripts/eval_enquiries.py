"""Measure enquiry extraction accuracy on synthetic Manglish text (tests/fixtures/enquiries_eval.jsonl).
  python scripts/eval_enquiries.py --fake [--noise 0.1] [--seed 0]     # offline stub, tests the tool itself (default without ILMU_API_KEY)
  python scripts/eval_enquiries.py --live [--max 60] [--catalog]       # real ILMU calls, needs ILMU_API_KEY
Uses the same schema, redact() and price-key check as pipeline.handle_enquiry. --catalog also lets the model
answer with raw material keys (pla_1kg_black...) instead of only recipe keys. Never prints the API key."""
import argparse
import json
import os
import random
import sys
import time
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from src import ilmu, pricing  # noqa: E402
from src.pipeline import _items_schema, redact  # noqa: E402
from src.templates import load_template  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "enquiries_eval.jsonl"
NOT_ORDER = ("unclear", "not_an_order")


def load_rows(path=FIXTURE):
    return [json.loads(l) for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]


def fake_extractor(rows, tpl, noise=0.1, seed=0):
    """Echoes the expected items; with probability `noise` per line breaks one (qty x2, wrong key, or a made-up item)."""
    rng, by_text, keys = random.Random(seed), {r["text"]: r for r in rows}, list(tpl["recipes"])

    def extract(text):
        items = [dict(i) for i in by_text[text]["expected"]]
        if rng.random() < noise:
            mode = rng.choice(["qty", "key"]) if items else "extra"
            if mode == "qty":
                items[0]["qty"] = (items[0]["qty"] or 1) * 2
            elif mode == "key":
                items[0]["item_key"] = rng.choice([k for k in keys if k != items[0]["item_key"]])
            else:
                items = [{"item_key": keys[0], "qty": 1}]
        return {"items": items}
    return extract


def _num(x):
    try:
        return None if x is None or isinstance(x, bool) else Decimal(str(x))
    except Exception:
        return None


def price_leak(out):
    bad = lambda d: isinstance(d, dict) and any(str(k).lower() in pricing.PRICE_KEYS for k in d)
    items = out.get("items") if isinstance(out.get("items"), list) else []
    return bad(out) or any(bad(i) or bad(i.get("attrs")) for i in items if isinstance(i, dict))


def score(rows, extract, sleep=0.0, limit=None):
    """-> metrics dict. extract(text) -> dict like {"items": [...]}; may raise ilmu.IlmuError."""
    n_ord = key_ok = qty_ok = full_ok = n_ref = refused = errors = leaks = 0
    bad = []
    for r in rows[:limit]:
        if sleep:
            time.sleep(sleep)
        try:
            out = extract(redact(r["text"]))
        except ilmu.IlmuError as e:
            errors += 1
            out, bad = {}, bad + [(r["id"], f"error {str(e)[:80]}")]
        leaks += price_leak(out)
        got = out.get("items") if isinstance(out.get("items"), list) else []
        got = sorted(((str(i.get("item_key")), _num(i.get("qty"))) for i in got if isinstance(i, dict)), key=str)
        if r["kind"] in NOT_ORDER:
            n_ref += 1
            refused += not got
            if got:
                bad.append((r["id"], f"should refuse, got {got}"))
            continue
        want = sorted(((i["item_key"], _num(i["qty"])) for i in r["expected"]), key=str)
        n_ord += 1
        k, q = [x[0] for x in got] == [x[0] for x in want], [x[1] for x in got] == [x[1] for x in want]
        key_ok, qty_ok, full_ok = key_ok + k, qty_ok + q, full_ok + (k and q)
        if not (k and q):
            bad.append((r["id"], f"want {want} got {got}"))
    return {"lines": min(len(rows), limit or len(rows)), "orders": n_ord, "item_key_exact": key_ok, "qty_exact": qty_ok,
            "full_line": full_ok, "refusal_lines": n_ref, "refused": refused, "api_errors": errors,
            "price_key_outputs": leaks, "misses": bad}


def table(m):
    pct = lambda a, b: f"{a}/{b} ({100 * a / b:.1f}%)" if b else "n/a"
    return "\n".join([
        f"Lines scored: {m['lines']} (synthetic text, not real-world accuracy)", "",
        "| Metric | Result |", "|---|---|",
        f"| Item key exact | {pct(m['item_key_exact'], m['orders'])} |",
        f"| Quantity exact | {pct(m['qty_exact'], m['orders'])} |",
        f"| Full line correct | {pct(m['full_line'], m['orders'])} |",
        f"| Refused/clarified (unclear + not an order) | {pct(m['refused'], m['refusal_lines'])} |",
        f"| Outputs containing a price key (must be 0) | {m['price_key_outputs']} |",
        f"| API errors | {m['api_errors']} |"])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--fake", action="store_true")
    g.add_argument("--live", action="store_true")
    ap.add_argument("--noise", type=float, default=0.1)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--max", type=int, default=60)
    ap.add_argument("--catalog", action="store_true", help="live: also allow raw material keys in the schema")
    ap.add_argument("--sleep", type=float, default=0.5, help="live: seconds between calls")
    ap.add_argument("--json", help="write full results to this path")
    a = ap.parse_args(argv)
    live = a.live or not (a.fake or not os.environ.get("ILMU_API_KEY"))
    rows, tpl = load_rows(), load_template("made_to_order")
    if live:
        if not os.environ.get("ILMU_API_KEY"):
            sys.exit("--live needs ILMU_API_KEY in the environment")
        schema = _items_schema(tpl)
        if a.catalog:
            enum = schema["properties"]["items"]["items"]["properties"]["item_key"]["enum"]
            enum += [c["item_key"] for c in tpl["item_catalog"] if c["item_key"] not in enum]  # the live schema already offers them when the template has resale_markup_pct
        used = [0]

        def extract(text):
            used[0] += len(json.dumps(schema)) + len(text)  # ponytail: extract_json hides token usage; chars/4 is a rough proxy
            out = ilmu.extract_json(text, schema)
            used[0] += len(json.dumps(out))
            return out
        m = score(rows, extract, a.sleep, a.max)
        m["approx_tokens"] = used[0] // 4
    else:
        m = score(rows, fake_extractor(rows, tpl, a.noise, a.seed), 0, a.max)
    print(f"Mode: {'live ' + (os.environ.get('ILMU_MODEL') or ilmu.LLM_MODEL) if live else 'FAKE stub (noise %.2f, seed %d), not a model result' % (a.noise, a.seed)}\n")
    print(table(m))
    if live:
        print(f"\nApprox tokens sent+received: {m['approx_tokens']} (chars/4, rough). Multiply by the ILMU price per token for cost.")
    if m["misses"]:
        print("\nMisses:\n" + "\n".join(f"- {i}: {w}" for i, w in m["misses"][:15]))
    if a.json:
        Path(a.json).write_text(json.dumps({**m, "mode": "live" if live else "fake"}, default=str, indent=1), encoding="utf-8")
    return m


if __name__ == "__main__":
    main()
