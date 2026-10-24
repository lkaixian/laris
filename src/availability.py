"""Customer asks "is there X available?": answer from CONFIRMED catalog items. The model only picks search terms; the reply is built here."""
import logging
import re

from . import ilmu

log = logging.getLogger("laris")

SCHEMA = {
    "type": "object",
    "properties": {
        "intent": {"enum": ["availability", "order", "other"]},
        "search_terms": {"type": "array", "items": {"type": "string", "maxLength": 40}, "maxItems": 5},
    },
    "required": ["intent", "search_terms"],
}
FEW_SHOT = (
    ("is there any esun filament available", {"intent": "availability", "search_terms": ["esun", "filament"]}),
    ("ada filament esun tak?", {"intent": "availability", "search_terms": ["filament", "esun"]}),
    ("10 kg PLA white please", {"intent": "order", "search_terms": []}),
)
HINTS = ("available", "availability", "do you have", "got ", "in stock", "stock", "ada ", "ada tak", "have any")
STOP = {"the", "any", "you", "have", "got", "ada", "tak", "available", "availability", "stock", "and", "for", "are", "there", "does",
        "can", "yang", "ke", "ni", "lagi", "boleh", "nak", "tanya", "stok", "ready"}
TAIL = "Reply with the item and quantity and we will send a quote."


def _terms(text, ilmu_client):
    try:
        j = ilmu.extract_json(text, SCHEMA, FEW_SHOT, client=ilmu_client)
        if j.get("intent") != "availability":
            return []
        raw = j.get("search_terms")
        return [t.strip()[:40] for t in raw if isinstance(t, str) and t.strip()][:5] if isinstance(raw, list) else []
    except Exception:  # model down or unusable output: keyword guess, never an error to the customer
        low = text.lower()
        if any(ch.isdigit() for ch in low) or not any(h in low for h in HINTS):
            return []
        return [w for w in dict.fromkeys(re.findall(r"[a-z0-9]{3,}", low)) if w not in STOP][:5]


def _like(t):
    return "%" + t.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_") + "%"


def _find(conn, tid, terms, joiner):
    hit = "(description ILIKE %s OR sku ILIKE %s OR labels::text ILIKE %s)"
    args = [tid]
    for t in terms:
        args += [_like(t)] * 3
    return conn.execute(
        "SELECT description, sku, sizes, price, currency FROM listing_items WHERE tenant_id=%s AND status='confirmed' AND ("
        + joiner.join([hit] * len(terms)) + ") ORDER BY created_at DESC LIMIT 5", args).fetchall()


def _line(r):
    sizes = [str(x)[:20] for x in (r["sizes"] or [])][:6]
    out = "We list: " + (r["description"] or r["sku"] or "item")[:80]
    if sizes:
        out += f" (sizes: {', '.join(sizes)})"
    if r["price"] is not None:
        out += f" - {(r['currency'] or 'MYR')[:5]} {r['price']:.2f}"
    return out


def answer(conn, tid, text, ilmu_client=None):
    terms = _terms(text, ilmu_client)
    if not terms:
        return None
    rows = _find(conn, tid, terms, " AND ") or (_find(conn, tid, terms, " OR ") if len(terms) > 1 else [])
    log.info("availability enquiry: %d matches", len(rows))
    if not rows:
        return "We could not find that in our list. " + TAIL
    return "\n".join(map(_line, rows)) + "\nListed means we carry it, not that it is in stock. " + TAIL
