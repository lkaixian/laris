"""Invite a person to a business by emailed link (owner only), and the public preview / accept of that link.
The token (32 random bytes, url-safe) travels in the URL fragment of the link and is stored only as SHA-256. Invites last 7 days."""
import logging
import os
import secrets
from uuid import UUID

import psycopg
from fastapi import APIRouter, BackgroundTasks, Depends, Request
from pydantic import BaseModel, Field

from .. import auth, db, mailer
from .. import license as lic
from ..errors import ApiError
from ..invite_mail import invite_mail
from .auth_routes import USERNAME, pick_role
from .deps import Ctx, audit, read_ctx, reply, require_owner, svc, throttle, write_ctx
from .signup import Email

log = logging.getLogger("laris")
r = APIRouter(prefix="/api")
INVALID = (404, "invite_invalid", "This invitation is no longer valid")  # one answer for unknown, expired, revoked and used
SHOW = """select i.id, i.email, r.key as role_key, r.name as role_name,
          case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end as status, i.created_at, i.expires_at"""
FROM = " from invites i join roles r on r.id = i.role_id"


def _one(c, iid):
    return c.execute(SHOW + FROM + " where i.id=%s", (iid,)).fetchone()


def _mail(ctx: Ctx, request: Request, bg: BackgroundTasks, to: str, role_name: str, token: str):
    base = (os.environ.get("APP_PUBLIC_URL") or str(request.base_url)).rstrip("/")  # env first: the Host header is caller-controlled
    biz = ctx.conn.execute("select coalesce(display_name, name) n from tenants where id=%s", (ctx.tenant_id,)).fetchone()["n"]
    if not mailer.enabled():
        log.warning("invite created but email is off (MAILTRAP_API_TOKEN unset): nobody receives the link")
    bg.add_task(svc(request).mail, to, *invite_mail(biz, role_name, ctx.name, f"{base}/#/invite?token={token}"), category="invite")


class NewInvite(BaseModel, extra="forbid"):
    email: Email
    role: str | None = Field(None, pattern=r"^[a-z0-9][a-z0-9-]{0,39}$")  # a role key
    role_id: UUID | None = None


@r.post("/invites")
def create_invite(body: NewInvite, request: Request, bg: BackgroundTasks, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    throttle(f"invite:{ctx.tenant_id}", 20, 3600, "Too many invitations. Try again later.")
    role = pick_role(ctx, body.role_id, body.role)  # any role of this business, an owner-class one too: the owner decides
    c = ctx.conn
    if c.execute("select 1 from users where tenant_id=%s and lower(email)=%s", (ctx.tenant_id, body.email)).fetchone():
        raise ApiError(409, "already_member", "That person already has an account in this business.")
    lic.check_seat(ctx)
    c.execute("update invites set status='revoked' where tenant_id=%s and lower(email)=%s and status='pending'", (ctx.tenant_id, body.email))
    token = secrets.token_urlsafe(32)
    iid = c.execute("insert into invites(tenant_id, email, role_id, invited_by, token_sha256) values (%s,%s,%s,%s,%s) returning id",
                    (ctx.tenant_id, body.email, role["id"], ctx.user_id, auth.token_hash(token))).fetchone()["id"]
    audit(ctx, "invites", iid, f"invitation sent ({role['key']})")
    _mail(ctx, request, bg, body.email, role["name"], token)
    return reply(ctx, _one(c, iid), 201)


@r.get("/invites")
def list_invites(ctx: Ctx = Depends(read_ctx)):
    require_owner(ctx)
    return reply(ctx, ctx.conn.execute(SHOW + ", u.name as invited_by_name" + FROM + " left join users u on u.id = i.invited_by"
                                       " where i.tenant_id=%s order by i.created_at desc, i.id limit 100", (ctx.tenant_id,)).fetchall())


@r.post("/invites/{iid}/resend")
def resend_invite(iid: UUID, request: Request, bg: BackgroundTasks, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    c = ctx.conn
    row = c.execute("select status from invites where id=%s and tenant_id=%s for update", (iid, ctx.tenant_id)).fetchone()
    if not row:
        raise ApiError(404, "not_found", "invitation not found")
    if row["status"] != "pending":
        raise ApiError(409, "not_pending", "Only a pending or expired invitation can be sent again.")
    throttle(f"invite-resend:{iid}", 3, 3600, "This invitation was sent again too often. Try again later.")
    token = secrets.token_urlsafe(32)
    to = c.execute("update invites set token_sha256=%s, created_at=now(), expires_at=now() + interval '7 days' where id=%s returning email",
                   (auth.token_hash(token), iid)).fetchone()["email"]
    audit(ctx, "invites", iid, "invitation resent")
    _mail(ctx, request, bg, to, _one(c, iid)["role_name"], token)
    return reply(ctx, _one(c, iid))


@r.delete("/invites/{iid}")
def revoke_invite(iid: UUID, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    row = ctx.conn.execute("select status from invites where id=%s and tenant_id=%s for update", (iid, ctx.tenant_id)).fetchone()
    if not row:
        raise ApiError(404, "not_found", "invitation not found")
    if row["status"] != "pending":
        raise ApiError(409, "not_pending", "Only a pending invitation can be revoked.")
    ctx.conn.execute("update invites set status='revoked' where id=%s", (iid,))
    audit(ctx, "invites", iid, "invitation revoked")
    return reply(ctx, {"ok": True})


# ---- public: the person holding the link
class Preview(BaseModel, extra="forbid"):
    token: str = Field(min_length=1, max_length=200)


class Accept(Preview):
    name: str = Field(min_length=1, max_length=80)
    username: str = Field(pattern=USERNAME)
    password: str = Field(min_length=auth.MIN_PASSWORD, max_length=200)


@r.post("/invites/preview")
def preview(body: Preview, request: Request):
    throttle(f"invite-preview:ip:{auth.client_ip(request)}", 30, 900, "Too many requests. Try again later.")
    with db.tx("owner", "invite") as c:
        row = c.execute("""select coalesce(t.display_name, t.name) as business_name, r.name as role_name, i.email
                           from invites i join tenants t on t.id = i.tenant_id join roles r on r.id = i.role_id
                           where i.token_sha256=%s and i.status='pending' and i.expires_at > now()""", (auth.token_hash(body.token),)).fetchone()
    if not row:
        raise ApiError(*INVALID)
    return row


@r.post("/invites/accept", status_code=201)
def accept(body: Accept, request: Request):
    throttle(f"invite-accept:ip:{auth.client_ip(request)}", 20, 900, "Too many requests. Try again later.")
    if why := auth.weak_password(body.password, body.username):
        raise ApiError(422, "weak_password", why)
    pw = auth.hash_password(body.password)
    with db.tx("owner", "invite") as c:  # any ApiError below rolls the whole thing back, the invite included
        # the conditional update is the lock: of two simultaneous accepts of one token only one gets a row back
        inv = c.execute("""update invites set status='accepted', accepted_at=now() where token_sha256=%s and status='pending' and expires_at > now()
                           returning id, tenant_id, email, role_id""", (auth.token_hash(body.token),)).fetchone()
        if not inv:
            raise ApiError(*INVALID)
        tid, email = inv["tenant_id"], inv["email"]
        ctx = Ctx(c, "owner", None, tid, "")
        lic.gate("/api/invites/accept", ctx)
        lic.check_seat(ctx)
        role = c.execute("select key, class from roles where id=%s", (inv["role_id"],)).fetchone()
        if c.execute("select 1 from users where tenant_id=%s and lower(email)=%s", (tid, email)).fetchone():
            raise ApiError(409, "already_member", "That email already has an account in this business.")
        try:
            uid = c.execute("""insert into users(tenant_id, name, username, email, email_verified_at, role, role_id, password_hash, active)
                               values (%s,%s,%s,%s, now(), %s,%s,%s, true) returning id""",
                            (tid, body.name, body.username, email, role["class"], inv["role_id"], pw)).fetchone()["id"]
        except psycopg.errors.UniqueViolation:  # the email was checked above: this is the user name
            raise ApiError(409, "username_taken", "That username is already taken.")
        c.execute("update invites set accepted_user_id=%s where id=%s", (uid, inv["id"]))
        c.execute("update invites set status='revoked' where tenant_id=%s and lower(email)=%s and status='pending'", (tid, email))
        for ent, eid, ev in (("users", uid, f"user created via invite ({role['key']})"), ("invites", inv["id"], "invitation accepted")):
            c.execute("insert into audit_log(tenant_id, actor, entity, entity_id, event) values (%s,%s,%s,%s,%s)", (tid, str(uid), ent, eid, ev))
    return {"ok": True}
