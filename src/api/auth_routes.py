"""Login, logout, password change and (owner) user management."""
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .. import auth, db
from .. import license as lic
from ..errors import ApiError
from .deps import Ctx, audit, read_ctx, reply, require_owner, write_ctx
from .roles import find_role

r = APIRouter(prefix="/api")
USERNAME = r"^[A-Za-z0-9._-]{3,40}$"
USER = """select u.id, u.name, u.username, u.role, u.role_id, r.key as role_key, r.name as role_name, u.active"""
FROM = " from users u left join roles r on r.id = u.role_id"  # users.role is the class (owner|staff); role_key / role_name the role itself


def pick_role(ctx: Ctx, role_id, key):
    """The role row of this tenant named by role_id or by key (an old client sends owner / staff as `role`)."""
    if (role_id is None) == (key is None):
        raise ApiError(422, "role_needed", "send exactly one of role_id or role")
    row = find_role(ctx.conn, ctx.tenant_id, role_id, key)
    if not row:
        raise ApiError(422, "unknown_role", "no such role")
    return row


def _bearer_hash(request: Request) -> str:
    got = request.headers.get("authorization", "")
    return auth.token_hash(got[7:]) if got.startswith("Bearer ") else ""


@r.get("/auth/config")
def config():
    with db.tx("staff", "", tenant=db.ALL_TENANTS) as c:
        return {"login_required": not auth.header_mode_allowed(c)}


class Login(BaseModel, extra="forbid"):
    username: str = Field(min_length=1)  # a user name or an email (up to 254); longer or odd input is just a non-match (401), never a 422
    password: str = Field(min_length=1, max_length=200)
    business_id: UUID | None = None  # an email with accounts in several businesses: which one to sign in to


@r.post("/login")
def login(body: Login, request: Request):
    who = body.username[:255]  # (the request body size is capped elsewhere)
    key, ip = who.lower(), auth.client_ip(request)
    if auth.throttled(key, ip):
        raise ApiError(429, "too_many_attempts", "Too many failed sign-ins. Wait a few minutes and try again.")
    with db.tx("staff", "", tenant=db.ALL_TENANTS) as c:
        cands = c.execute("""select u.id, u.name, u.role, u.password_hash, t.id as tenant_id, coalesce(t.display_name, t.name) as business
                             from users u join tenants t on t.id = u.tenant_id
                             where u.active and (lower(u.username) = lower(%s) or (lower(u.email) = lower(%s) and u.email_verified_at is not null))
                               and (%s::uuid is null or u.tenant_id = %s) order by t.name, u.id limit 5""",
                          (who, who, body.business_id, body.business_id)).fetchall()  # an email works as the user name
        if not cands:
            auth.verify_password(body.password, None)  # one dummy scrypt: timing does not reveal unknown accounts
        good = [u for u in cands if auth.verify_password(body.password, u["password_hash"])]
        if not good:
            auth.failed(key, ip)
            raise ApiError(401, "bad_credentials", "Wrong username or password.")
        if len(good) > 1:  # a correct password for several businesses: nothing is signed in, and it is not a failure
            raise ApiError(409, "choose_business", "Choose which business to sign in to",
                           businesses=[{"id": str(u["tenant_id"]), "name": u["business"]} for u in good])
        u = good[0]
        auth.cleared(key)
        if auth.needs_rehash(u["password_hash"]):  # weaker scrypt parameters than today's: upgrade now that we hold the plaintext
            c.execute("update users set password_hash=%s where id=%s", (auth.hash_password(body.password), u["id"]))
        tok, exp = auth.new_session(c, u["id"], request.headers.get("user-agent", ""))
    return {"token": tok, "expires_at": exp.isoformat(), "user": {"id": str(u["id"]), "name": u["name"], "role": u["role"]}}


@r.post("/logout")
def logout(request: Request):
    got = request.headers.get("authorization", "")
    if got.startswith("Bearer "):
        with db.tx("staff", "", tenant=db.ALL_TENANTS) as c:
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
        USER + """, u.password_hash is not null as has_password,
                  (select count(*) from sessions s where s.user_id = u.id and s.expires_at > now()) as sessions,
                  coalesce(u.channel_handle, '') ~* '^\\s*(tg|telegram):' as telegram_linked"""
        + FROM + " where u.tenant_id=%s order by u.active desc, u.name", (ctx.tenant_id,)).fetchall())


class NewUser(BaseModel, extra="forbid"):
    name: str = Field(min_length=1, max_length=80)
    username: str = Field(pattern=USERNAME)
    role: str | None = Field(None, pattern=r"^[a-z0-9][a-z0-9-]{0,39}$")  # a role key
    role_id: UUID | None = None
    password: str = Field(min_length=auth.MIN_PASSWORD, max_length=200)


@r.post("/users")
def create_user(body: NewUser, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    ctx.conn.execute("select 1 from tenants where id=%s for update", (ctx.tenant_id,))  # serialise seat checks per business
    lic.check_seat(ctx)
    if why := auth.weak_password(body.password, body.username):
        raise ApiError(422, "weak_password", why)
    role = pick_role(ctx, body.role_id, body.role)
    try:
        uid = ctx.conn.execute(  # the class (users.role) follows the role row, by trigger
            "insert into users(tenant_id, name, username, role, role_id, password_hash) values (%s,%s,%s,%s,%s,%s) returning id",
            (ctx.tenant_id, body.name, body.username, role["class"], role["id"], auth.hash_password(body.password))).fetchone()["id"]
    except psycopg.errors.UniqueViolation:
        raise ApiError(409, "username_taken", "That username is already taken.")
    audit(ctx, "users", uid, f"user created ({role['key']})")
    return reply(ctx, ctx.conn.execute(USER + FROM + " where u.id=%s", (uid,)).fetchone(), 201)


class EditUser(BaseModel, extra="forbid"):
    name: str | None = Field(None, min_length=1, max_length=80)
    role: str | None = Field(None, pattern=r"^[a-z0-9][a-z0-9-]{0,39}$")  # a role key
    role_id: UUID | None = None
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
    if sets.get("active") and not u["active"]:
        c.execute("select 1 from tenants where id=%s for update", (ctx.tenant_id,))
        lic.check_seat(ctx)  # reactivating takes a seat too
    if sets.keys() & {"role", "role_id"}:
        sets["role_id"] = pick_role(ctx, sets.pop("role_id", None), sets.pop("role", None))["id"]  # users.role follows it, by trigger
        new_class = find_role(ctx.conn, ctx.tenant_id, sets["role_id"])["class"]
    loses_owner = u["role"] == "owner" and u["active"] and (("role_id" in sets and new_class != "owner") or sets.get("active") is False)
    if loses_owner and not owners - {uid}:
        raise ApiError(409, "last_owner", "There must be at least one active owner.")
    if "password" in sets:
        if why := auth.weak_password(sets["password"], u["username"]):
            raise ApiError(422, "weak_password", why)
        sets["password_hash"] = auth.hash_password(sets.pop("password"))
    c.execute("update users set " + ", ".join(f"{k}=%({k})s" for k in sets) + " where id=%(id)s", {**sets, "id": uid})
    if sets.keys() & {"password_hash", "active", "role_id"}:
        auth.revoke_credentials(c, uid)  # API token and every session: force a fresh sign-in
    audit(ctx, "users", uid, "user changed: " + ",".join(sorted(k for k in sets if k != "password_hash")) + (", password" if "password_hash" in sets else ""))
    return reply(ctx, c.execute(USER + FROM + " where u.id=%s", (uid,)).fetchone())
