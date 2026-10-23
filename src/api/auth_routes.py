"""Login, logout, password change and (owner) user management."""
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .. import auth, db
from ..errors import ApiError
from .deps import Ctx, audit, read_ctx, reply, require_owner, write_ctx

r = APIRouter(prefix="/api")
USERNAME = r"^[A-Za-z0-9._-]{3,40}$"


def _bearer_hash(request: Request) -> str:
    got = request.headers.get("authorization", "")
    return auth.token_hash(got[7:]) if got.startswith("Bearer ") else ""


@r.get("/auth/config")
def config():
    with db.tx("staff", "") as c:
        return {"login_required": not auth.header_mode_allowed(c)}


class Login(BaseModel, extra="forbid"):
    username: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=1, max_length=200)


@r.post("/login")
def login(body: Login, request: Request):
    key, ip = body.username.lower(), auth.client_ip(request)
    if auth.throttled(key, ip):
        raise ApiError(429, "too_many_attempts", "Too many failed sign-ins. Wait a few minutes and try again.")
    with db.tx("staff", "") as c:
        u = c.execute("""select id, name, role, password_hash from users where lower(username) = lower(%s) and active""",
                      (body.username,)).fetchone()
        ok = auth.verify_password(body.password, u["password_hash"] if u else None)
        if not (u and ok):
            auth.failed(key, ip)
            raise ApiError(401, "bad_credentials", "Wrong username or password.")
        auth.cleared(key)
        if auth.needs_rehash(u["password_hash"]):  # weaker scrypt parameters than today's: upgrade now that we hold the plaintext
            c.execute("update users set password_hash=%s where id=%s", (auth.hash_password(body.password), u["id"]))
        tok, exp = auth.new_session(c, u["id"], request.headers.get("user-agent", ""))
    return {"token": tok, "expires_at": exp.isoformat(), "user": {"id": str(u["id"]), "name": u["name"], "role": u["role"]}}


@r.post("/logout")
def logout(request: Request):
    got = request.headers.get("authorization", "")
    if got.startswith("Bearer "):
        with db.tx("staff", "") as c:
            c.execute("delete from sessions where token_sha256 = %s", (auth.token_hash(got[7:]),))
    return {"ok": True}


class NewPassword(BaseModel, extra="forbid"):
    current: str = Field(min_length=1, max_length=200)
    new: str = Field(min_length=auth.MIN_PASSWORD, max_length=200)


@r.post("/me/password")
def change_password(body: NewPassword, request: Request, ctx: Ctx = Depends(write_ctx)):
    key = f"pw:{ctx.user_id}"
    if auth.throttled(key):
        raise ApiError(429, "too_many_attempts", "Too many wrong passwords. Wait a few minutes and try again.")
    row = ctx.conn.execute("select username, password_hash from users where id=%s", (ctx.user_id,)).fetchone()
    if not auth.verify_password(body.current, row["password_hash"]):
        auth.failed(key)
        raise ApiError(403, "bad_credentials", "Current password is wrong.")
    auth.cleared(key)
    if why := auth.weak_password(body.new, row["username"]):
        raise ApiError(422, "weak_password", why)
    ctx.conn.execute("update users set password_hash=%s where id=%s", (auth.hash_password(body.new), ctx.user_id))
    auth.revoke_credentials(ctx.conn, ctx.user_id, _bearer_hash(request))  # API token dies, other devices sign in again
    audit(ctx, "users", ctx.user_id, "password changed")
    return reply(ctx, {"ok": True})


# ---- own sessions (devices)
@r.get("/me/sessions")
def my_sessions(request: Request, ctx: Ctx = Depends(read_ctx)):
    return reply(ctx, ctx.conn.execute(
        """select id, created_at, last_seen_at, user_agent, token_sha256 = %s as current from sessions
           where user_id=%s and expires_at > now() order by created_at desc""", (_bearer_hash(request), ctx.user_id)).fetchall())


@r.post("/me/sessions/revoke-others")
def revoke_other_sessions(request: Request, ctx: Ctx = Depends(write_ctx)):
    n = ctx.conn.execute("delete from sessions where user_id=%s and token_sha256 <> %s", (ctx.user_id, _bearer_hash(request))).rowcount
    return reply(ctx, {"revoked": n})


@r.delete("/me/sessions/{sid}")
def revoke_session(sid: UUID, ctx: Ctx = Depends(write_ctx)):
    if not ctx.conn.execute("delete from sessions where id=%s and user_id=%s", (sid, ctx.user_id)).rowcount:
        raise ApiError(404, "not_found", "session not found")
    return reply(ctx, {"ok": True})


# ---- owner: manage accounts
@r.get("/users")
def users(ctx: Ctx = Depends(read_ctx)):
    require_owner(ctx)
    return reply(ctx, ctx.conn.execute(
        """select u.id, u.name, u.username, u.role, u.active, u.password_hash is not null as has_password,
                  (select count(*) from sessions s where s.user_id = u.id and s.expires_at > now()) as sessions
           from users u where u.tenant_id=%s order by u.active desc, u.name""", (ctx.tenant_id,)).fetchall())


class NewUser(BaseModel, extra="forbid"):
    name: str = Field(min_length=1, max_length=80)
    username: str = Field(pattern=USERNAME)
    role: str = Field(pattern="^(owner|staff)$")
    password: str = Field(min_length=auth.MIN_PASSWORD, max_length=200)


@r.post("/users")
def create_user(body: NewUser, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    if why := auth.weak_password(body.password, body.username):
        raise ApiError(422, "weak_password", why)
    try:
        u = ctx.conn.execute(
            "insert into users(tenant_id, name, username, role, password_hash) values (%s,%s,%s,%s,%s) returning id, name, username, role, active",
            (ctx.tenant_id, body.name, body.username, body.role, auth.hash_password(body.password))).fetchone()
    except psycopg.errors.UniqueViolation:
        raise ApiError(409, "username_taken", "That username is already taken.")
    audit(ctx, "users", u["id"], f"user created ({body.role})")
    return reply(ctx, u, 201)


class EditUser(BaseModel, extra="forbid"):
    name: str | None = Field(None, min_length=1, max_length=80)
    role: str | None = Field(None, pattern="^(owner|staff)$")
    active: bool | None = None
    password: str | None = Field(None, min_length=auth.MIN_PASSWORD, max_length=200)


@r.post("/users/{uid}")
def edit_user(uid: UUID, body: EditUser, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    c = ctx.conn
    # Lock every active owner (in id order, so two edits cannot deadlock) before reading anything: two simultaneous demotions
    # then queue, and the second one sees the first one's result when it counts owners.
    owners = {o["id"] for o in c.execute("select id from users where tenant_id=%s and role='owner' and active order by id for update", (ctx.tenant_id,))}
    u = c.execute("select id, username, role, active from users where id=%s and tenant_id=%s for update", (uid, ctx.tenant_id)).fetchone()
    if not u:
        raise ApiError(404, "not_found", "user not found")
    sets = body.model_dump(exclude_unset=True)
    if not sets:
        raise ApiError(422, "empty", "nothing to change")
    loses_owner = u["role"] == "owner" and u["active"] and (sets.get("role") == "staff" or sets.get("active") is False)
    if loses_owner and not owners - {uid}:
        raise ApiError(409, "last_owner", "There must be at least one active owner.")
    if "password" in sets:
        if why := auth.weak_password(sets["password"], u["username"]):
            raise ApiError(422, "weak_password", why)
        sets["password_hash"] = auth.hash_password(sets.pop("password"))
    c.execute("update users set " + ", ".join(f"{k}=%({k})s" for k in sets) + " where id=%(id)s", {**sets, "id": uid})
    if sets.keys() & {"password_hash", "active", "role"}:
        auth.revoke_credentials(c, uid)  # API token and every session: force a fresh sign-in
    audit(ctx, "users", uid, "user changed: " + ",".join(sorted(k for k in sets if k != "password_hash")) + (", password" if "password_hash" in sets else ""))
    return reply(ctx, c.execute("select id, name, username, role, active from users where id=%s", (uid,)).fetchone())
