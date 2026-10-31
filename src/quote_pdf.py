"""Customer-facing document PDFs (quotation, proforma, delivery order, invoice, receipt). Selling prices only: nothing here reads cost, margin or
supplier data. render(kind, model, layout, lang) draws a quote_doc.compose() model block by block from a doc_layout spec; render_model() is the
quotation, and the old (org, doc, customer, lines) call still works."""
import base64
import functools
import io
import logging
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from . import doc_layout, quote_doc

log = logging.getLogger("laris")
LOGO_BOX = (160, 40)  # max width, height in points
WIDTH = 178 * mm  # the A4 frame between 16 mm margins; the line table is exactly this wide
FONTS = Path(__file__).parent / "fonts"  # Noto Sans SC and Tamil; see README.md there
WEB_FONTS = Path(__file__).parent.parent / "web" / "public" / "fonts"  # Ubuntu, already self-hosted for the web
COLW = {"no": 8, "qty": 16, "uom": 16, "unit_price": 30, "discount": 18, "amount": 30}  # mm; description takes the rest of WIDTH
RIGHT = {"qty", "uom", "unit_price", "discount", "amount"}
LOGO_MAX_PIXELS = 16_000_000  # decoded size cap: a small file can still unpack into a huge bitmap


def _esc(s) -> str:
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _logo(url):
    """A reportlab Image from a stored data URL, scaled into LOGO_BOX with its aspect kept, or None. Never raises."""
    m = re.fullmatch(r"data:image/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})", url or "")
    if not m:
        return None
    try:
        from PIL import Image as PIL
        im = PIL.open(io.BytesIO(base64.b64decode(m.group(1), validate=True)))
        w, h = im.size
        if not (0 < w * h <= LOGO_MAX_PIXELS):
            return None
        im.thumbnail((LOGO_BOX[0] * 4, LOGO_BOX[1] * 4))  # plenty for print, keeps the PDF small
        buf = io.BytesIO()
        im.convert("RGBA").save(buf, "PNG")
        k = min(LOGO_BOX[0] / w, LOGO_BOX[1] / h)
        return Image(io.BytesIO(buf.getvalue()), width=w * k, height=h * k)
    except Exception as e:  # corrupt, truncated, unsupported: the quote still goes out without it
        log.warning("quote logo skipped: %s", type(e).__name__)
        return None


def _header_colors(hexcolor):
    """(background, text): the tenant colour, else the default; text black or white by luminance."""
    try:
        bg = colors.HexColor(hexcolor)
    except Exception:
        bg = colors.HexColor(quote_doc.DEFAULT_COLOR)
    return bg, colors.black if 0.299 * bg.red + 0.587 * bg.green + 0.114 * bg.blue > 0.5 else colors.white


class _Numbered(Canvas):
    """Two passes so every page can say 'Page x of y'. footer(page, pages) -> a Paragraph."""

    def __init__(self, *a, footer, **k):
        super().__init__(*a, **k)
        self._pages, self._footer = [], footer

    def showPage(self):
        self._pages.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        n = len(self._pages)
        for p in self._pages:
            self.__dict__.update(p)
            para = self._footer(self._pageNumber, n)
            para.wrapOn(self, 60 * mm, 10 * mm)
            para.drawOn(self, A4[0] - 76 * mm, 10 * mm)
            super().showPage()
        super().save()


@functools.cache
def _fonts() -> list[str]:
    """Register the PDF fonts once: Ubuntu (Latin, Malay), Noto Sans SC (zh, a GB2312 subset), Noto Sans Tamil. Names in fallback order."""
    for name, path in (("Ubuntu", WEB_FONTS / "ubuntu-400.ttf"), ("Ubuntu-Bold", WEB_FONTS / "ubuntu-700.ttf"),
                       ("NotoSansSC", FONTS / "NotoSansSC-Regular.ttf"), ("NotoSansTamil", FONTS / "NotoSansTamil-Regular.ttf")):
        pdfmetrics.registerFont(TTFont(name, str(path)))
    registerFontFamily("Ubuntu", normal="Ubuntu", bold="Ubuntu-Bold", italic="Ubuntu", boldItalic="Ubuntu-Bold")
    for n in ("NotoSansSC", "NotoSansTamil"):  # one weight only: bold falls back to regular
        registerFontFamily(n, normal=n, bold=n, italic=n, boldItalic=n)
    return ["Ubuntu", "NotoSansSC", "NotoSansTamil"]


def _base(lang: str) -> str:
    return {"zh": "NotoSansSC", "ta": "NotoSansTamil"}.get(lang, "Ubuntu")


def _rich(text, lang: str) -> str:
    """Escaped Paragraph markup, each character in the first font that has it (the language's own first), so a Chinese name on an English
    quote still prints. A character no font has stays in the base font as a blank box: it never fails the render."""
    base, chain = _base(lang), [_base(lang), *_fonts()]
    out, cur = [], base
    for ch in str(text or ""):
        if ch == "\n":
            out.append("<br/>")
            continue
        f = next((n for n in chain if ord(ch) in pdfmetrics.getFont(n).face.charToGlyph), base)
        if f != cur:
            out.append(("</font>" if cur != base else "") + (f'<font name="{f}">' if f != base else ""))
            cur = f
        out.append(_esc(ch))
    return "".join(out) + ("</font>" if cur != base else "")


def render_model(m: dict) -> bytes:
    return render("quotation", m)


def render(kind, model=None, layout=None, lang="en", *old) -> bytes:
    """The customer PDF of `model` (a quote_doc.compose() dict) as document `kind`, blocks drawn in the order of the layout spec: the kind's
    default with `layout` (an override or a whole spec) merged on top and validated. Selling prices only. Optional model keys for the later
    kinds: deposit {pct, amount, paid}, balance_due, due_on, payment {amount, method, reference, for: deposit|balance}, signature {name, at}.
    The old call render(org, doc, customer, lines) still draws a quotation."""
    if isinstance(kind, dict):
        return render_model(quote_doc.compose(kind, model, layout, lang))
    if lang not in doc_layout.LANGS:
        raise ValueError(f"unknown document language: {lang!r}")
    sp = doc_layout.merge(doc_layout.default_spec(kind), layout)
    m, i, cur, size = model, model["issuer"], model["currency"], sp["font_size"]
    sst, prices, band = bool(i.get("sst_registered") or i.get("sst_no")), sp["show_prices"], sp["style"] == "band"
    bg, fg = _header_colors(i["brand_color"])
    w = lambda k: doc_layout.WORDS[k][lang]
    body = ParagraphStyle("body", fontName=_base(lang), fontSize=size, leading=size * 1.25, shaping=1)  # shaping needs uharfbuzz; without it Tamil vowel signs land in the wrong place
    small, right = body.clone("small", fontSize=size - 1, leading=size * 1.15), body.clone("right", alignment=TA_RIGHT)
    right_small = small.clone("rs", alignment=TA_RIGHT, fontSize=8)
    P = lambda t, st=body, b=False: Paragraph(f"<b>{_rich(t, lang)}</b>" if b else _rich(t, lang), st)
    L = lambda label, text: Paragraph(f"<b>{_rich(label, lang)}:</b> {_rich(text, lang)}", body)
    money = lambda x: f"{x:,.2f}"

    def header():
        st = body.clone("hb", textColor=fg) if band else body
        name = body.clone("name", fontSize=size * 1.8, leading=size * 2.2, textColor=st.textColor, alignment=TA_CENTER)
        ids = [f"SSM {i['ssm_no']}" if i["ssm_no"] else "", f"SST {i['sst_no']}" if i["sst_no"] else ""]
        contact = [f"{w('email')} {i['email']}" if i["email"] else "", f"{w('tel')} {i['phone']}" if i["phone"] else ""]
        block = [P(i["name"], name, True), *([P(i["address"], st)] if i["address"] else []),
                 *(P(" | ".join(x for x in line if x), st) for line in (ids, contact) if any(line))]
        logo = _logo(i["logo_url"])
        if sp["style"] == "classic":  # centred, one rule underneath
            t = Table([[x] for x in ([logo] if logo else []) + block], colWidths=[WIDTH])
            t.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER"), ("LINEBELOW", (0, -1), (-1, -1), 1, colors.black)]))
            return [t]
        t = Table([[logo, block]] if logo else [[block]], colWidths=[logo.drawWidth + 6 * mm, WIDTH - logo.drawWidth - 6 * mm] if logo else [WIDTH])
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 6 if band else 0),
                               *([("BACKGROUND", (0, 0), (-1, -1), bg), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)] if band else [])]))
        return [t]

    def meta():
        pay = m.get("payment") or {}
        notes = ([w("not_tax")] + ([w("sst_note")] if sst else []) if kind == "proforma"
                 else [w("deposit_note")] if kind == "receipt" and pay.get("for") == "deposit" else [])
        out = [Spacer(1, 3 * mm), P(f"{doc_layout.title(sp, lang, sst)} {m['doc_no']}", body.clone("h2", fontSize=size * 1.5, leading=size * 1.9), True),
               *(P(n, small) for n in notes), P(f"{w('issued')}: {m['issued_on']:%Y-%m-%d}")]
        if kind in ("quotation", "proforma") and m["valid_until"]:
            out.append(P(f"{w('valid')}: {m['valid_until']}", body, True))
        if kind == "invoice" and m.get("due_on"):
            out.append(P(f"{w('due')}: {m['due_on']}", body, True))
        return out

    def parties():
        c = m["customer"]
        return [P("\n".join([f"{w('for')}: {c['name']}", *(x for x in (c["attention"] and f"{w('attn')}: {c['attention']}", c["address"]) if x)]))]

    def lines():
        cols = [c for c in sp["columns"] if prices or c not in doc_layout.PRICE_COLS]
        if not cols:
            return []
        hd = body.clone("hd", textColor=colors.black if sp["style"] == "classic" else fg)
        lab = lambda c: doc_layout.label(sp, c, lang) + (f" ({cur})" if c in ("unit_price", "amount") else "")
        rows = [[P(lab(c), hd.clone(f"h{c}", alignment=TA_RIGHT if c in RIGHT else TA_LEFT), True) for c in cols]]
        for l in m["lines"]:
            if l["is_header"]:
                rows.append([P(l["description"], body, True) if c == "description" else "" for c in cols])
                continue
            v = {"no": l["no"], "description": l["description"], "qty": f"{l['qty']:f}", "uom": l["uom"],
                 "unit_price": money(l["unit_price"]) if l["unit_price"] is not None else "",
                 "discount": f"{l['discount_pct']:g}%" if l["discount_pct"] else "", "amount": money(l["amount"])}
            rows.append([P(v[c], right if c in RIGHT else body) for c in cols])
        ws = [COLW[c] * mm if c in COLW else WIDTH - sum(COLW[x] for x in cols if x in COLW) * mm for c in cols]
        t = Table(rows, colWidths=ws, repeatRows=1)
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 1), (-1, -1), 0.25, colors.lightgrey),
                               *([("LINEBELOW", (0, 0), (-1, 0), 1, colors.black)] if sp["style"] == "classic" else [("BACKGROUND", (0, 0), (-1, 0), bg)])]))
        return [Spacer(1, 6 * mm), t, Spacer(1, 3 * mm)]

    def box(rows):  # label / amount pairs, the last one ruled off
        t = Table([[P(a), P(b, right)] for a, b in rows], colWidths=[40 * mm, 30 * mm], hAlign="RIGHT")
        t.setStyle(TableStyle([("LINEABOVE", (0, -1), (-1, -1), 0.5, colors.black)]))
        return t

    def totals():
        est = kind == "proforma" and sst
        return [box([(w("subtotal"), money(m["subtotal"])), *([(w("sst_est") if est else "SST", money(m["tax_total"]))] if m["tax_total"] is not None else []),
                     (f"{w('total')} ({cur})", money(m["total"]))])] if prices else []

    def deposit():  # the money box: proforma = deposit due; invoice = deposit paid and balance due; receipt = what was received
        d, pay, bal, rows = m.get("deposit") or {}, m.get("payment") or {}, m.get("balance_due"), []
        if kind == "proforma" and d.get("amount") is not None:
            rows.append((w("deposit_due") + (f" ({d['pct']:g}%)" if d.get("pct") else ""), money(d["amount"])))
        if kind == "invoice" and d.get("paid"):
            rows.append((w("deposit_paid"), money(d["paid"])))
        if kind == "receipt":
            f = pay.get("for")
            rows += [(w("pay_for"), w("pay_for_" + f) if f in ("deposit", "balance") else str(f))] if f else []
            rows += [(w(k), str(pay[k])) for k in ("method", "reference") if pay.get(k)]
            rows += [(w("received"), money(pay["amount"]))] if pay.get("amount") is not None else []
        if kind in ("invoice", "receipt") and bal is not None:
            rows.append((w("balance_due" if kind == "invoice" else "balance"), money(bal)))
        if not rows or not prices:
            return []
        return [Spacer(1, 3 * mm), box(rows), *([P(w("paid"), right, True)] if kind == "receipt" and bal is not None and not bal else [])]

    def terms():
        return [y for label, text in (("pterms", m["payment_terms"]), ("terms", m["terms_text"])) if text for y in (Spacer(1, 4 * mm), L(w(label), text))]

    def bank():
        return [Spacer(1, 4 * mm), L(w("bank"), i["bank_details"])] if i["bank_details"] else []

    def signature():
        s = m.get("signature") or {}
        cell = lambda k, v: [P(w(k), small), P(v or " ")]
        t = Table([[cell("sig_name", s.get("name")), cell("sig_sign", None), cell("sig_date", s.get("at") and f"{s['at']:%Y-%m-%d %H:%M}")]],
                  colWidths=[WIDTH * .38, WIDTH * .32, WIDTH * .30], rowHeights=[22 * mm])
        t.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 0.5, colors.black), ("VALIGN", (0, 0), (-1, -1), "BOTTOM")]))
        return [Spacer(1, 6 * mm), KeepTogether([*([P(w("good_order"), body, True), Spacer(1, 2 * mm)] if kind == "delivery_order" else []), t])]

    def chop():
        t = Table([[P(w("chop"), small)]], colWidths=[50 * mm], rowHeights=[28 * mm], hAlign="LEFT")
        t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, colors.grey, None, (3, 3)), ("VALIGN", (0, 0), (-1, -1), "BOTTOM")]))
        return [Spacer(1, 4 * mm), t]

    def footer():
        return [Spacer(1, 6 * mm), P(sp["footer_text"], body.clone("ft", alignment=TA_CENTER))] if sp.get("footer_text") else []

    draw = dict(header=header, meta=meta, parties=parties, lines=lines, totals=totals, deposit=deposit, terms=terms, bank=bank,
                signature=signature, chop=chop, footer=footer)
    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=A4, title=f"{doc_layout.title(sp, lang, sst)} {m['doc_no']}", author=i["name"], leftMargin=16 * mm,
                      rightMargin=16 * mm).build([x for b in sp["blocks"] for x in draw[b]()],
                                                 canvasmaker=lambda *a, **k: _Numbered(*a, footer=lambda n, t: P(w("page").format(n, t), right_small), **k))
    return buf.getvalue()


def table_pdf(title: str, subtitle: str, head: list[str], rows: list[list]) -> bytes:
    """A plain landscape A4 table (the activity log export). Every cell is escaped text; long text wraps inside its column."""
    from reportlab.lib.pagesizes import landscape
    buf = io.BytesIO()
    pdf = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=12 * mm, rightMargin=12 * mm, topMargin=12 * mm, bottomMargin=12 * mm,
                            title=title)
    st = getSampleStyleSheet()
    cell = st["BodyText"].clone("cell", fontSize=8, leading=10)
    data = [[Paragraph(f"<b>{_esc(h)}</b>", cell) for h in head]] + [[Paragraph(_esc(v), cell) for v in r] for r in rows]
    t = Table(data, colWidths=[16 * mm, 30 * mm, 40 * mm, 32 * mm, 20 * mm, None], repeatRows=1)
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, 0), 0.8, colors.HexColor("#0f5c47")),
                           ("LINEBELOW", (0, 1), (-1, -1), 0.25, colors.HexColor("#d5e0d9")), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e1f0e8"))]))
    pdf.build([Paragraph(_esc(title), st["Title"]), Paragraph(_esc(subtitle), st["Normal"]), Spacer(1, 4 * mm), t])
    return buf.getvalue()
