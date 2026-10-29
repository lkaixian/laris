"""Customer asks "is there X available?": answer from CONFIRMED catalog items. The model only picks search terms; the reply is built here.
A follow-up "quote 50kg" uses the items just shown and drafts a quotation for staff to price."""
import logging
import re
import time
from datetime import timedelta
from decimal import Decimal

from . import ilmu, pipeline, pricing
from .parse_util import contact_names

log = logging.getLogger("laris")

SCHEMA = {
    "type": "object",
    "properties": {
        "intent": {"enum": ["availability", "quote_request", "order", "other"]},
        "search_terms": {"type": "array", "items": {"type": "string", "maxLength": 40}, "maxItems": 5},
        "qty": {"type": ["number", "null"]},
        "uom": {"type": ["string", "null"], "maxLength": 12},
    },
    "required": ["intent", "search_terms"],
}
FEW_SHOT = (
    ("is there any esun filament available", {"intent": "availability", "search_terms": ["esun", "filament"]}),
    ("ada filament esun tak?", {"intent": "availability", "search_terms": ["filament", "esun"]}),
    ("10 kg PLA white please", {"intent": "order", "search_terms": []}),
    ("Ok, nak sebut harga. Quote kalau ambil bulk 50kg", {"intent": "quote_request", "search_terms": [], "qty": 50, "uom": "kg"}),
    ("quote 20 spool esun pla white", {"intent": "quote_request", "search_terms": ["esun", "pla", "white"], "qty": 20, "uom": "spool"}),
)
HINTS = ("available", "availability", "do you have", "got ", "in stock", "stock", "ada ", "ada tak", "have any")
STOP = {"the", "any", "you", "have", "got", "ada", "tak", "available", "availability", "stock", "and", "for", "are", "there", "does",
        "can", "yang", "ke", "ni", "lagi", "boleh", "nak", "tanya", "stok", "ready"}
TAIL = "Reply with the item and quantity and we will send a quote."
COLS = "SELECT id, description, sku, sizes, price, currency, price_tiers, stock_qty"

# ponytail: in-memory per process (run.sh forces 1 worker); move to a table if we scale out
_LAST = {}  # (tenant_id, party_id) -> (monotonic time, [listing item rows just shown])
TTL, CAP = 900, 1000


def _remember(key, rows):
    now = time.monotonic()
    for k in [k for k, (t, _) in _LAST.items() if now - t > TTL]:
        del _LAST[k]
    if key not in _LAST and len(_LAST) >= CAP:
        del _LAST[next(iter(_LAST))]
    _LAST[key] = (now, rows)


def _recall(conn, tid, key):
    """The items shown to this customer lately, re-read so one that is no longer confirmed is dropped."""
    hit = _LAST.get(key)
    if not hit or time.monotonic() - hit[0] > TTL:
        return []
    return conn.execute(COLS + " FROM listing_items WHERE tenant_id=%s AND status='confirmed' AND id = ANY(%s) ORDER BY created_at DESC",
                        (tid, [r["id"] for r in hit[1]])).fetchall()


def _parse(text, ilmu_client, names=()):
    """-> (intent, search terms, qty, uom)"""
    try:
        j = ilmu.extract_json(text, SCHEMA, FEW_SHOT, client=ilmu_client, names=names)
        if j.get("intent") not in ("availability", "quote_request"):
            return "other", [], None, None
        raw = j.get("search_terms")
        terms = [t.strip()[:40] for t in raw if isinstance(t, str) and t.strip()][:5] if isinstance(raw, list) else []
        qty, uom = j.get("qty"), j.get("uom")
        qty = Decimal(str(qty)) if isinstance(qty, (int, float)) and not isinstance(qty, bool) and 0 < qty < 10**9 else None
        return j["intent"], terms, qty, (uom.strip()[:12] if isinstance(uom, str) else "") or "unit"
    except Exception:  # model down or unusable output: keyword guess, never an error to the customer
        low = text.lower()
        if any(ch.isdigit() for ch in low) or not any(h in low for h in HINTS):
            return "other", [], None, None
        return "availability", [w for w in dict.fromkeys(re.findall(r"[a-z0-9]{3,}", low)) if w not in STOP][:5], None, None


def _like(t):
    return "%" + t.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_") + "%"


def _find(conn, tid, terms, joiner):
    hit = "(description ILIKE %s OR sku ILIKE %s OR labels::text ILIKE %s)"
    args = [tid]
    for t in terms:
        args += [_like(t)] * 3
    return conn.execute(
        COLS + " FROM listing_items WHERE tenant_id=%s AND status='confirmed' AND ("
        + joiner.join([hit] * len(terms)) + ") ORDER BY created_at DESC LIMIT 5", args).fetchall()


def _search(conn, tid, terms):
    return _find(conn, tid, terms, " AND ") or (_find(conn, tid, terms, " OR ") if len(terms) > 1 else [])


def _n(d):
    return f"{Decimal(str(d)).normalize():f}"  # 5.000 -> 5, 50 stays 50


def _money(r, v):
    return f"{(r['currency'] or 'MYR')[:5]} {Decimal(str(v)):.2f}"


def _stock(r):
    """Only a count the owner keyed in may say "in stock"; no count, no claim."""
    if r["stock_qty"] is None:
        return ""
    return " - in stock" if r["stock_qty"] > 0 else " - out of stock"


def _line(r):
    sizes = [str(x)[:20] for x in (r["sizes"] or [])][:6]
    out = "We list: " + (r["description"] or r["sku"] or "item")[:80]
    if sizes:
        out += f" (sizes: {', '.join(sizes)})"
    tiers = r["price_tiers"] or []
    if r["price"] is not None:
        out += " - " + _money(r, r["price"])
    elif tiers:
        out += " - from " + _money(r, min(Decimal(str(t["price"])) for t in tiers))
    if any(Decimal(str(t["min_qty"])) > 1 for t in tiers):
        out += ", bulk prices available"
    return out + _stock(r)


def _size(r, text, terms):
    """The size the customer named: one of the item's sizes as a whole word in the message or the search terms. One size only = that one."""
    sizes = [str(x) for x in (r["sizes"] or []) if str(x).strip()]
    if len(sizes) == 1:
        return sizes[0]
    hay = " ".join([text, *terms]).lower()
    hit = [s for s in sizes if re.search(r"(?<![a-z0-9.])" + re.escape(s.lower()) + r"(?![a-z0-9])", hay)]
    return max(hit, key=len) if hit else None  # "1.75mm" over "1.75"


def _pick(conn, tid, key, terms):
    """Candidates for a quote: the terms narrow what was just shown, else the catalog, else everything just shown."""
    mem = _recall(conn, tid, key)
    if terms:
        hit = [r for r in mem if all(t.lower() in f"{r['description']} {r['sku']} {' '.join(map(str, r['sizes'] or []))}".lower() for t in terms)]
        if hit:
            return hit
        if rows := _search(conn, tid, terms):
            return rows
    return mem


def _quote(conn, tid, party_id, key, text, terms, qty, uom, channel, external_id):
    rows = _pick(conn, tid, key, terms)
    if not rows:
        return None
    if len(rows) > 1:
        _remember(key, rows)
        return "Which one: " + " ".join(f"{i}) {(r['description'] or r['sku'] or 'item')[:80]}" for i, r in enumerate(rows, 1)) \
            + ", reply with the name"
    r = rows[0]
    name = (r["description"] or r["sku"] or "item")[:500]
    if qty is None:
        _remember(key, rows)
        return f"How many {name[:80]} do you need?"
    t = conn.execute("select * from tenants where id=%s", (tid,)).fetchone()
    enq = conn.execute("insert into enquiries(tenant_id,party_id,channel,status) values (%s,%s,%s,'quoted') returning id",
                       (tid, party_id, channel)).fetchone()["id"]
    doc_no = pipeline.next_quote_no(conn, tid, t["quote_prefix"])
    doc_id = conn.execute(
        """insert into documents(tenant_id,direction,kind,party_id,doc_no,status,valid_until,currency,enquiry_id,source_channel,
                                 payment_terms,terms_text)
           values (%s,'out','quotation',%s,%s,'draft',%s,%s,%s,%s,%s,%s) returning id""",
        (tid, party_id, doc_no, pipeline.today_my() + timedelta(days=t["quote_validity_days"]), t["currency"], enq, channel,
         t["quote_payment_terms"], t["quote_terms_text"])).fetchone()["id"]
    # the price comes from the rules engine (pricing.catalog_price), never from the model; no rule -> NULL for staff to fill.
    # no item_key (not a recipe), no price_source (that enum is for recipe lines); the line stays for staff to confirm before sending.
    p = pricing.catalog_price(r["price"], r["price_tiers"] or [], qty, _size(r, text, terms))
    if p["size"]:
        name = f"{name[:480]} ({p['size']})"
    why = ["catalog price from the price list and quantity tiers, confirm before sending" if p["unit_price"] is not None else f"catalog item: {p['why']}, staff to price"]
    if p["below_moq"] is not None:
        why.append(f"below the minimum of {_n(p['below_moq'])}, priced at that tier")
    if r["stock_qty"] is not None and r["stock_qty"] < qty:
        why.append(f"stock count {_n(r['stock_qty'])} is below the {_n(qty)} asked")
    conn.execute(
        """insert into document_lines(document_id,line_no,description,qty,uom,unit_price,needs_review,review_reason)
           values (%s,1,%s,%s,%s,%s,true,%s)""",
        (doc_id, name, qty, uom, p["unit_price"], "; ".join(why)))
    pipeline._log_ai(conn, tid, "extract_items", doc_id, {"intent": "quote_request", "listing_item_id": str(r["id"]), "qty": str(qty),
                                                         "size": p["size"]})
    pipeline._record_message(conn, enq, doc_id, "in", channel, text[:2000], external_id)
    _LAST.pop(key, None)
    out = f"Thanks, we received your quote request {doc_no}: {qty:f} {uom} {name[:100]}."
    if p["unit_price"] is not None:
        return out + f" Price at this quantity {_money(r, p['unit_price'])} per unit; our team will confirm it and send your quote shortly."
    if p["why"] == "size not given":
        return out + " Sizes: " + ", ".join(str(x)[:20] for x in (r["sizes"] or [])[:6]) \
            + "; our team will check which one you need and send your quote shortly."
    return out + " Our team will confirm the price and send your quote shortly."


def answer(conn, tid, party_id, text, ilmu_client=None, *, channel="web", external_id=None):
    intent, terms, qty, uom = _parse(text, ilmu_client, contact_names(conn, tid))
    key = (str(tid), str(party_id))
    if intent == "quote_request":
        return _quote(conn, tid, party_id, key, text, terms, qty, uom, channel, external_id)
    if not terms:
        return None
    rows = _search(conn, tid, terms)
    log.info("availability enquiry: %d matches", len(rows))
    if not rows:
        return "We could not find that in our list. " + TAIL
    _remember(key, rows)
    note = "Listed means we carry it, not that it is in stock. " if any(r["stock_qty"] is None for r in rows) else ""
    return "\n".join(map(_line, rows)) + "\n" + note + TAIL
