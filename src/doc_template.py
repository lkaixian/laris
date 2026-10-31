"""The owner's own Word template for a document: check an upload, fill it with an order's figures, and build a starter file to edit.
Kept free of the database and of any Word library so it can be tested alone: a .docx is a zip of XML, and only its text is touched.

A template is an ordinary .docx with {{placeholders}} typed where the figures go, for example {{doc_no}} or {{customer_name}}. A table row that
holds {{line.description}} (or any other {{line.*}}) is repeated once per item. Anything else in the file (logo, letterhead, fonts, layout) is
copied through unchanged. A placeholder LARIS does not know is left as typed, so a typo is visible instead of silently blank.
Safe by construction: macro files, embedded objects and remote templates are refused, the zip is size-checked before it is read, and every XML
part goes through defusedxml (no DTDs, no entity tricks) before and after filling."""
import base64
import hashlib
import io
import re
import zipfile
from pathlib import Path
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


def fill(data: bytes, values: dict[str, str], lines: list[dict[str, str]], logo: str | None = None) -> bytes:
    """The template with every known {{placeholder}} replaced; {{line.*}} rows repeat once per line. Returns a .docx.
    `logo` is the business's stored logo (a data URL). The starter files carry a blank "Company logo" picture: it becomes the logo, or, with no logo, the
    empty slot is dropped so only the company name shows. A picture the owner put there themselves is never touched."""
    z = _zip(data)
    files = {info.filename: z.read(info.filename) for info in z.infolist()}
    for n in files:
        if PART.match(n):
            files[n] = _fill_part(files[n].decode("utf-8"), values, lines).encode("utf-8")
    _logo_slot(files, _logo_png(logo))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as w:
        for n, raw in files.items():
            w.writestr(n, raw)
    return out.getvalue()


# ---------------------------------------------------------------- the company logo slot
SLOT_SHA = "d18553c11022"      # start of the sha256 of the blank picture the starter files hold in the slot
SLOT_BOX = (1371600, 514350)   # EMU: the room the logo gets (1.5 x 0.56 inch, about 3:1)
LOGO_MAX_PIXELS = 16_000_000
SLOT = re.compile(r"<w:p[ >](?:(?!</w:p>).)*?<w:drawing>(?:(?!</w:drawing>).)*?<wp:docPr[^>]*name=\"Company logo\"(?:(?!</w:drawing>).)*?r:embed=\"([^\"]+)\".*?</w:p>", re.S)


def _logo_png(url: str | None):
    """(png bytes, width, height) from a stored data URL, or None. Never raises: a bad logo means no logo, not a failed document."""
    m = re.fullmatch(r"data:image/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})", url or "")
    if not m:
        return None
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(base64.b64decode(m.group(1), validate=True)))
        w, h = im.size
        if not (0 < w * h <= LOGO_MAX_PIXELS):
            return None
        im.thumbnail((1200, 450))
        buf = io.BytesIO()
        im.convert("RGBA").save(buf, "PNG")
        return buf.getvalue(), im.size[0], im.size[1]
    except Exception:
        return None


def _logo_slot(files: dict[str, bytes], logo) -> None:
    doc = files.get("word/document.xml")
    rels = files.get("word/_rels/document.xml.rels")
    if doc is None or rels is None:
        return
    xml, rx = doc.decode("utf-8"), rels.decode("utf-8")
    m = SLOT.search(xml)
    if not m:
        return
    rel = re.search(r'<Relationship\b[^>]*\bId="%s"[^>]*>' % re.escape(m.group(1)), rx)
    target = re.search(r'Target="(media/[^"/]+)"', rel.group(0)) if rel else None
    if not target:
        return
    pic = files.get("word/" + target.group(1))
    if pic is None or hashlib.sha256(pic).hexdigest()[:12] != SLOT_SHA:
        return  # the owner already put their own picture in the slot
    if not logo:
        files["word/document.xml"] = (xml[:m.start()] + xml[m.end():]).encode("utf-8")
        return
    png, w, h = logo
    k = min(SLOT_BOX[0] / w, SLOT_BOX[1] / h)
    cx, cy = max(1, int(w * k)), max(1, int(h * k))
    para = re.sub(r'(<wp:extent cx=")\d+(" cy=")\d+"', rf'\g<1>{cx}\g<2>{cy}"', m.group(0))
    para = re.sub(r'(<a:ext cx=")\d+(" cy=")\d+"', rf'\g<1>{cx}\g<2>{cy}"', para)
    files["word/document.xml"] = (xml[:m.start()] + para + xml[m.end():]).encode("utf-8")
    files["word/media/company-logo.png"] = png
    files["word/_rels/document.xml.rels"] = rx.replace(rel.group(0), rel.group(0).replace(target.group(1), "media/company-logo.png")).encode("utf-8")


# ---------------------------------------------------------------- the starter files
STARTERS = Path(__file__).parent / "starter_templates"


def starter(stage: str) -> bytes:
    """A ready-to-edit .docx for the stage (letterhead, logo slot, the right placeholders): restyle it in Word and upload it back."""
    if stage not in STAGES:
        raise TemplateError("unknown document type")
    return (STARTERS / f"{stage}-template.docx").read_bytes()
