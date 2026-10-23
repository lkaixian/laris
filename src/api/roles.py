"""Custom roles (owner only). Every role is class owner or staff; custom ones are always staff, so the owner-only actions that the
database guard protects (approving quotes, promoting to the cost book) can never be handed out. Catalog: src/perms.py."""
import re
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .. import perms
from ..errors import ApiError
from .deps import Ctx, audit, read_ctx, reply, require_owner, write_ctx

r = APIRouter(prefix="/api")
COLS = "id, key, name, class, is_system, permissions, created_at"


def find_role(conn, tenant_id, role_id=None, key=None):
    """The role row of this tenant by id or key, else None (another tenant's role is invisible: RLS and the tenant filter)."""
    return conn.execute(f"select {COLS} from roles where tenant_id=%s and (id=%s or key=%s)", (tenant_id, role_id, key)).fetchone()


def shown(row: dict, users: int) -> dict:
    p = perms.ALL if row["class"] == "owner" else perms.grant(row["permissions"])
    return {"id": row["id"], "key": row["key"], "name": row["name"], "class": row["class"], "is_system": row["is_system"],
            "permissions": sorted(p), "users": users}


def _list(ctx: Ctx):
    n = {x["role_id"]: x["n"] for x in ctx.conn.execute("select role_id, count(*) n from users where tenant_id=%s group by role_id", (ctx.tenant_id,))}
    return [shown(x, n.get(x["id"], 0)) for x in ctx.conn.execute(
        f"select {COLS} from roles where tenant_id=%s order by is_system desc, class, name", (ctx.tenant_id,))]


@r.get("/roles")
def roles(ctx: Ctx = Depends(read_ctx)):
    require_owner(ctx)
    return reply(ctx, {"roles": _list(ctx),
                       "catalog": [{"key": k, "label": v["label"], "description": v["description"], "group": v["group"], "default": v["default"]}
                                   for k, v in perms.CATALOG.items()],
                       "non_assignable": [{"key": k, "label": v} for k, v in perms.NON_ASSIGNABLE.items()]})


def _perms(keys: list[str]) -> list[str]:
    if bad := [k for k in keys if k not in perms.ASSIGNABLE]:
        owner_only = any(k in perms.NON_ASSIGNABLE for k in bad)
        raise ApiError(422, "not_assignable" if owner_only else "unknown_permission",
                       ("owner-only, cannot be given to a role: " if owner_only else "unknown permission: ") + ", ".join(sorted(bad)))
    return sorted(set(keys))


class NewRole(BaseModel, extra="forbid"):
    name: str = Field(min_length=1, max_length=60)
    permissions: list[str] = Field(max_length=50)


class RoleEdit(BaseModel, extra="forbid"):
    name: str | None = Field(None, min_length=1, max_length=60)
    permissions: list[str] | None = Field(None, max_length=50)


@r.post("/roles")
def create_role(body: NewRole, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    name, p = body.name.strip(), _perms(body.permissions)
    if not name:
        raise ApiError(422, "empty", "a role needs a name")
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:36] or "role"
    taken = {x["key"] for x in ctx.conn.execute("select key from roles where tenant_id=%s", (ctx.tenant_id,))}
    key = next(k for k in (base, *(f"{base}-{i}" for i in range(2, 1000))) if k not in taken)
    try:
        row = ctx.conn.execute(f"insert into roles(tenant_id, key, name, class, permissions) values (%s,%s,%s,'staff',%s) returning {COLS}",
                               (ctx.tenant_id, key, name, p)).fetchone()
    except psycopg.errors.UniqueViolation:
        raise ApiError(409, "name_taken", "A role with that name already exists.")
    audit(ctx, "roles", row["id"], f"role created: {name}", None, {"permissions": p})
    return reply(ctx, shown(row, 0), 201)


@r.patch("/roles/{rid}")
def edit_role(rid: UUID, body: RoleEdit, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    sets = body.model_dump(exclude_unset=True)
    if not sets or None in sets.values():
        raise ApiError(422, "empty", "nothing to change")
    old = ctx.conn.execute(f"select {COLS} from roles where id=%s and tenant_id=%s for update", (rid, ctx.tenant_id)).fetchone()
    if not old:
        raise ApiError(404, "not_found", "role not found")
    if old["class"] == "owner" or (old["is_system"] and "name" in sets):
        raise ApiError(409, "system_role", "The owner role cannot be changed, and system roles cannot be renamed.")
    if "name" in sets:
        sets["name"] = sets["name"].strip()
    if "permissions" in sets:
        sets["permissions"] = _perms(sets["permissions"])
    try:
        row = ctx.conn.execute("update roles set " + ", ".join(f"{k}=%({k})s" for k in sets) + f" where id=%(id)s returning {COLS}",
                               {**sets, "id": rid}).fetchone()
    except psycopg.errors.UniqueViolation:
        raise ApiError(409, "name_taken", "A role with that name already exists.")
    before = {"name": old["name"], "permissions": sorted(perms.grant(old["permissions"]))}
    audit(ctx, "roles", rid, "role changed: " + ",".join(sorted(sets)), before, {"name": row["name"], "permissions": sorted(perms.grant(row["permissions"]))})
    n = ctx.conn.execute("select count(*) n from users where role_id=%s", (rid,)).fetchone()["n"]
    return reply(ctx, shown(row, n))  # permissions are read on every request, so people holding the role feel it at once


@r.delete("/roles/{rid}")
def delete_role(rid: UUID, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    old = ctx.conn.execute(f"select {COLS} from roles where id=%s and tenant_id=%s for update", (rid, ctx.tenant_id)).fetchone()
    if not old:
        raise ApiError(404, "not_found", "role not found")
    if old["is_system"]:
        raise ApiError(409, "system_role", "System roles cannot be deleted.")
    if ctx.conn.execute("select 1 from users where role_id=%s limit 1", (rid,)).fetchone():
        raise ApiError(409, "role_in_use", "People still hold this role. Move them to another role first.")
    ctx.conn.execute("delete from roles where id=%s", (rid,))
    audit(ctx, "roles", rid, f"role deleted: {old['name']}")
    return reply(ctx, {"ok": True})
