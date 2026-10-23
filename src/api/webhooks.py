"""Inbound channels. WhatsApp: verify HMAC on the RAW body before parsing. Telegram: secret-token header.
A staff/owner handle (users.channel_handle) or a supplier party -> supplier-document pipeline; anyone else -> customer
enquiry pipeline only, rate-limited so spam cannot burn ILMU credit."""
import hashlib
import hmac
import json
import logging
import os
import re
import time
from collections import defaultdict, deque

import psycopg
from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse
from starlette.concurrency import run_in_threadpool

from .. import db, pipeline
from .. import license as lic
from ..channels import telegram, whatsapp
from ..errors import ApiError
from ..tabular import sniff
from ..templates import load_template
from ..vision import VisionError
from . import listings
from .deps import JR, throttle

log = logging.getLogger("laris")
r = APIRouter(prefix="/webhooks")
LIMIT, WINDOW = 10, 600  # enquiries per sender per 10 minutes
# ponytail: in-memory, per process (run.sh forces 1 worker), keys never pruned; move to Redis/DB if we scale out
_HITS = defaultdict(deque)
SENDER_LIMIT = 30  # messages per (business, sender) per 10 minutes on the supplier and staff paths
MAX_BODY = 1_000_000  # webhook payloads are a few KB; refuse bulk before hashing/parsing
CATALOG = re.compile(r"\s*/?catalog\b", re.I)
SORRY = "Sorry, we could not process that message. Our team will follow up."


def _h(x) -> str:
    """Stable short id for logs (PDPA: no raw phone numbers or chat ids)."""
    return hashlib.sha256(str(x).encode()).hexdigest()[:10]


def _cap(request: Request):
    cl = request.headers.get("content-length") or "0"
    if not cl.isdigit() or int(cl) > MAX_BODY:
        raise ApiError(413, "too_large", "payload too large")


CLARIFY = ("no_items", "bad_items", "bad_qty", "too_many_items")  # the customer's message could not be turned into items


def _clarify(conn, tid) -> str:
    """Ask the customer what we could not read instead of a dead-end apology (the model's ask_clarification, templated)."""
    t = conn.execute("select trade_template from tenants where id=%s", (tid,)).fetchone()
    names = "; ".join(r.get("description", k) for k, r in load_template(t["trade_template"])["recipes"].items())
    pipeline._log_ai(conn, tid, "ask_clarification", None, {"reason": "enquiry not understood"})
    return f"Sorry, we could not tell what you need or how many. We quote for: {names}. Please reply with the item and quantity."


def _limited(key, limit=LIMIT) -> bool:
    now, q = time.monotonic(), _HITS[key]
    while q and now - q[0] > WINDOW:
        q.popleft()
    if len(q) >= limit:
        return True
    q.append(now)
    return False


# a handle is a phone number for WhatsApp and `tg:<chat id>` for Telegram: neither channel's id can match the other's
STAFF_Q = r"""select id, tenant_id from users
              where active and ((%(ch)s = 'whatsapp' and coalesce(channel_handle,'') !~* '^\s*(tg|telegram):'
                                 and regexp_replace(coalesce(channel_handle,''), '\D', '', 'g') = %(d)s)
                                or (%(ch)s = 'telegram' and lower(btrim(coalesce(channel_handle,''))) in ('tg:' || %(s)s, 'telegram:' || %(s)s)))
                and (%(scope)s::uuid is null or tenant_id = %(scope)s)"""
# a `tg:<chat id>` contact belongs to that exact Telegram chat only (never read as a phone number)
PARTY_Q = r"""select id, tenant_id, role from parties
              where ((%(ch)s = 'whatsapp' and coalesce(contact,'') !~* '^\s*(tg|telegram):' and regexp_replace(coalesce(contact,''), '\D', '', 'g') = %(d)s)
                     or (%(ch)s = 'telegram' and lower(btrim(coalesce(contact,''))) in ('tg:' || %(s)s, 'telegram:' || %(s)s)))
                and (%(scope)s::uuid is null or tenant_id = %(scope)s)
              order by (role = 'supplier') desc, id"""


def resolve_tenant(conn, m, digits):
    """Which business is this message for? -> (tenant id, None) or (None, reason code). Never guesses:
    1. WhatsApp: the tenant that owns the number it arrived on (tenants.wa_phone_number_id); a number nobody owns is dropped once any is mapped
    2. env TELEGRAM_TENANT_ID (Telegram) / WHATSAPP_TENANT_ID (WhatsApp)
    3. exactly one business exists: that one
    4. otherwise only an exact sender match (active staff handle or contact) in exactly one business; none or several: dropped."""
    if m.channel == "whatsapp" and m.to:
        if t := conn.execute("select id from tenants where wa_phone_number_id = %s", (m.to,)).fetchone():
            return t["id"], None
        if conn.execute("select 1 from tenants where wa_phone_number_id is not null limit 1").fetchone():
            return None, "unmapped_number"
    env = os.environ.get("TELEGRAM_TENANT_ID" if m.channel == "telegram" else "WHATSAPP_TENANT_ID", "").strip().lower()
    if env and (t := conn.execute("select id from tenants where id::text = %s", (env,)).fetchone()):
        return t["id"], None
    only = conn.execute("select id from tenants limit 2").fetchall()
    if len(only) == 1:
        return only[0]["id"], None
    args = {"ch": m.channel, "d": digits, "s": m.sender, "scope": None}
    hit = {x["tenant_id"] for q in (STAFF_Q, PARTY_Q) for x in conn.execute(q, args).fetchall()}
    return (hit.pop(), None) if len(hit) == 1 else (None, "ambiguous_sender" if hit else "unknown_sender")


def _hold(conn, tid, p, m):
    """Licence blocks processing: keep only the raw message (as a new enquiry) so the owner can see it. No model, no reply."""
    pid = p["id"] or pipeline.party(conn, tid, "customer", f"{m.channel} {m.sender}"[:100], m.sender)
    enq = conn.execute("insert into enquiries(tenant_id,party_id,channel,status) values (%s,%s,%s,'new') returning id", (tid, pid, m.channel)).fetchone()["id"]
    pipeline._record_message(conn, enq, None, "in", m.channel, (m.text or f"[{m.media_kind}]")[:2000], m.external_id)


def _handle(conn, s, m):
    """-> reply text or None. Raises ApiError (caller rolls back to the savepoint)."""
    if m.external_id and conn.execute("""select 1 from messages where channel=%s and external_id=%s
                                         union all select 1 from rfq_replies where external_id=%s""",
                                      (m.channel, m.external_id, m.external_id)).fetchone():
        return None  # provider retry
    digits = "".join(ch for ch in m.sender if ch.isdigit())
    if not digits:
        return None
    tid, why = resolve_tenant(conn, m, digits)
    if tid is None:  # fail closed: no reply, no processing, no number or text in the log; 200 so the provider does not retry
        log.warning("inbound from %s dropped: %s", _h(digits), why)
        return None
    args = {"ch": m.channel, "d": digits, "s": m.sender, "scope": tid}  # from here every lookup is this business only
    u = conn.execute(STAFF_Q + " limit 1", args).fetchone()
    p = None
    if u:  # our own staff/owner forwarding a supplier document
        actor, p = u["id"], {"id": None, "role": "supplier"}
    else:
        actor, p = None, conn.execute(PARTY_Q + " limit 1", args).fetchone()
    if p and p["role"] == "supplier":
        if _limited(f"sup:{tid}:{m.channel}:{digits}", SENDER_LIMIT):
            log.warning("inbound from %s rate-limited (supplier/staff)", _h(digits))
            return None
    elif p and p["role"] == "contractor":  # contacts we record, not people who order
        return None
    elif _limited(digits):
        log.warning("inbound from %s rate-limited", _h(digits))
        return None
    if lic.configured() and lic.status(conn, tid)["read_only"]:
        log.warning("licence blocks inbound processing (sender %s)", _h(digits))
        _hold(conn, tid, p or {"id": None}, m)
        return None
    if p is None:
        p = {"id": pipeline.party(conn, tid, "customer", f"{m.channel} {m.sender}"[:100], m.sender), "role": "customer"}
    if p["role"] == "supplier":
        if actor is None and (send := pipeline.rfq_send_for(conn, p["id"], m.reply_to, m.media_kind)) and send["tenant_id"] == tid:
            pipeline.record_rfq_reply(conn, send, m, s.ilmu)  # an answer to "how much for this photo?", not a document
            return "Thanks, we have your reply."
        if m.media_kind == "image" and CATALOG.match(m.text or ""):  # a caption "/catalog" or "catalog": a many-product photo, not a document
            throttle(f"listing:{tid}:{digits}", 10, 600, "too many catalog photos")
            data, mime = s.download(m.channel, m.media_ref, m.media_kind)
            try:
                res = listings.create_listing(conn, tid, actor, data, mime, party_id=p["id"], note=m.text.strip()[:300], channel=m.channel,
                                              http=getattr(s, "vision", None), ocr=s.ocr)
            except VisionError as e:
                raise ApiError(502, "vision_unavailable", str(e))
            return f"Received your catalog photo: {res['item_count']} product(s) are queued for review."
        if m.media_kind in ("image", "document"):
            data, mime = s.download(m.channel, m.media_ref, m.media_kind)
            if m.media_kind == "document":  # sheets/Word/CSV arrive as documents; Telegram gives no mime
                mime = sniff(data, m.media_name, mime) or mime
            res = pipeline.ingest_supplier_document(conn, tid, data=data, mime=mime, party_id=p["id"], channel=m.channel, actor=actor,
                                                    external_id=m.external_id, ilmu_client=s.ilmu, ocr=s.ocr)
        elif m.text and not m.media_kind:
            res = pipeline.ingest_supplier_document(conn, tid, text=m.text, party_id=p["id"], channel=m.channel, actor=actor,
                                                    external_id=m.external_id, ilmu_client=s.ilmu)
        else:
            raise ApiError(415, "unsupported_media", "supplier documents: send a PDF, photo or text")
        return f"Received {res['doc_no'] or 'your document'}; it is queued for review."
    text = m.text if not m.media_kind else None
    if m.media_kind == "audio":
        data, mime = s.download(m.channel, m.media_ref, m.media_kind)
        text = pipeline.transcribe(data, mime or "audio/ogg", s.ilmu)
    if not text:
        raise ApiError(415, "unsupported_media", "enquiries: send text or a voice note")
    if pipeline.classify_reply(text) and (hit := pipeline.record_reply(conn, p["id"], m.channel, text, m.external_id)):
        return f"Noted, thank you. We will confirm {hit['doc_no']} with you shortly."  # the owner records accept or decline
    try:
        res = pipeline.handle_enquiry(conn, tid, p["id"], m.channel, text, external_id=m.external_id, ilmu_client=s.ilmu)
    except ApiError as e:
        if e.code not in CLARIFY:  # anything else (no cost on file, AI down) is our problem, not the customer's
            raise
        return _clarify(conn, tid)
    return f"Thanks, we received your enquiry ({res['doc_no']}). We will send your quote shortly."


def _process(s, msgs, statuses=()):
    replies = []
    with db.tx("staff", "system:webhook") as conn:
        for wamid, st, at in statuses:
            if st == "read":  # sent -> read is the only status move; read_at is set either way
                conn.execute("""update documents d set read_at = coalesce(d.read_at, %s),
                                  status = case when d.status = 'sent' then 'read'::doc_status else d.status end
                                from messages m where m.document_id = d.id and m.external_id = %s and m.direction = 'out'""",
                             (at, wamid))
        for m in msgs:
            try:
                with conn.transaction():  # savepoint per message
                    text = _handle(conn, s, m)
            except ApiError as e:
                log.warning("inbound %s rejected: %s", _h(m.external_id), e.message)
                text = SORRY
            except psycopg.errors.UniqueViolation:  # a replay that raced past the duplicate check: the first copy won
                log.info("inbound %s is a duplicate", _h(m.external_id))
                text = None
            except Exception:
                log.exception("inbound %s failed", _h(m.external_id))
                text = None
            if text:
                replies.append((m.channel, m.sender, text, m.to))
    for ch, to, text, via in replies:  # after commit; a send failure never loses the stored document
        try:
            s.send(ch, to, text, via)  # answer from the number the customer wrote to
        except Exception:
            log.exception("reply to %s failed", _h(to))


@r.get("/whatsapp")
def wa_verify(request: Request):
    token = os.environ.get("WHATSAPP_VERIFY_TOKEN")
    c = whatsapp.verify_challenge(dict(request.query_params), token) if token else None  # unset: refuse, never compare to a default
    if c is None:
        raise ApiError(403, "bad_verify_token", "verification failed")
    return PlainTextResponse(c)


@r.post("/whatsapp")
async def wa_inbound(request: Request):
    _cap(request)
    raw = await request.body()  # signature is over the exact bytes: check before any parsing
    if not whatsapp.verify_signature(raw, request.headers.get("x-hub-signature-256"), os.environ.get("WHATSAPP_APP_SECRET", "")):
        raise ApiError(403, "bad_signature", "invalid signature")
    try:
        payload = json.loads(raw)
    except ValueError:
        raise ApiError(400, "bad_json", "body is not JSON")
    if len(raw) > MAX_BODY:  # chunked bodies carry no Content-Length
        raise ApiError(413, "too_large", "payload too large")
    await run_in_threadpool(_process, request.app.state.svc, whatsapp.parse_inbound(payload), whatsapp.parse_status(payload))
    return JR({"ok": True})


@r.post("/telegram")
async def tg_inbound(request: Request):
    secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
    if not secret or not hmac.compare_digest(request.headers.get("x-telegram-bot-api-secret-token", "").encode(), secret.encode()):
        raise ApiError(403, "bad_secret", "invalid secret token")
    _cap(request)
    try:
        m = telegram.parse_update(await request.json())
    except (ValueError, KeyError, TypeError):
        raise ApiError(400, "bad_update", "unparseable update")
    if m:
        await run_in_threadpool(_process, request.app.state.svc, [m])
    return JR({"ok": True})
