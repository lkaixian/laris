"""Write docs/tests.svg: one square per pytest test, grouped by file, with a tooltip per file.
Run: python scripts/tests_map.py   (re-run after adding tests)"""
import collections, re, subprocess, sys

out = subprocess.run([sys.executable, "-m", "pytest", "--collect-only", "-q"], capture_output=True, text=True).stdout
files = collections.Counter(m.group(1) for l in out.splitlines() if (m := re.match(r"(tests/[^:]+)::", l)))
total = sum(files.values())

CELL, COLS, W = 8, 120, 1000  # square pitch, squares per row, svg width
rows, y = [], 34
for f, n in sorted(files.items()):
    name = f.removeprefix("tests/")
    rects = "".join(
        f'<rect x="{10 + (i % COLS) * CELL}" y="{y + (i // COLS) * CELL}" width="7" height="7" fill="#2ea043"/>'
        for i in range(n))
    rows.append(f"<g><title>{name}: {n}</title>{rects}</g>")
    y += ((n - 1) // COLS + 1) * CELL + 4  # each file starts on its own row

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{y + 6}" viewBox="0 0 {W} {y + 6}">'
       f'<rect width="100%" height="100%" fill="#0d1117"/>'
       f'<text x="10" y="22" fill="#fff" font-family="sans-serif" font-size="15">'
       f'LARIS tests: {total} in {len(files)} files (one square per test, one row group per file)</text>'
       + "".join(rows) + "</svg>")
open("docs/tests.svg", "w", encoding="utf-8").write(svg)
print(total, len(files))
