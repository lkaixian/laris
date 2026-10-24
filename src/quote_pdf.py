"""Customer-facing quotation PDF. Selling prices only: nothing here reads cost, margin or supplier data.
render_model() draws a quote_doc.compose() model; render() keeps the old (org, doc, customer, lines) entry point."""
import base64
import io
import logging
import re

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from . import quote_doc

log = logging.getLogger("laris")
LOGO_BOX = (160, 40)  # max width, height in points
WIDTH = 178 * mm  # the A4 frame between 16 mm margins; the line table is exactly this wide
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
    """Two passes so every page can say 'Page x of y'."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._pages = []

    def showPage(self):
        self._pages.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        n = len(self._pages)
        for p in self._pages:
            self.__dict__.update(p)
            self.setFont("Helvetica", 8)
            self.drawRightString(A4[0] - 16 * mm, 10 * mm, f"Page {self._pageNumber} of {n}")
            super().showPage()
        super().save()


def render_model(m: dict) -> bytes:
    st = getSampleStyleSheet()
    body, i, cur = st["BodyText"], m["issuer"], m["currency"]
    bg, fg = _header_colors(i["brand_color"])
    rows = [["#", "Description", "Qty", "Unit", f"Unit price ({cur})", f"Amount ({cur})"]]
    for l in m["lines"]:
        if l["is_header"]:
            rows.append(["", Paragraph(f"<b>{_esc(l['description'])}</b>", body), "", "", "", ""])
        else:
            rows.append([l["no"], Paragraph(_esc(l["description"]), body), f"{l['qty']:f}", l["uom"], f"{l['unit_price']:,.2f}", f"{l['amount']:,.2f}"])
    t = Table(rows, colWidths=[8 * mm, 78 * mm, 16 * mm, 16 * mm, 30 * mm, 30 * mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), bg), ("TEXTCOLOR", (0, 0), (-1, 0), fg),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 1), (-1, -1), 0.25, colors.lightgrey)]))
    tot = [["Subtotal", f"{m['subtotal']:,.2f}"], *([["SST", f"{m['tax_total']:,.2f}"]] if m["tax_total"] is not None else []),
           [f"Total ({cur})", f"{m['total']:,.2f}"]]
    tt = Table(tot, colWidths=[40 * mm, 30 * mm], hAlign="RIGHT")
    tt.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "RIGHT"), ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                            ("LINEABOVE", (0, -1), (-1, -1), 0.5, colors.black)]))
    ids = [f"SSM {i['ssm_no']}" if i["ssm_no"] else "", f"SST {i['sst_no']}" if i["sst_no"] else ""]
    contact = [f"Email {i['email']}" if i["email"] else "", f"Tel {i['phone']}" if i["phone"] else ""]
    block = [Paragraph(_esc(i["name"]), st["Title"]), *([Paragraph(_esc(i["address"]), body)] if i["address"] else []),
             *(Paragraph(_esc(" | ".join(x for x in line if x)), body) for line in (ids, contact) if any(line))]
    logo = _logo(i["logo_url"])
    head = Table([[logo, block]] if logo else [[block]], colWidths=[logo.drawWidth + 6 * mm, WIDTH - logo.drawWidth - 6 * mm] if logo else [WIDTH])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    c = m["customer"]
    who = [f"For: {_esc(c['name'])}", *(_esc(x) for x in (c["attention"] and f"Attn: {c['attention']}", c["address"]) if x),
           f"Issued: {m['issued_on']:%Y-%m-%d}"]
    out = [head, Spacer(1, 3 * mm), Paragraph(f"Quotation {_esc(m['doc_no'])}", st["Heading2"]), Paragraph("<br/>".join(who), body)]
    if m["valid_until"]:
        out.append(Paragraph(f"<b>Valid until: {m['valid_until']}</b>", body))
    out += [Spacer(1, 6 * mm), t, Spacer(1, 3 * mm), tt]
    for label, text in (("Payment terms", m["payment_terms"]), ("Terms", m["terms_text"]), ("Bank details", i["bank_details"])):
        if text:
            out += [Spacer(1, 4 * mm), Paragraph(f"<b>{label}:</b> {_esc(text).replace(chr(10), '<br/>')}", body)]
    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=A4, title=f"Quotation {m['doc_no']}", author=i["name"], leftMargin=16 * mm, rightMargin=16 * mm).build(out, canvasmaker=_Numbered)
    return buf.getvalue()


def render(org: dict, doc: dict, customer: str, lines: list[dict]) -> bytes:
    return render_model(quote_doc.compose(org, doc, customer, lines))
