"""Write docs/tests.svg: one square per pytest test, grouped by file, with a tooltip per file.
Run: python scripts/tests_map.py   (re-run after adding tests)"""
import collections, re, subprocess, sys

out = subprocess.run([sys.executable, "-m", "pytest", "--collect-only", "-q"], capture_output=True, text=True).stdout
files = collections.Counter(m.group(1) for l in out.splitlines() if (m := re.match(r"(tests/[^:]+)::", l)))
total = sum(files.values())

LABEL, CELL, COLS, W = 170, 8, 100, 1000  # label column, square pitch, squares per row, svg width
FONT = 'font-family="sans-serif"'
rows, y = [], 62
for f, n in sorted(files.items()):
    name = f.removeprefix("tests/test_").removesuffix(".py").replace("_", " ")
    h = ((n - 1) // COLS + 1) * CELL
    rects = "".join(
        f'<rect x="{LABEL + (i % COLS) * CELL}" y="{y + (i // COLS) * CELL}" width="7" height="7" fill="#2ea043"/>'
        for i in range(n))
    rows.append(f'<g><title>{f}: {n} tests</title>'
                f'<text x="{LABEL - 10}" y="{y + 8}" text-anchor="end" fill="#c9d1d9" {FONT} font-size="12">{name}</text>'
                f'{rects}'
                f'<text x="{LABEL + min(n, COLS) * CELL + 6}" y="{y + 8}" fill="#8b949e" {FONT} font-size="11">{n}</text></g>')
    y += h + 5

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{y + 6}" viewBox="0 0 {W} {y + 6}">'
       f'<rect width="100%" height="100%" fill="#0d1117"/>'
       f'<text x="10" y="24" fill="#fff" {FONT} font-size="16">{total} automated tests across {len(files)} areas</text>'
       f'<text x="10" y="44" fill="#8b949e" {FONT} font-size="12">'
       f'Each row is one area of the app (name on the left, count on the right). Each green square is one automated check of it.</text>'
       + "".join(rows) + "</svg>")
open("docs/tests.svg", "w", encoding="utf-8").write(svg)
print(total, len(files))
