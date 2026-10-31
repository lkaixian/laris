"""The product side of the catalog: every product read from catalog photos in one searchable list, the business's own categories,
moving products between categories, and category suggestions (nearest existing category first, else a new one). Counts and names only."""
import re
from difflib import SequenceMatcher
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from ..errors import ApiError
from .contacts import like
from .deps import Ctx, audit, read_ctx, reply, require_perm, write_ctx
from .listings import COLS, _item

r = APIRouter(prefix="/api/catalog")
NEAR = 0.62  # how alike a suggestion and an existing category must be before we offer the existing one


def clean(name: str | None) -> str:
    return " ".join((name or "").split())[:60]


def _stem(w: str) -> str:
    return w[:-1] if len(w) > 3 and w.endswith("s") else w


def _words(s: str) -> set[str]:
    return {_stem(w) for w in re.findall(r"[a-z0-9]+", s.lower())}


def nearest(guess: str, cats: list[str]) -> str | None:
    """The existing category closest to `guess` (same words in any order, plural or not, or a close spelling), or None."""
    g, best, top = clean(guess), None, 0.0
    if not g:
        return None
    gw = _words(g)
    for c in cats:
        cw = _words(c)
        jac = len(gw & cw) / len(gw | cw) if gw | cw else 0
        score = max(SequenceMatcher(None, g.lower(), c.lower()).ratio(), jac, 0.9 if gw and cw and (gw <= cw or cw <= gw) else 0)
        if score > top:
            best, top = c, score
    return best if top >= NEAR else None


def category_names(conn, tid) -> list[str]:
    """The kept list plus any category a product already carries (older products have one without a row here)."""
    return [x["name"] for x in conn.execute(
        """select name from (select name, sort_order from catalog_categories where tenant_id=%(t)s
                             union select distinct category, 1000000 from listing_items where tenant_id=%(t)s and category is not null) u
           group by name order by min(sort_order), lower(name)""", {"t": tid}).fetchall()]


def pick(guess: str | None, cats: list[str]) -> str | None:
    """What to offer for the reader's guess: the same category if it exists, else the closest existing one (the person confirms), else the guess as a new one."""
    g = clean(guess)
    if not g:
        return None
    return next((c for c in cats if c.lower() == g.lower()), None) or nearest(g, cats) or g[:1].upper() + g[1:]


def keep(conn, tid, name: str) -> None:
    conn.execute("insert into catalog_categories(tenant_id, name, sort_order) values (%s, %s, (select coalesce(max(sort_order), 0) + 1 from catalog_categories where tenant_id=%s)) "
                 "on conflict (tenant_id, lower(name)) do nothing", (tid, name, tid))


@r.get("/categories")
def categories(ctx: Ctx = Depends(read_ctx)):
    counts = {x["category"]: x["n"] for x in ctx.conn.execute(
        "select category, count(*) n from listing_items where tenant_id=%s and status <> 'discarded' and category is not null group by category", (ctx.tenant_id,)).fetchall()}
    total = ctx.conn.execute("select count(*) n from listing_items where tenant_id=%s and status <> 'discarded'", (ctx.tenant_id,)).fetchone()["n"]
    names = category_names(ctx.conn, ctx.tenant_id)
    return reply(ctx, {"categories": [{"name": n, "count": counts.get(n, 0)} for n in names], "total": total, "uncategorised": total - sum(counts.values())})


class NameIn(BaseModel):
    name: str = Field(max_length=80)


class RenameIn(BaseModel):
    old: str = Field(max_length=80)
    new: str = Field(max_length=80)


@r.post("/categories")
def add_category(body: NameIn, ctx: Ctx = Depends(write_ctx)):
    require_perm(ctx, "manage_catalog")
    n = clean(body.name)
    if not n:
        raise ApiError(422, "bad_name", "a category needs a name")
    keep(ctx.conn, ctx.tenant_id, n)
    audit(ctx, "catalog_categories", ctx.tenant_id, f"category added: {n}")
    return reply(ctx, {"name": n}, 201)


@r.post("/categories/rename")
def rename_category(body: RenameIn, ctx: Ctx = Depends(write_ctx)):
    """Renaming onto an existing category merges the two."""
    require_perm(ctx, "manage_catalog")
    old, new = clean(body.old), clean(body.new)
    if not old or not new:
        raise ApiError(422, "bad_name", "a category needs a name")
    c, t = ctx.conn, ctx.tenant_id
    n = c.execute("update listing_items set category=%s where tenant_id=%s and lower(category)=lower(%s)", (new, t, old)).rowcount
    c.execute("update listing_items set category_suggestion=%s where tenant_id=%s and lower(category_suggestion)=lower(%s)", (new, t, old))
    if old.lower() != new.lower():
        c.execute("delete from catalog_categories where tenant_id=%s and lower(name)=lower(%s)", (t, old))
    keep(c, t, new)
    audit(ctx, "catalog_categories", t, f"category renamed: {old} -> {new} ({n} products)")
    return reply(ctx, {"name": new, "moved": n})


@r.post("/categories/delete")
def delete_category(body: NameIn, ctx: Ctx = Depends(write_ctx)):
    """Its products stay in the catalog, without a category."""
    require_perm(ctx, "manage_catalog")
    name, t = clean(body.name), ctx.tenant_id
    n = ctx.conn.execute("update listing_items set category=null where tenant_id=%s and lower(category)=lower(%s)", (t, name)).rowcount
    ctx.conn.execute("update listing_items set category_suggestion=null where tenant_id=%s and lower(category_suggestion)=lower(%s)", (t, name))
    ctx.conn.execute("delete from catalog_categories where tenant_id=%s and lower(name)=lower(%s)", (t, name))
    audit(ctx, "catalog_categories", t, f"category deleted: {name} ({n} products now uncategorised)")
    return reply(ctx, {"uncategorised": n})


@r.get("/items")
def items(q: str = Query("", max_length=100), category: str | None = Query(None, max_length=60), uncategorised: bool = False,
          suggested: bool = False, limit: int = Query(120, ge=1, le=300), ctx: Ctx = Depends(read_ctx)):
    """Products from every catalog photo. q looks in the name, labels, SKU, category and key; discarded products are left out."""
    rows = ctx.conn.execute(
        f"""select {COLS}, listing_id from listing_items
            where tenant_id=%(t)s and status <> 'discarded'
              and (not %(has_q)s or description ilike %(q)s or sku ilike %(q)s or item_key ilike %(q)s or category ilike %(q)s or labels::text ilike %(q)s)
              and (%(cat)s::text is null or lower(category) = lower(%(cat)s))
              and (not %(unc)s or category is null)
              and (not %(sug)s or (category_suggestion is not null and category is null))
            order by (category is null), lower(coalesce(category, '')), description, id limit %(n)s""",
        {"t": ctx.tenant_id, "has_q": bool(q.strip()), "q": like(q), "cat": category, "unc": uncategorised, "sug": suggested, "n": limit}).fetchall()
    return reply(ctx, [{**_item(ctx, x["listing_id"], x), "listing_id": x["listing_id"]} for x in rows])


class MoveIn(BaseModel):
    item_ids: list[UUID] = Field(min_length=1, max_length=200)
    category: str | None = Field(None, max_length=80)  # null or blank = no category


@r.post("/items/move")
def move(body: MoveIn, ctx: Ctx = Depends(write_ctx)):
    require_perm(ctx, "manage_catalog")
    cat = clean(body.category) or None
    if cat:  # use the spelling the business already has
        cat = next((c for c in category_names(ctx.conn, ctx.tenant_id) if c.lower() == cat.lower()), cat)
        keep(ctx.conn, ctx.tenant_id, cat)
    n = ctx.conn.execute("update listing_items set category=%s, category_suggestion=null where tenant_id=%s and id = any(%s)",
                         (cat, ctx.tenant_id, body.item_ids)).rowcount
    audit(ctx, "listing_items", ctx.tenant_id, f"{n} products moved to {cat or 'no category'}")
    return reply(ctx, {"moved": n, "category": cat})


class AcceptIn(BaseModel):
    item_ids: list[UUID] = Field(min_length=1, max_length=200)


@r.post("/items/accept-suggestions")
def accept(body: AcceptIn, ctx: Ctx = Depends(write_ctx)):
    """Confirm the suggested category on each product (creating it when it is new)."""
    require_perm(ctx, "manage_catalog")
    c, t = ctx.conn, ctx.tenant_id
    for x in c.execute("select distinct category_suggestion s from listing_items where tenant_id=%s and id = any(%s) and category_suggestion is not null", (t, body.item_ids)).fetchall():
        keep(c, t, x["s"])
    n = c.execute("update listing_items set category=category_suggestion, category_suggestion=null where tenant_id=%s and id = any(%s) and category_suggestion is not null",
                  (t, body.item_ids)).rowcount
    audit(ctx, "listing_items", t, f"{n} suggested categories accepted")
    return reply(ctx, {"accepted": n})
