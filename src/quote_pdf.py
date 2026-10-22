"""Customer-facing quotation PDF. Selling prices only: nothing here reads cost, margin or supplier data."""
import io
from decimal import Decimal

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .pricing import _q


def _esc(s) -> str:
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def render(org: str, doc: dict, customer: str, lines: list[dict]) -> bytes:
    st = getSampleStyleSheet()
    cur = doc["currency"]
    rows, total = [["#", "Description", "Qty", "Unit", f"Unit price ({cur})", f"Amount ({cur})"]], Decimal(0)
    for l in lines:
        if l["is_header"]:
            rows.append(["", Paragraph(f"<b>{_esc(l['description'])}</b>", st["BodyText"]), "", "", "", ""])
            continue
        amt = _q(l["qty"] * l["unit_price"] * (1 - (l["discount_pct"] or 0) / Decimal(100)))
        total += amt
        rows.append([l["line_no"], Paragraph(_esc(l["description"]), st["BodyText"]), f"{l['qty']:f}".rstrip("0").rstrip("."),
                     l["uom"], f"{l['unit_price']:,.2f}", f"{amt:,.2f}"])
    rows.append(["", "", "", "", "Total", f"{total:,.2f}"])
    t = Table(rows, colWidths=[8 * mm, 78 * mm, 16 * mm, 16 * mm, 30 * mm, 30 * mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f6f4a")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 1), (-1, -2), 0.25, colors.lightgrey), ("FONTNAME", (4, -1), (-1, -1), "Helvetica-Bold")]))
    out = [Paragraph(_esc(org), st["Title"]), Paragraph(f"Quotation {_esc(doc['doc_no'])}", st["Heading2"]),
           Paragraph(f"For: {_esc(customer)}<br/>Issued: {doc['issued_on'] or doc['created_at']:%Y-%m-%d}"
                     + (f"<br/>Valid until: {doc['valid_until']}" if doc["valid_until"] else ""), st["BodyText"]),
           Spacer(1, 6 * mm), t]
    for label, key in (("Payment terms", "payment_terms"), ("Notes", "terms_text")):
        if doc.get(key):
            out += [Spacer(1, 4 * mm), Paragraph(f"<b>{label}:</b> {_esc(doc[key])}", st["BodyText"])]
    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=A4, title=f"Quotation {doc['doc_no']}", author=org).build(out)
    return buf.getvalue()
