"""Write docs/features.svg: one treemap. Each bordered box is an area of the app, sized by how many features it has;
each cell inside is one feature, coloured by how far it got. Status is hand-kept below from README limits and docs/teammate-handoff.md.
Run: python scripts/features_map.py   (edit FEATURES when a feature changes status)"""
import math

G, A, R = "g", "a", "r"  # G built+tested+in the deployed demo, A built+tested but outside service only run against fakes/mocks, R not built or not connected
COLOR = {G: "#2ea043", A: "#d29922", R: "#da3633"}
LEGEND = {G: "Built, tested, in the demo", A: "Built and tested, but the outside part only against fakes", R: "Not built or not connected"}
FEATURES = {
    "Pricing and quotes": [("Cost book", G), ("Margin guard", G), ("Discount guard", G), ("Stale-cost alert", G), ("Supplier price tiers", G),
        ("Min order qty", G), ("Extraction check", G), ("AI never prices", G), ("Quote PDF", G), ("XLSX / CSV export", G),
        ("Trade templates", G), ("Per-size, qty tiers", G), ("Quote settings", G)],
    "Owner control and security": [("Owner approval", G), ("Custom roles", G), ("Activity log", G), ("Log CSV / PDF", G), ("Multi-business RLS", A),
        ("Sign-in, sessions", G), ("Email invites", A), ("Signed licence", G), ("Sign-up", G), ("API keys", G)],
    "Tracking and jobs": [("Tracker, overdue", G), ("Age colours", G), ("Follow-ups", G), ("Job board", G), ("Jobs from quotes", G),
        ("New job form", G), ("Speed to quote", G), ("Accept link", A), ("E-signature (simulated)", A), ("Chase scheduler", A)],
    "Chat channels": [("Telegram text", A), ("Voice note to text", A), ("Own bot per business", A), ("One-tap bot", A),
        ("Reactions, typing", A), ("Staff linking", A), ("/catalog photo import", A), ("WhatsApp", R)],
    "Help and assistant": [("Guided tour", A), ("Ctrl+K palette", A), ("17 help articles", G), ("AI guide", A),
        ("Assistant lookups", A), ("Assistant actions", A), ("Floating Ask", A)],
    "Supplier work": [("XLSX / CSV prices", G), ("DOCX prices", G), ("PDF prices", G), ("Photo prices (OCR)", A),
        ("Ask suppliers", A), ("Marked-up photo", A), ("Reply comparison", G)],
    "Languages and UI": [("English", G), ("Malay", A), ("Chinese", A), ("Tamil", A), ("All pages translated", G), ("UI polish 2-4", A), ("Mock mode", G)],
    "Privacy (PDPA)": [("Consent notice", A), ("/privacy /mydata /forget", A), ("Export person", G), ("Erase person", G),
        ("Breach register", G), ("DPO contact", G), ("Retention purge", G), ("Lawyer review", R)],
    "Catalog and stock": [("Photo to items", A), ("OCR cross-check", A), ("Availability reply", G), ("Stock count", G),
        ("Quote from chat", G), ("Owner review", G), ("Raw-material match", R)],
    "Integration": [("Recipes API", G), ("Price check API", G), ("Usage metering", G), ("Read-only MCP", G), ("Orbyte API", R)],
}

W, PAD, HEAD, TOP = 1000, 6, 20, 96
FONT = 'font-family="sans-serif"'


def tile(items, x, y, w, h):
    """Slice-and-dice: split the sorted list in two halves of near-equal weight along the longer side."""
    if len(items) == 1:
        return [(items[0][0], x, y, w, h)]
    total, acc, k = sum(i[1] for i in items), 0, 0
    while k < len(items) - 1 and acc + items[k][1] / 2 < total / 2:
        acc += items[k][1]; k += 1
    k = max(k, 1)
    f = sum(i[1] for i in items[:k]) / total
    if w >= h:
        return tile(items[:k], x, y, w * f, h) + tile(items[k:], x + w * f, y, w * (1 - f), h)
    return tile(items[:k], x, y, w, h * f) + tile(items[k:], x, y + h * f, w, h * (1 - f))


def cells(n, w, h):
    """Grid columns for n equal cells in w x h so cells are as square as possible."""
    cols = max(1, min(n, round(math.sqrt(n * w / h))))
    return cols, math.ceil(n / cols)


def wrap(s, w):
    cap = max(4, int(w / 6.3)); out, cur = [], ""
    for word in s.split():
        if cur and len(cur) + 1 + len(word) > cap: out.append(cur); cur = word
        else: cur = f"{cur} {word}".strip()
    return out + [cur]


total = sum(len(v) for v in FEATURES.values())
count = {s: sum(1 for v in FEATURES.values() for _, t in v if t == s) for s in COLOR}
H = 560
items = sorted(((k, len(v)) for k, v in FEATURES.items()), key=lambda i: -i[1])
body = []
for name, x, y, w, h in tile(items, 0, 0, W - 2 * PAD, H):
    x, y = x + PAD, y + TOP
    feats = FEATURES[name]
    cols, rows = cells(len(feats), w - 2 * PAD, h - HEAD - PAD)
    cw, ch = (w - 2 * PAD) / cols, (h - HEAD - PAD) / rows
    g = [f'<rect x="{x + 1:.1f}" y="{y + 1:.1f}" width="{w - 2:.1f}" height="{h - 2:.1f}" rx="4" fill="none" stroke="#8b949e" stroke-width="1.5"/>',
         f'<text x="{x + 8:.1f}" y="{y + 15:.1f}" fill="#fff" {FONT} font-size="12" font-weight="bold">{name} ({len(feats)})</text>']
    for i, (f, st) in enumerate(feats):
        cx, cy = x + PAD + (i % cols) * cw, y + HEAD + (i // cols) * ch
        lines = wrap(f, cw - 8)[:3]
        txt = "".join(f'<text x="{cx + 5:.1f}" y="{cy + 14 + j * 12:.1f}" fill="#fff" {FONT} font-size="10.5">{l}</text>' for j, l in enumerate(lines))
        g.append(f'<g><title>{f}: {LEGEND[st]}</title><rect x="{cx + 1:.1f}" y="{cy + 1:.1f}" width="{cw - 2:.1f}" height="{ch - 2:.1f}" rx="2" fill="{COLOR[st]}"/>{txt}</g>')
    body.append("".join(g))

lx, leg = 10, []
for s in (G, A, R):
    leg.append(f'<rect x="{lx}" y="62" width="12" height="12" rx="2" fill="{COLOR[s]}"/>'
               f'<text x="{lx + 18}" y="72" fill="#c9d1d9" {FONT} font-size="12">{LEGEND[s]}: {count[s]}</text>')
    lx += 18 + 7 * len(LEGEND[s]) + 40
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{TOP + H + 6}" viewBox="0 0 {W} {TOP + H + 6}">'
       f'<rect width="100%" height="100%" fill="#0d1117"/>'
       f'<text x="10" y="24" fill="#fff" {FONT} font-size="16">{total} features in {len(FEATURES)} areas, and how far each one got</text>'
       f'<text x="10" y="44" fill="#8b949e" {FONT} font-size="12">Each bordered box is an area of the app; the bigger the box, the more features it has. Each coloured cell is one feature.</text>'
       + "".join(leg) + "".join(body) + "</svg>")
open("docs/features.svg", "w", encoding="utf-8").write(svg)
print(total, count)
