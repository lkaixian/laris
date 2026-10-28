"""Word and character error rate for voice notes.
  python scripts/eval_wer.py results.csv                                  # columns: id,reference,hypothesis
  python scripts/eval_wer.py --live --audio-dir DIR --refs refs.csv       # refs.csv: id,reference ; DIR holds <id>.ogg (or .opus .mp3 .m4a .wav)
--live sends each audio file to ILMU (needs ILMU_API_KEY) and prints the hypotheses as CSV with --save-hyp PATH."""
import argparse
import csv
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src import ilmu  # noqa: E402

MIME = {".ogg": "audio/ogg", ".opus": "audio/ogg", ".mp3": "audio/mpeg", ".m4a": "audio/x-m4a", ".wav": "audio/x-wav"}


def norm(s):
    return " ".join(re.sub(r"[^\w\s]|_", " ", s.lower()).split())


def edits(a, b):
    """Levenshtein distance between two sequences (words or characters)."""
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def wer(ref, hyp):
    r = norm(ref).split()
    return edits(r, norm(hyp).split()), len(r)


def cer(ref, hyp):
    r = norm(ref)
    return edits(r, norm(hyp)), len(r)


def report(rows):
    """rows: [(id, ref, hyp)] -> (overall WER, overall CER, worst 5 [(wer, id, ref, hyp)])."""
    we = wn = ce = cn = 0
    per = []
    for i, ref, hyp in rows:
        e, n = wer(ref, hyp)
        c, m = cer(ref, hyp)
        we, wn, ce, cn = we + e, wn + n, ce + c, cn + m
        per.append((e / n if n else float(e > 0), i, ref, hyp))
    return (we / wn if wn else 0.0), (ce / cn if cn else 0.0), sorted(per, reverse=True)[:5]


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def transcribe_dir(refs, audio_dir, sleep=0.5):
    out = []
    for r in refs:
        f = next((p for p in Path(audio_dir).glob(r["id"] + ".*") if p.suffix.lower() in MIME), None)
        if not f:
            sys.exit(f"no audio file for id {r['id']} in {audio_dir}")
        time.sleep(sleep)
        out.append((r["id"], r["reference"], ilmu.transcribe(f.read_bytes(), MIME[f.suffix.lower()])))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("csv", nargs="?", help="CSV with id,reference,hypothesis")
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--audio-dir")
    ap.add_argument("--refs")
    ap.add_argument("--save-hyp", help="live: write id,reference,hypothesis CSV here")
    a = ap.parse_args(argv)
    if a.live:
        if not (a.audio_dir and a.refs):
            sys.exit("--live needs --audio-dir and --refs")
        if not os.environ.get("ILMU_API_KEY"):
            sys.exit("--live needs ILMU_API_KEY in the environment")
        rows = transcribe_dir(read_csv(a.refs), a.audio_dir)
        if a.save_hyp:
            with open(a.save_hyp, "w", encoding="utf-8", newline="") as f:
                csv.writer(f).writerows([("id", "reference", "hypothesis"), *rows])
    elif a.csv:
        rows = [(r["id"], r["reference"], r["hypothesis"]) for r in read_csv(a.csv)]
    else:
        sys.exit("give a CSV, or --live with --audio-dir and --refs")
    w, c, worst = report(rows)
    print(f"n = {len(rows)} clips\n\n| Metric | Value |\n|---|---|\n| WER | {100 * w:.1f}% |\n| CER | {100 * c:.1f}% |\n\nWorst 5 by WER:")
    for x, i, ref, hyp in worst:
        print(f"- {i} ({100 * x:.0f}%)\n    ref: {ref}\n    hyp: {hyp}")


if __name__ == "__main__":
    main()
