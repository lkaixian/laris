"""Supplier price replies (Ask suppliers): reading a WhatsApp/Telegram answer to an RFQ into a price and tiers."""
from decimal import Decimal

from psycopg.types.json import Jsonb

from . import ai_log, ilmu
from .parse_util import _dec, contact_names


# ---------------------------------------------------------------- supplier price replies (Ask suppliers)
RFQ_SCHEMA = {"type": "object", "properties": {
    "unit_price": {"type": ["number", "null"], "description": "price per unit for the smallest order they quote"},
    "min_qty": {"type": ["number", "null"], "description": "minimum order quantity, if stated"},
    "tiers": {"type": "array", "description": "bulk price breaks, if stated", "items": {"type": "object", "properties": {
        "min_qty": {"type": "number"}, "unit_price": {"type": "number"}}, "required": ["min_qty", "unit_price"]}},
    "currency": {"type": ["string", "null"]}}}
RFQ_OPEN_DAYS, RFQ_MAX_TIERS = 7, 20


def rfq_send_for(conn, party_id, reply_to, media_kind=None):
    """The ask a supplier's message answers: the send whose wamid it replies to, else their newest send still waiting
    (7 days). A photo or PDF is only taken as a reply when it quotes our message: otherwise it is their price list."""
    s = conn.execute("select id, tenant_id from rfq_sends where wamid=%s and supplier_id=%s", (reply_to, party_id)).fetchone() if reply_to else None
    if s or media_kind in ("image", "document"):
        return s
    return conn.execute("""select s.id, s.tenant_id from rfq_sends s where s.supplier_id=%s and s.status='sent'
                             and s.created_at > now() - %s * interval '1 day'
                             and exists (select 1 from rfq_replies r where r.send_id=s.id and r.status='waiting')
                           order by s.created_at desc limit 1""", (party_id, RFQ_OPEN_DAYS)).fetchone()


def rfq_price(out, currency):
    """-> (unit_price, min_qty, tiers [(min_qty, unit_price)], clean). clean only when a positive price came through every
    check; the model's words never set a status, this does."""
    out = out if isinstance(out, dict) else {}
    clean, up, mq = True, _dec(out.get("unit_price")), _dec(out.get("min_qty"))
    if out.get("unit_price") is not None and not up:
        up, clean = None, False
    if mq is not None and mq <= 0:
        mq = None
    raw = out.get("tiers") if isinstance(out.get("tiers"), list) else []
    tiers = []
    for t in raw[:RFQ_MAX_TIERS]:
        tm, tp = (_dec(t.get(k)) for k in ("min_qty", "unit_price")) if isinstance(t, dict) else (None, None)
        if tm and tp:
            tiers.append((tm, tp))
        else:
            clean = False
    tiers.sort()
    # a bigger order must not cost more per unit, and a break quoted twice is ambiguous
    if len(raw) > RFQ_MAX_TIERS or len({m for m, _ in tiers}) < len(tiers) or any(b[1] > a[1] for a, b in zip(tiers, tiers[1:])):
        clean = False
    if up is None and tiers:
        up, mq = tiers[0][1], tiers[0][0]  # headline = the smallest order they quote
    if up is None:
        return None, None, [], False
    up, mq = up.quantize(Decimal("0.0001")), mq and mq.quantize(Decimal("0.001"))  # the column's precision
    if not up or mq == 0:
        return None, None, [], False
    if str(out.get("currency") or "").upper() not in ("", "RM", "MYR", currency):
        clean = False  # a foreign price must not be read as ringgit
    return up, mq, tiers, clean


def record_rfq_reply(conn, send, m, ilmu_client=None):
    """Store a supplier's WhatsApp reply on its ask. ILMU down or unreadable -> needs_review with the raw text kept."""
    if m.media_kind:  # voice notes and photos are not transcribed or read here: a person looks
        text, up, mq, tiers, clean = f"[{m.media_kind}] {m.text or ''}".strip(), None, None, [], False
    else:
        text = (m.text or "")[:2000]
        cur = conn.execute("select currency from tenants where id=%s", (send["tenant_id"],)).fetchone()["currency"]
        try:
            with ai_log.logged(conn, send["tenant_id"], None, "rfq_reply"):
                up, mq, tiers, clean = rfq_price(ilmu.extract_json(text, RFQ_SCHEMA, client=ilmu_client, names=contact_names(conn, send["tenant_id"])), cur)
        except ilmu.IlmuError:
            up, mq, tiers, clean = None, None, [], False
    vals = (text, m.external_id, up, mq, Jsonb([{"min_qty": f"{a:f}", "unit_price": f"{b:f}"} for a, b in tiers]),
            "ready" if clean else "needs_review")
    w = conn.execute("select id from rfq_replies where send_id=%s and status='waiting' order by created_at limit 1 for update",
                     (send["id"],)).fetchone()
    if w:
        conn.execute("""update rfq_replies set message_text=%s, external_id=%s, unit_price=%s, min_qty=%s, tiers=%s, status=%s
                        where id=%s""", (*vals, w["id"]))
    else:  # a second message on the same ask (a correction, an extra tier) is its own row
        conn.execute("""insert into rfq_replies(message_text, external_id, unit_price, min_qty, tiers, status, send_id, tenant_id)
                        values (%s,%s,%s,%s,%s,%s,%s,%s)""", (*vals, send["id"], send["tenant_id"]))
