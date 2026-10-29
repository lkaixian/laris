"""Public self-service: register a business (email-verified), resend the code, reset a forgotten password by emailed code.
Every answer is the same whether or not the email exists. Codes are 6 digits, stored as HMAC-SHA256, 10 minutes, 5 wrong tries."""
import hashlib
import hmac
import logging
import os
import secrets
from typing import Annotated

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
MAX_TRIES, MINUTES, MAX_DAILY = 5, 10, 10


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


def _digest(ident, purpose: str, code: str) -> str:
    """Keyed with SECRET_KEY, else a key derived from DATABASE_URL (secret, and the same on every restart and instance). The key stays out
    of the database: with only 10^6 possible codes, an unkeyed hash from a stolen row would fall to brute force."""
    key = (os.environ.get("SECRET_KEY") or "laris-codes:" + db.url()).encode()
    return hmac.new(key, f"{purpose}:{ident}:{code}".encode(), hashlib.sha256).hexdigest()


def _issue(c, user_id, tenant_id, purpose: str, code: str | None = None, ident=None) -> str:
    """A fresh code (or `code`, to share one across accounts); every older one of the same purpose dies for this user.
    `ident` is what the code is bound to: the user (default), or the email for a reset code valid for all its accounts."""
    code = code or f"{secrets.randbelow(10 ** 6):06d}"
    # wrong guesses follow the user, not the code: a re-requested code starts with the tries already spent in the last hour
    spent = c.execute("select coalesce(max(attempts), 0) n from email_codes where user_id=%s and purpose=%s and created_at > now() - interval '1 hour'",
                      (user_id, purpose)).fetchone()["n"]
    c.execute("update email_codes set used_at = now() where user_id=%s and purpose=%s and used_at is null", (user_id, purpose))
    c.execute("insert into email_codes(purpose, user_id, tenant_id, code_hash, expires_at, attempts) values (%s,%s,%s,%s, now() + %s * interval '1 minute', %s)",
              (purpose, user_id, tenant_id, _digest(ident or user_id, purpose, code), MINUTES, spent))
    return code


def _redeem(c, users, purpose: str, code: str, email: str | None = None):
    """The matched code row, once, among the live codes of `users` (None if none). Verify codes are bound to one user, so a code only
    activates its own account; with `email` (reset) one code is valid for the email and all its rows are spent together.
    A wrong guess counts against every live row (the caller commits it); MAX_TRIES wrong ones kill the code."""
    rows = c.execute("""select id, user_id, code_hash from email_codes where user_id = any(%s) and purpose=%s and used_at is null
                        and expires_at > now() and attempts < %s order by created_at desc, id desc for update""",
                     ([u["id"] for u in users], purpose, MAX_TRIES)).fetchall() if users else []
    hits = [r for r in rows if hmac.compare_digest(_digest(email or r["user_id"], purpose, code), r["code_hash"])]
    if not hits:
        c.execute("update email_codes set attempts = attempts + 1 where id = any(%s)", ([r["id"] for r in rows],))
        return None
    c.execute("update email_codes set used_at = now() where id = any(%s)", ([r["id"] for r in (rows if email else hits)],))
    return hits[0]


def _echo(code: str) -> dict:
    """Demo only: SIGNUP_DEV_ECHO=1 hands the code back when email is off, so a local demo works without a mailbox. Never when email is on,
    and never on a Replit deployment (a forgotten variable there would hand out account codes)."""
    deployed = os.environ.get("REPLIT_DEPLOYMENT") or os.environ.get("REPL_DEPLOYMENT")
    return {"dev_code": code} if os.environ.get("SIGNUP_DEV_ECHO") == "1" and not mailer.enabled() and not deployed else {}


def _guard(request: Request, what: str, email: str, n_ip: int, n_email: int, window: int):
    throttle(f"{what}:ip:{auth.client_ip(request)}", n_ip, window, "Too many requests. Try again later.")
    throttle(f"{what}:{email}", n_email, window, "Too many requests for this email. Try again later.")
    throttle(f"codes:{email}", MAX_DAILY, 86400, "Too many codes requested for this email today. Try again tomorrow.")  # signup, resend and reset together


def _drop_pending(c, u):  # u: an unverified owner alone in its tenant
    """Delete an unverified signup: the user (its codes cascade) and, since it was alone in it, the tenant it created."""
    c.execute("delete from users where id=%s", (u["id"],))
    if not c.execute("select 1 from users where tenant_id=%s", (u["tenant_id"],)).fetchone():
        for t in ("tenant_fields", "field_proposals", "roles"):
            c.execute(f"delete from {t} where tenant_id=%s", (u["tenant_id"],))
        c.execute("delete from tenants where id=%s", (u["tenant_id"],))


class Check(BaseModel, extra="forbid"):
    kind: str = Field(pattern="^(business|email)$")
    value: str = Field(min_length=1, max_length=254)


@r.post("/signup/check")
def check(body: Check, request: Request):
    """Is this business name / email free? Taken = an active (verified) account has it; an unverified attempt does not block."""
    throttle(f"check:ip:{auth.client_ip(request)}", 60, 300, "Too many checks. Try again in a few minutes.")
    with db.tx("owner", "signup") as c:
        if body.kind == "business":
            q = "select 1 from tenants t where (lower(display_name)=lower(%s) or lower(name)=lower(%s)) and exists (select 1 from users u where u.tenant_id=t.id and u.active)"
            args = (_clean(body.value),) * 2
        else:
            q, args = "select 1 from users where lower(email)=%s and active", (_email(body.value),)
        return {"available": not c.execute(q, args).fetchone()}


@r.post("/signup", status_code=202)
def signup(body: Signup, request: Request, bg: BackgroundTasks):
    _guard(request, "signup", body.email, 5, 3, 3600)
    if why := auth.weak_password(body.password, body.email.split("@")[0]):
        raise ApiError(422, "weak_password", why)
    pw = auth.hash_password(body.password)
    with db.tx("owner", "signup") as c:
        # the same email may own other businesses; only an earlier unverified attempt (alone in its own tenant) is replaced
        for u in c.execute("""select id, tenant_id from users u where lower(email)=%s and not active and email_verified_at is null
                              and not exists (select 1 from users o where o.tenant_id=u.tenant_id and o.id<>u.id) for update""", (body.email,)).fetchall():
            _drop_pending(c, u)
        try:
            tid = db.create_tenant(c, body.business_name, body.trade_template)
        except TemplateError:
            raise ApiError(422, "unknown_template", "unknown trade template")
        uid = c.execute("insert into users(tenant_id, name, email, role, password_hash, active) values (%s,%s,%s,'owner',%s,false) returning id",
                        (tid, body.owner_name, body.email, pw)).fetchone()["id"]
        code = _issue(c, uid, tid, "verify")
        if not mailer.enabled():
            log.warning("signup created but email is off (MAILTRAP_API_TOKEN unset): nobody receives the code")
    bg.add_task(svc(request).mail, body.email, *mailer.verification_mail(code), category="signup")
    return {**OK, **_echo(code)}


@r.post("/signup/verify")
def verify(body: Verify, request: Request):
    throttle(f"verify:ip:{auth.client_ip(request)}", 30, 900, "Too many requests. Try again later.")
    with db.tx("owner", "signup") as c:
        us = c.execute("select id from users where lower(email)=%s and not active and email_verified_at is null for update", (body.email,)).fetchall()
        hit = _redeem(c, us, "verify", body.code)  # bound to its own user: another pending account of this email stays pending
        if hit:
            c.execute("update users set active=true, email_verified_at=now() where id=%s", (hit["user_id"],))
    if not hit:
        raise ApiError(400, *BAD_CODE)
    return {"ok": True}


@r.post("/signup/resend", status_code=202)
def resend(body: EmailOnly, request: Request, bg: BackgroundTasks):
    _guard(request, "resend", body.email, 10, 3, 900)
    echo = {}
    with db.tx("owner", "signup") as c:
        u = c.execute("select id, tenant_id from users where lower(email)=%s and not active and email_verified_at is null for update", (body.email,)).fetchone()
        if u:
            code = _issue(c, u["id"], u["tenant_id"], "verify")
            bg.add_task(svc(request).mail, body.email, *mailer.verification_mail(code), category="signup")
            echo = _echo(code)
    return {**OK, **echo}


@r.post("/password/forgot", status_code=202)
def forgot(body: EmailOnly, request: Request, bg: BackgroundTasks):
    _guard(request, "forgot", body.email, 10, 3, 900)
    echo = {}
    with db.tx("owner", "signup") as c:
        us = c.execute("select id, tenant_id from users where lower(email)=%s and active and email_verified_at is not null order by id for update", (body.email,)).fetchall()
        if us:
            code = None  # ONE code for the email: one row per account, all bound to the email
            for u in us:
                code = _issue(c, u["id"], u["tenant_id"], "reset", code, body.email)
            bg.add_task(svc(request).mail, body.email, *mailer.reset_mail(code), category="password-reset")
            echo = _echo(code)
    return {**OK, **echo}


@r.post("/password/reset")
def reset(body: Reset, request: Request):
    throttle(f"reset:ip:{auth.client_ip(request)}", 30, 900, "Too many requests. Try again later.")
    if why := auth.weak_password(body.new_password, body.email.split("@")[0]):
        raise ApiError(422, "weak_password", why)  # before the code is spent
    with db.tx("owner", "signup") as c:
        us = c.execute("select id, username from users where lower(email)=%s and active and email_verified_at is not null order by id for update", (body.email,)).fetchall()
        ok = _redeem(c, us, "reset", body.code, body.email)
        if ok:  # the code proves the mailbox: every verified active account with this email gets the new password
            pw = auth.hash_password(body.new_password)
            for u in us:
                c.execute("update users set password_hash=%s where id=%s", (pw, u["id"]))
                auth.revoke_credentials(c, u["id"])  # API token and every session
    if not ok:
        raise ApiError(400, *BAD_CODE)
    auth.cleared(body.email)
    for u in us:
        if u["username"]:
            auth.cleared(u["username"].lower())
    return {"ok": True}
