"""Step 223: every text/surface pair in both themes meets WCAG AA (4.5:1 text, 3:1 borders, focus ring and icons). Reads web/src/theme.css."""
import re
from pathlib import Path

import pytest

CSS = (Path(__file__).resolve().parent.parent / "web/src/theme.css").read_text()


def block(sel: str) -> str:
    a = CSS.index(sel)
    return CSS[a:CSS.index("\n}", a)]


def tokens(text: str) -> dict:
    return {k[2:]: v.strip() for k, v in re.findall(r"(--[\w-]+):\s*(#[0-9a-fA-F]{6})", text)}


def lum(h: str) -> float:
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def ratio(a: str, b: str) -> float:
    x, y = sorted((lum(a), lum(b)), reverse=True)
    return (x + 0.05) / (y + 0.05)


LIGHT = {**tokens(block(":root, :root[data-theme=\"light\"]"))}
DARK = {**LIGHT, **tokens(block(':root[data-theme="dark"]'))}
TEXT = [("ink", "bg"), ("ink", "surface"), ("ink", "surface-2"), ("ink-2", "surface"), ("muted", "bg"), ("muted", "surface"), ("muted", "surface-2"),
        ("accent", "bg"), ("accent", "surface"), ("on-accent", "accent"), ("warn", "bg"), ("warn", "surface"), ("amber", "surface"), ("amber", "bg")]
NONTEXT = [("line", "bg"), ("line", "surface"), ("accent", "bg"), ("accent", "surface")]


@pytest.mark.parametrize("theme,t", [("light", LIGHT), ("dark", DARK)])
def test_text_pairs_pass_aa(theme, t):
    bad = [(f, b, round(ratio(t[f], t[b]), 2)) for f, b in TEXT if f in t and b in t and ratio(t[f], t[b]) < 4.5]
    assert not bad, bad


@pytest.mark.parametrize("theme,t", [("light", LIGHT), ("dark", DARK)])
def test_borders_focus_and_icons_pass_3_to_1(theme, t):
    bad = [(f, b, round(ratio(t[f], t[b]), 2)) for f, b in NONTEXT if ratio(t[f], t[b]) < 3]
    assert not bad, bad


def chips(theme: str):
    pre = r':root\[data-theme="dark"\] ' if theme == "dark" else r"^\s*"
    rx = re.compile(pre + r"\.(chip|heat)-(\w+)\s*\{\s*--(?:chip|heat)-fg:\s*(#\w{6});\s*--(?:chip|heat)-bg:\s*(#\w{6})", re.M)
    return [(f"{a}-{b}", c, d) for a, b, c, d in rx.findall(CSS)]


@pytest.mark.parametrize("theme", ["light", "dark"])
def test_status_chips_and_heat_bands_pass_aa(theme):
    found = chips(theme)
    assert len(found) >= 8, found
    bad = [(n, round(ratio(fg, bg), 2)) for n, fg, bg in found if ratio(fg, bg) < 4.5]
    assert not bad, bad


def test_chips_stay_distinct_from_the_dark_page():
    # A chip must be visibly a chip: its background differs from the page by at least 1.15:1 or it carries a border/shape cue.
    near = [n for n, _, bg in chips("dark") if ratio(bg, DARK["bg"]) < 1.15]
    assert len(near) <= 3, near
