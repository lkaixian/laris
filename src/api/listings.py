"""Catalog photos: one photo, many labelled products. A vision model proposes the items; a human confirms each one beside its own crop.
Nothing here prices anything: a price is only shown if OCR also saw it, and only to roles that may see supplier costs."""
import io
import logging
from contextlib import contextmanager
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import Response
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .. import ai_quota, vision
from ..errors import ApiError
from .deps import Ctx, audit, guarded, read_ctx, reply, require_perm, svc, throttle, write_ctx
from .routes import MAGIC, read_capped
from . import rfq

log = logging.getLogger("laris")
r = APIRouter(prefix="/api")

MAX_IMAGE = 8_000_000
IMAGES = ("image/jpeg", "image/png", "image/webp")
COLS = "id, position, description, labels, sku, sizes, price, currency, bbox, status, reasons, item_key, price_tiers, stock_qty, category, category_suggestion, cutout is not null as has_cutout"
CATEGORIZE = Literal["auto", "suggest", "manual"]  # auto keeps the reader's category, suggest only proposes it, manual ignores it


def describe(data: bytes, *, http=None, ocr=None) -> dict:
    """Validate and read the photo (the model call: seconds). Touches NO database: call it with no transaction open, so no row is locked meanwhile.
    Used by the API upload and the chat '/catalog' path. Raises ApiError or vision.VisionError. -> input for store()."""
    if len(data) > MAX_IMAGE:  # both entry points (API upload, chat /catalog) end here: the provider's size and mime are not trusted
        raise ApiError(413, "too_large", "photo over 8 MB")
    mime = next((m for sig, m in MAGIC if data.startswith(sig)), None)
    if mime not in IMAGES or (mime == "image/webp" and data[8:12] != b"WEBP"):
        raise ApiError(415, "unsupported_media", "send a JPEG, PNG or WebP photo")
    items = vision.describe_listing(data, mime, client=http, **({"ocr": ocr} if ocr else {}))
    return {"data": data, "mime": mime, "items": items, "pics": vision.crops(data, items)}


def store(conn, tenant_id, user_id, d: dict, *, party_id=None, note=None, channel="upload", categorize: str = "suggest") -> dict:
    """Store what describe() read, with one cropped picture per product. The items are all 'needs_review'."""
    items, data = d["items"], d["data"]
    lid = conn.execute("""insert into listings(tenant_id,created_by,party_id,note,source_channel,image,image_mime)
                          values (%s,%s,%s,%s,%s,%s,%s) returning id""",
                       (tenant_id, user_id, party_id, note, channel, data, d["mime"])).fetchone()["id"]
    from .catalog import category_names, keep, pick  # local: catalog imports this module
    cats = category_names(conn, tenant_id)  # grows as this photo proposes new ones, so "Filament" and "Filaments" in one photo become one
    for n, (it, pic) in enumerate(zip(items, d["pics"])):
        guess = pick(it.get("category"), cats) if categorize != "manual" else None
        if guess and guess.lower() not in {c.lower() for c in cats}:
            cats.append(guess)
        if guess and categorize == "auto":
            keep(conn, tenant_id, guess)
        conn.execute("""insert into listing_items(listing_id,tenant_id,position,description,labels,sku,sizes,price,currency,bbox,crop,status,reasons,category,category_suggestion)
                        values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'needs_review',%s,%s,%s)""",
                     (lid, tenant_id, n, it["description"], Jsonb(it["labels"]), it["sku"], Jsonb(it["sizes"]), it["price"], it["currency"],
                      Jsonb(it["bbox"]), pic, Jsonb(it["reasons"]), guess if categorize == "auto" else None, guess if categorize == "suggest" else None))
    conn.execute("insert into audit_log(tenant_id,actor,entity,entity_id,event,after) values (%s,%s,'listings',%s,%s,%s)",
                 (tenant_id, str(user_id) if user_id else f"system:{channel}", lid, f"catalog photo read: {len(items)} item(s) to review",
                  Jsonb({"items": len(items), "channel": channel})))
    return {"listing_id": lid, "item_count": len(items)}


def _item(ctx: Ctx, lid, x: dict) -> dict:
    """Prices are supplier costs: without view_costs the price and currency are not sent at all."""
    price = x["price"] if ctx.costs else None
    return {**x, "price": price, "currency": x["currency"] if price is not None or (ctx.costs and x["price_tiers"]) else None,
            "price_tiers": x["price_tiers"] if ctx.costs else [],
            "crop_url": f"/api/listings/{lid}/items/{x['id']}/crop",
            "cutout_url": f"/api/listings/{lid}/items/{x['id']}/cutout" if x["has_cutout"] else None}


def _items(ctx: Ctx, lid) -> list[dict]:
    return [_item(ctx, lid, x) for x in ctx.conn.execute(
        f"select {COLS} from listing_items where listing_id=%s and tenant_id=%s order by position", (lid, ctx.tenant_id)).fetchall()]


open_write = contextmanager(write_ctx)  # the same identity, licence gate and tenant scoping as Depends(write_ctx), but a short transaction we close ourselves


@r.post("/listings")
def upload(request: Request, image: UploadFile = File(...), supplier_id: UUID | None = Form(None),
           note: str | None = Form(None, max_length=300), categorize: CATEGORIZE = Form("suggest")):
    """No Depends(write_ctx): its transaction would stay open for the whole model call. Check inside one short transaction, read the photo
    with none open, then store in a second one."""
    with open_write(request) as ctx:
        require_perm(ctx, "manage_catalog")
        if miss := vision.missing_env():
            raise ApiError(503, "vision_not_configured", "vision not configured: set " + ", ".join(miss))
        ai_quota.check(ctx.conn, ctx.tenant_id, "photos")
        throttle(f"listing:{ctx.tenant_id}", 10, 600, "Too many catalog photos in 10 minutes. Wait a while.")  # each one is a GPU call
        data = read_capped(image, MAX_IMAGE, "photo over 8 MB")
        mime = next((m for sig, m in MAGIC if data.startswith(sig)), None)
        if mime not in IMAGES:
            raise ApiError(415, "unsupported_media", "send a JPEG, PNG or WebP photo")
        if supplier_id and not ctx.conn.execute("select 1 from parties where id=%s and tenant_id=%s and role='supplier'",
                                                (supplier_id, ctx.tenant_id)).fetchone():
            raise ApiError(422, "bad_supplier", "supplier_id is not a supplier of yours")
    s = svc(request)
    try:
        d = describe(data, http=getattr(s, "vision", None), ocr=s.ocr)
    except vision.VisionError as e:
        raise ApiError(502, "vision_unavailable", f"{e}; try again, or key the products in by hand")
    with open_write(request) as ctx:
        res = store(ctx.conn, ctx.tenant_id, ctx.user_id, d, party_id=supplier_id, note=(note or "").strip() or None, categorize=categorize)
        return reply(ctx, {**res, "items": _items(ctx, res["listing_id"])}, 201)


@r.get("/listings")
def listings(ctx: Ctx = Depends(read_ctx)):
    rows = ctx.conn.execute("""select l.id, l.party_id, p.name as party_name, l.note, l.source_channel, l.created_at,
                                      (select count(*) from listing_items i where i.listing_id=l.id) as items,
                                      (select count(*) from listing_items i where i.listing_id=l.id and i.status='needs_review') as to_review
                               from listings l left join parties p on p.id=l.party_id
                               where l.tenant_id=%s order by l.created_at desc, l.id limit 50""", (ctx.tenant_id,)).fetchall()
    return reply(ctx, [{**x, "image_url": f"/api/listings/{x['id']}/image", "thumb_url": f"/api/listings/{x['id']}/thumb"} for x in rows])


def _listing(ctx: Ctx, lid) -> dict:
    x = ctx.conn.execute("""select l.id, l.party_id, p.name as party_name, l.note, l.source_channel, l.created_at
                            from listings l left join parties p on p.id=l.party_id where l.id=%s and l.tenant_id=%s""", (lid, ctx.tenant_id)).fetchone()
    if not x:
        raise ApiError(404, "not_found", "catalog photo not found")
    return x


@r.get("/listings/categories")
def categories(ctx: Ctx = Depends(read_ctx)):
    """The business's own categories, for the picker."""
    return reply(ctx, [x["category"] for x in ctx.conn.execute(
        "select distinct category from listing_items where tenant_id=%s and category is not null order by category limit 200", (ctx.tenant_id,)).fetchall()])


@r.get("/listings/{listing_id}")
def listing(listing_id: UUID, ctx: Ctx = Depends(read_ctx)):
    x = _listing(ctx, listing_id)
    return reply(ctx, {**x, "image_url": f"/api/listings/{x['id']}/image", "items": _items(ctx, listing_id)})


@r.get("/listings/{listing_id}/image")
def listing_image(listing_id: UUID, ctx: Ctx = Depends(read_ctx)):
    row = ctx.conn.execute("select image, image_mime from listings where id=%s and tenant_id=%s", (listing_id, ctx.tenant_id)).fetchone()
    if not row:
        raise ApiError(404, "not_found", "catalog photo not found")
    if not row["image"]:
        raise ApiError(404, "expired", "photo removed after the retention period")
    return Response(bytes(row["image"]), media_type=row["image_mime"])


@r.get("/listings/{listing_id}/thumb")
def listing_thumb(listing_id: UUID, ctx: Ctx = Depends(read_ctx)):
    """Small upright JPEG of the whole photo for the gallery; the full image can be 8 MB."""
    from PIL import Image, ImageOps
    row = ctx.conn.execute("select image from listings where id=%s and tenant_id=%s", (listing_id, ctx.tenant_id)).fetchone()
    if not row:
        raise ApiError(404, "not_found", "catalog photo not found")
    if not row["image"]:
        raise ApiError(404, "expired", "photo removed after the retention period")
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(bytes(row["image"])))).convert("RGB")
    im.thumbnail((480, 480))
    out = io.BytesIO()
    im.save(out, "JPEG", quality=80)
    return Response(out.getvalue(), media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


def _crop_row(ctx: Ctx, listing_id, item_id) -> dict:
    row = ctx.conn.execute("select description, labels, sku, crop, crop_mime from listing_items where id=%s and listing_id=%s and tenant_id=%s",
                           (item_id, listing_id, ctx.tenant_id)).fetchone()
    if not row:
        raise ApiError(404, "not_found", "product not found")
    return row


@r.get("/listings/{listing_id}/items/{item_id}/crop")
def crop(listing_id: UUID, item_id: UUID, ctx: Ctx = Depends(read_ctx)):
    row = _crop_row(ctx, listing_id, item_id)
    if not row["crop"]:
        raise ApiError(404, "expired", "photo removed after the retention period")
    return Response(bytes(row["crop"]), media_type=row["crop_mime"])


MAX_CUTOUT = 2_000_000
CUTOUT_SIDE = 1200  # the crop is at most 600 px; the browser draws at the crop's own size


@r.get("/listings/{listing_id}/items/{item_id}/cutout")
def cutout(listing_id: UUID, item_id: UUID, ctx: Ctx = Depends(read_ctx)):
    row = ctx.conn.execute("select cutout from listing_items where id=%s and listing_id=%s and tenant_id=%s", (item_id, listing_id, ctx.tenant_id)).fetchone()
    if not row or not row["cutout"]:
        raise ApiError(404, "not_found", "this product has no cut-out")
    return Response(bytes(row["cutout"]), media_type="image/png")


@r.post("/listings/{listing_id}/items/{item_id}/cutout")
def save_cutout(listing_id: UUID, item_id: UUID, file: UploadFile = File(...), ctx: Ctx = Depends(write_ctx)):
    """The product picture with a transparent background, drawn in the browser. Checked as a real PNG with an alpha channel; nothing else is stored."""
    from PIL import Image
    require_perm(ctx, "manage_catalog")
    data = read_capped(file, MAX_CUTOUT, "cut-out over 2 MB")
    try:
        im = Image.open(io.BytesIO(data))
        ok = im.format == "PNG" and "A" in im.getbands() and max(im.size) <= CUTOUT_SIDE
    except (OSError, Image.DecompressionBombError):
        ok = False
    if not ok:
        raise ApiError(415, "unsupported_media", f"send a PNG with a transparent background, at most {CUTOUT_SIDE} px on a side")
    if not ctx.conn.execute("update listing_items set cutout=%s where id=%s and listing_id=%s and tenant_id=%s returning 1",
                            (data, item_id, listing_id, ctx.tenant_id)).fetchone():
        raise ApiError(404, "not_found", "product not found")
    audit(ctx, "listing_items", item_id, "catalog product cut-out saved", None, None)
    return reply(ctx, {"cutout_url": f"/api/listings/{listing_id}/items/{item_id}/cutout"})


@r.delete("/listings/{listing_id}/items/{item_id}/cutout")
def delete_cutout(listing_id: UUID, item_id: UUID, ctx: Ctx = Depends(write_ctx)):
    require_perm(ctx, "manage_catalog")
    if not ctx.conn.execute("update listing_items set cutout=null where id=%s and listing_id=%s and tenant_id=%s returning 1",
                            (item_id, listing_id, ctx.tenant_id)).fetchone():
        raise ApiError(404, "not_found", "product not found")
    audit(ctx, "listing_items", item_id, "catalog product cut-out removed", None, None)
    return reply(ctx, {"cutout_url": None})


class Tier(BaseModel, extra="forbid"):
    size: str | None = Field(None, max_length=20)
    min_qty: Decimal = Field(Decimal(1), gt=0, lt=Decimal(10) ** 9, decimal_places=3)
    price: Decimal = Field(gt=0, lt=Decimal(10) ** 10, decimal_places=4)


class ItemPatch(BaseModel, extra="forbid"):
    description: str | None = Field(None, max_length=300)
    sku: str | None = Field(None, max_length=80)
    sizes: list[str] | None = Field(None, max_length=30)
    price: Decimal | None = Field(None, gt=0, lt=Decimal(10) ** 10, decimal_places=4)
    status: Literal["confirmed", "discarded"] | None = None
    item_key: str | None = Field(None, pattern=r"^[a-z][a-z0-9_]{0,60}$")
    price_tiers: list[Tier] | None = Field(None, max_length=50)    # per size and quantity; [] clears them
    stock_qty: Decimal | None = Field(None, ge=0, lt=Decimal(10) ** 11, decimal_places=3)  # null = not counted
    category: str | None = Field(None, max_length=60)  # null or blank clears it; setting one also drops the reader's pending suggestion


def _tiers(tiers: list[Tier], sizes: list[str]) -> list[dict]:
    """Each tier's size must be one of the item's sizes (matched without case, stored as the item spells it); one price per size and min_qty."""
    known, out, seen = {s.lower(): s for s in sizes}, [], set()
    for t in tiers:
        size = (t.size or "").strip() or None
        if size is not None:
            if size.lower() not in known:
                raise ApiError(422, "bad_tier", f"size {size!r} is not one of this product's sizes; add it to sizes first")
            size = known[size.lower()]
        if (k := ((size or "").lower(), t.min_qty)) in seen:
            raise ApiError(422, "bad_tier", "two prices for the same size and minimum quantity")
        seen.add(k)
        out.append({"size": size, "min_qty": f"{t.min_qty.normalize():f}", "price": f"{t.price.normalize():f}"})
    return sorted(out, key=lambda t: ((t["size"] or "").lower(), Decimal(t["min_qty"])))


@r.patch("/listings/{listing_id}/items/{item_id}")
def edit_item(listing_id: UUID, item_id: UUID, body: ItemPatch, ctx: Ctx = Depends(write_ctx)):
    require_perm(ctx, "manage_catalog")
    ch = {k: getattr(body, k) for k in body.model_fields_set}
    if not ch or ("description" in ch and ch["description"] is None) or ("status" in ch and ch["status"] is None):
        raise ApiError(422, "empty", "nothing to change (description and status cannot be null)")
    if "price" in ch or "price_tiers" in ch:
        require_perm(ctx, "view_costs")  # a price is a supplier cost
    if "price_tiers" in ch and ch["price_tiers"] is None:
        ch["price_tiers"] = []
    if "category" in ch:
        ch["category"] = (ch["category"] or "").strip() or None
        ch["category_suggestion"] = None
        if ch["category"]:
            from .catalog import keep  # local: catalog imports this module
            keep(ctx.conn, ctx.tenant_id, ch["category"][:60])
    if "sizes" in ch:
        ch["sizes"] = [s.strip()[:20] for s in ch["sizes"] or [] if s.strip()]
    c = ctx.conn
    old = c.execute(f"select {COLS} from listing_items where id=%s and listing_id=%s and tenant_id=%s for update",
                    (item_id, listing_id, ctx.tenant_id)).fetchone()
    if not old:
        raise ApiError(404, "not_found", "product not found")
    if "price_tiers" in ch:
        ch["price_tiers"] = _tiers(body.price_tiers or [], ch.get("sizes", old["sizes"]) or [])
    elif "sizes" in ch and (gone := {t["size"] for t in old["price_tiers"] if t.get("size") and t["size"].lower() not in {s.lower() for s in ch["sizes"]}}):
        raise ApiError(422, "bad_tier", "remove the prices for " + ", ".join(sorted(gone)) + " before removing that size")
    sets = ", ".join(f"{k}=%s" for k in ch)  # keys come from the model's own field names, never from the client
    with guarded():
        c.execute(f"update listing_items set {sets} where id=%s", [Jsonb(v) if k in ("sizes", "price_tiers") else v for k, v in ch.items()] + [item_id])
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
    require_perm(ctx, "ask_suppliers")  # before the lookup: a role without it learns nothing about which products exist
    row = _crop_row(ctx, listing_id, item_id)
    desc = (body.description or row["description"] or " ".join(row["labels"]) or row["sku"] or "catalog item").strip()[:200]
    return rfq.ask(request, UploadFile(io.BytesIO(bytes(row["crop"])), filename="crop.jpg"), desc, body.note or rfq.DEFAULT_NOTE,
                   None, body.supplier_ids, ctx)
