"""Inbound channels. WhatsApp: verify HMAC on the RAW body before parsing. Telegram: secret-token header.
A staff/owner handle (users.channel_handle) or a supplier party -> supplier-document pipeline; anyone else -> customer
enquiry pipeline only, rate-limited so spam cannot burn ILMU credit."""
import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime
from typing import NamedTuple

import psycopg
from psycopg.types.json import Jsonb
from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse
from starlette.concurrency import run_in_threadpool

from .. import availability, db, pipeline, tgbots
from .. import license as lic
from ..channels import telegram, whatsapp
from ..errors import ApiError
from ..tabular import sniff
from ..templates import load_template
from ..vision import VisionError
from . import listings, privacy
from .bot_text import HELP, NO_ROW, SORRY, SORRYS, T, VOICE_SORRY, Reply, _lang, bot_settings, dpo_line, notice_text  # noqa: F401  (re-exported)
from .deps import JR, hit, throttle

log = logging.getLogger("laris")
r = APIRouter(prefix="/webhooks")
LIMIT, WINDOW = 10, 600  # enquiries per sender per 10 minutes
# ponytail: in-memory, per process (run.sh forces 1 worker), keys never pruned; move to Redis/DB if we scale out
_HITS = defaultdict(deque)
SENDER_LIMIT = 30  # messages per (business, sender) per 10 minutes on the supplier and staff paths
MAX_BODY = 1_000_000  # webhook payloads are a few KB; refuse bulk before hashing/parsing
CATALOG = re.compile(r"\s*/?catalog\b", re.I)
HELP_CMD = re.compile(r"\s*/(start|help)(@\w+)?\s*$", re.I)
RIGHTS_CMD = re.compile(r"\s*/(privacy|mydata|forget)(@\w+)?\s*$", re.I)  # a customer's PDPA commands
RIGHTS_LIMIT = 5  # rights commands per (business, sender) per 10 minutes
YES = re.compile(r"\s*(yes|y|ya|ok|okay|setuju|agree)[.!]?\s*$", re.I)  # the reply that agrees to the notice when the owner requires it






def _now() -> datetime:
    return datetime.now(pipeline.MY)






def _rights(conn, tid, pid, m, cfg, digits):
    """A customer's PDPA side of the chat. The first message records that the notice was shown (m.notice carries its text, sent as its own
    message before the reply); /privacy, /mydata and /forget answer from here. -> reply text, or None to carry on with the message."""
    lang = _lang(cfg, m.text)
    first = conn.execute("""insert into customer_consent(tenant_id, party_id, channel, notice_version)
                            values (%s, %s, %s, coalesce((select notice_version from tenant_privacy where tenant_id=%s), 1)) on conflict do nothing returning party_id""",
                         (tid, pid, m.channel, tid)).fetchone() is not None
    notice = notice_text(conn, tid)
    cmd = RIGHTS_CMD.match(m.text) if m.text and not m.media_kind else None
    cmd = cmd and cmd.group(1).lower()
    row = conn.execute("""select p.require_optin, c.agreed_at from customer_consent c left join tenant_privacy p on p.tenant_id = c.tenant_id
                          where c.party_id=%s""", (pid,)).fetchone()
    if row and row["require_optin"] and not row["agreed_at"] and not cmd:  # the owner wants a recorded YES before anything is read
        if m.text and not m.media_kind and YES.match(m.text):
            conn.execute("update customer_consent set agreed_at=now(), basis='agreed_in_chat' where party_id=%s", (pid,))
            return T[lang]["agreed"]
        return f"{notice}\n\n{T['en']['agree']} / {T['ms']['agree']}"
    if first and cmd != "privacy":  # /privacy below answers with the notice itself
        m.notice = notice
    if not cmd:
        return None
    if _limited(f"rights:{tid}:{m.channel}:{digits}", RIGHTS_LIMIT):
        log.warning("inbound from %s rate-limited (rights command)", _h(digits))
        return ""  # nothing to send, and the message is not an enquiry
    if cmd == "privacy":
        return notice
    if cmd == "mydata":  # the sender's own party only; the same export the owner gets, which never carries a cost or margin
        out = Reply(T[lang]["mydata"])
        out.document = (json.dumps(privacy.export_data(conn, tid, pid), default=str, indent=2, ensure_ascii=False).encode(), "my-data.json", T[lang]["mydata_fail"])
        return out
    if conn.execute("""insert into data_requests(tenant_id, party_id, kind, channel) values (%s, %s, 'erase', %s)
                       on conflict do nothing returning id""", (tid, pid, m.channel)).fetchone() is not None:  # one pending request at a time
        conn.execute("insert into audit_log(tenant_id,actor,entity,entity_id,event) values (%s,'system:webhook','parties',%s,'erase requested in chat')", (tid, pid))
    return T[lang]["forget"]  # nothing is erased here: the owner decides


def _closed(cfg, lang) -> str:
    """The after-hours note to append to a confirmation, or "" (open, or the owner switched it off). A day not ticked counts as closed."""
    ah, now = cfg["after_hours"], _now()
    if not ah["enabled"]:
        return ""
    t = now.strftime("%H:%M")
    inside = ah["open"] <= t < ah["close"] if ah["open"] <= ah["close"] else t >= ah["open"] or t < ah["close"]  # open after close = overnight
    return "" if inside and now.isoweekday() in ah["days"] else "\n\n" + (ah["message"] or T[lang]["after"])
TG_ACK = os.environ.get("TELEGRAM_ACK", "1") != "0"  # "0" switches the Telegram reactions and typing indicator off


def _h(x) -> str:
    """Stable short id for logs (PDPA: no raw phone numbers or chat ids)."""
    return hashlib.sha256(str(x).encode()).hexdigest()[:10]


def _cap(request: Request):
    cl = request.headers.get("content-length") or "0"
    if not cl.isdigit() or int(cl) > MAX_BODY:
        raise ApiError(413, "too_large", "payload too large")


CLARIFY = ("no_items", "bad_items", "bad_qty", "too_many_items")  # the customer's message could not be turned into items


def _clarify(conn, tid, lang="en") -> str:
    """Ask the customer what we could not read instead of a dead-end apology (the model's ask_clarification, templated)."""
    t = conn.execute("select trade_template from tenants where id=%s", (tid,)).fetchone()
    names = "; ".join(r.get("description", k) for k, r in load_template(t["trade_template"])["recipes"].items())
    pipeline._log_ai(conn, tid, "ask_clarification", None, {"reason": "enquiry not understood"})
    return T[lang]["clarify"].format(names=names)


def _limited(key, limit=LIMIT) -> bool:
    return not hit(key, limit, WINDOW, _HITS)


# a handle is a phone number for WhatsApp and `tg:<chat id>` for Telegram: neither channel's id can match the other's
STAFF_Q = r"""select id, tenant_id from users
              where active and ((%(ch)s = 'whatsapp' and coalesce(channel_handle,'') !~* '^\s*(tg|telegram):'
                                 and regexp_replace(coalesce(channel_handle,''), '\D', '', 'g') = %(d)s)
                                or (%(ch)s = 'telegram' and lower(btrim(coalesce(channel_handle,''))) in ('tg:' || %(s)s, 'telegram:' || %(s)s)))
                and (%(scope)s::uuid is null or tenant_id = %(scope)s)"""
# a `tg:<chat id>` contact belongs to that exact Telegram chat only (never read as a phone number)
PARTY_Q = r"""select id, tenant_id, role from parties
              where ((%(ch)s = 'whatsapp' and coalesce(contact,'') !~* '^\s*(tg|telegram):' and regexp_replace(coalesce(contact,''), '\D', '', 'g') = %(d)s)
                     or (%(ch)s = 'telegram' and (lower(btrim(coalesce(contact,''))) in ('tg:' || %(s)s, 'telegram:' || %(s)s)
                                             or (role = 'customer' and btrim(coalesce(contact,'')) = %(s)s))))  -- a customer's contact is the bare chat id; renaming them must not lose them
                and (%(scope)s::uuid is null or tenant_id = %(scope)s)
              order by (role = 'supplier') desc, id"""


PHONE = re.compile(r"\+?\d[\d \-]{6,16}\d")
LABELS = re.compile(r"\b(my|name|nama|phone|number|tel|telefon|hp|and|dan|is|ialah)\b", re.I)
PROFILE_TRIES = 2  # asks this many times, then the enquiry goes on without a number


def parse_profile(text: str) -> tuple[str, str]:
    """A reply like "Ah Seng 012-3456789" -> (name, phone); phone is "" when there is no usable number."""
    m = PHONE.search(text or "")
    digits = re.sub(r"\D", "", m.group()) if m else ""
    if not 8 <= len(digits) <= 15:
        return "", ""
    rest = LABELS.sub(" ", (text[:m.start()] + " " + text[m.end():]))
    name = " ".join(re.sub(r"[^\w .'’@-]", " ", rest).split())[:60]
    return name, ("+" if m.group().lstrip().startswith("+") else "") + digits


def _profile_on(m) -> bool:
    return m.channel == "telegram" and os.environ.get("TELEGRAM_ASK_PROFILE", "1") != "0"


def _profile_answer(conn, tid, pid, text, lang):
    """The customer's reply to "your name and phone number?" -> (reply, None) to ask again, or (None, (kept text, kept id, thanks)) to go on
    with the enquiry we kept (answered, or asked enough times)."""
    row = conn.execute("select pending_enquiry pe, profile_tries n, name from parties where id=%s for update", (pid,)).fetchone()
    pe = row["pe"]
    name, phone = parse_profile(text)
    if phone:
        new = name or row["name"]
        while name and conn.execute("select 1 from parties where tenant_id=%s and role='customer' and name=%s and id<>%s", (tid, new, pid)).fetchone():
            new = f"{name} {secrets.token_hex(2)}"
        # the contact (the chat id) stays the routing key; the name and number are for people
        conn.execute("update parties set phone=%s, name=%s, pending_enquiry=null where id=%s", (phone, new, pid))
        return None, (pe["text"], pe["ext"], T[lang]["profile_ok"].format(name=name) + " " if name else "")
    if row["n"] + 1 < PROFILE_TRIES:
        conn.execute("update parties set profile_tries=profile_tries+1 where id=%s", (pid,))
        return T[lang]["ask_profile_again"], None
    conn.execute("update parties set profile_tries=%s, pending_enquiry=null where id=%s", (PROFILE_TRIES, pid))
    return None, (pe["text"], pe["ext"], "")


def resolve_tenant(conn, m, digits):
    """Which business is this message for? -> (tenant id, None) or (None, reason code). Never guesses:
    1. WhatsApp: the tenant that owns the number it arrived on (tenants.wa_phone_number_id); a number nobody owns is dropped once any is mapped
    0. a business's own Telegram bot (m.tenant_id): always that business
    2. env TELEGRAM_TENANT_ID (Telegram) / WHATSAPP_TENANT_ID (WhatsApp)
    3. exactly one business exists: that one
    4. otherwise only an exact sender match (active staff handle or contact) in exactly one business; none or several: dropped."""
    if m.tenant_id:  # a business's own bot (or a linked helper user): that business or nothing
        return m.tenant_id, None
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


def _dl(s, m):
    """Download the message's media; a Telegram message from a business or helper bot is fetched with that bot's token."""
    return s.download(m.channel, m.media_ref, m.media_kind, *((m.to,) if m.channel == "telegram" and m.to else ()))


def _hold(conn, tid, p, m):
    """Licence blocks processing: keep only the raw message (as a new enquiry) so the owner can see it. No model, no reply."""
    pid = p["id"] or pipeline.party(conn, tid, "customer", f"{m.channel} {m.sender}"[:100], m.sender)
    enq = conn.execute("insert into enquiries(tenant_id,party_id,channel,status) values (%s,%s,%s,'new') returning id", (tid, pid, m.channel)).fetchone()["id"]
    return pipeline._record_message(conn, enq, None, "in", m.channel, (m.text or f"[{m.media_kind}]")[:2000], m.external_id)


def _trace(conn, m, what: str):
    """A message we could not process leaves a durable trace OUTSIDE the failed savepoint: an audit row (no text, no number) and the raw
    message as a new enquiry, so the owner can see that something arrived. Never raises."""
    try:
        with conn.transaction():
            tid, _ = resolve_tenant(conn, m, "".join(ch for ch in m.sender if ch.isdigit()))
            if tid is None:
                return
            mid = tid  # the audit row needs an entity id: the stored message, else the business
            try:
                with conn.transaction():
                    mid = _hold(conn, tid, {"id": None}, m)
            except Exception:
                log.exception("inbound %s: could not keep the raw message", _h(m.external_id))
            conn.execute("insert into audit_log(tenant_id,actor,entity,entity_id,event) values (%s,'system:webhook','messages',%s,%s)",
                         (tid, mid, f"inbound failed: {what}"))
    except Exception:
        log.exception("inbound %s: could not record the failure", _h(m.external_id))


class Catalog(NamedTuple):
    """A '/catalog' photo that passed every check: read by the model with no transaction open, then stored in a new one."""
    tid: object
    actor: object
    party_id: object
    data: bytes
    m: object


def _handle(conn, s, m):
    """-> reply text, None, or a Catalog to finish later. Raises ApiError (caller rolls back to the savepoint)."""
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
    cfg = bot_settings(conn, tid) if m.channel == "telegram" else {**NO_ROW, "language": "en"}  # the customisation is for the Telegram bots only
    if m.text and not m.media_kind and (cmd := HELP_CMD.match(m.text)):  # /start and /help: no record, no model call
        start, lang = cmd.group(1).lower() == "start", _lang(cfg, None)
        out = Reply(cfg["welcome" if start else "help"] or T[lang]["welcome" if start else "help"])
        if start and cfg["quick_replies"]:  # a tap on a button sends its label as text: no callback handling
            out.markup = {"keyboard": [[{"text": q}] for q in cfg["quick_replies"]], "resize_keyboard": True, "is_persistent": True}
        return out
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
    if m.channel == "telegram" and m.username and p["role"] == "customer" and p["id"]:
        conn.execute("update parties set tg_username=%s where id=%s and tg_username is distinct from %s", (m.username, p["id"], m.username))
    if p["role"] == "customer" and (out := _rights(conn, tid, p["id"], m, cfg, digits)) is not None:  # never staff or suppliers
        return out
    if p["role"] == "supplier":
        if actor is None and (send := pipeline.rfq_send_for(conn, p["id"], m.reply_to, m.media_kind)) and send["tenant_id"] == tid:
            pipeline.record_rfq_reply(conn, send, m, s.ilmu)  # an answer to "how much for this photo?", not a document
            return "Thanks, we have your reply."
        if m.media_kind == "image" and CATALOG.match(m.text or ""):  # a caption "/catalog" or "catalog": a many-product photo, not a document
            throttle(f"listing:{tid}:{digits}", 10, 600, "too many catalog photos")
            data, _ = _dl(s, m)
            return Catalog(tid, actor, p["id"], data, m)  # the model runs after this transaction has closed (see _catalog)
        if m.media_kind in ("image", "document"):
            data, mime = _dl(s, m)
            if m.media_kind == "document":  # sheets/Word/CSV arrive as documents; Telegram gives no mime
                mime = sniff(data, m.media_name, mime) or mime
            res = pipeline.ingest_supplier_document(conn, tid, data=data, mime=mime, party_id=p["id"], channel=m.channel, actor=actor,
                                                    external_id=m.external_id, ilmu_client=s.ilmu, ocr=s.ocr)
        elif m.text and not m.media_kind:
            res = pipeline.ingest_supplier_document(conn, tid, text=m.text, party_id=p["id"], channel=m.channel, actor=actor,
                                                    external_id=m.external_id, ilmu_client=s.ilmu)
        else:
            raise ApiError(415, "unsupported_media", "supplier documents: send a PDF, photo or text")
        lang = _lang(cfg, m.text)
        return T[lang]["received"].format(doc=res["doc_no"] or T[lang]["doc"])
    text = m.text if not m.media_kind else None
    if m.media_kind == "audio":
        try:
            data, mime = _dl(s, m)
            text = pipeline.transcribe(data, mime or "audio/ogg", s.ilmu)
        except Exception as e:  # a voice note we cannot hear is the customer's to resend, not a silent failure
            log.warning("inbound %s voice note failed: %s", _h(m.external_id), type(e).__name__)
        if not text:
            return T[_lang(cfg, None)]["voice"]
    if not text:
        raise ApiError(415, "unsupported_media", "enquiries: send text or a voice note")
    lang = _lang(cfg, text)
    thanks, ext = "", m.external_id
    held = conn.execute("select pending_enquiry is not null h from parties where id=%s", (p["id"],)).fetchone()["h"] if _profile_on(m) else False
    if held:  # this message answers "your name and phone number?"; the first enquiry is still waiting
        out, kept = _profile_answer(conn, tid, p["id"], text, lang)
        if out is not None:
            return out
        text, ext, thanks = kept
    elif (r := availability.answer(conn, tid, p["id"], text, s.ilmu, channel=m.channel, external_id=m.external_id)) is not None:
        return r
    if pipeline.classify_reply(text) and (hit := pipeline.record_reply(conn, p["id"], m.channel, text, m.external_id)):
        return T[lang]["noted"].format(doc=hit["doc_no"]) + _closed(cfg, lang)  # the owner records accept or decline
    if _profile_on(m) and not held:  # a new Telegram customer: name and number first, then the quote
        who = conn.execute("select phone, profile_tries n from parties where id=%s", (p["id"],)).fetchone()
        if not who["phone"] and who["n"] < PROFILE_TRIES:
            conn.execute("update parties set pending_enquiry=%s where id=%s", (Jsonb({"text": text, "ext": m.external_id}), p["id"]))
            return T[lang]["ask_profile"]
    try:
        res = pipeline.handle_enquiry(conn, tid, p["id"], m.channel, text, external_id=ext, ilmu_client=s.ilmu)
    except ApiError as e:
        if e.code not in CLARIFY:  # anything else (no cost on file, AI down) is our problem, not the customer's
            raise
        return _clarify(conn, tid, lang)
    return thanks + T[lang]["thanks"].format(doc=res["doc_no"]) + _closed(cfg, lang)


def _catalog(s, j: Catalog) -> str | None:
    """Phase two of a '/catalog' photo: the model call holds no transaction or lock, the store is a short one of its own."""
    try:
        d = listings.describe(j.data, http=getattr(s, "vision", None), ocr=s.ocr)
        with db.tx("staff", "system:webhook", tenant=db.ALL_TENANTS) as conn:
            res = listings.store(conn, j.tid, j.actor, d, party_id=j.party_id, note=j.m.text.strip()[:300], channel=j.m.channel)
        return f"Received your catalog photo: {res['item_count']} product(s) are queued for review."
    except Exception as e:
        what = e.code if isinstance(e, ApiError) else "vision_unavailable" if isinstance(e, VisionError) else type(e).__name__
        if isinstance(e, (ApiError, VisionError)):
            log.warning("inbound %s catalog photo rejected: %s", _h(j.m.external_id), what)
        else:
            log.exception("inbound %s failed", _h(j.m.external_id))
        with db.tx("staff", "system:webhook", tenant=db.ALL_TENANTS) as conn:
            _trace(conn, j.m, what)
        return SORRY


def _sorry(conn, m) -> str:
    """The apology in the business's language (English if anything about that cannot be looked up)."""
    try:
        with conn.transaction():
            tid, _ = resolve_tenant(conn, m, "".join(c for c in m.sender if c.isdigit()))
            return T[_lang(bot_settings(conn, tid) if tid and m.channel == "telegram" else NO_ROW, m.text)]["sorry"]
    except Exception:
        return SORRY


def _process(s, msgs, statuses=()):
    replies, later, outcomes = [], [], []  # outcomes: (message, ok) for the Telegram reaction; WhatsApp ignores it
    with db.tx("staff", "system:webhook", tenant=db.ALL_TENANTS) as conn:
        for wamid, st, at in statuses:
            if st == "read":  # sent -> read is the only status move; read_at is set either way
                conn.execute("""update documents d set read_at = coalesce(d.read_at, %s),
                                  status = case when d.status = 'sent' then 'read'::doc_status else d.status end
                                from messages m where m.document_id = d.id and m.external_id = %s and m.direction = 'out'""",
                             (at, wamid))
        for m in msgs:
            failed, note = False, None
            try:
                with conn.transaction():  # savepoint per message
                    text = _handle(conn, s, m)
                note = getattr(m, "notice", None)  # only when the consent row was kept
            except ApiError as e:
                log.warning("inbound %s rejected: %s", _h(m.external_id), e.message)
                text = _sorry(conn, m)
                _trace(conn, m, e.code)
            except psycopg.errors.UniqueViolation:  # a replay that raced past the duplicate check: the first copy won
                log.info("inbound %s is a duplicate", _h(m.external_id))
                text = None
            except Exception as e:
                log.exception("inbound %s failed", _h(m.external_id))
                text, failed = None, True
                _trace(conn, m, type(e).__name__)
            if note:
                replies.append((m.channel, m.sender, note, m.to))
            if isinstance(text, Catalog):
                later.append(text)
            elif text:
                replies.append((m.channel, m.sender, text, m.to))
            if not isinstance(text, Catalog):
                outcomes.append((m, not failed and text not in SORRYS))
    for j in later:  # the committed transaction above is closed: the model call below holds no lock
        text = _catalog(s, j)
        outcomes.append((j.m, text != SORRY))
        if text:
            replies.append((j.m.channel, j.m.sender, text, j.m.to))
    for ch, to, text, via in replies:  # after commit; a send failure never loses the stored document
        try:
            if getattr(text, "document", None):  # /mydata: the file, with the text as its caption
                data, name, bad = text.document
                try:
                    if ch == "telegram":
                        telegram.send_document(to, data, "application/json", name, text, client=s.http, token=via)
                    else:
                        whatsapp.send_document(to, data, "application/json", name, text, client=s.http, phone_id=via)
                except Exception as e:
                    log.warning("data file to %s failed: %s", _h(to), type(e).__name__)
                    s.send(ch, to, bad, via)
            elif getattr(text, "markup", None):  # the /start keyboard: only Telegram has one
                telegram.send_message(to, text, client=s.http, token=via, reply_markup=text.markup)
            else:
                s.send(ch, to, text, via)  # answer from the number the customer wrote to
        except Exception:
            log.exception("reply to %s failed", _h(to))
    return outcomes


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


def _tg_check(request: Request, secret: str):
    if not secret or not hmac.compare_digest(request.headers.get("x-telegram-bot-api-secret-token", "").encode(), secret.encode()):
        raise ApiError(403, "bad_secret", "invalid secret token")
    _cap(request)


async def _json(request: Request):
    try:
        return await request.json()
    except ValueError:
        raise ApiError(400, "bad_update", "unparseable update")


async def _tg_update(request: Request):
    try:
        return telegram.parse_update(await request.json())
    except (ValueError, KeyError, TypeError):
        raise ApiError(400, "bad_update", "unparseable update")


def _reactions(m) -> bool:
    """False when the owner switched the reaction and typing indicator off for this business (any failure to look it up: on)."""
    if not TG_ACK:
        return True
    try:
        with db.tx("staff", "system:webhook", tenant=db.ALL_TENANTS) as conn:
            tid = m.tenant_id or resolve_tenant(conn, m, "".join(c for c in m.sender if c.isdigit()))[0]
            return not tid or bot_settings(conn, tid)["reactions"]
    except Exception:
        return True


async def _tg_run(request: Request, m, token, run, ack=True):
    """Received (eyes), typing, then thumbs up or sad face around `run` (sync, returns [(message, ok)]). token None = the env bot."""
    if not (TG_ACK and ack):
        await run_in_threadpool(run)
        return
    kw = {"token": token} if token else {}
    http, mid = request.app.state.svc.http, m.external_id.rpartition(":")[2]

    async def ack(fn, *a):  # blocking httpx off the event loop; an ack must never break message handling
        try:
            await run_in_threadpool(lambda: fn(*a, client=http, **kw))
        except Exception as e:
            log.warning("telegram ack failed: %s", type(e).__name__)

    async def typing():
        while True:
            await ack(telegram.chat_action, m.sender, "typing")
            await asyncio.sleep(4)  # the indicator lasts 5 seconds

    await ack(telegram.react, m.sender, mid, "👀")
    task, emoji = asyncio.create_task(typing()), "😢"
    try:
        emoji = "👍" if all(ok for _, ok in await run_in_threadpool(run)) else "😢"
    finally:
        task.cancel()
        await ack(telegram.react, m.sender, mid, emoji)


@r.post("/telegram")
async def tg_inbound(request: Request):
    _tg_check(request, os.environ.get("TELEGRAM_WEBHOOK_SECRET", ""))
    if m := await _tg_update(request):
        await _tg_run(request, m, None, lambda: _process(request.app.state.svc, [m]), await run_in_threadpool(_reactions, m))
    return JR({"ok": True})


def _bot(key):
    with db.tx("staff", "system:webhook", tenant=db.ALL_TENANTS) as conn:
        return conn.execute("select tenant_id, bot_id, token_enc, secret_enc from tenant_telegram_bots where bot_key=%s", (key,)).fetchone()


@r.post("/telegram/b/{bot_key}")
async def tg_business(bot_key: str, request: Request):
    """A business's own customer bot (connected under Channels). Every message is for that business, answered by that bot."""
    bot = await run_in_threadpool(_bot, bot_key)
    if not bot:
        raise ApiError(404, "not_found", "not found")
    _tg_check(request, tgbots.decrypt(bot["secret_enc"]))
    if m := await _tg_update(request):
        m.tenant_id, m.to = bot["tenant_id"], tgbots.decrypt(bot["token_enc"])
        m.external_id = f"b{bot['bot_id']}:{m.external_id}"  # another bot's chat with the same person reuses chat and message numbers
        await _tg_run(request, m, m.to, lambda: _process(request.app.state.svc, [m]), await run_in_threadpool(_reactions, m))
    return JR({"ok": True})


# ---- the LARIS helper bot: owners and staff link their Telegram account here and send /catalog photos and supplier documents
LINK_CMD = re.compile(r"\s*/(?:start(?:@\w+)?\s+link_|link(?:@\w+)?\s+)(\S{1,64})\s*$", re.I)
UNLINK_CMD = re.compile(r"\s*/unlink(@\w+)?\s*$", re.I)
BAD_CODE = "That link did not work. Ask for a new one in the LARIS dashboard (Team, Link Telegram)."
NOT_LINKED = "Ask your business owner to send you a link from the LARIS dashboard."
HELPER_HELP = ("You are linked to LARIS. Send a product photo with the caption /catalog, or forward a supplier price list or PDF "
               "to record its prices. Send /unlink to disconnect.")
HANDLE_Q = "lower(btrim(coalesce(channel_handle,''))) in ('tg:' || %(s)s, 'telegram:' || %(s)s)"






NOT_OWNER = ("We could not connect your new bot. Link your Telegram as the business owner from the LARIS dashboard (Team, Link Telegram), "
             "then create the bot again.")




@r.post("/telegram/helper")
async def tg_helper(request: Request):
    from . import helper_bot  # here, not at the top: helper_bot imports this module
    _tg_check(request, os.environ.get("LARIS_HELPER_WEBHOOK_SECRET", ""))
    token = os.environ.get("LARIS_HELPER_BOT_TOKEN", "")
    if token and isinstance(upd := await _json(request), dict) and "managed_bot" in upd:
        await run_in_threadpool(helper_bot._managed_bot, request.app.state.svc, upd["managed_bot"], token)
    elif token and (m := await _tg_update(request)):
        await _tg_run(request, m, token, lambda: helper_bot._helper(request.app.state.svc, m, token))
    return JR({"ok": True})
