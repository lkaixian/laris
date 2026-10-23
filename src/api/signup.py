"""Public self-service: register a business (email-verified), resend the code, reset a forgotten password by emailed code.
Every answer is the same whether or not the email exists. Codes are 6 digits, stored as HMAC-SHA256, 10 minutes, 5 wrong tries."""
import hashlib
import hmac
import logging
import os
import secrets
from typing import Annotated

import psycopg
from fastapi import APIRouter, BackgroundTasks, Request
from pydantic import AfterValidator, BaseModel, BeforeValidator, Field

from .. import auth, db, mailer
from ..errors import ApiError
from ..templates import KEY_RE, TemplateError
from .deps import svc, throttle

log = logging.getLogger("laris")
r = APIRouter(prefix="/api")
OK = {"ok": True, "message": "If this email can be used, we sent a 6-digit code"}
BAD_CODE = ("invalid_code", "invalid or expired code")
MAX_TRIES, MINUTES = 5, 10


def _clean(v):
    """Trim and drop control characters; names are plain text (the UI escapes, nothing is stored as markup)."""
    return "".join(ch for ch in v if ch.isprintable()).strip() if isinstance(v, str) else v


def _email(v: str) -> str:
    v = v.strip().lower()
    local, _, domain = v.rpartition("@")
    if not local or "." not in domain or domain[0] == "." or domain[-1] == "." or any(ch.isspace() or ch in "<>,;\"'" for ch in v):
        raise ValueError("not a valid email address")
    return v


Email = Annotated[str, Field(max_length=254), AfterValidator(_email)]
Name = Annotated[str, BeforeValidator(_clean), Field(min_length=2, max_length=80)]
Code = Annotated[str, Field(pattern=r"^[0-9]{6}$")]


class Signup(BaseModel, extra="forbid"):
    business_name: Name
    owner_name: Name
    email: Email
    password: str = Field(min_length=auth.MIN_PASSWORD, max_length=200)
    trade_template: str = Field(pattern=KEY_RE.pattern)


class EmailOnly(BaseModel, extra="forbid"):
    email: Email


class Verify(EmailOnly):
    code: Code


class Reset(Verify):
    new_password: str = Field(min_length=auth.MIN_PASSWORD, max_length=200)


def _digest(user_id, purpose: str, code: str) -> str:
    """Keyed with SECRET_KEY, else a key derived from DATABASE_URL (secret, and the same on every restart and instance). The key stays out
    of the database: with only 10^6 possible codes, an unkeyed hash from a stolen row would fall to brute force."""
    key = (os.environ.get("SECRET_KEY") or "laris-codes:" + db.url()).encode()
    return hmac.new(key, f"{purpose}:{user_id}:{code}".encode(), hashlib.sha256).hexdigest()


def _issue(c, user_id, tenant_id, purpose: str) -> str:
    """A fresh code; every older one of the same purpose dies."""
    code = f"{secrets.randbelow(10 ** 6):06d}"
    c.execute("update email_codes set used_at = now() where user_id=%s and purpose=%s and used_at is null", (user_id, purpose))
    c.execute("insert into email_codes(purpose, user_id, tenant_id, code_hash, expires_at) values (%s,%s,%s,%s, now() + %s * interval '1 minute')",
              (purpose, user_id, tenant_id, _digest(user_id, purpose, code), MINUTES))
    return code


def _redeem(c, u, purpose: str, code: str) -> bool:
    """True once, for the user's newest live code. A wrong guess counts (the caller commits it); MAX_TRIES wrong ones kill the code."""
    row = c.execute("""select id, code_hash from email_codes where user_id=%s and purpose=%s and used_at is null and expires_at > now() and attempts < %s
                       order by created_at desc, id desc limit 1 for update""", (u["id"], purpose, MAX_TRIES)).fetchone() if u else None
    good = hmac.compare_digest(_digest(u["id"] if u else "", purpose, code), row["code_hash"] if row else "0" * 64)
    if not (row and good):
        if row:
            c.execute("update email_codes set attempts = attempts + 1 where id=%s", (row["id"],))
        return False
    c.execute("update email_codes set used_at = now() where id=%s", (row["id"],))
    return True


def _echo(code: str) -> dict:
    """Demo only: SIGNUP_DEV_ECHO=1 hands the code back when email is off, so a local demo works without a mailbox. Never when email is on."""
    return {"dev_code": code} if os.environ.get("SIGNUP_DEV_ECHO") == "1" and not mailer.enabled() else {}


def _guard(request: Request, what: str, email: str, n_ip: int, n_email: int, window: int):
    throttle(f"{what}:ip:{auth.client_ip(request)}", n_ip, window, "Too many requests. Try again later.")
    throttle(f"{what}:{email}", n_email, window, "Too many requests for this email. Try again later.")


def _drop_pending(c, u):
    """Delete an unverified signup: the user (its codes cascade) and, since it was alone in it, the tenant it created."""
    c.execute("delete from users where id=%s", (u["id"],))
    if not c.execute("select 1 from users where tenant_id=%s", (u["tenant_id"],)).fetchone():
        for t in ("tenant_fields", "field_proposals", "roles"):
            c.execute(f"delete from {t} where tenant_id=%s", (u["tenant_id"],))
        c.execute("delete from tenants where id=%s", (u["tenant_id"],))


@r.post("/signup", status_code=202)
def signup(body: Signup, request: Request, bg: BackgroundTasks):
    _guard(request, "signup", body.email, 5, 3, 3600)
    if why := auth.weak_password(body.password, body.email.split("@")[0]):
        raise ApiError(422, "weak_password", why)
    pw = auth.hash_password(body.password)  # also for an existing email, so the answer takes the same time
    echo = {}
    try:
        with db.tx("owner", "signup") as c:
            u = c.execute("select id, tenant_id, email_verified_at from users where lower(email)=%s for update", (body.email,)).fetchone()
            if u and u["email_verified_at"]:
                mail = (body.email, *mailer.exists_mail())
            else:
                if u:
                    _drop_pending(c, u)  # a retry replaces the earlier unverified attempt
                try:
                    tid = db.create_tenant(c, body.business_name, body.trade_template)
                except TemplateError:
                    raise ApiError(422, "unknown_template", "unknown trade template")
                uid = c.execute("insert into users(tenant_id, name, email, role, password_hash, active) values (%s,%s,%s,'owner',%s,false) returning id",
                                (tid, body.owner_name, body.email, pw)).fetchone()["id"]
                code = _issue(c, uid, tid, "verify")
                mail, echo = (body.email, *mailer.verification_mail(code, body.owner_name)), _echo(code)
                if not mailer.enabled():
                    log.warning("signup created but email is off (MAILTRAP_API_TOKEN unset): nobody receives the code")
    except psycopg.errors.UniqueViolation:  # two signups for one email at the same moment: the other one wins
        return {**OK}
    bg.add_task(svc(request).mail, *mail, category="signup")
    return {**OK, **echo}


@r.post("/signup/verify")
def verify(body: Verify, request: Request):
    throttle(f"verify:ip:{auth.client_ip(request)}", 30, 900, "Too many requests. Try again later.")
    with db.tx("owner", "signup") as c:
        u = c.execute("select id from users where lower(email)=%s and not active and email_verified_at is null for update", (body.email,)).fetchone()
        ok = _redeem(c, u, "verify", body.code)
        if ok:
            c.execute("update users set active=true, email_verified_at=now() where id=%s", (u["id"],))
    if not ok:
        raise ApiError(400, *BAD_CODE)
    return {"ok": True}


@r.post("/signup/resend", status_code=202)
def resend(body: EmailOnly, request: Request, bg: BackgroundTasks):
    _guard(request, "resend", body.email, 10, 3, 900)
    echo = {}
    with db.tx("owner", "signup") as c:
        u = c.execute("select id, tenant_id, name from users where lower(email)=%s and not active and email_verified_at is null for update", (body.email,)).fetchone()
        if u:
            code = _issue(c, u["id"], u["tenant_id"], "verify")
            bg.add_task(svc(request).mail, body.email, *mailer.verification_mail(code, u["name"]), category="signup")
            echo = _echo(code)
    return {**OK, **echo}


@r.post("/password/forgot", status_code=202)
def forgot(body: EmailOnly, request: Request, bg: BackgroundTasks):
    _guard(request, "forgot", body.email, 10, 3, 900)
    echo = {}
    with db.tx("owner", "signup") as c:
        u = c.execute("select id, tenant_id, name from users where lower(email)=%s and active and email_verified_at is not null for update", (body.email,)).fetchone()
        if u:
            code = _issue(c, u["id"], u["tenant_id"], "reset")
            bg.add_task(svc(request).mail, body.email, *mailer.reset_mail(code, u["name"]), category="password-reset")
            echo = _echo(code)
    return {**OK, **echo}


@r.post("/password/reset")
def reset(body: Reset, request: Request):
    throttle(f"reset:ip:{auth.client_ip(request)}", 30, 900, "Too many requests. Try again later.")
    if why := auth.weak_password(body.new_password, body.email.split("@")[0]):
        raise ApiError(422, "weak_password", why)  # before the code is spent
    with db.tx("owner", "signup") as c:
        u = c.execute("select id, username from users where lower(email)=%s and active and email_verified_at is not null for update", (body.email,)).fetchone()
        ok = _redeem(c, u, "reset", body.code)
        if ok:
            c.execute("update users set password_hash=%s where id=%s", (auth.hash_password(body.new_password), u["id"]))
            auth.revoke_credentials(c, u["id"])  # API token and every session
    if not ok:
        raise ApiError(400, *BAD_CODE)
    auth.cleared(body.email)
    if u["username"]:
        auth.cleared(u["username"].lower())
    return {"ok": True}
