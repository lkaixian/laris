"""Request context (one transaction per request), JSON rendering, staff scrubbing, injectable services."""
import hmac
import json
import os
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

import httpx
import psycopg
from psycopg.types.json import Jsonb
from fastapi import Request
from fastapi.responses import JSONResponse

from .. import db, ocr
from ..auth import header_mode_allowed, token_hash
from ..channels import telegram, whatsapp
from ..errors import ApiError

Q4 = Decimal("0.0001")


def _enc(o):
    if isinstance(o, Decimal):
        return str(o.quantize(Q4) if o.as_tuple().exponent < -4 else o)  # money stays a string, max 4 decimals
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if isinstance(o, UUID):
        return str(o)
    raise TypeError(type(o))


class JR(JSONResponse):
    def render(self, content) -> bytes:
        return json.dumps(content, default=_enc, ensure_ascii=False, separators=(",", ":")).encode()


# Keys a staff response must never carry, at any depth (belt and braces: builders also omit them).
STAFF_HIDE = {"cost", "unit_cost", "old_cost", "current_cost", "current_unit_cost", "cost_snapshot", "cost_item_id",
              "cost_date", "cost_is_stale", "margin", "margin_delta", "margin_pct", "line_margin", "line_cost",
              "supplier", "provenance", "source_doc_id", "source_doc_no", "source_line_id", "stale", "extraction"}


def scrub(x):
    if isinstance(x, dict):
        return {k: scrub(v) for k, v in x.items() if k not in STAFF_HIDE}
    if isinstance(x, list):
        return [scrub(v) for v in x]
    return x


@dataclass
class Ctx:
    conn: psycopg.Connection
    role: str
    user_id: UUID | None
    tenant_id: UUID
    name: str

    @property
    def owner(self) -> bool:
        return self.role == "owner"


def reply(ctx: Ctx, data, status: int = 200) -> JR:
    """EVERY API response goes through here: staff get scrub()."""
    return JR(data if ctx.owner else scrub(data), status_code=status)


def require_owner(ctx: Ctx):
    if not ctx.owner:
        raise ApiError(403, "owner_only", "owner role required")


def _open(request: Request, write: bool):
    """Identity, strongest first:
    1. a per-user API token (`Authorization: Bearer <token>`, stored only as SHA-256): user, role and tenant come from the DB row,
       X-Role / X-User are ignored;
    2. the shared APP_TOKEN: demo mode only (auth.header_mode_allowed), the caller names its user with X-Role / X-User,
       and that user must belong to the first tenant (never cross-tenant);
    3. no token: demo mode too, only when auth.header_mode_allowed. Otherwise 401."""
    got = request.headers.get("authorization", "")
    tok = got[7:] if got.startswith("Bearer ") else None
    shared = os.environ.get("APP_TOKEN")
    shared_ok = bool(shared) and tok is not None and hmac.compare_digest(tok.encode(), shared.encode())
    with db.tx("staff", "") as conn:
        u = conn.execute("""select u.id, u.tenant_id, u.name, u.role from users u
                            left join sessions s on s.user_id = u.id and s.token_sha256 = %(h)s and s.expires_at > now()
                            where u.active and (s.token_sha256 is not null
                                  or (u.token_sha256 = %(h)s and (u.token_expires_at is null or u.token_expires_at > now())))""",
                         {"h": token_hash(tok)}).fetchone() if tok and not shared_ok else None
        if u:
            role = u["role"]
            conn.execute("update sessions set last_seen_at = now() where token_sha256 = %s and (last_seen_at is null or last_seen_at < now() - interval '1 minute')",
                         (token_hash(tok),))  # at most one write a minute per session
        else:
            if (shared and not shared_ok) or (tok and not shared_ok) or not header_mode_allowed(conn):  # a token that matches nothing is never ignored
                raise ApiError(401, "bad_token", "missing or invalid bearer token")
            home = conn.execute("select id from tenants order by name, id limit 1").fetchone()["id"] if shared_ok else None
            role = (request.headers.get("x-role") or "staff").lower()
            if role not in ("owner", "staff"):
                raise ApiError(400, "bad_role", "X-Role must be owner or staff")
            uid = request.headers.get("x-user")
            if write and not uid:
                raise ApiError(401, "no_user", "X-User header required for writes")
            if uid:
                try:
                    uid = str(UUID(uid))
                except ValueError:
                    raise ApiError(401, "bad_user", "X-User is not a uuid")
                u = conn.execute("select id, tenant_id, name, role from users where id=%s and active", (uid,)).fetchone()
                if u and home and u["tenant_id"] != home:
                    u = None
            elif request.url.path == "/api/me":  # bootstrap only: the UI learns its id here, then sends X-User
                u = conn.execute("select id, tenant_id, name, role from users where role=%s and active and (%s::uuid is null or tenant_id=%s) order by name, id limit 1",
                                 (role, home, home)).fetchone()
            else:
                raise ApiError(401, "no_user", "X-User header required")
            if not u:
                raise ApiError(401, "unknown_user", "unknown user")
            if role == "owner" and u["role"] != "owner":
                raise ApiError(403, "not_owner", "this user is not an owner")
        conn.execute("select set_config('laris.role', %s, true), set_config('laris.actor', %s, true), set_config('laris.tenant', %s, true)",
                     (role, str(u["id"]), str(u["tenant_id"])))  # from here the database only shows this tenant's rows
        yield Ctx(conn, role, u["id"], u["tenant_id"], u["name"])


def read_ctx(request: Request):
    yield from _open(request, False)


def write_ctx(request: Request):
    yield from _open(request, True)


@contextmanager
def guarded():
    """Map DB guard / constraint errors to 403 / 409 (the statement must be the last thing before raising)."""
    try:
        yield
    except psycopg.errors.RaiseException as e:
        m = e.diag.message_primary or str(e)
        denied = m.startswith("role ") or m.startswith("approval needs")
        raise ApiError(403 if denied else 409, "forbidden" if denied else "conflict", m)
    except (psycopg.errors.IntegrityError, psycopg.errors.DataError) as e:
        raise ApiError(409, "conflict", e.diag.message_primary or str(e))


def audit(ctx: Ctx, entity: str, entity_id, event: str, before=None, after=None):
    j = Jsonb
    ctx.conn.execute(
        "insert into audit_log(tenant_id,actor,entity,entity_id,event,before,after) values (%s,%s,%s,%s,%s,%s,%s)",
        (ctx.tenant_id, str(ctx.user_id), entity, entity_id, event,
         j(before, dumps=lambda o: json.dumps(o, default=_enc)) if before is not None else None,
         j(after, dumps=lambda o: json.dumps(o, default=_enc)) if after is not None else None))


class Services:
    """Everything that touches the network. Tests replace these attributes with fakes."""

    def __init__(self):
        self.ilmu = None  # httpx.Client for ILMU (None = real)
        self.http = None  # httpx.Client for WhatsApp / Telegram (None = real)
        self.ocr = ocr

    def send(self, channel: str, to: str, text: str, phone_id: str | None = None) -> str:
        """phone_id: the tenant's own WhatsApp business number; None falls back to WHATSAPP_PHONE_NUMBER_ID."""
        if channel == "whatsapp":
            try:
                return whatsapp.send_text(to, text, client=self.http, phone_id=phone_id)
            except httpx.HTTPStatusError as e:  # 24h window closed: only an approved template can open the chat
                tpl = os.environ.get("WHATSAPP_FOLLOWUP_TEMPLATE")
                if not tpl or not whatsapp.is_outside_window(e):
                    raise
                return whatsapp.send_template(to, tpl, os.environ.get("WHATSAPP_TEMPLATE_LANG", "en"),
                                              [" ".join(text.split())[:1000]], client=self.http, phone_id=phone_id)
        if channel == "telegram":
            return telegram.send_message(to, text, client=self.http)
        raise ValueError(f"cannot send on {channel}")

    def upload_media(self, data: bytes, mime: str, phone_id: str | None = None) -> str:
        return whatsapp.upload_media(data, mime, client=self.http, phone_id=phone_id)

    def send_image(self, to: str, media_id: str, note: str, phone_id: str | None = None) -> str:
        """Photo + note to a supplier. Outside the 24h window only an approved template (image header) can open the chat."""
        try:
            return whatsapp.send_image(to, media_id, note, client=self.http, phone_id=phone_id)
        except httpx.HTTPStatusError as e:
            if not whatsapp.is_outside_window(e):
                raise
            tpl = os.environ.get("WHATSAPP_RFQ_TEMPLATE")
            if not tpl:
                raise RuntimeError("outside WhatsApp's 24h window and no WHATSAPP_RFQ_TEMPLATE is set; the supplier has to write to you first") from e
            return whatsapp.send_template(to, tpl, os.environ.get("WHATSAPP_TEMPLATE_LANG", "en"), [" ".join(note.split())[:1000]],
                                          header_image=media_id, client=self.http, phone_id=phone_id)

    def send_photo(self, chat_id: str, data: bytes, mime: str, note: str) -> str:
        return telegram.send_photo(chat_id, data, mime, note, client=self.http)

    def download(self, channel: str, ref: str, kind: str) -> tuple[bytes, str]:
        if channel == "whatsapp":
            return whatsapp.download_media(ref, client=self.http)
        data = telegram.get_file(ref, client=self.http)  # telegram gives no mime: sniff
        return data, "application/pdf" if data[:4] == b"%PDF" else {"audio": "audio/ogg"}.get(kind, "image/jpeg")


def svc(request: Request) -> Services:
    return request.app.state.svc
