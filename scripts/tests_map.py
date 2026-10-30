"""Write docs/tests.svg: one treemap. Each bordered box is a test file (an area of the app), sized by its test count;
each green square inside is one pytest test. Run: python scripts/tests_map.py   (re-run after adding tests)"""
import collections, math, re, subprocess, sys

out = subprocess.run([sys.executable, "-m", "pytest", "--collect-only", "-q"], capture_output=True, text=True).stdout
files = collections.Counter(m.group(1) for l in out.splitlines() if (m := re.match(r"(tests/[^:]+)::", l)))
total = sum(files.values())

W, H, PAD, HEAD, TOP, EXTRA = 1000, 1000, 5, 16, 62, 3  # EXTRA: header cost in test-squares, so tiny areas still fit a label
FONT = 'font-family="sans-serif"'


def tile(items, x, y, w, h):
    """Slice-and-dice: split the sorted list in two halves of near-equal weight along the longer side."""
    if len(items) == 1:
        return [(items[0][0], x, y, w, h)]
    tot, acc, k = sum(i[1] for i in items), 0, 0
    while k < len(items) - 1 and acc + items[k][1] / 2 < tot / 2:
        acc += items[k][1]; k += 1
    k = max(k, 1)
    f = sum(i[1] for i in items[:k]) / tot
    if w >= h:
        return tile(items[:k], x, y, w * f, h) + tile(items[k:], x + w * f, y, w * (1 - f), h)
    return tile(items[:k], x, y, w, h * f) + tile(items[k:], x, y + h * f, w, h * (1 - f))


items = sorted(((f, n + EXTRA) for f, n in files.items()), key=lambda i: -i[1])
body = []
for f, x, y, w, h in tile(items, 0, 0, W - 2 * PAD, H):
    n, x, y = files[f], x + PAD, y + TOP
    name = f.removeprefix("tests/test_").removesuffix(".py").replace("_", " ")
    bw, bh = w - 2 * PAD, h - HEAD - PAD
    cols = max(1, min(n, round(math.sqrt(n * bw / bh))))
    rows = math.ceil(n / cols)
    cw, ch = bw / cols, bh / rows
    label = f"{name} ({n})"
    cap = max(3, int((w - 10) / 6.2))
    if len(label) > cap: label = label[:cap - 1] + "…"
    rects = "".join(f'<rect x="{x + PAD + (i % cols) * cw + 1:.1f}" y="{y + HEAD + (i // cols) * ch + 1:.1f}" '
                    f'width="{cw - 2:.1f}" height="{ch - 2:.1f}" rx="2" fill="#2ea043"/>' for i in range(n))
    body.append(f'<g><title>{f}: {n} tests</title>'
                f'<rect x="{x + 1:.1f}" y="{y + 1:.1f}" width="{w - 2:.1f}" height="{h - 2:.1f}" rx="4" fill="none" stroke="#8b949e" stroke-width="1.5"/>'
                f'<text x="{x + 6:.1f}" y="{y + 13:.1f}" fill="#fff" {FONT} font-size="10.5" font-weight="bold">{label}</text>{rects}</g>')

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{TOP + H + 6}" viewBox="0 0 {W} {TOP + H + 6}">'
       f'<rect width="100%" height="100%" fill="#0d1117"/>'
       f'<text x="10" y="24" fill="#fff" {FONT} font-size="16">{total} automated tests across {len(files)} areas</text>'
       f'<text x="10" y="44" fill="#8b949e" {FONT} font-size="12">Each bordered box is one area of the app; the bigger the box, the more tests it has. Each green square is one automated check.</text>'
       + "".join(body) + "</svg>")
open("docs/tests.svg", "w", encoding="utf-8").write(svg)
print(total, len(files))
