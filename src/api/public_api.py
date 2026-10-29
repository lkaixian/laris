"""Usage counter (owner) and a small key-protected, read-only price API for other modules. AI never sets a price here and no cost,
margin or supplier data leaves: the lines come from the same pricing.price_quote the dashboard uses, then are cut down to selling figures."""
import hashlib
import hmac
import os
import secrets
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .. import db, pricing
from ..errors import ApiError
from ..pipeline import MAX_ITEMS, MAX_QTY, MY
from ..templates import load_template
from .ai_guide import ai_row
from .deps import JR, Ctx, audit, guarded, read_ctx, reply, require_owner, throttle, write_ctx

r = APIRouter(prefix="/api")
MAX_BODY = 16_384
PER_MIN = 60
USAGE_NOTE = "Shown for planning. LARIS does not bill anything yet."


def now() -> datetime:  # tests patch this
    return datetime.now(MY)


# ---- usage ---------------------------------------------------------------------------------------------------------
@r.get("/usage")
def usage(ctx: Ctx = Depends(read_ctx)):
    require_owner(ctx)
    n = now().astimezone(MY)
    start = datetime(n.year, n.month, 1, tzinfo=MY)
    end = datetime(n.year + (n.month == 12), n.month % 12 + 1, 1, tzinfo=MY)
    p = {"t": ctx.tenant_id, "a": start, "b": end}
    one = lambda q: ctx.conn.execute(q, p).fetchone()["n"]
    docs = "select count(*) n from documents where tenant_id=%(t)s and direction='out' and kind='quotation' and {c} >= %(a)s and {c} < %(b)s"
    approved, sent = one(docs.format(c="approved_at")), one(docs.format(c="sent_at"))
    calls = one("select count(*) n from usage_events where tenant_id=%(t)s and kind='price' and at >= %(a)s and at < %(b)s")
    try:
        free = int(os.environ.get("USAGE_FREE_QUOTES", "20"))
    except ValueError:
        free = 20
    return reply(ctx, {"period": f"{n.year}-{n.month:02d}", "approved_quotes": approved, "quotes_sent": sent, "api_calls": calls,
                       "free_allowance": free, "over_allowance": approved > free, "note": USAGE_NOTE})


# ---- API keys (owner) ----------------------------------------------------------------------------------------------
class KeyIn(BaseModel, extra="forbid"):
    name: str = Field(min_length=1, max_length=60)
    mcp_role_id: UUID | None = None  # set: an MCP key for an AI tool, limited to what this staff role may read (src/api/mcp.py)


def _sha(k: str) -> str:
    return hashlib.sha256(k.encode()).hexdigest()


@r.get("/settings/api-keys")
def list_keys(ctx: Ctx = Depends(read_ctx)):
    require_owner(ctx)
    rows = ctx.conn.execute("""select k.id, k.name, k.key_prefix, k.created_at, k.last_used_at, k.revoked_at is not null as revoked, r.name as mcp_role
                               from api_keys k left join roles r on r.id = k.role_id where k.tenant_id=%s order by k.created_at, k.id""", (ctx.tenant_id,)).fetchall()
    return reply(ctx, rows)


@r.post("/settings/api-keys")
def create_key(body: KeyIn, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    name = body.name.strip()
    if not name:
        raise ApiError(422, "bad_name", "give the key a name")
    if body.mcp_role_id:
        from .assistant import rag_on  # the same consent gate as the Assistant reading records
        if not rag_on(ai_row(ctx)):
            raise ApiError(422, "ai_consent_required", "Turn on 'Guide plus my data, read by the AI' in AI settings first: an AI tool reading your records needs that agreement.")
        if not ctx.conn.execute("select 1 from roles where id=%s and tenant_id=%s and class='staff'", (body.mcp_role_id, ctx.tenant_id)).fetchone():
            raise ApiError(422, "bad_role", "choose one of your staff roles; an AI tool can never act as the owner")
    key = "lar_" + secrets.token_urlsafe(24)  # 32 url-safe characters
    with guarded():
        kid = ctx.conn.execute("insert into api_keys(tenant_id, name, key_prefix, key_hash, created_by, role_id) values (%s,%s,%s,%s,%s,%s) returning id",
                               (ctx.tenant_id, name, key[:8], _sha(key), ctx.user_id, body.mcp_role_id)).fetchone()["id"]
    audit(ctx, "api_keys", kid, "api key created", None, {"name": name, "key_prefix": key[:8], **({"mcp_role_id": str(body.mcp_role_id)} if body.mcp_role_id else {})})
    return reply(ctx, {"id": kid, "name": name, "key": key, "note": "Copy it now, it is shown once."}, 201)


@r.delete("/settings/api-keys/{kid}")
def revoke_key(kid: UUID, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    row = ctx.conn.execute("update api_keys set revoked_at = coalesce(revoked_at, now()) where id=%s and tenant_id=%s returning name",
                           (kid, ctx.tenant_id)).fetchone()
    if not row:
        raise ApiError(404, "not_found", "no such key")
    audit(ctx, "api_keys", kid, "api key revoked", {"name": row["name"]}, None)
    return reply(ctx, {"id": kid, "revoked": True})


# ---- public API v1 -------------------------------------------------------------------------------------------------
def key_conn(request: Request):
    """X-API-Key or Bearer -> the key's tenant, nothing else. Unknown and revoked look the same. Yields (conn, tenant_id, key_id)."""
    got = request.headers.get("authorization", "")
    k = request.headers.get("x-api-key") or (got[7:] if got.startswith("Bearer ") else "")
    bad = ApiError(401, "bad_key", "missing or invalid API key")
    if not k or len(k) > 100:
        raise bad
    h = _sha(k)
    with db.tx("staff", "", "*") as conn:  # key lookup crosses tenants on purpose; narrowed right after
        row = conn.execute("select id, tenant_id, key_hash from api_keys where key_hash=%s and revoked_at is null", (h,)).fetchone()
        if not row or not hmac.compare_digest(row["key_hash"], h):
            raise bad
        throttle(f"apikey:{row['id']}", PER_MIN, 60, f"at most {PER_MIN} requests a minute per key")
        cl = request.headers.get("content-length", "0")
        if not cl.isdigit() or int(cl) > MAX_BODY:
            raise ApiError(413, "too_large", "request body too large")
        conn.execute("select set_config('laris.tenant', %s, true)", (str(row["tenant_id"]),))
        conn.execute("update api_keys set last_used_at = now() where id=%s", (row["id"],))
        yield conn, row["tenant_id"], row["id"]


def _tenant(conn, tid):
    t = conn.execute("select * from tenants where id=%s", (tid,)).fetchone()
    return t, load_template(t["trade_template"])


@r.get("/v1/recipes")
def recipes(k=Depends(key_conn)):
    conn, tid, kid = k
    _, tpl = _tenant(conn, tid)
    return JR([{"recipe_key": key, "description": rc.get("description", key), "uom": rc["uom"], **({"fixed_rate": True} if "fixed_rate" in rc else {})}
               for key, rc in tpl["recipes"].items()])


class PriceItem(BaseModel, extra="forbid"):
    recipe_key: str = Field(min_length=1, max_length=60)
    qty: Decimal = Field(gt=0, le=MAX_QTY, allow_inf_nan=False)


class PriceIn(BaseModel, extra="forbid"):
    items: list[PriceItem] = Field(min_length=1, max_length=MAX_ITEMS)
    customer: str | None = Field(None, max_length=80)


def current_costs(conn, tid) -> dict:
    """Same lookup as pipeline.handle_enquiry: item_key -> price tiers of the newest cost's supplier and uom.
    ponytail: copied, not shared, because pipeline.py is not ours to edit now; extract one helper there later."""
    costs = {}
    for c in conn.execute(
            """select item_key, uom, supplier_id, min_qty, unit_cost, id from cost_items
               where tenant_id=%s and superseded_by is null and (valid_until is null or valid_until >= current_date)
               order by item_key, effective_date desc, created_at desc""", (tid,)):
        first = costs.setdefault(c["item_key"], (c["supplier_id"], c["uom"], {}))
        if first[:2] == (c["supplier_id"], c["uom"]):
            first[2].setdefault(c["min_qty"], (c["min_qty"], c["unit_cost"], c["id"]))
    return {key: list(v[2].values()) for key, v in costs.items()}


def price_items(conn, tid, items) -> dict:
    """items: [(recipe_key, qty)]. The dashboard's own rules engine and cost book; returns selling figures only."""
    t, tpl = _tenant(conn, tid)
    unknown = sorted({k for k, _ in items if k not in tpl["recipes"]})
    if unknown:
        raise ApiError(422, "unknown_recipe", "unknown recipe_key: " + ", ".join(unknown), unknown=unknown)
    costs, ok, review = current_costs(conn, tid), [], []
    for k, q in items:
        try:
            pricing.price_quote([{"item_key": k, "qty": q}], costs, tpl, dict(t))
            ok.append({"item_key": k, "qty": q})
        except pricing.MissingCost:
            review.append(k)
    quote = pricing.price_quote(ok, costs, tpl, dict(t)) if ok else {"lines": [], "subtotal": Decimal(0), "margin_pct": None}
    return {"lines": [{"recipe_key": l["item_key"], "description": tpl["recipes"][l["item_key"]].get("description", l["item_key"]), "qty": l["qty"],
                       "uom": l["uom"], "unit_price": l["unit_price"], "line_total": l["line_total"]} for l in quote["lines"]],
            "total": quote["subtotal"], "below_margin_floor": bool(ok and pricing.margin_guard(quote, t["min_margin_pct"])),
            "needs_review": list(dict.fromkeys(review)), "ai_used": False, "currency": "RM"}


@r.post("/v1/quote-price")
def quote_price(body: PriceIn, k=Depends(key_conn)):
    conn, tid, kid = k
    out = price_items(conn, tid, [(i.recipe_key, i.qty) for i in body.items])
    conn.execute("insert into usage_events(tenant_id, kind, key_id) values (%s,'price',%s)", (tid, kid))
    return JR(out)
