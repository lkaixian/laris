"""Licence status, activation (owner), and "request a licence" (owner). Verification and time: src/license.py, src/clock.py."""
import os
from datetime import datetime, timezone

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
    return reply(ctx, lic.status(ctx.conn, ctx.tenant_id))  # staff see the same status; the key and its holder stay in the database


class Activate(BaseModel, extra="forbid"):
    key: str = Field(min_length=1, max_length=lic.MAX_TOKEN)


def _owner_email(ctx: Ctx) -> str | None:
    """The activating owner's VERIFIED email (users.email + email_verified_at), lowercase; None when the account has none."""
    u = ctx.conn.execute("select lower(email) e from users where id=%s and email_verified_at is not null", (ctx.user_id,)).fetchone()
    return u["e"] if u else None


@r.post("/license")
def activate(body: Activate, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    throttle(f"license:{ctx.tenant_id}", 10, 3600, "Too many licence attempts. Try again later.")
    if not lic.configured():
        raise ApiError(409, "licensing_off", "This installation does not enforce licences.")
    p, _ = lic.inspect(body.key)
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
                         (body.key.strip(), p["lid"], p["email"], p["plan"], p["seats"], p["expires_at"], ctx.tenant_id))
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
