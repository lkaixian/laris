"""Step 0 of the order chain: layout specs (src/doc_layout.py) and the one renderer (src/quote_pdf.render). No database, no network."""
import copy
import io
from datetime import date, datetime
from decimal import Decimal

import pytest
from pypdf import PdfReader

from src import doc_layout as dl
from src import quote_doc, quote_pdf

ORG = {"name": "Kedai Cetak 华美 தமிழ்", "address": "1 Jalan Test\nKuala Lumpur", "ssm_no": "123", "sst_registered": False, "sst_no": None,
       "bank_details": "Maybank 5140 1234", "issuer_email": "a@b.co", "issuer_phone": "012"}
DOC = {"doc_no": "QT-2026-0001", "status": "sent", "issued_on": date(2026, 10, 31), "created_at": datetime(2026, 10, 31), "valid_until": date(2026, 11, 30),
       "currency": "MYR", "payment_terms": "50% deposit", "terms_text": "Warranty 1 year"}
LINES = [{"is_header": True, "description": "Signboards", "line_no": None},
         {"is_header": False, "line_no": 1, "description": "Papan tanda akrilik 亚克力招牌 பலகை", "qty": Decimal(40), "uom": "pcs",
          "unit_price": Decimal("60"), "discount_pct": None, "tax_rate": None}]
CUSTOMERS = {"en": "Lim Cafe", "ms": "Kedai Kopi Ahmad bin Ali", "zh": "林记咖啡店", "ta": "முருகன் உணவகம்"}
EXTRA = {"deposit": {"pct": Decimal(50), "amount": Decimal("1200"), "paid": Decimal("1200")}, "balance_due": Decimal("1200"),
         "due_on": date(2026, 11, 30), "payment": {"amount": Decimal("1200"), "method": "DuitNow", "reference": "REF123", "for": "deposit"},
         "signature": {"name": "Ali", "at": datetime(2026, 11, 1, 10, 30)}}


def model(lang="en", sst=False, **kw):
    lines = [{**l, "tax_rate": Decimal(6)} if not l["is_header"] else l for l in LINES]  # a rate on the line: only then is there an SST line
    m = quote_doc.compose({**ORG, "sst_registered": sst, "sst_no": "W10-1" if sst else None}, DOC, CUSTOMERS[lang], lines)
    return {**m, **EXTRA, **kw}


def text(pdf: bytes) -> str:
    return "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(pdf)).pages)


def bad(**kw):
    with pytest.raises(ValueError):
        dl.validate({**dl.default_spec("invoice"), **kw})


def test_every_kind_renders_a_pdf_in_every_language_with_zh_ta_ms_text():
    for kind in dl.KINDS:
        for lang in dl.LANGS:
            pdf = quote_pdf.render(kind, model(lang), lang=lang)
            assert pdf[:5] == b"%PDF-", (kind, lang)
            t = text(pdf)
            if lang != "ta":  # shaped Tamil (uharfbuzz) has no text layer to read back; it is checked by eye, see the build log
                assert dl.title(dl.default_spec(kind), lang, False) in t and CUSTOMERS[lang] in t or kind == "receipt" and CUSTOMERS[lang] in t, (kind, lang)
            assert "QT-2026-0001" in t, (kind, lang)
    t = text(quote_pdf.render("quotation", model("zh"), lang="zh"))
    assert "亚克力招牌" in t and "华美" in t and "Papan tanda" in t  # Chinese, Malay and Latin on one line: per-character font fallback
    assert "Jumlah kecil" in text(quote_pdf.render("quotation", model("ms"), lang="ms")) and "小计" in t


def test_a_glyph_no_font_has_never_fails_the_render():
    m = model()
    m["customer"] = {**m["customer"], "name": "Nama \U0001F600 กข ال � Ω"}  # emoji, Thai, Arabic: in no bundled font
    for lang in dl.LANGS:
        assert quote_pdf.render("invoice", m, lang=lang)[:5] == b"%PDF-"


def test_old_entry_points_still_draw_the_quotation():
    org = {**ORG, "sst_registered": False}
    a, b = quote_pdf.render(org, DOC, "Lim Cafe", LINES), quote_pdf.render_model(quote_doc.compose(org, DOC, "Lim Cafe", LINES))
    assert a[:5] == b"%PDF-" and text(a) == text(b) and "Quotation QT-2026-0001" in text(a)


def test_delivery_order_has_no_prices_by_default_and_shows_them_when_switched_on():
    m = model()
    t = text(quote_pdf.render("delivery_order", m))
    assert "Delivery Order" in t and "received in good order" in t and "Signature" in t and "Company chop" in t and "Papan tanda" in t
    assert not any(w in t for w in ("60.00", "2,400.00", "Unit price", "Amount", "Subtotal", "Total"))
    t = text(quote_pdf.render("delivery_order", m, {"show_prices": True}))
    assert "60.00" in t and "2,400.00" in t and "Unit price" in t and "Subtotal" in t


def test_kind_specific_wording():
    pf = text(quote_pdf.render("proforma", model(sst=True)))
    assert "not a tax invoice" in pf and "SST (estimate)" in pf and "Deposit due (50%)" in pf and "1,200.00" in pf
    assert "SST shown is an estimate" not in text(quote_pdf.render("proforma", model()))  # not registered: no SST wording
    assert "Tax Invoice" in text(quote_pdf.render("invoice", model(sst=True)))
    inv = text(quote_pdf.render("invoice", model()))
    assert "Invoice QT" in inv and "Tax Invoice" not in inv and "Deposit paid" in inv and "Balance due" in inv and "Due date: 2026-11-30" in inv
    rc = text(quote_pdf.render("receipt", model()))
    assert "Amount received" in rc and "DuitNow" in rc and "REF123" in rc and "Balance" in rc and "Deposit receipt, not a tax invoice" in rc


def test_blocks_are_drawn_in_spec_order_and_left_out_when_absent():
    m = model()
    t = text(quote_pdf.render("quotation", m, {"blocks": ["bank", "header"]}))
    assert t.index("Bank details") < t.index("Kedai Cetak") and "Subtotal" not in t and "Papan" not in t
    for style in dl.STYLES:
        assert quote_pdf.render("quotation", m, {"style": style, "font_size": 12, "footer_text": "Thank you\nTerima kasih"})[:5] == b"%PDF-"


def test_render_still_has_the_selling_price_and_no_cost_words():
    t = text(quote_pdf.render_model(model())).lower()
    assert "2,400.00" in t and "60.00" in t and not any(w in t for w in ("cost", "margin", "supplier", "1500", "1,500", "37.5"))


def test_validate_rejects_anything_outside_the_allowed_set():
    for k in dl.KINDS:
        assert dl.validate(dl.default_spec(k)) == dl.default_spec(k)
    bad(blocks=["header", "script"])
    bad(blocks=["header", "header"])
    bad(blocks="header")
    bad(columns=["no", "cost"])
    bad(columns=["margin"])
    bad(style="neon")
    bad(paper="A0")
    bad(font_size=500)
    bad(font_size=2)
    bad(font_size="10")
    bad(font_size=True)
    bad(show_prices="yes")
    bad(show_prices=1)
    bad(kind="statement")
    bad(title={"en": "x", "fr": "y"})
    bad(title={"en": ""})
    bad(title={"en": "x" * 61})
    bad(title="Invoice")
    bad(title_sst={"en": "a\x00b"})
    bad(labels={"cost": {"en": "Cost"}})
    bad(labels={"qty": {"en": "x" * 31}})
    bad(labels={"qty": {"xx": "Pcs"}})
    bad(footer_text="x" * 301)
    bad(footer_text=5)
    bad(logo_url="http://evil.test/x.png")  # unknown key
    bad(font_size=float("nan"))
    with pytest.raises(ValueError):
        dl.validate({k: v for k, v in dl.default_spec("invoice").items() if k != "blocks"})
    with pytest.raises(ValueError):
        dl.validate("not a dict")
    with pytest.raises(ValueError):
        dl.default_spec("nope")
    with pytest.raises(ValueError):  # and the renderer enforces it: a bad override never reaches the drawing code
        quote_pdf.render("invoice", model(), {"blocks": ["header", "cost"]})
    with pytest.raises(ValueError):
        quote_pdf.render("invoice", model(), lang="fr")


def test_merge_keeps_defaults_for_untouched_keys_and_never_mutates_them():
    d = dl.default_spec("invoice")
    before = copy.deepcopy(d)
    out = dl.merge(d, {"title": {"ms": "Bil"}, "labels": {"qty": {"en": "Pcs"}}, "style": "band"})
    assert d == before
    assert out["title"] == {**d["title"], "ms": "Bil"} and out["style"] == "band"
    assert out["blocks"] == d["blocks"] and out["columns"] == d["columns"] and out["font_size"] == d["font_size"] and out["title_sst"] == d["title_sst"]
    assert dl.label(out, "qty", "en") == "Pcs" and dl.label(out, "qty", "ms") == "Kuantiti"
    again = dl.merge(d, {"labels": {"qty": {"ms": "Biji"}}})
    assert dl.merge(again, {"labels": {"qty": {"en": "Pcs"}}})["labels"]["qty"] == {"ms": "Biji", "en": "Pcs"}
    assert dl.merge(d, None) == d and dl.merge(d, {}) == d
    for o in ({"kind": "receipt"}, {"blocks": ["nope"]}, {"extra": 1}, {"title": "x"}, "x"):
        with pytest.raises(ValueError):
            dl.merge(d, o)


def test_default_wording_exists_in_all_four_languages():
    assert all(set(v) == set(dl.LANGS) for v in [*dl.WORDS.values(), *dl.LABELS.values()])
    assert all(set(s["title"]) == set(dl.LANGS) for s in dl.DEFAULTS.values())
    assert dl.DEFAULTS["delivery_order"]["show_prices"] is False and all(s["show_prices"] for k, s in dl.DEFAULTS.items() if k != "delivery_order")
