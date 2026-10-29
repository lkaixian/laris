"""Ask suppliers: send a photographed item to suppliers on WhatsApp or Telegram, compare their price replies, accept one into the cost book.
Replies arrive through /webhooks/whatsapp and /webhooks/telegram (pipeline.record_rfq_reply). Supplier prices are owner-only, as everywhere."""
import json
import logging
import re
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import Response
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .. import pipeline, tgbots
from ..channels import telegram
from ..channels.telegram import NOT_STARTED
from ..errors import ApiError
from .deps import Ctx, audit, read_ctx, reply, require_owner, require_perm, svc, throttle, write_ctx
from .routes import MAGIC, Transition, read_capped, transition

log = logging.getLogger("laris")
r = APIRouter(prefix="/api")

DEFAULT_NOTE = "How much for the marked one? Any MOQ or bulk price?"
MAX_IMAGE, MAX_SUPPLIERS = 8_000_000, 20
IMAGES = ("image/jpeg", "image/png")  # WhatsApp image messages take nothing else (WebP is for stickers)


def _why(e: Exception, ch: str = "WhatsApp") -> str:
    """Short, safe reason shown to staff (no URLs, no tokens)."""
    if isinstance(e, httpx.HTTPStatusError):
        return f"{ch} refused it (HTTP {e.response.status_code})"
    if isinstance(e, RuntimeError) and (str(e) == NOT_STARTED or str(e).startswith(("outside WhatsApp's 24h window", "telegram "))):
        return str(e)[:200]  # the app's own fixed messages; any other RuntimeError may carry internals
    return f"could not reach {ch}"


@r.post("/rfq")
def ask(request: Request, image: UploadFile = File(...), description: str = Form(..., max_length=200),
        note: str = Form(DEFAULT_NOTE, max_length=300), circle: str | None = Form(None),
        supplier_ids: list[UUID] = Form(...), ctx: Ctx = Depends(write_ctx)):
    require_perm(ctx, "ask_suppliers")
    throttle(f"rfq:{ctx.tenant_id}", 10, 600, "Too many supplier requests in 10 minutes. Wait a while.")  # each one messages suppliers
    data = read_capped(image, MAX_IMAGE, "photo over 8 MB")
    mime = next((m for sig, m in MAGIC if data.startswith(sig)), None)
    if mime not in IMAGES:
        raise ApiError(415, "unsupported_media", "send a JPEG or PNG photo")
    description, note = description.strip(), note.strip() or DEFAULT_NOTE
    if not description:
        raise ApiError(422, "empty", "describe the item")
    ring = None
    if circle:
        try:
            ring = json.loads(circle)
            if not (isinstance(ring, dict) and all(isinstance(ring.get(k), (int, float)) and 0 <= ring[k] <= 1 for k in "xyr")):
                raise ValueError
            ring = {k: ring[k] for k in "xyr"}
        except ValueError:
            raise ApiError(422, "bad_circle", "circle must be {x, y, r} as fractions between 0 and 1")
    ids = list(dict.fromkeys(supplier_ids))
    if len(ids) > MAX_SUPPLIERS:
        raise ApiError(422, "too_many", f"at most {MAX_SUPPLIERS} suppliers per request")
    c = ctx.conn
    sup = {s["id"]: s for s in c.execute("select id, contact from parties where tenant_id=%s and role='supplier' and id = any(%s)",
                                         (ctx.tenant_id, ids)).fetchall()}
    for i in ids:
        contact = sup[i]["contact"] if i in sup else None
        tg = telegram.chat_of(contact)
        to = tg or "".join(ch for ch in (contact or "") if ch.isdigit())
        if not to or (not tg and re.match(r"\s*(tg|telegram):", contact, re.I)):  # "tg:abc" is a bad Telegram id, not a phone number
            raise ApiError(422, "bad_supplier", f"{i} is not a supplier of yours with a phone number or a tg:<chat id> contact")
        sup[i]["to"], sup[i]["tg"] = to, bool(tg)
    rfq = c.execute("""insert into rfq_items(tenant_id,created_by,description,note,circle,image,image_mime)
                       values (%s,%s,%s,%s,%s,%s,%s) returning id""",
                    (ctx.tenant_id, ctx.user_id, description, note, Jsonb(ring) if ring else None, data, mime)).fetchone()["id"]
    pn = c.execute("select wa_phone_number_id from tenants where id=%s", (ctx.tenant_id,)).fetchone()["wa_phone_number_id"]
    s, media, err = svc(request), None, None
    tk = (t,) if (t := tgbots.token_for(c, ctx.tenant_id)) else ()  # the business's own bot, else the env bot
    if not all(sup[i]["tg"] for i in ids):  # Telegram-only requests need no WhatsApp upload
        try:
            media = s.upload_media(data, mime, pn)  # once; the same id goes to every WhatsApp supplier
        except Exception as e:
            log.exception("rfq photo upload failed")
            err = _why(e)
    sends = []
    for i in ids:
        tg = sup[i]["tg"]
        wamid, e_msg = None, None if tg else err
        if tg or media:
            try:
                wamid = s.send_photo(sup[i]["to"], data, mime, note, *tk) if tg else s.send_image(sup[i]["to"], media, note, pn)
            except Exception as e:  # one supplier failing must not stop the rest
                log.exception("rfq send failed")
                e_msg = _why(e, "Telegram" if tg else "WhatsApp")
        st = "sent" if wamid else "failed"
        sid = c.execute("insert into rfq_sends(rfq_item_id,tenant_id,supplier_id,wamid,status,error) values (%s,%s,%s,%s,%s,%s) returning id",
                        (rfq, ctx.tenant_id, i, wamid, st, None if wamid else e_msg)).fetchone()["id"]
        if wamid:
            c.execute("insert into rfq_replies(send_id,tenant_id) values (%s,%s)", (sid, ctx.tenant_id))
        sends.append({"supplier_id": i, "status": st, "error": None if wamid else e_msg})
    audit(ctx, "rfq_items", rfq, f"asked {len(ids)} supplier(s) for a price", None,
          {"description": description, "sent": sum(x["status"] == "sent" for x in sends)})
    return reply(ctx, {"rfq_id": rfq, "sends": sends}, 201)


@r.get("/rfq")
def rfq_list(ctx: Ctx = Depends(read_ctx)):
    c = ctx.conn
    items = c.execute("select id, description, note, created_at from rfq_items where tenant_id=%s order by created_at desc, id limit 100",
                      (ctx.tenant_id,)).fetchall()
    by = {i["id"]: [] for i in items}
    for x in c.execute("""select r.id reply_id, r.send_id, s.supplier_id, p.name supplier_name, s.rfq_item_id, r.message_text,
                                 r.unit_price, r.min_qty, r.tiers, r.status
                          from rfq_replies r join rfq_sends s on s.id=r.send_id join parties p on p.id=s.supplier_id
                          where r.tenant_id=%s and s.rfq_item_id = any(%s) order by r.created_at, r.id""",
                       (ctx.tenant_id, list(by))).fetchall():
        o = "view_replies_prices" in ctx.perms  # supplier prices and their words; without it you learn only who has answered
        by[x["rfq_item_id"]].append({
            "reply_id": x["reply_id"], "send_id": x["send_id"], "supplier_id": x["supplier_id"], "supplier_name": x["supplier_name"],
            "text": (x["message_text"] or "") if o else "", "unit_price": x["unit_price"] if o else None,
            "min_qty": x["min_qty"] if o else None, "tiers": x["tiers"] if o else [],
            "status": x["status"] if o else ("waiting" if x["status"] == "waiting" else "needs_review")})
    return reply(ctx, [{**i, "image_url": f"/api/rfq/{i['id']}/image", "replies": by[i["id"]]} for i in items])


@r.get("/rfq/{rfq_id}/image")
def rfq_image(rfq_id: UUID, ctx: Ctx = Depends(read_ctx)):
    row = ctx.conn.execute("select image, image_mime from rfq_items where id=%s and tenant_id=%s", (rfq_id, ctx.tenant_id)).fetchone()
    if not row:
        raise ApiError(404, "not_found", "photo not found")
    return Response(bytes(row["image"]), media_type=row["image_mime"], headers={"Cache-Control": "private, max-age=3600"})


class Accept(BaseModel, extra="forbid"):
    item_key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,60}$")


@r.post("/rfq/{rfq_id}/replies/{reply_id}/accept")
def accept(rfq_id: UUID, reply_id: UUID, body: Accept, request: Request, ctx: Ctx = Depends(write_ctx)):
    """The owner takes a supplier's price: it becomes an inbound quotation that goes through the usual steps into the cost book."""
    require_owner(ctx)
    c = ctx.conn
    x = c.execute("""select r.id, r.status, r.unit_price, r.min_qty, r.tiers, s.supplier_id, i.description
                     from rfq_replies r join rfq_sends s on s.id=r.send_id join rfq_items i on i.id=s.rfq_item_id
                     where r.id=%s and i.id=%s and r.tenant_id=%s for update of r""", (reply_id, rfq_id, ctx.tenant_id)).fetchone()
    if not x:
        raise ApiError(404, "not_found", "reply not found")
    if x["status"] == "accepted":
        raise ApiError(409, "accepted", "this reply was already accepted")
    if x["unit_price"] is None:
        raise ApiError(409, "no_price", "no price was read from this reply; key it in under Documents instead")
    tiers = [(t["min_qty"], t["unit_price"]) for t in x["tiers"]]
    if not any(float(m) == float(x["min_qty"] or 1) for m, _ in tiers):  # the headline price is a line too, unless a tier already is it
        tiers.insert(0, (x["min_qty"] or 1, x["unit_price"]))
    raw = {"doc_no": f"RFQ-{str(reply_id)[:8]}", "lines": [
        {"description": x["description"], "item_key": body.item_key, "min_qty": str(m), "unit_price": str(p), "uom": "pcs"}
        for m, p in tiers]}
    res = pipeline.ingest_supplier_document(c, ctx.tenant_id, raw=raw, party_id=x["supplier_id"], channel="upload", actor=ctx.user_id)
    # the owner choosing the item and the price is the review (a price-jump flag is only a prompt to look); the flags stay in the audit
    c.execute("update document_lines set needs_review=false where document_id=%s", (res["doc_id"],))
    for to in ("reviewed", "accepted", "in_cost_book"):
        transition(res["doc_id"], Transition(to=to), request, ctx)  # the same guarded path as the Documents screen
    c.execute("update rfq_replies set status='accepted', doc_id=%s where id=%s", (res["doc_id"], reply_id))
    audit(ctx, "rfq_replies", reply_id, f"reply accepted into the cost book as {body.item_key}", None,
          {"doc_id": res["doc_id"], "doc_flags": res["doc_flags"]})
    return reply(ctx, {"reply_id": reply_id, "status": "accepted", "doc_id": res["doc_id"]})
