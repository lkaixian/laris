"""The owner's own Word template for a document: check an upload, fill it with an order's figures, and build a starter file to edit.
Kept free of the database and of any Word library so it can be tested alone: a .docx is a zip of XML, and only its text is touched.

A template is an ordinary .docx with {{placeholders}} typed where the figures go, for example {{doc_no}} or {{customer_name}}. A table row that
holds {{line.description}} (or any other {{line.*}}) is repeated once per item. Anything else in the file (logo, letterhead, fonts, layout) is
copied through unchanged. A placeholder LARIS does not know is left as typed, so a typo is visible instead of silently blank.
Safe by construction: macro files, embedded objects and remote templates are refused, the zip is size-checked before it is read, and every XML
part goes through defusedxml (no DTDs, no entity tricks) before and after filling."""
import io
import re
import zipfile
from xml.sax.saxutils import escape, unescape

from defusedxml import ElementTree as safe_xml

STAGES = ("purchase_order", "sales_order", "proforma", "delivery_order", "invoice", "receipt")
MAX_BYTES = 2_000_000          # the upload; the database holds the same limit
MAX_ENTRIES, MAX_UNPACKED = 300, 25_000_000
LINE_FIELDS = ("no", "description", "qty", "uom", "unit_price", "amount")
# name -> what it prints; this is also the help shown on the Admin page
FIELDS = {
    "doc_no": "Document number", "doc_type": "Document title, e.g. Invoice", "date": "Date issued (dd/mm/yyyy)", "due_date": "Payment due date (invoice)",
    "reference": "The customer's own PO number, when there is one", "status": "Document status",
    "customer_name": "Customer name", "customer_attention": "Customer contact person", "customer_address": "Customer address", "customer_email": "Customer email",
    "company_name": "Your business name", "company_address": "Your address", "company_ssm": "Your SSM number", "company_sst": "Your SST number",
    "company_email": "Your email", "company_phone": "Your phone", "bank_details": "Your bank details",
    "currency": "Currency, e.g. RM", "subtotal": "Total before tax", "tax": "SST amount", "total": "Total to pay",
    "payment_terms": "Payment terms", "terms": "Terms and conditions",
    "deposit_percent": "Deposit % (proforma)", "deposit_amount": "Deposit amount (proforma)", "deposit_paid": "Deposit already paid (invoice)", "balance_due": "Balance still to pay",
    "amount_paid": "Amount received (receipt)", "payment_method": "How it was paid (receipt)", "payment_reference": "Payment reference (receipt)",
    "signed_by": "Name of the person who signed for the goods (delivery order)", "signed_at": "When they signed (delivery order)",
    **{f"line.{k}": f"Each item: {k.replace('_', ' ')}" for k in LINE_FIELDS},
}
TOKEN = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}")
PART = re.compile(r"^word/(document|header\d*|footer\d*)\.xml$")
PARA = re.compile(r"<w:p[ >].*?</w:p>", re.S)
ROW = re.compile(r"<w:tr[ >].*?</w:tr>", re.S)
RUN_TEXT = re.compile(r"<w:t(?:\s[^>]*)?>(.*?)</w:t>", re.S)
BAD_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


class TemplateError(ValueError):
    """The file cannot be used as a template; the message says why, in words an owner can act on."""


def _zip(data: bytes) -> zipfile.ZipFile:
    if not data or len(data) > MAX_BYTES:
        raise TemplateError(f"the file must be a Word (.docx) file under {MAX_BYTES // 1_000_000} MB")
    if not zipfile.is_zipfile(io.BytesIO(data)):
        raise TemplateError("this is not a Word (.docx) file; save the template as .docx and try again")
    z = zipfile.ZipFile(io.BytesIO(data))
    infos = z.infolist()
    if len(infos) > MAX_ENTRIES or sum(i.file_size for i in infos) > MAX_UNPACKED:
        raise TemplateError("the file is too large or has too many parts to be a document template")
    names = {i.filename for i in infos}
    for n in names:
        if n.startswith("/") or "\\" in n or ".." in n.split("/"):
            raise TemplateError("the file has an unsafe part name")
        if "vbaProject" in n or n.startswith("word/embeddings/") or n.endswith(".bin") and "vba" in n.lower():
            raise TemplateError("the template has macros or embedded objects; save a plain .docx (not .docm) without them")
    if "[Content_Types].xml" not in names or "word/document.xml" not in names:
        raise TemplateError("this is not a Word (.docx) file; save the template as .docx and try again")
    return z


def _read(z: zipfile.ZipFile, name: str) -> str:
    try:
        return z.read(name).decode("utf-8")
    except UnicodeDecodeError:
        raise TemplateError("a part of the file is not valid text") from None


def _safe(xml: str, what: str) -> None:
    try:
        safe_xml.fromstring(xml.encode("utf-8"))
    except Exception:
        raise TemplateError(f"the file's {what} is damaged or uses something LARIS does not allow") from None


def _para_text(p: str) -> str:
    return "".join(unescape(t) for t in RUN_TEXT.findall(p))


def _is_line_row(row: str) -> bool:
    """A table row that prints the items: any paragraph in it holds a {{line.*}} placeholder (even when Word split the text over several runs)."""
    return any(TOKEN.search(_para_text(p)) and any(k.startswith("line.") for k in TOKEN.findall(_para_text(p))) for p in PARA.findall(row))


def check(data: bytes) -> dict:
    """Validate an upload. -> {placeholders: [...], unknown: [...], repeats_lines: bool}. Raises TemplateError."""
    z = _zip(data)
    if "macroEnabled" in _read(z, "[Content_Types].xml"):
        raise TemplateError("the template has macros; save a plain .docx (not .docm)")
    for n in z.namelist():
        if n.endswith(".rels"):
            rels = _read(z, n)
            if re.search(r'Type="[^"]*(attachedTemplate|oleObject|externalLink|frame)"', rels):
                raise TemplateError("the template points at another file or an embedded object; save a plain .docx")
    found, repeats = set(), False
    for n in z.namelist():
        if PART.match(n):
            xml = _read(z, n)
            _safe(xml, "text")
            for p in PARA.findall(xml):
                found.update(TOKEN.findall(_para_text(p)))
            repeats = repeats or any(_is_line_row(r) for r in ROW.findall(xml))
    return {"placeholders": sorted(found), "unknown": sorted(k for k in found if k not in FIELDS), "repeats_lines": repeats}


def _clean(v) -> str:
    return BAD_CHARS.sub("", "" if v is None else str(v))


def _fill_paragraphs(xml: str, values: dict[str, str]) -> str:
    def one(m: re.Match) -> str:
        p = m.group(0)
        runs = list(RUN_TEXT.finditer(p))
        if not runs:
            return p
        text = "".join(unescape(r.group(1)) for r in runs)
        if "{{" not in text:
            return p
        new = TOKEN.sub(lambda t: _clean(values[t.group(1)]) if t.group(1) in values else t.group(0), text)
        body = escape(new).replace("\n", '</w:t><w:br/><w:t xml:space="preserve">')
        seen = []

        def put(r: re.Match) -> str:
            seen.append(1)
            return f'<w:t xml:space="preserve">{body}</w:t>' if len(seen) == 1 else "<w:t></w:t>"
        return RUN_TEXT.sub(put, p)
    return PARA.sub(one, xml)


def _fill_part(xml: str, values: dict[str, str], lines: list[dict[str, str]]) -> str:
    def row(m: re.Match) -> str:
        r = m.group(0)
        if not _is_line_row(r):
            return r
        return "".join(_fill_paragraphs(r, {**values, **{f"line.{k}": v for k, v in ln.items()}}) for ln in lines)
    out = _fill_paragraphs(ROW.sub(row, xml), values)
    _safe(out, "text after filling")
    return out


def fill(data: bytes, values: dict[str, str], lines: list[dict[str, str]]) -> bytes:
    """The template with every known {{placeholder}} replaced; {{line.*}} rows repeat once per line. Returns a .docx."""
    z = _zip(data)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as w:
        for info in z.infolist():
            raw = z.read(info.filename)
            if PART.match(info.filename):
                raw = _fill_part(raw.decode("utf-8"), values, lines).encode("utf-8")
            w.writestr(info.filename, raw)
    return out.getvalue()


# ---------------------------------------------------------------- the starter file
def _p(text: str, bold=False, size: int | None = None, right=False) -> str:
    rpr = ("<w:b/>" if bold else "") + (f'<w:sz w:val="{size * 2}"/>' if size else "")
    ppr = '<w:pPr><w:jc w:val="right"/></w:pPr>' if right else ""
    return f'<w:p>{ppr}<w:r>{"<w:rPr>" + rpr + "</w:rPr>" if rpr else ""}<w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>'


def _tc(text: str, w: int, bold=False, right=False) -> str:
    return f'<w:tc><w:tcPr><w:tcW w:w="{w}" w:type="dxa"/></w:tcPr>{_p(text, bold, right=right)}</w:tc>'


def _table(rows: list[list[str]], widths: list[int], header=True) -> str:
    border = "".join(f'<w:{s} w:val="single" w:sz="4" w:space="0" w:color="999999"/>' for s in ("top", "left", "bottom", "right", "insideH", "insideV"))
    body = "".join("<w:tr>" + "".join(_tc(c, widths[i], bold=header and n == 0, right=i >= 2 and n >= 0 and widths[i] < 1500) for i, c in enumerate(r)) + "</w:tr>" for n, r in enumerate(rows))
    return f'<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>{border}</w:tblBorders></w:tblPr>{body}</w:tbl>'


_TITLES = {"purchase_order": "Purchase Order", "sales_order": "Sales Order", "proforma": "Proforma Invoice", "delivery_order": "Delivery Order", "invoice": "Invoice", "receipt": "Receipt"}


def starter(stage: str) -> bytes:
    """A ready-to-edit .docx for the stage, already carrying the right placeholders, so an owner can restyle it in Word and upload it back."""
    if stage not in STAGES:
        raise TemplateError("unknown document type")
    priced = stage != "delivery_order"
    body = [_p("{{company_name}}", bold=True, size=16), _p("{{company_address}}"), _p("SSM {{company_ssm}}   {{company_email}}   {{company_phone}}"),
            _p(_TITLES[stage].upper(), bold=True, size=20), _p("No: {{doc_no}}"), _p("Date: {{date}}")]
    if stage in ("purchase_order", "sales_order", "delivery_order", "invoice"):
        body.append(_p("Your PO no: {{reference}}"))
    if stage == "invoice":
        body.append(_p("Due date: {{due_date}}"))
    body += [_p("Customer", bold=True), _p("{{customer_name}}"), _p("{{customer_address}}")]
    if stage == "receipt":
        body += [_p("Received with thanks", bold=True), _p("Amount received: {{currency}} {{amount_paid}}"), _p("Paid by: {{payment_method}}   Reference: {{payment_reference}}"),
                 _p("Balance still to pay: {{currency}} {{balance_due}}")]
    else:
        cols = [("No", 600), ("Description", 4200), ("Qty", 800), ("Unit", 800)] + ([("Unit price", 1300), ("Amount", 1300)] if priced else [])
        heads = [c[0] for c in cols]
        row = ["{{line.no}}", "{{line.description}}", "{{line.qty}}", "{{line.uom}}"] + (["{{line.unit_price}}", "{{line.amount}}"] if priced else [])
        body.append(_table([heads, row], [c[1] for c in cols]))
        if priced:
            body += [_p("Total before tax: {{currency}} {{subtotal}}", right=True), _p("SST: {{currency}} {{tax}}", right=True), _p("Total: {{currency}} {{total}}", bold=True, right=True)]
        if stage == "proforma":
            body.append(_p("Deposit ({{deposit_percent}}%): {{currency}} {{deposit_amount}}", bold=True))
        if stage == "invoice":
            body += [_p("Deposit already paid: {{currency}} {{deposit_paid}}"), _p("Balance to pay: {{currency}} {{balance_due}}", bold=True)]
        if stage == "delivery_order":
            body.append(_p("Received in good order by: {{signed_by}}   {{signed_at}}"))
        body += [_p("Payment terms: {{payment_terms}}"), _p("{{terms}}")]
        if stage in ("proforma", "invoice"):
            body.append(_p("{{bank_details}}"))
    ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    doc = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {ns}><w:body>{"".join(body)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>'
    types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
             '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
             '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", types)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/document.xml", doc)
    return out.getvalue()
