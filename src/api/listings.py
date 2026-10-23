"""Catalog photos: one photo, many labelled products. A vision model proposes the items; a human confirms each one beside its own crop.
Nothing here prices anything: a price is only shown if OCR also saw it, and only to roles that may see supplier costs."""
import io
import logging
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import Response
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .. import vision
from ..errors import ApiError
from .deps import Ctx, audit, guarded, read_ctx, reply, require_perm, svc, throttle, write_ctx
from .routes import MAGIC, read_capped
from . import rfq

log = logging.getLogger("laris")
r = APIRouter(prefix="/api")

MAX_IMAGE = 8_000_000
IMAGES = ("image/jpeg", "image/png", "image/webp")
COLS = "id, position, description, labels, sku, sizes, price, currency, bbox, status, reasons, item_key"


def create_listing(conn, tenant_id, user_id, data: bytes, mime: str, *, party_id=None, note=None, channel="upload",
                   http=None, ocr=None) -> dict:
    """Read the photo, store it with one cropped picture per product. Used by the API and by the chat '/catalog' path.
    Raises vision.VisionError. The items are all 'needs_review'."""
    items = vision.describe_listing(data, mime, client=http, **({"ocr": ocr} if ocr else {}))
    pics = vision.crops(data, items)
    lid = conn.execute("""insert into listings(tenant_id,created_by,party_id,note,source_channel,image,image_mime)
                          values (%s,%s,%s,%s,%s,%s,%s) returning id""",
                       (tenant_id, user_id, party_id, note, channel, data, mime)).fetchone()["id"]
    for n, (it, pic) in enumerate(zip(items, pics)):
        conn.execute("""insert into listing_items(listing_id,tenant_id,position,description,labels,sku,sizes,price,currency,bbox,crop,status,reasons)
                        values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'needs_review',%s)""",
                     (lid, tenant_id, n, it["description"], Jsonb(it["labels"]), it["sku"], Jsonb(it["sizes"]), it["price"], it["currency"],
                      Jsonb(it["bbox"]), pic, Jsonb(it["reasons"])))
    conn.execute("insert into audit_log(tenant_id,actor,entity,entity_id,event,after) values (%s,%s,'listings',%s,%s,%s)",
                 (tenant_id, str(user_id) if user_id else f"system:{channel}", lid, f"catalog photo read: {len(items)} item(s) to review",
                  Jsonb({"items": len(items), "channel": channel})))
    return {"listing_id": lid, "item_count": len(items)}


def _item(ctx: Ctx, lid, x: dict) -> dict:
    """Prices are supplier costs: without view_costs the price and currency are not sent at all."""
    price = x["price"] if ctx.costs else None
    return {**x, "price": price, "currency": x["currency"] if price is not None else None,
            "crop_url": f"/api/listings/{lid}/items/{x['id']}/crop"}


def _items(ctx: Ctx, lid) -> list[dict]:
    return [_item(ctx, lid, x) for x in ctx.conn.execute(
        f"select {COLS} from listing_items where listing_id=%s and tenant_id=%s order by position", (lid, ctx.tenant_id)).fetchall()]


@r.post("/listings")
def upload(request: Request, image: UploadFile = File(...), supplier_id: UUID | None = Form(None),
           note: str | None = Form(None, max_length=300), ctx: Ctx = Depends(write_ctx)):
    require_perm(ctx, "upload_documents")
    if miss := vision.missing_env():
        raise ApiError(503, "vision_not_configured", "vision not configured: set " + ", ".join(miss))
    throttle(f"listing:{ctx.user_id}", 10, 600, "Too many catalog photos in 10 minutes. Wait a while.")  # each one is a GPU call
    data = read_capped(image, MAX_IMAGE, "photo over 8 MB")
    mime = next((m for sig, m in MAGIC if data.startswith(sig)), None)
    if mime not in IMAGES:
        raise ApiError(415, "unsupported_media", "send a JPEG, PNG or WebP photo")
    if supplier_id and not ctx.conn.execute("select 1 from parties where id=%s and tenant_id=%s and role='supplier'",
                                            (supplier_id, ctx.tenant_id)).fetchone():
        raise ApiError(422, "bad_supplier", "supplier_id is not a supplier of yours")
    s = svc(request)
    try:
        res = create_listing(ctx.conn, ctx.tenant_id, ctx.user_id, data, mime, party_id=supplier_id, note=(note or "").strip() or None,
                             http=getattr(s, "vision", None), ocr=s.ocr)
    except vision.VisionError as e:
        raise ApiError(502, "vision_unavailable", f"{e}; try again, or key the products in by hand")
    return reply(ctx, {**res, "items": _items(ctx, res["listing_id"])}, 201)


@r.get("/listings")
def listings(ctx: Ctx = Depends(read_ctx)):
    rows = ctx.conn.execute("""select l.id, l.party_id, p.name as party_name, l.note, l.source_channel, l.created_at,
                                      (select count(*) from listing_items i where i.listing_id=l.id) as items,
                                      (select count(*) from listing_items i where i.listing_id=l.id and i.status='needs_review') as to_review
                               from listings l left join parties p on p.id=l.party_id
                               where l.tenant_id=%s order by l.created_at desc, l.id limit 50""", (ctx.tenant_id,)).fetchall()
    return reply(ctx, [{**x, "image_url": f"/api/listings/{x['id']}/image"} for x in rows])


def _listing(ctx: Ctx, lid) -> dict:
    x = ctx.conn.execute("""select l.id, l.party_id, p.name as party_name, l.note, l.source_channel, l.created_at
                            from listings l left join parties p on p.id=l.party_id where l.id=%s and l.tenant_id=%s""", (lid, ctx.tenant_id)).fetchone()
    if not x:
        raise ApiError(404, "not_found", "catalog photo not found")
    return x


@r.get("/listings/{listing_id}")
def listing(listing_id: UUID, ctx: Ctx = Depends(read_ctx)):
    x = _listing(ctx, listing_id)
    return reply(ctx, {**x, "image_url": f"/api/listings/{x['id']}/image", "items": _items(ctx, listing_id)})


@r.get("/listings/{listing_id}/image")
def listing_image(listing_id: UUID, ctx: Ctx = Depends(read_ctx)):
    row = ctx.conn.execute("select image, image_mime from listings where id=%s and tenant_id=%s", (listing_id, ctx.tenant_id)).fetchone()
    if not row:
        raise ApiError(404, "not_found", "catalog photo not found")
    return Response(bytes(row["image"]), media_type=row["image_mime"])


def _crop_row(ctx: Ctx, listing_id, item_id) -> dict:
    row = ctx.conn.execute("select description, labels, sku, crop, crop_mime from listing_items where id=%s and listing_id=%s and tenant_id=%s",
                           (item_id, listing_id, ctx.tenant_id)).fetchone()
    if not row:
        raise ApiError(404, "not_found", "product not found")
    return row


@r.get("/listings/{listing_id}/items/{item_id}/crop")
def crop(listing_id: UUID, item_id: UUID, ctx: Ctx = Depends(read_ctx)):
    row = _crop_row(ctx, listing_id, item_id)
    return Response(bytes(row["crop"]), media_type=row["crop_mime"])


class ItemPatch(BaseModel, extra="forbid"):
    description: str | None = Field(None, max_length=300)
    sku: str | None = Field(None, max_length=80)
    sizes: list[str] | None = Field(None, max_length=30)
    price: Decimal | None = Field(None, gt=0, lt=Decimal(10) ** 10, decimal_places=4)
    status: Literal["confirmed", "discarded"] | None = None
    item_key: str | None = Field(None, pattern=r"^[a-z][a-z0-9_]{0,60}$")


@r.patch("/listings/{listing_id}/items/{item_id}")
def edit_item(listing_id: UUID, item_id: UUID, body: ItemPatch, ctx: Ctx = Depends(write_ctx)):
    require_perm(ctx, "upload_documents")
    ch = {k: getattr(body, k) for k in body.model_fields_set}
    if not ch or ("description" in ch and ch["description"] is None) or ("status" in ch and ch["status"] is None):
        raise ApiError(422, "empty", "nothing to change (description and status cannot be null)")
    if "price" in ch:
        require_perm(ctx, "view_costs")  # a price is a supplier cost
    if "sizes" in ch:
        ch["sizes"] = [s.strip()[:20] for s in ch["sizes"] or [] if s.strip()]
    c = ctx.conn
    old = c.execute(f"select {COLS} from listing_items where id=%s and listing_id=%s and tenant_id=%s for update",
                    (item_id, listing_id, ctx.tenant_id)).fetchone()
    if not old:
        raise ApiError(404, "not_found", "product not found")
    sets = ", ".join(f"{k}=%s" for k in ch)  # keys come from the model's own field names, never from the client
    with guarded():
        c.execute(f"update listing_items set {sets} where id=%s", [Jsonb(v) if k == "sizes" else v for k, v in ch.items()] + [item_id])
    audit(ctx, "listing_items", item_id, f"catalog product {ch['status']}" if "status" in ch else "catalog product edited",
          {k: old[k] for k in ch}, ch)
    return reply(ctx, _item(ctx, listing_id, c.execute(f"select {COLS} from listing_items where id=%s", (item_id,)).fetchone()))


class Ask(BaseModel, extra="forbid"):
    supplier_ids: list[UUID] = Field(min_length=1, max_length=rfq.MAX_SUPPLIERS)
    description: str | None = Field(None, max_length=200)
    note: str | None = Field(None, max_length=300)


@r.post("/listings/{listing_id}/items/{item_id}/ask")
def ask(listing_id: UUID, item_id: UUID, body: Ask, request: Request, ctx: Ctx = Depends(write_ctx)):
    """'How much?' about exactly this product: the same code as POST /api/rfq, with the crop as the photo."""
    row = _crop_row(ctx, listing_id, item_id)
    desc = (body.description or row["description"] or " ".join(row["labels"]) or row["sku"] or "catalog item").strip()[:200]
    return rfq.ask(request, UploadFile(io.BytesIO(bytes(row["crop"])), filename="crop.jpg"), desc, body.note or rfq.DEFAULT_NOTE,
                   None, body.supplier_ids, ctx)
