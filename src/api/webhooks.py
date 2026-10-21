"""Inbound channels. WhatsApp: verify HMAC on the RAW body before parsing. Telegram: secret-token header.
Known supplier contact -> supplier-document pipeline; anyone else -> customer enquiry pipeline."""
import hmac
import json
import logging
import os

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse
from starlette.concurrency import run_in_threadpool

from .. import db, pipeline
from ..channels import telegram, whatsapp
from ..errors import ApiError
from .deps import JR

log = logging.getLogger("laris")
r = APIRouter(prefix="/webhooks")
SORRY = "Sorry, we could not process that message. Our team will follow up."


def _handle(conn, s, m):
    """-> reply text or None. Raises ApiError (caller rolls back to the savepoint)."""
    if m.external_id and conn.execute("select 1 from messages where channel=%s and external_id=%s",
                                      (m.channel, m.external_id)).fetchone():
        return None  # provider retry
    digits = "".join(ch for ch in m.sender if ch.isdigit())
    if not digits:
        return None
    # ponytail: single-tenant routing (sender's party, else the first tenant); add phone-number-id -> tenant for multi-tenant
    p = conn.execute(r"""select id, tenant_id, role from parties
                         where regexp_replace(coalesce(contact,''), '\D', '', 'g') = %s
                         order by (role = 'supplier') desc limit 1""", (digits,)).fetchone()
    if p:
        tid = p["tenant_id"]
    else:
        tid = conn.execute("select id from tenants order by name, id limit 1").fetchone()["id"]
        p = {"id": pipeline.party(conn, tid, "customer", f"{m.channel} {m.sender}"[:100], m.sender), "role": "customer"}
    if p["role"] == "supplier":
        if m.media_kind in ("image", "document"):
            data, mime = s.download(m.channel, m.media_ref, m.media_kind)
            res = pipeline.ingest_supplier_document(conn, tid, data=data, mime=mime, party_id=p["id"], channel=m.channel,
                                                    external_id=m.external_id, ilmu_client=s.ilmu, ocr=s.ocr)
        elif m.text and not m.media_kind:
            res = pipeline.ingest_supplier_document(conn, tid, text=m.text, party_id=p["id"], channel=m.channel,
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
    res = pipeline.handle_enquiry(conn, tid, p["id"], m.channel, text, external_id=m.external_id, ilmu_client=s.ilmu)
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
                log.warning("inbound %s rejected: %s", m.external_id, e.message)
                text = SORRY
            except Exception:
                log.exception("inbound %s failed", m.external_id)
                text = None
            if text:
                replies.append((m.channel, m.sender, text))
    for ch, to, text in replies:  # after commit; a send failure never loses the stored document
        try:
            s.send(ch, to, text)
        except Exception:
            log.exception("reply to %s failed", to)


@r.get("/whatsapp")
def wa_verify(request: Request):
    c = whatsapp.verify_challenge(dict(request.query_params), os.environ.get("WHATSAPP_VERIFY_TOKEN") or "\0unset")
    if c is None:
        raise ApiError(403, "bad_verify_token", "verification failed")
    return PlainTextResponse(c)


@r.post("/whatsapp")
async def wa_inbound(request: Request):
    raw = await request.body()  # signature is over the exact bytes: check before any parsing
    if not whatsapp.verify_signature(raw, request.headers.get("x-hub-signature-256"), os.environ.get("WHATSAPP_APP_SECRET", "")):
        raise ApiError(403, "bad_signature", "invalid signature")
    try:
        payload = json.loads(raw)
    except ValueError:
        raise ApiError(400, "bad_json", "body is not JSON")
    await run_in_threadpool(_process, request.app.state.svc, whatsapp.parse_inbound(payload), whatsapp.parse_status(payload))
    return JR({"ok": True})


@r.post("/telegram")
async def tg_inbound(request: Request):
    secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
    if not secret or not hmac.compare_digest(request.headers.get("x-telegram-bot-api-secret-token", ""), secret):
        raise ApiError(403, "bad_secret", "invalid secret token")
    try:
        m = telegram.parse_update(await request.json())
    except (ValueError, KeyError, TypeError):
        raise ApiError(400, "bad_update", "unparseable update")
    if m:
        await run_in_threadpool(_process, request.app.state.svc, [m])
    return JR({"ok": True})
