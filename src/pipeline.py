"""Document pipelines. Both take an open transaction (conn) and an injectable ILMU httpx client; both create
NOTHING if ILMU/OCR fails (the owner keys lines manually). The LLM never supplies a price: enquiry prices come
from pricing.price_quote, supplier prices come from the paper and are checked by validate.validate_extraction."""
import hashlib
import json
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from statistics import mean

from psycopg.types.json import Jsonb

from . import ilmu, ocr as ocr_mod, pricing, validate
from .errors import ApiError
from .templates import load_template

KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,40}$")
BIG = Decimal(10) ** 10

SUPPLIER_SCHEMA = {
    "type": "object",
    "properties": {
        "supplier_name": {"type": ["string", "null"]}, "doc_no": {"type": ["string", "null"]},
        "issued_on": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
        "valid_until": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
        "currency": {"type": ["string", "null"]},
        "lines": {"type": "array", "items": {"type": "object", "properties": {
            "line_no": {"type": "integer"}, "description": {"type": "string"}, "qty": {"type": ["number", "null"]},
            "uom": {"type": ["string", "null"]}, "unit_price": {"type": ["number", "null"]},
            "amount": {"type": ["number", "null"]}}, "required": ["description"]}},
        "totals": {"type": "object", "properties": {"subtotal": {"type": ["number", "null"]},
                   "sst": {"type": ["number", "null"]}, "grand_total": {"type": ["number", "null"]}}},
    },
    "required": ["lines"],
}
LINE_KNOWN = {"line_no", "description", "qty", "uom", "unit_price", "amount", "ocr_confidence", "item_key_suggestion",
              "item_key_score", "confidence", "needs_review", "failed", "discount_pct", "tax_rate", "section"}


def _ilmu(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except ilmu.IlmuError as e:
        raise ApiError(502, "ilmu_unavailable", f"AI extraction failed ({e}); key the lines in manually") from e


def transcribe(audio: bytes, mime: str, ilmu_client=None) -> str:
    return _ilmu(ilmu.transcribe, audio, mime, client=ilmu_client)


MY = timezone(timedelta(hours=8))  # Malaysia has no DST, so a fixed offset needs no tz database


def today_my() -> date:
    return datetime.now(MY).date()


def next_quote_no(conn, tenant_id) -> str:
    """QT-<year>-NNNN, one counter per tenant and year; the advisory lock serialises concurrent creates."""
    conn.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"quote-no:{tenant_id}",))
    pre = f"QT-{today_my().year}-"
    n = conn.execute("""select coalesce(max(substring(doc_no from '[0-9]+$')::int), 0) n from documents
                        where tenant_id=%s and direction='out' and doc_no like %s""", (tenant_id, pre + "%")).fetchone()["n"]
    return f"{pre}{n + 1:04d}"


PII = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"                       # email
                 r"|(?<!\d)(?:\+?60|0)1\d[ -]?\d{3,4}[ -]?\d{4}(?!\d)"       # Malaysian mobile
                 r"|(?<!\d)\d{6}-?\d{2}-?\d{4}(?!\d)")                       # NRIC


def redact(text: str) -> str:
    """Strip contact details and NRIC numbers before text leaves for the LLM (PDPA cross-border transfer).
    Prices, quantities and document numbers are untouched. ponytail: regex only; names and addresses pass through."""
    return PII.sub("[redacted]", text)


MAX_QTY, MAX_ITEMS, MAX_ATTRS = Decimal(1_000_000), 50, 20


def clean_items(items) -> list:
    """Bound what the LLM (and so a customer) can push into pricing: item count, qty range, flat short attrs."""
    if len(items) > MAX_ITEMS:
        raise ApiError(422, "too_many_items", f"at most {MAX_ITEMS} items per enquiry")
    out = []
    for i in items:
        q = _dec(i.get("qty"))
        if q is None or not 0 < q <= MAX_QTY:
            raise ApiError(422, "bad_qty", f"quantity must be between 0 and {MAX_QTY:,}")
        a = i.get("attrs") if isinstance(i.get("attrs"), dict) else {}
        i = {**i, "qty": q, "attrs": {str(k)[:60]: str(v)[:200] for k, v in list(a.items())[:MAX_ATTRS]
                                      if isinstance(v, (str, int, float)) and not isinstance(v, bool)}}
        out.append(i)
    return out


def _dec(x, lo=Decimal(0)):
    if x is None or isinstance(x, bool):
        return None
    try:
        d = Decimal(str(x).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return None
    return d if d.is_finite() and lo <= d < BIG else None


def _date(s):
    try:
        return date.fromisoformat(s) if s else None
    except (ValueError, TypeError):
        return None


def party(conn, tenant_id, role, name, contact=None):
    return conn.execute(
        """insert into parties(tenant_id,role,name,contact) values (%s,%s,%s,%s)
           on conflict (tenant_id,role,name) do update set contact = coalesce(parties.contact, excluded.contact)
           returning id""", (tenant_id, role, name[:200], contact)).fetchone()["id"]


ACCEPT = {"ok", "okay", "yes", "ya", "yup", "setuju", "boleh", "confirm", "confirmed", "deal", "proceed", "accept", "accepted", "terima", "jom", "lock"}
DECLINE = {"no", "nope", "tak", "tidak", "cancel", "batal", "reject", "declined", "expensive", "mahal", "pass"}


def classify_reply(text: str) -> str | None:
    """Short answer to a quote we sent: 'accept' or 'decline' by keyword, else None (then it is a new enquiry).
    Only suggests: nothing is accepted until the owner records it."""
    words = re.findall(r"[a-z]+", text.lower())
    if not words or len(words) > 8 or any(w.isdigit() for w in text.split()):  # a number means it is probably a new order
        return None
    a, d = any(w in ACCEPT for w in words), any(w in DECLINE for w in words)
    if "tak" in words and "boleh" in words:  # "tak boleh" = cannot
        return "decline"
    return "accept" if a and not d else "decline" if d and not a else None


def record_reply(conn, party_id, channel, text, external_id):
    """Attach a customer's reply to their latest open quote. -> {doc_id, doc_no} or None when they have none."""
    d = conn.execute("""select id, doc_no from documents where party_id=%s and direction='out' and status in ('sent','read')
                        order by sent_at desc nulls last, created_at desc limit 1""", (party_id,)).fetchone()
    if not d:
        return None
    _record_message(conn, None, d["id"], "in", channel, text[:2000], external_id)
    return {"doc_id": d["id"], "doc_no": d["doc_no"]}


def route_attrs(conn, tenant_id, direction, extras: dict):
    """-> (attrs for approved tenant_fields, attrs_unmapped for everything else). Keys normalised to the field-key regex."""
    approved = {r["key"] for r in conn.execute(
        "select key from tenant_fields where tenant_id=%s and %s::doc_direction = any(applies_to)", (tenant_id, direction))}
    attrs, unmapped = {}, {}
    for k, v in (extras or {}).items():
        key = re.sub(r"[^a-z0-9_]+", "_", str(k).lower()).strip("_")
        if KEY_RE.match(key):
            (attrs if key in approved else unmapped)[key] = v
    return attrs, unmapped


def propose(conn, tenant_id, unmapped: dict, line_id):
    for k, v in unmapped.items():
        conn.execute(
            """insert into field_proposals(tenant_id,key,sample_values,source_line_id) values (%s,%s,%s,%s)
               on conflict (tenant_id,key) do update set sample_values = case
                 when field_proposals.status='pending' and jsonb_array_length(field_proposals.sample_values) < 5
                 then field_proposals.sample_values || excluded.sample_values else field_proposals.sample_values end""",
            (tenant_id, k, Jsonb([v]), line_id))


def _log_ai(conn, tenant_id, action, input_ref, payload, confidence=None):
    """Every model call that fed a document is recorded (suggestions only; the DB rejects price keys in payload)."""
    conn.execute("insert into ai_actions(tenant_id,action,input_ref,payload,model,confidence) values (%s,%s,%s,%s,%s,%s)",
                 (tenant_id, action, input_ref, Jsonb(payload), ilmu.LLM_MODEL, confidence))


def _record_message(conn, enquiry_id, doc_id, direction, channel, body, external_id):
    conn.execute("""insert into messages(enquiry_id,document_id,direction,channel,body,external_id)
                    values (%s,%s,%s,%s,%s,%s)""", (enquiry_id, doc_id, direction, channel, body, external_id))


# ---------------------------------------------------------------- (a) supplier document in
def _rows(items):
    rows, top = [], None
    for i in items:  # ocr_image output is sorted by y then x
        h = max(i["bbox"][3] - i["bbox"][1], 1)
        if top is None or i["bbox"][1] - top > h * 0.5:
            rows.append([])
            top = i["bbox"][1]
        rows[-1].append(i["text"])
    return "\n".join(" ".join(r) for r in rows)


def _source_text(data, mime, text, ocr):
    if text:
        return text, None
    mime = (mime or "").split(";")[0].lower()
    try:
        if mime == "application/pdf":
            t = ocr.pdf_text(data)
            if not t:
                raise ApiError(422, "scanned_pdf", "PDF has no text layer; send it as a photo/image instead")
            return t, None
        if mime.startswith("image/"):
            items = ocr.ocr_image(data)
            if not items:
                raise ApiError(422, "no_text", "no text found in the image")
            return _rows(items), mean(i["conf"] for i in items)
    except ApiError:
        raise
    except Exception as e:  # OcrError, corrupt file, missing engine
        raise ApiError(422, "ocr_failed", f"could not read the document ({e}); key the lines in manually") from e
    raise ApiError(415, "unsupported_media", f"cannot read {mime or 'unknown type'}; send text, PDF or an image")


JUMP_PCT = Decimal(20)


def _flag_price_jumps(conn, tenant_id, v):
    """A supplier price far from the current cost book is either news or an injected/misread number: a human confirms.
    Marks the line needs_review and adds a doc flag naming the item and the change."""
    for l in v["lines"]:
        up, key = _dec(l.get("unit_price")), l.get("item_key_suggestion")
        if not (up and key):
            continue
        cur = conn.execute("""select unit_cost from cost_items where tenant_id=%s and item_key=%s and superseded_by is null
                              order by effective_date desc limit 1""", (tenant_id, key)).fetchone()
        if cur and cur["unit_cost"] > 0:
            pct = (up - cur["unit_cost"]) / cur["unit_cost"] * 100
            if abs(pct) > JUMP_PCT:
                l["needs_review"] = True
                l["failed"] = [*l["failed"], "price_jump"]
                v["doc_flags"].append(f"price_jump:{key}:{pct:+.0f}%")
                v["ok"] = False


def ingest_supplier_document(conn, tenant_id, *, data: bytes | None = None, mime: str | None = None,
                             text: str | None = None, party_id=None, supplier_name=None, kind="quotation",
                             channel="upload", actor=None, external_id=None, ilmu_client=None, ocr=ocr_mod,
                             raw: dict | None = None) -> dict:
    """raw = lines keyed by hand (no OCR, no model): same validation, storage and review path as an extracted document."""
    t = conn.execute("select * from tenants where id=%s", (tenant_id,)).fetchone()
    tpl = load_template(t["trade_template"])
    manual, ocr_conf = raw is not None, None
    if not manual:
        src, ocr_conf = _source_text(data, mime, text, ocr)
        raw = _ilmu(ilmu.extract_json, redact(src[:20000]), SUPPLIER_SCHEMA, client=ilmu_client)
    if ocr_conf is not None:  # the LLM never scores itself: confidence comes from the OCR engine
        for l in raw.get("lines") if isinstance(raw.get("lines"), list) else []:
            if isinstance(l, dict):
                l.setdefault("ocr_confidence", round(ocr_conf, 3))
    v = validate.validate_extraction(raw, tpl["item_catalog"])
    if not v["lines"]:
        raise ApiError(422, "no_lines", "no line items found; key the lines in manually")
    if manual:  # the person who typed the line chose its item: that settles the catalog match, not the other checks
        for l, src_l in zip(v["lines"], raw["lines"]):
            if src_l.get("item_key"):
                l["item_key_suggestion"] = src_l["item_key"]
                l["failed"] = [f for f in l["failed"] if f not in ("no_item_match", "fuzzy_item_match")]
                l["needs_review"] = bool(l["failed"])
    _flag_price_jumps(conn, tenant_id, v)
    if party_id is None:
        party_id = party(conn, tenant_id, "supplier", supplier_name or str(raw.get("supplier_name") or "Unknown supplier"))
    # integrity + replay: the same bytes/text must not become a second document, whoever forwards it
    sha = hashlib.sha256(json.dumps(raw, sort_keys=True, default=str).encode() if manual
                         else data if data else (text or "").encode()).hexdigest()
    if conn.execute("select 1 from documents where tenant_id=%s and direction='in' and extraction->>'source_sha256'=%s",
                    (tenant_id, sha)).fetchone():
        raise ApiError(409, "duplicate", "this exact document was already received")
    doc_no = str(raw["doc_no"])[:100] if raw.get("doc_no") else None
    if doc_no and conn.execute("select 1 from documents where tenant_id=%s and direction='in' and party_id=%s and doc_no=%s",
                               (tenant_id, party_id, doc_no)).fetchone():
        raise ApiError(409, "duplicate", f"document {doc_no} already recorded for this supplier")
    tot = raw.get("totals") if isinstance(raw.get("totals"), dict) else {}
    cur = str(raw.get("currency") or "").upper()
    doc_id = conn.execute(
        """insert into documents(tenant_id,direction,kind,party_id,doc_no,status,issued_on,valid_until,currency,
                                 stated_total,tax_total,extraction,source_channel,created_by)
           values (%s,'in',%s,%s,%s,'parsed',%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
        (tenant_id, kind, party_id, doc_no, _date(raw.get("issued_on")) or today_my(), _date(raw.get("valid_until")),
         cur if re.fullmatch(r"[A-Z]{3}", cur) else t["currency"], _dec(tot.get("grand_total")), _dec(tot.get("sst")),
         Jsonb({"llm": raw, "doc_flags": v["doc_flags"], "source_sha256": sha}), channel, actor)).fetchone()["id"]
    for n, l in enumerate(v["lines"], 1):
        qty, up = _dec(l.get("qty")), _dec(l.get("unit_price"))
        qty = qty if qty and qty > 0 else None
        disc, ocrc = _dec(l.get("discount_pct")), _dec(l.get("ocr_confidence"))
        attrs, unmapped = route_attrs(conn, tenant_id, "in", {k: x for k, x in l.items() if k not in LINE_KNOWN})
        lid = conn.execute(
            """insert into document_lines(document_id,line_no,description,item_key,qty,uom,unit_price,ocr_confidence,
                   needs_review,discount_pct,tax_rate,section,attrs,attrs_unmapped)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
            (doc_id, n, str(l.get("description") or "")[:500], l.get("item_key_suggestion"), qty,
             str(l.get("uom") or "")[:20], up, ocrc if ocrc is not None and ocrc <= 1 else None,
             bool(l["needs_review"]) or qty is None or up is None,
             disc if disc is not None and disc <= 100 else None, _dec(l.get("tax_rate")),
             str(l["section"])[:100] if l.get("section") else None, Jsonb(attrs), Jsonb(unmapped))).fetchone()["id"]
        propose(conn, tenant_id, unmapped, lid)
    if not manual:
        _log_ai(conn, tenant_id, "parse_receipt_lines", doc_id,
                {"lines": len(v["lines"]), "doc_flags": v["doc_flags"], "source_sha256": sha},
                round(ocr_conf, 3) if ocr_conf is not None else None)
    _record_message(conn, None, doc_id, "in", channel, "[keyed in by hand]" if manual else (text or f"[{mime}]")[:2000], external_id)
    return {"doc_id": doc_id, "doc_no": doc_no, "ok": v["ok"], "doc_flags": v["doc_flags"]}


# ---------------------------------------------------------------- (b) customer enquiry in
def _items_schema(tpl):
    names = "; ".join(f"{k}: {r.get('description', k)}" for k, r in tpl["recipes"].items())
    return {"type": "object", "properties": {"items": {"type": "array", "items": {"type": "object", "properties": {
        "item_key": {"type": "string", "enum": list(tpl["recipes"]), "description": names},
        "qty": {"type": "number"}, "attrs": {"type": "object"}}, "required": ["item_key", "qty"]}}},
        "required": ["items"], "description": "Extract ONLY what the customer wants and how many. Never include prices."}


def handle_enquiry(conn, tenant_id, party_id, channel, text, *, actor=None, external_id=None, ilmu_client=None) -> dict:
    t = conn.execute("select * from tenants where id=%s", (tenant_id,)).fetchone()
    tpl = load_template(t["trade_template"])
    out = _ilmu(ilmu.extract_json, redact(text[:4000]), _items_schema(tpl), client=ilmu_client)
    items = out.get("items")
    if not isinstance(items, list) or not items or not all(isinstance(i, dict) for i in items):
        raise ApiError(422, "no_items", "could not find any items in the enquiry")
    costs = {r["item_key"]: (r["unit_cost"], r["id"]) for r in conn.execute(
        """select distinct on (item_key) item_key, unit_cost, id from cost_items
           where tenant_id=%s and superseded_by is null and (valid_until is null or valid_until >= current_date)
           order by item_key, effective_date desc, created_at desc""", (tenant_id,))}
    try:
        quote = pricing.price_quote(clean_items(items), costs, tpl, dict(t))
    except pricing.PriceInjection as e:
        raise ApiError(422, "price_injection", str(e))
    except pricing.MissingCost as e:
        raise ApiError(422, "missing_cost", f"no current supplier cost for {e.args[0]}; add a supplier quote first")
    except (KeyError, ValueError, TypeError, ArithmeticError) as e:
        raise ApiError(422, "bad_items", f"could not price the enquiry: {e}")
    flagged = {v["line_no"] for v in pricing.margin_guard(quote, t["min_margin_pct"]) if v["line_no"]}

    enq = conn.execute("insert into enquiries(tenant_id,party_id,channel,status) values (%s,%s,%s,'quoted') returning id",
                       (tenant_id, party_id, channel)).fetchone()["id"]
    doc_no = next_quote_no(conn, tenant_id)
    doc_id = conn.execute(
        """insert into documents(tenant_id,direction,kind,party_id,doc_no,status,valid_until,currency,enquiry_id,source_channel,created_by)
           values (%s,'out','quotation',%s,%s,'draft',%s,%s,%s,%s,%s) returning id""",
        (tenant_id, party_id, doc_no, today_my() + timedelta(days=30), t["currency"], enq, channel, actor)
    ).fetchone()["id"]
    for l in quote["lines"]:
        attrs, unmapped = route_attrs(conn, tenant_id, "out", l["attrs"])
        lid = conn.execute(
            """insert into document_lines(document_id,line_no,description,item_key,qty,uom,unit_price,price_source,
                   needs_review,attrs,attrs_unmapped,other_cost_per_unit) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
            (doc_id, l["line_no"], tpl["recipes"][l["item_key"]].get("description", l["item_key"]), l["item_key"],
             l["qty"], l["uom"], l["unit_price"], l["price_source"], l["line_no"] in flagged, Jsonb(attrs), Jsonb(unmapped),
             sum((q * u for _, q, u, cid in l["basis"] if cid is None), Decimal(0)) / l["qty"])  # labour + machine per unit
        ).fetchone()["id"]
        propose(conn, tenant_id, unmapped, lid)
        for _, q, uc, cid in l["basis"]:
            if cid is not None:  # rate-card hours have no cost_item row (see db/views.sql note)
                conn.execute("insert into line_cost_basis(out_line_id,cost_item_id,qty_consumed,cost_snapshot) values (%s,%s,%s,%s)",
                             (lid, cid, q / l["qty"], uc))  # per unit of the sold line, as in the seed
    _log_ai(conn, tenant_id, "extract_items", doc_id,
            {"items": [{"item_key": i["item_key"], "qty": str(i["qty"])} for i in items]})
    _record_message(conn, enq, doc_id, "in", channel, text[:2000], external_id)
    return {"doc_id": doc_id, "doc_no": doc_no, "flagged_lines": sorted(flagged)}


# ---------------------------------------------------------------- quote out
def _target(conn, doc_id):
    """The quote plus where to reach its customer, or None when there is no chat contact on file."""
    d = conn.execute("""select d.doc_no, d.valid_until, d.currency, d.party_id, p.name, p.contact, e.channel,
                               t.wa_phone_number_id pn from documents d
                        join parties p on p.id=d.party_id join enquiries e on e.id=d.enquiry_id join tenants t on t.id=d.tenant_id
                        where d.id=%s and d.direction='out'""", (doc_id,)).fetchone()
    return d if d and d["contact"] and d["channel"] in ("whatsapp", "telegram") else None


def followup_text(conn, doc_id) -> str | None:
    """Suggested chase message (deterministic template, no model). The owner reads it before it goes out."""
    d = _target(conn, doc_id)
    if not d:
        return None
    total = conn.execute("""select coalesce(sum(round(qty * unit_price * (1 - coalesce(discount_pct, 0) / 100), 2)), 0) t
                            from document_lines where document_id=%s and not is_header""", (doc_id,)).fetchone()["t"]
    until = f", valid until {d['valid_until']}" if d["valid_until"] else ""
    return (f"Hi {d['name']}, just checking if you had a chance to look at quotation {d['doc_no']} "
            f"({d['currency']} {total:.2f}{until}). Happy to adjust it if needed.")


def send_followup(conn, send, doc_id) -> bool:
    d, body = _target(conn, doc_id), followup_text(conn, doc_id)
    if not d:
        return False
    _record_message(conn, None, doc_id, "out", d["channel"], body, send(d["channel"], d["contact"], body, d["pn"]))
    return True


def send_quote(conn, send, doc_id) -> bool:
    """Send an approved quote to the customer on the channel the enquiry came in on. Selling prices only."""
    d = _target(conn, doc_id)
    if not d:
        return False
    ls = conn.execute("select * from document_lines where document_id=%s order by line_no", (doc_id,)).fetchall()
    total = sum((pricing._q(l["qty"] * l["unit_price"] * (1 - (l["discount_pct"] or 0) / Decimal(100))) for l in ls), Decimal(0))
    body = "\n".join(
        [f"Quotation {d['doc_no']}"]
        + [f"{l['line_no']}. {l['description']} x {l['qty']:f} {l['uom']} @ {d['currency']} {l['unit_price']:.2f}" for l in ls]
        + [f"Total: {d['currency']} {total:.2f}"] + ([f"Valid until {d['valid_until']}"] if d["valid_until"] else []))
    wid = send(d["channel"], d["contact"], body, d["pn"])
    _record_message(conn, None, doc_id, "out", d["channel"], body, wid)
    return True
