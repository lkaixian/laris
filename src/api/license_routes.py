"""Licence status, activation (owner), and "request a licence" (owner). Verification and time: src/license.py, src/clock.py."""
import base64
import os
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from uuid import UUID

import psycopg
from fastapi import APIRouter, BackgroundTasks, Depends, Request
from pydantic import BaseModel, Field

from .. import clock, license as lic
from ..errors import ApiError
from .deps import Ctx, audit, read_ctx, reply, require_owner, svc, throttle, write_ctx

r = APIRouter(prefix="/api")
BAD = "That licence key is not valid."


def _bad(hint: str = ""):
    raise ApiError(422, "invalid_license", f"{BAD} ({hint})" if hint else BAD)


@r.get("/license/plans")  # public: the sign-in / signup pages show it too
def plans():
    return {"plans": [{"key": k, "name": v["name"], "seats": v["seats"], "price": "Contact us"} for k, v in lic.PLANS.items()]}  # REAL DATA needed: prices


@r.get("/license")
def get_license(ctx: Ctx = Depends(read_ctx)):
    o = _offer(ctx) if ctx.owner else None  # not cached with the status: it changes the moment the issuer sends a licence
    offer = {"plan": o[1]["plan"], "seats": o[1]["seats"], "expires_at": lic._iso(o[1]["expires_at"])} if o else None
    return reply(ctx, {**lic.status(ctx.conn, ctx.tenant_id), "offer": offer})  # staff see the same status; the key and its holder stay in the database


class Activate(BaseModel, extra="forbid"):
    key: str = Field(min_length=1, max_length=lic.MAX_TOKEN)


def _owner_email(ctx: Ctx) -> str | None:
    """The activating owner's VERIFIED email (users.email + email_verified_at), lowercase; None when the account has none."""
    u = ctx.conn.execute("select lower(email) e from users where id=%s and email_verified_at is not null", (ctx.user_id,)).fetchone()
    return u["e"] if u else None


@r.post("/license")
def activate(body: Activate, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    return _activate(ctx, body.key)


def _activate(ctx: Ctx, key: str):
    """The one activation path: POST /api/license {key} and POST /api/license/accept-offer both end here."""
    throttle(f"license:{ctx.tenant_id}", 10, 3600, "Too many licence attempts. Try again later.")
    lic.refresh(ctx.conn)
    if not lic.configured():
        raise ApiError(409, "licensing_off", "This installation does not enforce licences.")
    p, _ = lic.inspect(key)
    if not p:
        _bad()  # signature / format: nothing about which check failed
    mine = _owner_email(ctx)
    if not mine:
        _bad("your account needs a verified email")
    if p["email"] != mine:
        _bad("not for this email")
    clk = clock.trusted_now(ctx.conn)
    if p["expires_at"] <= clk["now"]:
        _bad("expired")
    # Offline too long (UDP/123 blocked) is not a reason to refuse a valid key: the expiry above is judged against max(system clock, watermark),
    # so a clock that is not behind the watermark cannot make a key look valid for longer. The status stays clock_unverified (read-only) until NTP answers.
    if clk["unverified"] and clk["behind"]:
        raise ApiError(409, "clock_unverified", "The server cannot confirm today's date. Connect it to the internet and try again.")
    used = ctx.conn.execute("select count(*) n from users where tenant_id=%s and active", (ctx.tenant_id,)).fetchone()["n"]
    if p["seats"] < used:
        raise ApiError(409, "too_many_users", f"This licence covers {p['seats']} users but {used} accounts are active. Deactivate some or get a larger licence.")
    try:
        ctx.conn.execute("""update tenants set license_token=%s, license_id=%s, license_email=%s, license_plan=%s, license_seats=%s,
                            license_expires_at=to_timestamp(%s), license_activated_at=now() where id=%s""",
                         (key.strip(), p["lid"], p["email"], p["plan"], p["seats"], p["expires_at"], ctx.tenant_id))
    except psycopg.errors.UniqueViolation:  # RLS hides other tenants' rows, the unique index does not
        raise ApiError(409, "license_in_use", "That licence is already used by another organisation.")
    audit(ctx, "tenants", ctx.tenant_id, "license activated", None,
          {"license_id": p["lid"], "plan": p["plan"], "seats": p["seats"], "expires_at": datetime.fromtimestamp(p["expires_at"], timezone.utc).isoformat()})  # never the token
    lic.invalidate(ctx.tenant_id)
    return reply(ctx, lic.status(ctx.conn, ctx.tenant_id))


class Request_(BaseModel, extra="forbid"):
    plan: str = Field(pattern="^(" + "|".join(lic.PLANS) + ")$")
    seats: int = Field(ge=1, le=1000)
    note: str | None = Field(None, max_length=1000)


@r.post("/license/request", status_code=202)  # allowed while unlicensed (lic.ALLOWED)
def request_license(body: Request_, request: Request, bg: BackgroundTasks, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    u = ctx.conn.execute("select lower(email) e, name from users where id=%s", (ctx.user_id,)).fetchone()
    if not u["e"]:
        raise ApiError(422, "email_needed", "Your account needs an email address so we can reply.")
    throttle(f"licreq:{ctx.tenant_id}", 3, 86400, "You can send 3 licence requests a day. We have your earlier ones.")
    org = ctx.conn.execute("select coalesce(display_name, name) n from tenants where id=%s", (ctx.tenant_id,)).fetchone()["n"]
    rid = ctx.conn.execute("insert into license_requests(tenant_id, requested_by, email, plan, seats, note) values (%s,%s,%s,%s,%s,%s) returning id",
                           (ctx.tenant_id, ctx.user_id, u["e"], body.plan, body.seats, body.note)).fetchone()["id"]
    audit(ctx, "license_requests", rid, f"license requested: {body.plan} x{body.seats}")
    text = f"Organisation: {org}\nAccount: {u['name']} <{u['e']}>\nPlan: {body.plan}, seats: {body.seats}\nNote: {body.note or '-'}\nRequest id: {rid}"
    if issuer := os.environ.get("LICENSE_ISSUER_EMAIL", "").strip():
        bg.add_task(svc(request).mail, issuer, f"LARIS licence request: {org}", text, category="license-request")
    bg.add_task(svc(request).mail, u["e"], "We received your LARIS licence request",
                f"Hello {u['name']},\n\nWe received your request for the {body.plan} plan ({body.seats} seats). We will reply to this address.\n\nReference: {rid}",
                category="license-request")  # mail() never raises and is a no-op when email is off
    return reply(ctx, {"ok": True, "id": rid}, 202)


# ---- the platform operator's web page: the browser signs, the server only verifies (docs/licensing.md "Issuing from the web page")
def _offer(ctx: Ctx):
    """(request row, payload) of the newest issued, unexpired, not yet activated licence for this tenant's owner email, else None."""
    mine = _owner_email(ctx)
    if not mine:
        return None
    for q in ctx.conn.execute("""select id, issued_token from license_requests q where status = 'issued' and issued_token is not null and lower(email) = %s
                                 and issued_token is distinct from (select license_token from tenants where id = q.tenant_id) order by issued_at desc""", (mine,)).fetchall():
        p, _ = lic.inspect(q["issued_token"])
        if p and p["email"] == mine and p["expires_at"] > time.time():
            return q, p
    return None


@r.post("/license/accept-offer")
def accept_offer(ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    lic.refresh(ctx.conn)
    o = _offer(ctx)
    if not o:
        raise ApiError(404, "no_offer", "There is no licence waiting for you.")
    out = _activate(ctx, o[0]["issued_token"])
    ctx.conn.execute("update license_requests set issued_token = null where id = %s", (o[0]["id"],))
    return out


def _admin(ctx: Ctx):
    """Platform admin = a signed-in owner whose verified email is LICENSE_ISSUER_EMAIL. Anyone else gets 404 so the page does not advertise itself."""
    issuer = os.environ.get("LICENSE_ISSUER_EMAIL", "").strip().lower()
    if not (ctx.owner and issuer and _owner_email(ctx) == issuer):
        raise ApiError(404, "not_found", "Not found.")
    lic.refresh(ctx.conn)


@contextmanager
def _all_tenants(ctx: Ctx):
    """Cross-tenant reads and writes for the admin endpoints only (after _admin): scope '*' for a moment, then back to this tenant."""
    ctx.conn.execute("select set_config('laris.tenant', '*', true)")
    try:
        yield
    finally:
        ctx.conn.execute("select set_config('laris.tenant', %s, true)", (str(ctx.tenant_id),))


@r.get("/license/admin/config")
def admin_config(ctx: Ctx = Depends(read_ctx)):
    _admin(ctx)
    return reply(ctx, {"public_key": lic.raw_key() or None, "source": lic.source(), "enforced": lic.configured()})


class PublicKey(BaseModel, extra="forbid"):
    public_key: str = Field(min_length=1, max_length=200)
    confirm: bool = False


@r.post("/license/admin/public-key")
def admin_public_key(body: PublicKey, ctx: Ctx = Depends(write_ctx)):
    _admin(ctx)
    if lic.source() == "environment":
        raise ApiError(409, "key_from_environment", "The public key is set by the server environment; change it there.")
    key = lic.parse_key(body.public_key.strip())
    if key is None:
        raise ApiError(422, "bad_key", "That is not a base64 Ed25519 public key (32 bytes).")
    with _all_tenants(ctx):
        held = [t["license_token"] for t in ctx.conn.execute("select license_token from tenants where license_token is not null").fetchall()]
    n = sum(lic.inspect(t, key)[0] is None for t in held)  # licences this key would stop verifying
    if n and not body.confirm:
        raise ApiError(409, "would_invalidate", f"{n} organisation(s) hold a licence that this key does not verify.", licences=n)
    lic.set_key(ctx.conn, base64.b64encode(key.public_bytes_raw()).decode(), ctx.user_id)
    audit(ctx, "license_config", ctx.tenant_id, "license public key set", None, {"fingerprint": lic.fingerprint(key), "licences_invalidated": n})
    return reply(ctx, {"public_key": lic.raw_key(), "source": lic.source(), "enforced": lic.configured()})


@r.get("/license/admin/requests")
def admin_requests(ctx: Ctx = Depends(read_ctx)):
    _admin(ctx)
    with _all_tenants(ctx):
        rows = ctx.conn.execute("""select q.id, coalesce(t.display_name, t.name) org, q.email, q.plan, q.seats, q.note, q.created_at, q.status, q.issued_token
                                   from license_requests q join tenants t on t.id = q.tenant_id where q.status in ('new', 'issued')
                                   order by q.created_at desc""").fetchall()
    out = []
    for q in rows:
        p = lic.inspect(q["issued_token"])[0] if q["issued_token"] else None
        out.append({"id": q["id"], "org": q["org"], "email": q["email"], "plan": q["plan"], "seats": q["seats"], **({"note": q["note"]} if q["note"] else {}),
                    "requested_at": q["created_at"], "status": "issued" if q["status"] == "issued" else "pending",
                    "offer_expires_at": lic._iso(p["expires_at"]) if p else None})
    return reply(ctx, out)


class Issue(BaseModel, extra="forbid"):
    request_id: str = Field(min_length=1, max_length=64)
    token: str = Field(min_length=1, max_length=lic.MAX_TOKEN)


@r.post("/license/admin/issue")
def admin_issue(body: Issue, request: Request, ctx: Ctx = Depends(write_ctx)):
    _admin(ctx)
    try:
        rid = str(UUID(body.request_id))
    except ValueError:
        raise ApiError(404, "request_not_found", "No such licence request.")
    with _all_tenants(ctx):
        q = ctx.conn.execute("select id, email, plan, seats from license_requests where id = %s and status in ('new', 'issued')", (rid,)).fetchone()
    if not q:
        raise ApiError(404, "request_not_found", "No such licence request.")
    p, _ = lic.inspect(body.token)  # the same strict verification as activation, under the configured public key
    if not p:
        _bad()
    order = list(lic.PLANS)
    if (p["email"] != q["email"].lower() or p["seats"] > q["seats"] or p["plan"] not in order or q["plan"] not in order
            or order.index(p["plan"]) > order.index(q["plan"])):
        raise ApiError(422, "token_mismatch", "The signed licence does not match the request (email, plan or seats).")
    token = body.token.strip()
    with _all_tenants(ctx):
        ctx.conn.execute("update license_requests set status = 'issued', issued_token = %s, issued_at = now(), issued_license_id = %s where id = %s",
                         (token, p["lid"], rid))
    audit(ctx, "license_requests", rid, f"license issued: {p['plan']} x{p['seats']}", None, {"license_id": p["lid"], "email": p["email"]})  # never the token
    text = (f"Your LARIS licence ({p['plan']}, {p['seats']} seats) is ready. Sign in as the owner with this email address, open Licence and accept it, "
            f"or paste this key:\n\n{token}\n\nKeep it private: it works for one organisation.")
    emailed = bool(svc(request).mail(p["email"], "Your LARIS licence key", text, category="license"))  # best effort: mail() never raises
    return reply(ctx, {"ok": True, "emailed": emailed})
