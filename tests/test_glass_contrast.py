"""WCAG contrast of the glass skin, computed, not eyeballed. Reads the token blocks in web/src/glass.css.
Worst case for text on glass = the moving background at its most extreme right behind the panel, so every pair is checked over
every backdrop the page can show: each base colour alone, each orb at peak opacity over it, and all orbs stacked at peak."""
import itertools
import re
from pathlib import Path

import pytest

CSS = (Path(__file__).resolve().parent.parent / "web" / "src" / "glass.css").read_text(encoding="utf-8")
AA_TEXT, AA_UI = 4.5, 3.0


def block(selector_re: str) -> dict:
    m = re.search(r"^" + selector_re + r" \{(.*?)^\}", CSS, re.S | re.M)
    assert m, f"token block not found: {selector_re}"
    return {k: v.strip() for k, v in re.findall(r"(--[\w-]+):\s*([^;]+);", m.group(1))}


THEMES = {"light": block(r':root, :root\[data-theme="light"\]'), "dark": block(r':root\[data-theme="dark"\]')}


def rgba(v: str) -> tuple[float, float, float, float]:
    v = v.strip()
    if v.startswith("#"):
        h = v[1:]
        h = "".join(c * 2 for c in h) if len(h) == 3 else h
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 1.0
    m = re.fullmatch(r"rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)", v)
    if m:
        return float(m[1]), float(m[2]), float(m[3]), float(m[4] or 1)
    m = re.fullmatch(r"(\d+)\s+(\d+)\s+(\d+)", v)
    assert m, f"cannot read colour {v!r}"
    return float(m[1]), float(m[2]), float(m[3]), 1.0


def over(fg, bg):
    """fg (r, g, b, a) painted over an opaque bg (r, g, b)."""
    r, g, b, a = fg
    return tuple(a * f + (1 - a) * c for f, c in zip((r, g, b), bg[:3]))


def lum(c) -> float:
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])


def contrast(a, b) -> float:
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def backdrops(t: dict) -> list:
    """Every colour that can be right behind a panel."""
    out = []
    orbs = [(rgba(t[f"--orb-{i}"])[:3], float(t[f"--orb-{i}-peak"])) for i in (1, 2, 3)]
    for base in (rgba(t["--glass-bg-deep"])[:3], rgba(t["--glass-bg-brand"])[:3]):
        out.append(base)
        for c, a in orbs:
            out.append(over((*c, a), base))
        stacked = base
        for c, a in (orbs[1], orbs[2], orbs[0]):          # paint order of the three radial gradients, bottom to top
            stacked = over((*c, a), stacked)
        out.append(stacked)
    return out


def stack(t, backdrop, *layers):
    c = backdrop
    for name in layers:
        c = over(rgba(t[name]), c)
    return c


@pytest.mark.parametrize("theme", ["light", "dark"])
def test_text_passes_aa_over_every_backdrop(theme):
    t = THEMES[theme]
    fails = []
    # (label, text token, layers painted over the backdrop in order, minimum)
    text_pairs = [
        ("ink on surface", "--ink", ["--surface-glass"]), ("ink-2 on surface", "--ink-2", ["--surface-glass"]),
        ("muted on surface", "--muted", ["--surface-glass"]), ("accent on surface", "--accent", ["--surface-glass"]),
        ("accent-hover on surface", "--accent-hover", ["--surface-glass"]), ("warn on surface", "--warn", ["--surface-glass"]),
        ("ink on tint", "--ink", ["--surface-glass", "--tint"]), ("accent on tint", "--accent", ["--surface-glass", "--tint"]),
        ("muted on table header", "--muted", ["--surface-glass", "--surface-2"]), ("warn on warn-bg", "--warn", ["--surface-glass", "--warn-bg"]),
        ("ink on strong tile", "--ink", ["--glass-fill-strong"]), ("muted on strong tile", "--muted", ["--glass-fill-strong"]),
        ("accent on strong tile", "--accent", ["--glass-fill-strong"]),
        ("ink on nested surface", "--ink", ["--surface-glass", "--surface-glass"]), ("muted on nested surface", "--muted", ["--surface-glass", "--surface-glass"]),
        ("ink on solid fallback", "--ink", ["--surface-solid"]), ("muted on solid fallback", "--muted", ["--surface-solid"]),
        ("accent on solid fallback", "--accent", ["--surface-solid"]), ("warn on solid fallback", "--warn", ["--surface-solid"]),
    ]
    for label, tok, layers in text_pairs:
        for i, bd in enumerate(backdrops(t)):
            bg = stack(t, bd, *layers)
            ratio = contrast(rgba(t[tok])[:3], bg)
            if ratio < AA_TEXT:
                fails.append(f"{label}: {ratio:.2f} over backdrop #{i}")
    assert not fails, f"{theme}: " + "; ".join(fails)


@pytest.mark.parametrize("theme", ["light", "dark"])
def test_buttons_and_form_borders_pass(theme):
    t = THEMES[theme]
    # button label on its fill (the fill is opaque)
    assert contrast(rgba(t["--on-accent"])[:3], rgba(t["--accent"])[:3]) >= AA_TEXT
    assert contrast(rgba(t["--on-accent"])[:3], rgba(t["--accent-hover"])[:3]) >= AA_TEXT
    fails = []
    for i, bd in enumerate(backdrops(t)):
        for layers in (["--surface-glass"], ["--surface-solid"]):
            bg = stack(t, bd, *layers)
            for tok in ("--line", "--accent"):                 # form borders and the focus ring need 3:1 against the surface
                ratio = contrast(rgba(t[tok])[:3], bg)
                if ratio < AA_UI:
                    fails.append(f"{tok} on {layers[0]}: {ratio:.2f} over backdrop #{i}")
    assert not fails, f"{theme}: " + "; ".join(fails)


def test_dark_theme_is_built_on_the_brand_green():
    d = THEMES["dark"]
    assert d["--glass-bg-brand"].lower() == "#00563f" and d["--glass-bg-deep"].lower() == "#00281d"
    assert d["--accent"].lower() == "#5cf2b0" and d["--ink"].lower() == "#f2fbf7"


def test_every_fallback_trigger_drops_the_blur():
    # user switch, OS setting and missing backdrop-filter must all swap to the solid surface and turn the filter off
    assert CSS.count("--glass-filter: none") == 3
    assert 'data-transparency="reduce"' in CSS and "prefers-reduced-transparency" in CSS and "@supports not" in CSS
    assert CSS.count("--surface: var(--surface-solid)") == 3


def test_blur_is_never_nested():
    assert ".bg-surface :is(" in CSS and "backdrop-filter: none" in CSS


def test_background_stops_when_hidden_or_lite():
    assert "[data-hidden] body::before { animation-play-state: paused" in CSS
    assert "[data-lite] body::before { animation: none" in CSS


def test_orb_opacity_is_capped_so_text_always_has_room():
    for name, t in THEMES.items():
        for i in (1, 2, 3):
            assert float(t[f"--orb-{i}-peak"]) <= 0.65, (name, i)


THEME_CSS = (Path(__file__).resolve().parent.parent / "web" / "src" / "theme.css").read_text(encoding="utf-8")
KNOWN_SURFACE_MIXES = 15   # rules in theme.css that mix --surface with transparency; each has a counterpart in glass.css (see its "Compatibility" block)


def test_upstream_glass_rules_use_the_tested_surface():
    """theme.css rules that do color-mix(var(--surface) NN%, transparent) assume an opaque surface. Under the frosted surface they would stack to
    about 55% opacity and the contrast proof above would no longer describe what is on screen. Each known one is overridden in glass.css."""
    mixes = len(re.findall(r"color-mix\(in srgb, var\(--surface\) \d+%, transparent\)", THEME_CSS))
    assert mixes == KNOWN_SURFACE_MIXES, (
        f"theme.css now has {mixes} rules mixing --surface with transparency (known: {KNOWN_SURFACE_MIXES}). Add a compatibility override for the new one "
        "in glass.css (Compatibility block), then raise KNOWN_SURFACE_MIXES.")
    for sel in (".glass-pane::before", ".glass-dialog", ".nav-tip", ".toast", ".input", ".card", ".glass-lite", ".glass-stage fieldset", ".guide-panel", ".orb-disc", ".btn:not("):
        assert sel in CSS, f"glass.css does not override {sel}"
    assert CSS.count("var(--surface-solid)") >= 5   # floating panels use the firm surface
