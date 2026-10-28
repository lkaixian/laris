import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.email_layout import PAIRS, render  # noqa: E402

EVIL = '<script>alert("x")</script> \'q\' "d"'


def _lum(h: str) -> float:
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def ratio(fg: str, bg: str) -> float:
    a, b = sorted((_lum(fg), _lum(bg)), reverse=True)
    return (a + 0.05) / (b + 0.05)


def mk(blocks, **kw):
    d = dict(title="T", preheader="pre", blocks=blocks, footer="why")
    d.update(kw)
    return render(**d)


ALL = [("p", EVIL), ("code", EVIL, EVIL), ("mono", EVIL), ("facts", [(EVIL, EVIL)]), ("table", [EVIL], [[EVIL]]),
       ("button", EVIL, "https://example.com/a"), ("note", EVIL)]


@pytest.mark.parametrize("b", ALL)
def test_escaping(b):
    _, html = mk([b], title=EVIL, preheader=EVIL, brand=EVIL, via=EVIL, footer=EVIL, base_url="https://example.com")
    assert "<script" not in html and 'alert("x")' not in html


@pytest.mark.parametrize("u", ["javascript:alert(1)", "data:text/html,x", "https://a.com/x y", 'https://a.com/"x', "ftp://a.com", ""])
def test_bad_urls_refused(u):
    text, html = mk([("button", "Go", u)], base_url=u)
    assert "href=" not in html and "<img" not in html and u not in text or u == ""
    assert "Go" in html


def test_good_url():
    text, html = mk([("button", "Go", "https://example.com/a?b=1&c=2")])
    assert 'href="https://example.com/a?b=1&amp;c=2"' in html and "Go: https://example.com/a?b=1&c=2" in text


def test_long_string_and_code_once():
    long = "x" * 300
    text, html = mk([("p", long), ("code", "482913", "n")])
    assert "word-break:break-word" in html and "overflow-wrap:anywhere" in html
    assert html.count("482913") == 1 and text.count("482913") == 1


def test_mono_block_wraps_long_key_once():
    key = "eyJ" + "A1b2C3." * 40
    text, html = mk([("mono", key)])
    assert "word-break:break-all" in html and "font-size:13px" in html and "user-select:all" in html and "text-align:left" in html
    assert html.count(key) == 1 and text.count(f"\n    {key}\n") == 1


def test_structure_and_logo():
    text, html = mk([], base_url="https://example.com")
    assert '<html lang="en">' in html and 'name="viewport"' in html and "pre" in html and 'role="presentation"' in html
    assert 'src="https://example.com/brand/laris-logo.png"' in html and 'width="32" height="32"' in html and "LARIS" in html
    assert "mso-hide:all" in html and "prefers-color-scheme:dark" in html and "max-width:620px" in html


def test_no_emdash_no_tags_wrapped():
    text, html = mk([("p", "word " * 80), ("facts", [("A", "b")]), ("table", ["H1", "H2"], [["a", "b"]]),
                     ("button", "Go", "https://example.com")], via="via LARIS")
    assert "—" not in text + html
    assert not re.search(r"<[a-z/]", text)
    assert max(len(l) for l in text.splitlines()) <= 72


@pytest.mark.parametrize("mode", ["light", "dark"])
def test_contrast(mode):
    for name, (fg, bg) in PAIRS[mode].items():
        assert ratio(fg, bg) >= 4.5, (mode, name, ratio(fg, bg))


def test_empty_blocks():
    text, html = mk([])
    assert "T" in text and "</html>" in html
