"""Owner-only: which WhatsApp number (phone_number_id) belongs to this business, and whether chat messages can reach it."""
import os

import psycopg
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..errors import ApiError
from .deps import Ctx, audit, read_ctx, reply, require_owner, write_ctx

r = APIRouter(prefix="/api")


class ChannelsEdit(BaseModel, extra="forbid"):
    wa_phone_number_id: str | None = Field(pattern=r"^\d{5,32}$")  # required key; null clears it


def _view(ctx: Ctx) -> dict:
    pn = ctx.conn.execute("select wa_phone_number_id from tenants where id=%s", (ctx.tenant_id,)).fetchone()["wa_phone_number_id"]
    set_scope = lambda t: ctx.conn.execute("select set_config('laris.tenant', %s, true)", (t,))
    set_scope("*")  # RLS hides other businesses from the request: widen for this one count, only a yes/no leaves
    many = ctx.conn.execute("select count(*) > 1 as m from tenants").fetchone()["m"]
    set_scope(str(ctx.tenant_id))
    me = str(ctx.tenant_id).lower()
    env = lambda k: os.environ.get(k, "").strip().lower() == me
    return {"wa_phone_number_id": pn, "whatsapp_mapped": bool(pn) or env("WHATSAPP_TENANT_ID"), "telegram_mapped": env("TELEGRAM_TENANT_ID"),
            "tenants_total_hint": many}  # true = several businesses: an unmapped channel drops unknown senders


@r.get("/settings/channels")
def get_channels(ctx: Ctx = Depends(read_ctx)):
    require_owner(ctx)
    return reply(ctx, _view(ctx))


@r.post("/settings/channels")
def set_channels(body: ChannelsEdit, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    old = ctx.conn.execute("select wa_phone_number_id from tenants where id=%s for update", (ctx.tenant_id,)).fetchone()["wa_phone_number_id"]
    try:
        with ctx.conn.transaction():  # savepoint: a refused number leaves the request usable
            ctx.conn.execute("update tenants set wa_phone_number_id=%s where id=%s", (body.wa_phone_number_id, ctx.tenant_id))
    except psycopg.errors.UniqueViolation:  # the index sees every business, the request sees one: never say whose
        raise ApiError(409, "number_in_use", "That WhatsApp number is already connected to a business.")
    audit(ctx, "tenants", ctx.tenant_id, "channel settings changed", {"wa_phone_number_id": old}, {"wa_phone_number_id": body.wa_phone_number_id})
    return reply(ctx, _view(ctx))
