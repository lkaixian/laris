"""Inbound channels. WhatsApp: verify HMAC on the RAW body before parsing. Telegram: secret-token header.
A staff/owner handle (users.channel_handle) or a supplier party -> supplier-document pipeline; anyone else -> customer
enquiry pipeline only, rate-limited so spam cannot burn ILMU credit."""
import hashlib
import hmac
import json
import logging
import os
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse
from starlette.concurrency import run_in_threadpool

from .. import db, pipeline
from ..channels import telegram, whatsapp
from ..errors import ApiError
from ..templates import load_template
from .deps import JR

log = logging.getLogger("laris")
r = APIRouter(prefix="/webhooks")
LIMIT, WINDOW = 10, 600  # enquiries per sender per 10 minutes
# ponytail: in-memory, per process (run.sh forces 1 worker), keys never pruned; move to Redis/DB if we scale out
_HITS = defaultdict(deque)
MAX_BODY = 1_000_000  # webhook payloads are a few KB; refuse bulk before hashing/parsing
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


def _limited(sender) -> bool:
    now, q = time.monotonic(), _HITS[sender]
    while q and now - q[0] > WINDOW:
        q.popleft()
    if len(q) >= LIMIT:
        return True
    q.append(now)
    return False


def _handle(conn, s, m):
    """-> reply text or None. Raises ApiError (caller rolls back to the savepoint)."""
    if m.external_id and conn.execute("select 1 from messages where channel=%s and external_id=%s",
                                      (m.channel, m.external_id)).fetchone():
        return None  # provider retry
    digits = "".join(ch for ch in m.sender if ch.isdigit())
    if not digits:
        return None
    # ponytail: single-tenant routing; WHATSAPP_TENANT_ID (else the first tenant) owns every unknown sender
    u = conn.execute(r"""select id, tenant_id from users where regexp_replace(coalesce(channel_handle,''), '\D', '', 'g') = %s
                         limit 1""", (digits,)).fetchone()
    if u:  # our own staff/owner forwarding a supplier document
        tid, actor, p = u["tenant_id"], u["id"], {"id": None, "role": "supplier"}
    else:
        actor = None
        p = conn.execute(r"""select id, tenant_id, role from parties
                             where regexp_replace(coalesce(contact,''), '\D', '', 'g') = %s
                             order by (role = 'supplier') desc limit 1""", (digits,)).fetchone()
        if p and p["role"] == "supplier":
            tid = p["tenant_id"]
        else:
            if _limited(digits):
                log.warning("inbound from %s rate-limited", _h(digits))
                return None
            tid = p["tenant_id"] if p else None
            if tid is None:
                t = conn.execute("select id from tenants where id::text = %s", (os.environ.get("WHATSAPP_TENANT_ID", ""),)).fetchone() \
                    or conn.execute("select id from tenants order by name, id limit 1").fetchone()
                tid = t["id"]
                p = {"id": pipeline.party(conn, tid, "customer", f"{m.channel} {m.sender}"[:100], m.sender), "role": "customer"}
    if p["role"] == "supplier":
        if m.media_kind in ("image", "document"):
            data, mime = s.download(m.channel, m.media_ref, m.media_kind)
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
            except Exception:
                log.exception("inbound %s failed", _h(m.external_id))
                text = None
            if text:
                replies.append((m.channel, m.sender, text))
    for ch, to, text in replies:  # after commit; a send failure never loses the stored document
        try:
            s.send(ch, to, text)
        except Exception:
            log.exception("reply to %s failed", _h(to))


@r.get("/whatsapp")
def wa_verify(request: Request):
    c = whatsapp.verify_challenge(dict(request.query_params), os.environ.get("WHATSAPP_VERIFY_TOKEN") or "\0unset")
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
