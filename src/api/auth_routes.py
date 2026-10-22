"""Login, logout, password change and (owner) user management."""
import os
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .. import auth, db
from ..errors import ApiError
from .deps import Ctx, audit, read_ctx, reply, require_owner, write_ctx

r = APIRouter(prefix="/api")
USERNAME = r"^[A-Za-z0-9._-]{3,40}$"


def login_required() -> bool:
    """Header-only demo mode stays until real accounts exist (or the operator turns it off)."""
    if os.environ.get("REQUIRE_USER_TOKEN") == "1" or os.environ.get("APP_TOKEN"):
        return True
    with db.tx("staff", "") as c:
        return bool(c.execute("select 1 from users where password_hash is not null limit 1").fetchone())


@r.get("/auth/config")
def config():
    return {"login_required": login_required()}


class Login(BaseModel, extra="forbid"):
    username: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=1, max_length=200)


@r.post("/login")
def login(body: Login, request: Request):
    key = f"{body.username.lower()}|{request.client.host if request.client else ''}"
    if auth.throttled(key):
        raise ApiError(429, "too_many_attempts", "Too many failed sign-ins. Wait 15 minutes and try again.")
    with db.tx("staff", "") as c:
        u = c.execute("""select id, name, role, password_hash from users where lower(username) = lower(%s) and active""",
                      (body.username,)).fetchone()
        ok = auth.verify_password(body.password, u["password_hash"] if u else None)
        if not (u and ok):
            auth.failed(key)
            raise ApiError(401, "bad_credentials", "Wrong username or password.")
        auth.cleared(key)
        tok, exp = auth.new_session(c, u["id"], request.headers.get("user-agent", ""))
        c.execute("delete from sessions where expires_at < now()")
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
    row = ctx.conn.execute("select password_hash from users where id=%s", (ctx.user_id,)).fetchone()
    if not auth.verify_password(body.current, row["password_hash"]):
        raise ApiError(403, "bad_credentials", "Current password is wrong.")
    ctx.conn.execute("update users set password_hash=%s where id=%s", (auth.hash_password(body.new), ctx.user_id))
    got = request.headers.get("authorization", "")
    keep = auth.token_hash(got[7:]) if got.startswith("Bearer ") else ""
    ctx.conn.execute("delete from sessions where user_id=%s and token_sha256 <> %s", (ctx.user_id, keep))  # other devices sign in again
    audit(ctx, "users", ctx.user_id, "password changed")
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
    u = c.execute("select id, role, active from users where id=%s and tenant_id=%s for update", (uid, ctx.tenant_id)).fetchone()
    if not u:
        raise ApiError(404, "not_found", "user not found")
    sets = body.model_dump(exclude_unset=True)
    if not sets:
        raise ApiError(422, "empty", "nothing to change")
    loses_owner = u["role"] == "owner" and u["active"] and (sets.get("role") == "staff" or sets.get("active") is False)
    if loses_owner and not c.execute("select 1 from users where tenant_id=%s and role='owner' and active and id<>%s limit 1",
                                      (ctx.tenant_id, uid)).fetchone():
        raise ApiError(409, "last_owner", "There must be at least one active owner.")
    if "password" in sets:
        sets["password_hash"] = auth.hash_password(sets.pop("password"))
    c.execute("update users set " + ", ".join(f"{k}=%({k})s" for k in sets) + " where id=%(id)s", {**sets, "id": uid})
    if "password_hash" in sets or sets.get("active") is False or "role" in sets:
        c.execute("delete from sessions where user_id=%s", (uid,))  # force a fresh sign-in
    audit(ctx, "users", uid, "user changed: " + ",".join(sorted(k for k in sets if k != "password_hash")) + (", password" if "password_hash" in sets else ""))
    return reply(ctx, c.execute("select id, name, username, role, active from users where id=%s", (uid,)).fetchone())
