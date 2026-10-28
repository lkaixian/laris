"""Telegram setup from the dashboard: the business's own customer bot (owner) and the link between a person and the LARIS helper bot.
Tokens are encrypted at rest (src/tgbots.py) and never leave the server: no response, audit row or log line carries one."""
import hashlib
import logging
import os
import re
import secrets
import time
import unicodedata
from typing import Annotated, Literal
from urllib.parse import urlencode
from uuid import UUID

import httpx
import psycopg
from fastapi import APIRouter, Depends, Request
from psycopg.types.json import Jsonb
from pydantic import BaseModel, BeforeValidator, Field

from .. import tgbots
from ..channels import telegram
from ..errors import ApiError
from . import channel_settings, webhooks
from .deps import Ctx, audit, read_ctx, reply, require_owner, svc, write_ctx

log = logging.getLogger("laris")
r = APIRouter(prefix="/api")
TOKEN_RE = re.compile(r"^\d{5,}:[A-Za-z0-9_-]{30,}$")
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0 O 1 I: read aloud or typed from a screenshot
TG_HANDLE = r"^\s*(tg|telegram):"
# ponytail: in memory per process (single worker). Live Telegram look-ups: 30 s per business; the helper's username: 1 h.
_LIVE, _HELPER = {}, {}


def _http(request):
    return svc(request).http


def _me(tok, request) -> dict:
    """The bot's getMe, cached 1 h (a failure, or a helper that cannot manage bots yet, is retried after a minute); {} when Telegram cannot be asked."""
    hit = _HELPER.get(tok)  # not (0, {}): a machine up for under an hour has monotonic() < 3600, which would pass an empty entry off as fresh
    at, me = hit if hit else (0, {})
    if hit is None or time.monotonic() - at > 3600:
        try:
            me = telegram.get_me(tok, client=_http(request))
        except Exception as e:
            log.warning("telegram getMe failed: %s", type(e).__name__)
            me = {}
        ok = me.get("username") and (me.get("can_manage_bots") or tok != os.environ.get("LARIS_HELPER_BOT_TOKEN", "").strip())
        _HELPER[tok] = (time.monotonic() if ok else time.monotonic() - 3540, me)
    return me


def _username(tok, request):
    return _me(tok, request).get("username")


def _helper(request) -> dict:
    tok = os.environ.get("LARIS_HELPER_BOT_TOKEN", "").strip()
    name = _username(tok, request) if tok else None
    return {"configured": bool(tok), "username": name, "link": f"https://t.me/{name}" if name else None}


def _create(ctx: Ctx, request) -> dict:
    """One-tap creation: a t.me/newbot link through the helper (the manager bot), with a suggested username and name."""
    tok = os.environ.get("LARIS_HELPER_BOT_TOKEN", "").strip()
    me = _me(tok, request) if tok else {}
    if not me.get("username") or not me.get("can_manage_bots"):
        return {"create_link": None, "create_blocked": "unavailable"}
    if not ctx.conn.execute("select 1 from users where id=%s and channel_handle ~* %s", (ctx.user_id, TG_HANDLE)).fetchone():
        return {"create_link": None, "create_blocked": "link_first"}  # the managed_bot update is matched to the business by the creator's linked chat
    name = ctx.conn.execute("select name from tenants where id=%s", (ctx.tenant_id,)).fetchone()["name"]
    slug = re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()).lstrip("0123456789")
    suffix = "_laris_bot"
    uname = (slug[:32 - len(suffix)] or "shop") + suffix
    return {"create_link": f"https://t.me/newbot/{me['username']}/{uname}?{urlencode({'name': name[:64]})}", "create_blocked": None}


def _live(tid, token, request) -> tuple:
    """(webhook_ok, last_error) from Telegram's getWebhookInfo, cached 30 s; (None, None) when Telegram cannot be asked."""
    at, val = _LIVE.get(tid, (0, None))
    if val is None or time.monotonic() - at > 30:
        try:
            i = telegram.webhook_info(client=_http(request), token=token)
            recent = bool(i.get("last_error_date")) and time.time() - i["last_error_date"] < 3600  # Telegram never clears the last error
            val = (bool(i.get("url")) and not recent, (i.get("last_error_message") or None) if recent else None)
        except Exception as e:
            log.warning("telegram getWebhookInfo failed: %s", type(e).__name__)
            val = (None, None)
        _LIVE[tid] = (time.monotonic(), val)
    return val


def _bot_view(ctx: Ctx, request) -> dict:
    row = ctx.conn.execute("select username, name, token_enc from tenant_telegram_bots where tenant_id=%s", (ctx.tenant_id,)).fetchone()
    env = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if row:
        try:
            tok = tgbots.decrypt(row["token_enc"])
        except Exception:  # SECRET_KEY changed or unset: the bot cannot be used until it is connected again
            tok = None
        ok, err = _live(ctx.tenant_id, tok, request) if tok else (None, "The saved token cannot be read. Connect the bot again.")
        return {"connected": True, "username": row["username"], "name": row["name"], "webhook_ok": ok, "last_error": err, "source": "dashboard"}
    v = channel_settings._view(ctx)
    if env and (v["telegram_mapped"] or not v["tenants_total_hint"]):  # the one env bot belongs to the TELEGRAM_TENANT_ID business, or the only one
        ok, err = _live(ctx.tenant_id, env, request)
        return {"connected": True, "username": _username(env, request), "name": None, "webhook_ok": ok, "last_error": err, "source": "environment"}
    return {"connected": False, "username": None, "name": None, "webhook_ok": None, "last_error": None, "source": None}


@r.get("/settings/telegram")
def get_telegram(request: Request, ctx: Ctx = Depends(read_ctx)):
    require_owner(ctx)
    staff = ctx.conn.execute("""select id as user_id, name, role, coalesce(channel_handle,'') ~* %s as linked from users
                                where tenant_id=%s and active order by name, id""", (TG_HANDLE, ctx.tenant_id)).fetchall()
    return reply(ctx, {"helper": _helper(request), "bot": {**_bot_view(ctx, request), **_create(ctx, request)}, "staff": staff})


class Connect(BaseModel, extra="forbid"):
    token: str


def _in_use(ctx: Ctx, bot_id) -> bool:
    c = ctx.conn
    c.execute("select set_config('laris.tenant', '*', true)")  # RLS hides other businesses: widen for this one yes/no
    hit = c.execute("select 1 from tenant_telegram_bots where bot_id=%s and tenant_id<>%s", (bot_id, ctx.tenant_id)).fetchone()
    c.execute("select set_config('laris.tenant', %s, true)", (str(ctx.tenant_id),))
    return bool(hit)


def connect_bot(ctx: Ctx, token: str, http) -> dict:
    """Validate, register and store a business's customer bot -> its getMe. Used by the dashboard and by one-tap creation (webhooks._managed_bot)."""
    token = token.strip()
    if not TOKEN_RE.match(token):
        raise ApiError(422, "bad_token", "That does not look like a bot token. Copy the whole token from BotFather.")
    tgbots.encrypt("x")  # raises 422 secret_key_unset before any network call
    base = os.environ.get("APP_PUBLIC_URL", "").strip().rstrip("/")
    if not base:
        raise ApiError(422, "public_url_unset", "This server does not know its public web address yet, so Telegram cannot be told where to send messages. Ask whoever runs this server to set APP_PUBLIC_URL.")
    try:
        me = telegram.get_me(token, client=http)
    except RuntimeError as e:  # "telegram getMe failed: HTTP 401": Telegram answered, and refused the token
        if str(e).endswith(("401", "404")):
            raise ApiError(422, "bad_token", "Telegram does not accept that token. Check it in BotFather and try again.") from None
        raise ApiError(502, "telegram_unreachable", "Telegram could not be reached. Try again in a minute.") from None
    except (httpx.HTTPError, OSError):
        raise ApiError(502, "telegram_unreachable", "Telegram could not be reached. Try again in a minute.") from None
    if _in_use(ctx, me["id"]):  # never say which business
        raise ApiError(409, "bot_in_use", "That bot is already connected to a business. Make a new bot in BotFather for this one.")
    key, secret = secrets.token_urlsafe(18), secrets.token_urlsafe(32)
    try:
        telegram.set_webhook(f"{base}/webhooks/telegram/b/{key}", secret, client=http, token=token)
    except (RuntimeError, httpx.HTTPError, OSError) as e:
        log.warning("telegram setWebhook failed: %s", type(e).__name__)
        raise ApiError(502, "telegram_unreachable", "Telegram did not accept the webhook address. Check the server's public address and try again.") from None
    try:
        telegram.set_commands(client=http, token=token)  # the Menu button; the bot works without it
    except Exception as e:
        log.warning("telegram setMyCommands failed: %s", type(e).__name__)
    old = ctx.conn.execute("select bot_id, token_enc from tenant_telegram_bots where tenant_id=%s", (ctx.tenant_id,)).fetchone()
    try:
        with ctx.conn.transaction():  # savepoint: a lost race leaves the request usable
            ctx.conn.execute("""insert into tenant_telegram_bots(tenant_id,bot_id,bot_key,username,name,token_enc,secret_enc,connected_by)
                                values (%s,%s,%s,%s,%s,%s,%s,%s)
                                on conflict (tenant_id) do update set bot_id=excluded.bot_id, bot_key=excluded.bot_key, username=excluded.username,
                                  name=excluded.name, token_enc=excluded.token_enc, secret_enc=excluded.secret_enc,
                                  connected_by=excluded.connected_by, created_at=now()""",
                             (ctx.tenant_id, me["id"], key, me.get("username") or "", me.get("first_name"), tgbots.encrypt(token),
                              tgbots.encrypt(secret), ctx.user_id))
    except psycopg.errors.UniqueViolation:
        raise ApiError(409, "bot_in_use", "That bot is already connected to a business. Make a new bot in BotFather for this one.") from None
    if old and old["bot_id"] != me["id"]:  # replaced: the old bot stops sending us messages
        try:
            telegram.delete_webhook(tgbots.decrypt(old["token_enc"]), client=http)
        except Exception as e:
            log.warning("telegram deleteWebhook failed: %s", type(e).__name__)
    _LIVE.pop(ctx.tenant_id, None)
    audit(ctx, "tenants", ctx.tenant_id, "telegram bot connected", None, {"bot": me.get("username")})
    return me


@r.post("/settings/telegram/connect")
def connect(body: Connect, request: Request, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    connect_bot(ctx, body.token, _http(request))
    return reply(ctx, _bot_view(ctx, request))


@r.post("/settings/telegram/disconnect")
def disconnect(request: Request, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    old = ctx.conn.execute("delete from tenant_telegram_bots where tenant_id=%s returning username, token_enc", (ctx.tenant_id,)).fetchone()
    if old:
        try:
            telegram.delete_webhook(tgbots.decrypt(old["token_enc"]), client=_http(request))
        except Exception as e:
            log.warning("telegram deleteWebhook failed: %s", type(e).__name__)
        _LIVE.pop(ctx.tenant_id, None)
        audit(ctx, "tenants", ctx.tenant_id, "telegram bot disconnected", {"bot": old["username"]}, None)
    return reply(ctx, _bot_view(ctx, request))


def _member(ctx: Ctx, uid):
    if not ctx.conn.execute("select 1 from users where id=%s and tenant_id=%s and active", (uid, ctx.tenant_id)).fetchone():
        raise ApiError(404, "not_found", "user not found")


def _link(ctx: Ctx, request, uid) -> dict:
    _member(ctx, uid)
    h = _helper(request)
    if not h["link"]:
        raise ApiError(409, "helper_not_configured", "The LARIS helper bot is not set up on this server yet, so Telegram accounts cannot be linked.")
    code = "".join(secrets.choice(ALPHABET) for _ in range(8))
    ctx.conn.execute("update telegram_link_codes set used_at=now() where user_id=%s and used_at is null", (uid,))  # the newest code is the only one
    exp = ctx.conn.execute("""insert into telegram_link_codes(tenant_id,user_id,code_hash,expires_at) values (%s,%s,%s, now() + interval '15 minutes')
                              returning expires_at""", (ctx.tenant_id, uid, hashlib.sha256(code.encode()).hexdigest())).fetchone()["expires_at"]
    audit(ctx, "users", uid, "telegram link code created")
    return reply(ctx, {"url": f"{h['link']}?start=link_{code}", "code": code, "expires_at": exp})


def _unlink(ctx: Ctx, uid) -> dict:
    _member(ctx, uid)
    ctx.conn.execute("update telegram_link_codes set used_at=now() where user_id=%s and used_at is null", (uid,))
    if ctx.conn.execute("update users set channel_handle=null where id=%s and channel_handle ~* %s returning id", (uid, TG_HANDLE)).fetchone():
        audit(ctx, "users", uid, "telegram unlinked")
    return reply(ctx, {"ok": True})


@r.post("/users/{uid}/telegram-link")
def link_user(uid: UUID, request: Request, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    return _link(ctx, request, uid)


@r.delete("/users/{uid}/telegram-link")
def unlink_user(uid: UUID, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    return _unlink(ctx, uid)


@r.post("/me/telegram-link")
def link_me(request: Request, ctx: Ctx = Depends(write_ctx)):
    return _link(ctx, request, ctx.user_id)


@r.delete("/me/telegram-link")
def unlink_me(ctx: Ctx = Depends(write_ctx)):
    return _unlink(ctx, ctx.user_id)



# ---- what the owner customised on the customer bot (webhooks.bot_settings reads it; no row = the defaults)
def _clean(v):
    return re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", v).strip() if isinstance(v, str) else v  # control characters out, newline and tab stay


def _txt(n, lo=0):
    return Annotated[str, BeforeValidator(_clean), Field(min_length=lo, max_length=n)]


HHMM = Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]


class AfterHoursIn(BaseModel, extra="forbid"):
    enabled: bool | None = None
    message: _txt(300) | None = None
    open: HHMM | None = None
    close: HHMM | None = None
    days: Annotated[list[Annotated[int, Field(ge=1, le=7)]], Field(min_length=1)] | None = None  # ISO weekdays: Monday = 1


class BotSettingsIn(BaseModel, extra="forbid"):
    welcome: _txt(600) | None = None
    help: _txt(1000) | None = None
    language: Literal["auto", "en", "ms"] | None = None
    quick_replies: Annotated[list[_txt(40, 1)], Field(max_length=4)] | None = None
    after_hours: AfterHoursIn | None = None
    reactions: bool | None = None


def _settings_view(cur: dict) -> dict:
    d = webhooks.T["en"]
    return {"welcome": cur["welcome"] or d["welcome"], "help": cur["help"] or d["help"], "language": cur["language"],
            "quick_replies": cur["quick_replies"], "after_hours": {**cur["after_hours"], "message": cur["after_hours"]["message"] or d["after"]},
            "reactions": cur["reactions"], "defaults": {"welcome": d["welcome"], "help": d["help"], "after_hours_message": d["after"]}}


@r.get("/settings/telegram/bot-settings")
def get_bot_settings(ctx: Ctx = Depends(read_ctx)):
    require_owner(ctx)
    return reply(ctx, _settings_view(webhooks.bot_settings(ctx.conn, ctx.tenant_id)))


@r.post("/settings/telegram/bot-settings")
def set_bot_settings(body: BotSettingsIn, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    d = body.model_dump(exclude_none=True)
    fields = sorted(d)
    cur = webhooks.bot_settings(ctx.conn, ctx.tenant_id)
    ah = {**cur["after_hours"], **d.pop("after_hours", {})}
    ah["days"] = sorted(set(ah["days"]))
    new = {**cur, **d, "after_hours": ah}
    ctx.conn.execute("""insert into tenant_bot_settings(tenant_id,welcome,help,language,quick_replies,after_hours,reactions) values (%s,%s,%s,%s,%s,%s,%s)
                        on conflict (tenant_id) do update set welcome=excluded.welcome, help=excluded.help, language=excluded.language,
                          quick_replies=excluded.quick_replies, after_hours=excluded.after_hours, reactions=excluded.reactions, updated_at=now()""",
                     (ctx.tenant_id, new["welcome"] or None, new["help"] or None, new["language"], Jsonb(new["quick_replies"]), Jsonb(ah), new["reactions"]))
    audit(ctx, "tenants", ctx.tenant_id, "telegram bot settings changed", None, {"fields": fields})
    return reply(ctx, _settings_view(new))
