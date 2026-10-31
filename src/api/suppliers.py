"""Suppliers section: directory, product price comparison with an explainable recommendation, contracts, timeline, in/out-of-contract.
The rules live in src/suppliers_engine.py (pure, tested); this file loads rows, applies permissions and writes the audit trail.
Seeing supplier prices needs view_costs (owner) or manage_contracts (a buyer role); responses are built without the scrubbed key names."""
import json
import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from .. import suppliers_engine as E
from ..errors import ApiError
from .deps import JR, Ctx, audit, guarded, read_ctx, require_owner, require_perm, write_ctx
from .routes import Transition, transition

r = APIRouter(prefix="/api")
D = Decimal
LANGS = ("en", "ms", "zh", "ta")

# Plain-language "why" in the four languages. Flagged for native-speaker review in docs/TRANSLATION_REVIEW_SUPPLIERS.md.
WHY = {
    "en": "{supplier} is the cheapest delivered: RM {total} for {qty} {uom}{saving}, arrives in {lead} day(s){rel}.",
    "ms": "{supplier} paling murah selepas penghantaran: RM {total} untuk {qty} {uom}{saving}, tiba dalam {lead} hari{rel}.",
    "zh": "{supplier} 到岸价最低：{qty} {uom} 共 RM {total}{saving}，{lead} 天内送达{rel}。",
    "ta": "{supplier} விநியோகத்துடன் மிகக் குறைந்தது: {qty} {uom} க்கு RM {total}{saving}, {lead} நாளில் வரும்{rel}.",
}
SAVING = {"en": ", RM {x} less than the next option", "ms": ", RM {x} kurang daripada pilihan seterusnya",
          "zh": "，比下一选项少 RM {x}", "ta": ", அடுத்த விருப்பத்தை விட RM {x} குறைவு"}
REL = {"en": ", on time {x}% of the time", "ms": ", tepat masa {x}% daripada masa", "zh": "，准时率 {x}%", "ta": ", {x}% நேரம் சரியான நேரத்தில்"}
ASK = {"en": "Some data is missing ({what}). Please confirm it before ordering.", "ms": "Sebahagian data tiada ({what}). Sila sahkan sebelum membuat pesanan.",
       "zh": "部分数据缺失（{what}）。下单前请先确认。", "ta": "சில தகவல் இல்லை ({what}). ஆர்டர் செய்யும் முன் உறுதிப்படுத்தவும்."}
NONE = {"en": "No supplier qualifies. See the reasons next to each one.", "ms": "Tiada pembekal yang layak. Lihat sebab di sebelah setiap pembekal.",
        "zh": "没有符合条件的供应商。请查看各供应商旁的原因。", "ta": "தகுதியான சப்ளையர் இல்லை. ஒவ்வொன்றின் காரணத்தைப் பார்க்கவும்."}


def can_see(ctx: Ctx) -> bool:
    return "view_costs" in ctx.perms or "manage_contracts" in ctx.perms


def gate(ctx: Ctx):
    if not can_see(ctx):
        raise ApiError(403, "permission_required", "your role cannot see supplier prices")


def out(data, status=200) -> JR:
    return JR(data, status_code=status)


def today() -> date:
    return E.today_my()


# ---------- loading ----------
def settings(ctx: Ctx) -> dict:
    row = ctx.conn.execute("select * from supplier_settings where tenant_id=%s", (ctx.tenant_id,)).fetchone()
    return row or {"manager_limit": D(5000), "weights": E.DEFAULT_WEIGHTS, "five_sen": False, "market_gap_pct": D(5)}


def engine_offer(x: dict) -> dict:
    rel = None
    if x["on_time_pct"] is not None:
        rel = x["on_time_pct"] * D("0.7") + (x["price_stability_pct"] if x["price_stability_pct"] is not None else x["on_time_pct"]) * D("0.3")
    return {"id": str(x["id"]), "supplier_id": str(x["supplier_id"]), "supplier": x["supplier_name"], "product_id": str(x["product_id"]),
            "pack_label": x["pack_label"], "pack_size": x["pack_size"], "tiers": [(int(t["min_packs"]), D(str(t["price"]))) for t in x["tiers"]],
            "moq": x["moq"], "lead_days": x["lead_days"], "delivery_fee": x["delivery_fee"], "free_delivery_over": x["free_delivery_over"],
            "sst_rate": x["sst_rate"], "discount_pct": x["discount_pct"], "valid_until": x["valid_until"], "stock": x["stock"],
            "payment_days": x["payment_days"] if x["payment_days"] is not None else x["profile_payment_days"], "certs": x["certs"] or [],
            "blocked": x["standing"] == "blocked", "reliability": rel, "distance_km": x["distance_km"], "state": x["state"], "standing": x["standing"]}


OFFER_SQL = """select o.*, p.name supplier_name, sp.state, sp.certs, sp.standing, sp.on_time_pct, sp.price_stability_pct, sp.distance_km,
                      sp.payment_days profile_payment_days
               from supplier_offers o join parties p on p.id=o.supplier_id left join supplier_profiles sp on sp.supplier_id=o.supplier_id
               where o.tenant_id=%s"""


def load_offers(ctx: Ctx, product_id: UUID, supplier_ids=None) -> list[dict]:
    rows = ctx.conn.execute(OFFER_SQL + " and o.product_id=%s order by p.name, o.id", (ctx.tenant_id, product_id)).fetchall()
    return [engine_offer(x) for x in rows if supplier_ids is None or x["supplier_id"] in supplier_ids]


def load_contracts(ctx: Ctx) -> list[dict]:
    cs = ctx.conn.execute("""select c.*, p.name supplier_name, coalesce((select sum(u.qty) from contract_usage u where u.contract_id=c.id), 0) used_qty
                             from contracts c join parties p on p.id=c.supplier_id where c.tenant_id=%s order by c.start_on, c.id""", (ctx.tenant_id,)).fetchall()
    items = ctx.conn.execute("select * from contract_items where tenant_id=%s", (ctx.tenant_id,)).fetchall()
    by: dict = {}
    for i in items:
        by.setdefault(i["contract_id"], []).append(i)
    res = []
    for c in cs:
        its = by.get(c["id"], [])
        res.append({**c, "id": str(c["id"]), "supplier_id": str(c["supplier_id"]), "start": c["start_on"], "end": c["end_on"],
                    "products": {str(i["product_id"]) for i in its}, "items": its,
                    "pack_size": its[0]["pack_size"] if len(its) == 1 else None,
                    "price": its[0]["price_per_pack"] if len(its) == 1 else None})
    return res


def get_product(ctx: Ctx, pid: UUID) -> dict:
    p = ctx.conn.execute("select * from products where id=%s and tenant_id=%s", (pid, ctx.tenant_id)).fetchone()
    if not p:
        raise ApiError(404, "not_found", "product not found")
    return p


def unit_qty(p: dict, qty: Decimal, uom: str | None) -> Decimal:
    if not uom:
        return qty
    try:
        q, base = E.to_base(qty, uom)
    except KeyError:
        raise ApiError(422, "bad_uom", f"unknown unit '{uom}'")
    if base != p["base_uom"]:
        raise ApiError(422, "uom_mismatch", f"{p['name']} is counted in {p['base_uom']}, not {uom}")
    return q


def reliability_of(profile: dict | None):
    if not profile or profile["on_time_pct"] is None:
        return None
    return profile["on_time_pct"]


# ---------- supplier directory ----------
def contract_status_map(ctx: Ctx, on: date) -> dict:
    """supplier id -> in_contract | expiring | not_in_contract | expired."""
    st: dict = {}
    for c in load_contracts(ctx):
        sid = c["supplier_id"]
        eff = E.effective_state(c, on)
        if eff in ("active", "expiring", "renewal") and c["start"] <= on <= c["end"]:
            st[sid] = "expiring" if (eff == "expiring" or st.get(sid) == "expiring") else "in_contract"
        elif eff == "expired" and sid not in st:
            st[sid] = "expired"
    return st


def card(x: dict, status: str, spark: list) -> dict:
    rel = None
    if x["on_time_pct"] is not None:
        rel = float(x["on_time_pct"]) * 0.7 + float(x["price_stability_pct"] if x["price_stability_pct"] is not None else x["on_time_pct"]) * 0.3
    return {"id": x["id"], "name": x["name"], "contact": x["contact"], "state": x["state"], "categories": x["categories"] or [], "certs": x["certs"] or [],
            "payment_days": x["payment_days"], "standing": x["standing"] or "normal", "on_time_pct": x["on_time_pct"],
            "price_stability_pct": x["price_stability_pct"], "response_hours": x["response_hours"], "distance_km": x["distance_km"],
            "reliability": round(rel, 1) if rel is not None else None, "avg_lead_days": x["avg_lead"], "min_moq": x["min_moq"],
            "last_order_on": x["last_order_on"], "contract_status": status, "sparkline": spark}


@r.get("/suppliers")
def suppliers(q: str = Query("", max_length=100), state: str | None = None, category: str | None = None, cert: list[str] = Query([]),
              contract: str | None = Query(None, pattern="^(in_contract|expiring|not_in_contract|expired)$"),
              standing: str | None = Query(None, pattern="^(normal|preferred|blocked)$"), product_id: UUID | None = None,
              max_lead: int | None = Query(None, ge=0), min_reliability: float | None = Query(None, ge=0, le=100),
              max_moq: float | None = Query(None, ge=0), payment_days: int | None = Query(None, ge=0), ctx: Ctx = Depends(read_ctx)):
    gate(ctx)
    rows = ctx.conn.execute("""select p.id, p.name, p.contact, sp.state, sp.categories, sp.certs, sp.payment_days, sp.standing, sp.on_time_pct, sp.price_stability_pct,
                                      sp.response_hours, sp.distance_km, sp.last_order_on,
                                      (select round(avg(o.lead_days),1) from supplier_offers o where o.supplier_id=p.id) avg_lead,
                                      (select min(o.moq) from supplier_offers o where o.supplier_id=p.id) min_moq
                               from parties p left join supplier_profiles sp on sp.supplier_id=p.id
                               where p.tenant_id=%s and p.role='supplier' and (%s = '' or p.name ilike %s) order by p.name""",
                            (ctx.tenant_id, q.strip(), "%" + q.strip().replace("%", "") + "%")).fetchall()
    sts = contract_status_map(ctx, today())
    offered = {x["supplier_id"] for x in ctx.conn.execute("select supplier_id from supplier_offers where tenant_id=%s and (%s::uuid is null or product_id=%s)",
                                                         (ctx.tenant_id, product_id, product_id)).fetchall()}
    sparks: dict = {}
    for h in ctx.conn.execute("""select o.supplier_id, h.month, h.price_per_base from offer_history h join supplier_offers o on o.id=h.offer_id
                                 where h.tenant_id=%s order by h.month""", (ctx.tenant_id,)).fetchall():
        sparks.setdefault(h["supplier_id"], []).append(h["price_per_base"])
    cards = []
    for x in rows:
        c = card(x, sts.get(str(x["id"]), "not_in_contract"), sparks.get(x["id"], [])[-12:])
        keep = ((not state or x["state"] == state) and (not category or category in c["categories"]) and all(k in c["certs"] for k in cert)
                and (not contract or c["contract_status"] == contract) and (not standing or c["standing"] == standing)
                and (product_id is None or x["id"] in offered) and (max_lead is None or (c["avg_lead_days"] is not None and c["avg_lead_days"] <= max_lead))
                and (min_reliability is None or (c["reliability"] or 0) >= min_reliability)
                and (max_moq is None or c["min_moq"] is None or c["min_moq"] <= D(str(max_moq)))
                and (payment_days is None or (c["payment_days"] or 0) >= payment_days))
        if keep:
            cards.append(c)
    return out(cards)


@r.get("/suppliers/summary")
def summary(ctx: Ctx = Depends(read_ctx)):
    gate(ctx)
    t, cs = today(), load_contracts(ctx)
    eff = [(c, E.effective_state(c, t)) for c in cs]
    live = [c for c, s in eff if s in ("active", "expiring", "renewal") and c["start"] <= t <= c["end"]]
    exp90 = [c for c in live if 0 <= E.days_left(c["end"], t) <= 90]
    sp = ctx.conn.execute("""select coalesce(sum(amount) filter (where status='approved'),0) total,
                                    coalesce(sum(amount) filter (where status='approved' and contract_id is not null),0) in_contract,
                                    coalesce(sum(amount) filter (where status='approved' and off_contract_reason is not null),0) off_contract
                             from purchases where tenant_id=%s and bought_on >= %s""", (ctx.tenant_id, t - timedelta(days=90))).fetchone()
    # Saved = what approved orders this month cost less than the same product's previous price (the latest earlier day's order, its cheapest if
    # there were several). Counts real orders only: a saved recommendation nobody acted on, or saved twice, adds nothing.
    sv = ctx.conn.execute("""select coalesce(sum(greatest(prev.pp - pu.amount / pu.qty, 0) * pu.qty), 0) s
                             from purchases pu
                             join lateral (select p2.amount / p2.qty pp from purchases p2
                                           where p2.tenant_id = pu.tenant_id and p2.product_id = pu.product_id and p2.status = 'approved' and p2.bought_on < pu.bought_on
                                           order by p2.bought_on desc, p2.amount / p2.qty limit 1) prev on true
                             where pu.tenant_id=%s and pu.status = 'approved' and pu.bought_on >= date_trunc('month', %s::date)::date""", (ctx.tenant_id, t)).fetchone()
    pending = ctx.conn.execute("select count(*) n from purchases where tenant_id=%s and status='pending'", (ctx.tenant_id,)).fetchone()["n"]
    waiting = ctx.conn.execute("select count(*) n from contracts where tenant_id=%s and state='pending_approval'", (ctx.tenant_id,)).fetchone()["n"]
    total = sp["total"] or D(0)
    return out({
        "suppliers": ctx.conn.execute("select count(*) n from parties where tenant_id=%s and role='supplier'", (ctx.tenant_id,)).fetchone()["n"],
        "active_contracts": len(live), "expiring_90": len(exp90), "savings_this_month": sv["s"],
        "spend_90d": total, "in_contract_spend": sp["in_contract"], "not_in_contract_spend": total - sp["in_contract"],
        "off_contract_pct": round(float(sp["off_contract"] / total * 100), 1) if total else 0.0,
        "by_status": {s: sum(1 for _, x in eff if x == s) for s in E.STATES},
        "needs_you": {"expiring": [{"id": c["id"], "name": c["name"], "days_left": E.days_left(c["end"], t)} for c in exp90],
                      "contracts_waiting_approval": waiting, "off_contract_orders_pending": pending}})


@r.get("/suppliers/{sid}")
def supplier(sid: UUID, ctx: Ctx = Depends(read_ctx)):
    gate(ctx)
    p = ctx.conn.execute("""select p.id, p.name, p.contact, p.email, p.attention, p.address, p.ssm_no, sp.* from parties p
                            left join supplier_profiles sp on sp.supplier_id=p.id where p.id=%s and p.tenant_id=%s and p.role='supplier'""",
                         (sid, ctx.tenant_id)).fetchone()
    if not p:
        raise ApiError(404, "not_found", "supplier not found")
    if not ctx.owner and "edit_supplier_contacts" not in ctx.perms:  # numbers stay masked for people who cannot change them
        p["contact"] = ("*" * max(len(p["contact"] or "") - 4, 0)) + (p["contact"] or "")[-4:] if p["contact"] else None
    offers = [{**engine_offer(x), "pack_label": x["pack_label"], "product_name": None} for x in
              ctx.conn.execute(OFFER_SQL + " and o.supplier_id=%s", (ctx.tenant_id, sid)).fetchall()]
    names = {str(x["id"]): x["name"] for x in ctx.conn.execute("select id,name from products where tenant_id=%s", (ctx.tenant_id,)).fetchall()}
    for o in offers:
        o["product_name"] = names.get(o["product_id"])
        o["tiers"] = [[m, str(pr)] for m, pr in o["tiers"]]
    t = today()
    cons = [{"id": c["id"], "name": c["name"], "state": E.effective_state(c, t), "start": c["start"], "end": c["end"], "days_left": E.days_left(c["end"], t)}
            for c in load_contracts(ctx) if c["supplier_id"] == str(sid)]
    purchases = ctx.conn.execute("""select pu.bought_on, pu.qty, pu.amount, pu.status, pr.name product_name from purchases pu join products pr on pr.id=pu.product_id
                                    where pu.tenant_id=%s and pu.supplier_id=%s order by pu.bought_on desc limit 50""", (ctx.tenant_id, sid)).fetchall()
    rel = E.D(p["on_time_pct"] or 0)
    radar = {"price": float(p["price_stability_pct"] or 0), "speed": float(max(0, 100 - (p["response_hours"] or 0) * 4)),
             "reliability": float(rel), "quality": float(p["on_time_pct"] or 0) * 0.9, "flexibility": float(min(100, 40 + (p["payment_days"] or 0)))}
    return out({**p, "offers": offers, "contracts": cons, "purchases": purchases, "radar": radar,
                "contract_status": contract_status_map(ctx, t).get(str(sid), "not_in_contract")})


class ProfileIn(BaseModel, extra="forbid"):
    state: str | None = Field(None, max_length=40)
    categories: list[str] | None = Field(None, max_length=20)
    certs: list[str] | None = Field(None, max_length=20)
    payment_days: int | None = Field(None, ge=0, le=365)
    standing: str | None = Field(None, pattern="^(normal|preferred|blocked)$")
    on_time_pct: float | None = Field(None, ge=0, le=100)
    distance_km: float | None = Field(None, ge=0)


@r.put("/suppliers/{sid}/profile")
def put_profile(sid: UUID, body: ProfileIn, ctx: Ctx = Depends(write_ctx)):
    require_perm(ctx, "manage_contacts")
    if not ctx.conn.execute("select 1 from parties where id=%s and tenant_id=%s and role='supplier'", (sid, ctx.tenant_id)).fetchone():
        raise ApiError(404, "not_found", "supplier not found")
    sets = body.model_dump(exclude_unset=True)
    if sets.get("standing") == "blocked":
        require_owner(ctx)  # blocking a supplier is the owner's call
    ctx.conn.execute("insert into supplier_profiles(supplier_id,tenant_id) values (%s,%s) on conflict do nothing", (sid, ctx.tenant_id))
    if sets:
        ctx.conn.execute("update supplier_profiles set " + ",".join(f"{k}=%({k})s" for k in sets) + " where supplier_id=%(sid)s", {**sets, "sid": sid})
    audit(ctx, "supplier_profiles", sid, "supplier profile changed: " + ",".join(sorted(sets)))
    return out({"ok": True})


# ---------- products and offers ----------
@r.get("/products")
def products(q: str = Query("", max_length=100), ctx: Ctx = Depends(read_ctx)):
    gate(ctx)
    t, cs = today(), load_contracts(ctx)
    rows = ctx.conn.execute("""select p.id, p.name, p.base_uom, p.category, p.item_key,
                                      (select count(*) from supplier_offers o where o.product_id=p.id) offers,
                                      (select coalesce(array_agg(a.alias), '{}') from product_aliases a where a.product_id=p.id and a.confirmed) aliases
                               from products p where p.tenant_id=%s order by p.name""", (ctx.tenant_id,)).fetchall()
    ql = q.strip().lower()
    return out([{**x, "coverage": E.classify(cs, str(x["id"]), t)["status"]} for x in rows
                if not ql or ql in x["name"].lower() or any(ql in a.lower() for a in x["aliases"])])


class ProductIn(BaseModel, extra="forbid"):
    name: str = Field(min_length=1, max_length=120)
    base_uom: str = Field(pattern="^(kg|l|pc|m)$")
    category: str | None = Field(None, max_length=60)
    item_key: str | None = Field(None, pattern=r"^[a-z][a-z0-9_]{0,60}$")
    aliases: dict[str, list[str]] = {}


@r.post("/products", status_code=201)
def new_product(body: ProductIn, ctx: Ctx = Depends(write_ctx)):
    require_perm(ctx, "manage_contacts")
    with guarded():
        pid = ctx.conn.execute("insert into products(tenant_id,name,base_uom,category,item_key) values (%s,%s,%s,%s,%s) returning id",
                               (ctx.tenant_id, body.name.strip(), body.base_uom, body.category, body.item_key)).fetchone()["id"]
        for lang, names in body.aliases.items():
            if lang not in LANGS:
                raise ApiError(422, "bad_lang", f"language must be one of {LANGS}")
            for a in names:
                ctx.conn.execute("insert into product_aliases(tenant_id,product_id,lang,alias) values (%s,%s,%s,%s) on conflict do nothing", (ctx.tenant_id, pid, lang, a.strip()))
    audit(ctx, "products", pid, "product added")
    return out({"id": pid}, 201)


@r.get("/products/match")
def match(text: str = Query(min_length=1, max_length=200), ctx: Ctx = Depends(read_ctx)):
    """Suggest the canonical product for a supplier's wording. Rules only (word overlap); under 0.8 it is a suggestion for a human to confirm."""
    gate(ctx)
    words = set(text.lower().replace(",", " ").split())
    best = []
    for x in ctx.conn.execute("""select p.id, p.name, a.alias from products p left join product_aliases a on a.product_id=p.id and a.confirmed
                                 where p.tenant_id=%s""", (ctx.tenant_id,)).fetchall():
        for cand in {x["name"], x["alias"]} - {None}:
            cw = set(cand.lower().replace(",", " ").split())
            score = len(words & cw) / max(len(words | cw), 1)
            if score:
                best.append((score, str(x["id"]), x["name"]))
    best.sort(reverse=True)
    seen, res = set(), []
    for s, pid, name in best:
        if pid not in seen:
            seen.add(pid)
            res.append({"product_id": pid, "name": name, "confidence": round(s, 2), "needs_confirm": s < 0.8})
    return out(res[:3])


class OfferIn(BaseModel, extra="forbid"):
    supplier_id: UUID
    product_id: UUID
    pack_label: str = Field("pack", max_length=40)
    pack_size: Decimal = Field(D(1), gt=0)
    tiers: list[tuple[int, Decimal]] = Field(min_length=1, max_length=10)
    moq: Decimal | None = Field(None, gt=0)
    lead_days: int = Field(1, ge=0, le=365)
    delivery_fee: Decimal | None = Field(None, ge=0)
    free_delivery_over: Decimal | None = Field(None, ge=0)
    sst_rate: Decimal = Field(D(0), ge=0, le=1)
    discount_pct: Decimal = Field(D(0), ge=0, le=100)
    valid_until: date | None = None
    stock: Decimal | None = Field(None, ge=0)
    payment_days: int | None = Field(None, ge=0, le=365)
    source: str = Field("manual", pattern="^(manual|rfq|pasted)$")


@r.put("/offers")
def put_offer(body: OfferIn, ctx: Ctx = Depends(write_ctx)):
    require_perm(ctx, "manage_contacts")
    c = ctx.conn
    if not c.execute("select 1 from parties where id=%s and tenant_id=%s and role='supplier'", (body.supplier_id, ctx.tenant_id)).fetchone():
        raise ApiError(404, "not_found", "supplier not found")
    get_product(ctx, body.product_id)
    if any(p < 0 for _, p in body.tiers) or len({m for m, _ in body.tiers}) != len(body.tiers) or any(m < 1 for m, _ in body.tiers):
        raise ApiError(422, "bad_tiers", "tiers need distinct min_packs of 1 or more and prices of 0 or more")
    tiers = json.dumps([{"min_packs": str(m), "price": str(p)} for m, p in sorted(body.tiers)])
    with guarded():
        oid = c.execute("""insert into supplier_offers(tenant_id,supplier_id,product_id,pack_label,pack_size,tiers,moq,lead_days,delivery_fee,free_delivery_over,sst_rate,
                                                       discount_pct,valid_until,stock,payment_days,source)
                           values (%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                           on conflict (tenant_id,supplier_id,product_id) do update set pack_label=excluded.pack_label, pack_size=excluded.pack_size,
                             tiers=excluded.tiers, moq=excluded.moq, lead_days=excluded.lead_days, delivery_fee=excluded.delivery_fee,
                             free_delivery_over=excluded.free_delivery_over, sst_rate=excluded.sst_rate, discount_pct=excluded.discount_pct,
                             valid_until=excluded.valid_until, stock=excluded.stock, payment_days=excluded.payment_days, source=excluded.source, updated_at=now()
                           returning id""",
                        (ctx.tenant_id, body.supplier_id, body.product_id, body.pack_label, body.pack_size, tiers, body.moq, body.lead_days, body.delivery_fee,
                         body.free_delivery_over, body.sst_rate, body.discount_pct, body.valid_until, body.stock, body.payment_days, body.source)).fetchone()["id"]
        first = body.tiers[0][1] / body.pack_size
        c.execute("""insert into offer_history(tenant_id,offer_id,month,price_per_base) values (%s,%s,date_trunc('month', current_date)::date,%s)
                     on conflict (offer_id,month) do update set price_per_base=excluded.price_per_base""", (ctx.tenant_id, oid, first))
    audit(ctx, "supplier_offers", oid, "offer saved", None, {"supplier_id": body.supplier_id, "product_id": body.product_id})
    return out({"id": oid})


class FromReply(BaseModel, extra="forbid"):
    product_id: UUID
    pack_label: str = Field("pack", max_length=40)
    pack_size: Decimal = Field(D(1), gt=0)
    lead_days: int = Field(2, ge=0, le=365)
    delivery_fee: Decimal | None = Field(None, ge=0)


@r.post("/offers/from-reply/{reply_id}", status_code=201)
def offer_from_reply(reply_id: UUID, body: FromReply, ctx: Ctx = Depends(write_ctx)):
    """A price read from a supplier's reply to an 'Ask suppliers' request becomes a comparable offer. Reuses the existing request flow."""
    require_perm(ctx, "manage_contacts")
    require_perm(ctx, "view_replies_prices")
    x = ctx.conn.execute("""select r.id, r.unit_price, r.min_qty, r.tiers, s.supplier_id from rfq_replies r join rfq_sends s on s.id=r.send_id
                            where r.id=%s and r.tenant_id=%s""", (reply_id, ctx.tenant_id)).fetchone()
    if not x:
        raise ApiError(404, "not_found", "reply not found")
    if x["unit_price"] is None:
        raise ApiError(409, "no_price", "no price was read from this reply")
    get_product(ctx, body.product_id)
    tiers = [(1, x["unit_price"])] + [(int(D(str(t["min_qty"]))), D(str(t["unit_price"]))) for t in x["tiers"] if D(str(t["min_qty"])) > 1]
    oid = ctx.conn.execute("""insert into supplier_offers(tenant_id,supplier_id,product_id,pack_label,pack_size,tiers,moq,lead_days,delivery_fee,source,rfq_reply_id)
                              values (%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,'rfq',%s)
                              on conflict (tenant_id,supplier_id,product_id) do update set tiers=excluded.tiers, moq=excluded.moq, source='rfq',
                                rfq_reply_id=excluded.rfq_reply_id, updated_at=now() returning id""",
                           (ctx.tenant_id, x["supplier_id"], body.product_id, body.pack_label, body.pack_size,
                            json.dumps([{"min_packs": str(m), "price": str(p)} for m, p in tiers]),
                            (x["min_qty"] * body.pack_size) if x["min_qty"] and x["min_qty"] > 1 else None, body.lead_days, body.delivery_fee, reply_id)).fetchone()["id"]
    audit(ctx, "supplier_offers", oid, "offer made from a supplier reply", None, {"reply_id": reply_id})
    return out({"id": oid}, 201)


@r.post("/offers/{oid}/to-cost-book")
def offer_to_cost_book(oid: UUID, request: Request, ctx: Ctx = Depends(write_ctx)):
    """Owner: the chosen price becomes the cost-book price, through the same inbound-quotation path as everything else, so quote pricing follows it."""
    require_owner(ctx)
    from .. import pipeline  # local: pipeline imports the API layer's siblings
    o = ctx.conn.execute("""select o.*, p.name pname, p.item_key, p.base_uom from supplier_offers o join products p on p.id=o.product_id
                            where o.id=%s and o.tenant_id=%s""", (oid, ctx.tenant_id)).fetchone()
    if not o:
        raise ApiError(404, "not_found", "offer not found")
    if not o["item_key"]:
        raise ApiError(409, "no_item_key", "set a cost-book key on this product first")
    lines = [{"description": o["pname"], "item_key": o["item_key"], "min_qty": str(int(t["min_packs"]) * o["pack_size"]),
              "unit_price": str((D(str(t["price"])) / o["pack_size"]).quantize(D("0.0001"))), "uom": o["base_uom"]} for t in o["tiers"]]
    res = pipeline.ingest_supplier_document(ctx.conn, ctx.tenant_id, raw={"doc_no": f"OFFER-{str(oid)[:8]}", "lines": lines}, party_id=o["supplier_id"],
                                            channel="upload", actor=ctx.user_id)
    ctx.conn.execute("update document_lines set needs_review=false where document_id=%s", (res["doc_id"],))
    for to in ("reviewed", "accepted", "in_cost_book"):
        transition(res["doc_id"], Transition(to=to), request, ctx)
    audit(ctx, "supplier_offers", oid, f"offer price written to the cost book as {o['item_key']}", None, {"doc_id": res["doc_id"]})
    return out({"doc_id": res["doc_id"]})


# ---------- comparison and recommendation ----------
def render_why(ex: dict, uom: str) -> dict:
    if not ex:
        return {l: NONE[l] for l in LANGS}
    p, res = ex["params"], {}
    who = re.sub(r"^SAMPLE | \(synthetic\)$", "", p["supplier"] or "")  # the demo labels are for the data, not for the sentence
    for l in LANGS:
        txt = WHY[l].format(supplier=who, total=p["total"], qty=p["qty"].rstrip("0").rstrip(".") if "." in p["qty"] else p["qty"], uom=uom, lead=p["lead_days"],
                            saving=SAVING[l].format(x=p["saving_vs_next"]) if p["saving_vs_next"] and D(p["saving_vs_next"]) > 0 else "",
                            rel=REL[l].format(x=p["reliability"].split(".")[0]) if p["reliability"] else "")
        if ex["ask_human"]:
            txt += " " + ASK[l].format(what=", ".join(ex["missing"]))
        res[l] = txt
    return res


def row_out(rw: dict, base_uom: str) -> dict:
    o, l = rw["offer"], rw["landed"]
    return {"offer_id": o["id"], "supplier_id": o["supplier_id"], "supplier_name": o["supplier"], "state": o["state"], "standing": o["standing"], "pack_label": o["pack_label"],
            "pack_size": o["pack_size"], "lead_days": o["lead_days"], "moq": o["moq"], "stock": o["stock"], "valid_until": o["valid_until"],
            "certs": o["certs"], "reliability": o["reliability"], "payment_days": o["payment_days"],
            "landed": {k: l[k] for k in ("packs", "pack_price", "goods", "discount", "delivery", "sst", "total", "per_base_unit", "base_qty", "missing")},
            "why_not": rw["why_not"], "delta_vs_lowest": rw.get("delta_vs_lowest"), "score": rw.get("score")}


def compare(ctx: Ctx, pid: UUID, qty: Decimal, needed_by: date | None, filt: dict) -> dict:
    p, st, t = get_product(ctx, pid), settings(ctx), today()
    offers = load_offers(ctx, pid)
    # list filters that hide a supplier before the guardrails: state, payment terms, contract-only / non-contract-only
    cs = load_contracts(ctx)
    cov = E.classify(cs, str(pid), t, qty)
    in_c = {c["supplier_id"] for c in E.covering(cs, str(pid), t)}
    if filt.get("state"):
        offers = [o for o in offers if o["state"] == filt["state"]]
    if filt.get("payment_days") is not None:
        offers = [o for o in offers if (o["payment_days"] or 0) >= filt["payment_days"]]
    if filt.get("contract_only") is True:
        offers = [o for o in offers if o["supplier_id"] in in_c]
    if filt.get("contract_only") is False:
        offers = [o for o in offers if o["supplier_id"] not in in_c]
    weights = {**st["weights"], **(filt.get("weights") or {})}
    res = E.rank(offers, qty, needed_by, t, filt.get("certs") or (), filt.get("min_reliability"), weights, st["five_sen"])
    ex = E.explain(res)
    rec = res["recommended"]
    sort = filt.get("sort", "lowest")
    q = list(res["qualified"])
    if sort == "fastest":
        q.sort(key=lambda r_: (r_["offer"]["lead_days"], r_["landed"]["total"]))
    elif sort == "reliable":
        q.sort(key=lambda r_: (-(r_["offer"]["reliability"] or 0), r_["landed"]["total"]))
    elif sort == "value":
        q.sort(key=lambda r_: (-r_["score"], r_["landed"]["total"]))
    last = ctx.conn.execute("select amount/qty per_base, supplier_id from purchases where tenant_id=%s and product_id=%s and status='approved' order by bought_on desc limit 1",
                            (ctx.tenant_id, pid)).fetchone()
    market = [r_["landed"]["per_base_unit"] for r_ in res["qualified"]]
    savings = None
    if rec:
        rb = rec["landed"]["per_base_unit"]
        base = rec["landed"]["base_qty"]
        savings = {"vs_last_paid": ((last["per_base"] - rb) * base).quantize(D("0.01")) if last else None,
                   "vs_market_avg": ((sum(market) / len(market) - rb) * base).quantize(D("0.01")),
                   "vs_highest": ((max(market) - rb) * base).quantize(D("0.01"))}
    hist = ctx.conn.execute("""select o.supplier_id, h.month, h.price_per_base from offer_history h join supplier_offers o on o.id=h.offer_id
                               where h.tenant_id=%s and o.product_id=%s order by h.month""", (ctx.tenant_id, pid)).fetchall()
    series: dict = {}
    for h in hist:
        series.setdefault(str(h["supplier_id"]), []).append({"month": h["month"], "price": h["price_per_base"]})
    result = {"product": {"id": p["id"], "name": p["name"], "base_uom": p["base_uom"]}, "qty": qty, "needed_by": needed_by,
              "coverage": cov, "recommended": row_out(rec, p["base_uom"]) if rec else None,
              "qualified": [row_out(x, p["base_uom"]) for x in q], "disqualified": [row_out(x, p["base_uom"]) for x in res["disqualified"]],
              "badges": res["badges"], "weights": res["weights"], "rules": res["rules"], "why": render_why(ex, p["base_uom"]), "explain": ex,
              "split": E.split_hint(res, qty), "savings": savings, "history": series,
              "last_paid_per_base": last["per_base"] if last else None, "market_avg_per_base": (sum(market) / len(market)) if market else None}
    contract_offer = None
    if cov["status"] in ("in_contract", "expiring", "partial"):
        c = next(c for c in cs if c["id"] == str(cov["contract_id"]))
        it = next((i for i in c["items"] if i["product_id"] == pid), None)
        if it and rec:
            cpb = it["price_per_pack"] / it["pack_size"]
            contract_offer = {"contract_id": c["id"], "name": c["name"], "supplier_name": c["supplier_name"], "price_per_base": cpb,
                              "insight": E.market_insight(cpb, rec["landed"]["per_base_unit"], st["market_gap_pct"],
                                                          next((d for d in sorted(c["price_reviews"] or []) if d >= t), None), t)}
    result["contract"] = contract_offer
    return result


@r.get("/products/{pid}/compare")
def product_compare(pid: UUID, qty: Decimal = Query(D(1), gt=0, le=10_000_000), uom: str | None = Query(None, max_length=10),
                    needed_by: date | None = None, state: str | None = None, payment_days: int | None = Query(None, ge=0),
                    cert: list[str] = Query([]), min_reliability: float | None = Query(None, ge=0, le=100), contract_only: bool | None = None,
                    sort: str = Query("lowest", pattern="^(lowest|fastest|reliable|value)$"), w_price: int | None = Query(None, ge=0, le=100),
                    w_reliability: int | None = Query(None, ge=0, le=100), w_lead: int | None = Query(None, ge=0, le=100), w_terms: int | None = Query(None, ge=0, le=100),
                    ctx: Ctx = Depends(read_ctx)):
    gate(ctx)
    p = get_product(ctx, pid)
    w = {k: v for k, v in {"price": w_price, "reliability": w_reliability, "lead": w_lead, "terms": w_terms}.items() if v is not None}
    if w and sum({**E.DEFAULT_WEIGHTS, **w}.values()) == 0:
        raise ApiError(422, "bad_weights", "weights cannot all be zero")
    return out(compare(ctx, pid, unit_qty(p, qty, uom), needed_by, {"state": state, "payment_days": payment_days, "certs": cert, "min_reliability": min_reliability,
                                                                    "contract_only": contract_only, "sort": sort, "weights": w}))


@r.post("/products/{pid}/recommendation", status_code=201)
def save_recommendation(pid: UUID, qty: Decimal = Query(D(1), gt=0, le=10_000_000), needed_by: date | None = None, ctx: Ctx = Depends(write_ctx)):
    """Stores the snapshot (inputs, rules, ranking, four-language reason) so the advice can be explained later."""
    gate(ctx)
    res = compare(ctx, pid, qty, needed_by, {})
    saving = (res["savings"] or {}).get("vs_last_paid") or D(0)
    slim = {k: res[k] for k in ("recommended", "badges", "weights", "rules", "why", "explain", "split", "savings", "coverage")}
    slim["saving_vs_last_paid"] = max(saving, D(0))
    slim["ranking"] = [{"offer_id": x["offer_id"], "total": x["landed"]["total"]} for x in res["qualified"]]
    slim["disqualified"] = [{"offer_id": x["offer_id"], "why_not": x["why_not"]} for x in res["disqualified"]]
    rid = ctx.conn.execute("insert into recommendations(tenant_id,product_id,qty,needed_by,inputs,result,created_by) values (%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s) returning id",
                           (ctx.tenant_id, pid, qty, needed_by, json.dumps({"qty": str(qty), "needed_by": str(needed_by) if needed_by else None, "today": str(today())}),
                            json.dumps(slim, default=str), ctx.user_id)).fetchone()["id"]
    audit(ctx, "recommendations", rid, "recommendation saved", None, {"product_id": pid, "recommended": (res["recommended"] or {}).get("supplier_name")})
    return out({"id": rid, **slim}, 201)


@r.get("/products/{pid}/rfq-candidates")
def rfq_candidates(pid: UUID, qty: Decimal = Query(D(1), gt=0), needed_by: date | None = None, limit: int = Query(4, ge=1, le=6), ctx: Ctx = Depends(read_ctx)):
    """The top qualified suppliers to ask for fresh quotes. The Ask suppliers screen (needs a photo) sends the request; nothing is sent here."""
    gate(ctx)
    res = E.rank([o for o in load_offers(ctx, pid) if o["standing"] != "blocked"], qty, None, today())
    return out([{"supplier_id": x["offer"]["supplier_id"], "supplier_name": x["offer"]["supplier"]} for x in res["qualified"][:limit]])


@r.put("/products/{pid}/shortlist/{oid}")
def shortlist_add(pid: UUID, oid: UUID, ctx: Ctx = Depends(write_ctx)):
    gate(ctx)
    get_product(ctx, pid)
    if not ctx.conn.execute("select 1 from supplier_offers where id=%s and product_id=%s and tenant_id=%s", (oid, pid, ctx.tenant_id)).fetchone():
        raise ApiError(404, "not_found", "offer not found")
    ctx.conn.execute("insert into shortlist(tenant_id,product_id,offer_id,user_id) values (%s,%s,%s,%s) on conflict do nothing", (ctx.tenant_id, pid, oid, ctx.user_id))
    return out({"ok": True})


# ---------- contracts ----------
class ItemIn(BaseModel, extra="forbid"):
    product_id: UUID
    pack_size: Decimal = Field(D(1), gt=0)
    price_per_pack: Decimal = Field(ge=0)


class ContractIn(BaseModel, extra="forbid"):
    supplier_id: UUID
    name: str = Field(min_length=1, max_length=120)
    items: list[ItemIn] = Field(min_length=1, max_length=50)
    price_model: str = Field("fixed", pattern="^(fixed|tiered|indexed)$")
    start_on: date
    end_on: date
    renewal: str = Field("manual", pattern="^(manual|auto)$")
    notice_days: int = Field(30, ge=0, le=365)
    price_reviews: list[date] = Field([], max_length=24)
    min_qty: Decimal | None = Field(None, ge=0)
    max_qty: Decimal | None = Field(None, ge=0)
    value: Decimal = Field(D(0), ge=0)
    payment_days: int | None = Field(None, ge=0, le=365)
    sla_lead_days: int | None = Field(None, ge=0, le=365)
    terms_note: str | None = Field(None, max_length=2000)


def event(ctx: Ctx, cid, frm, to, reason=None):
    ctx.conn.execute("insert into contract_events(tenant_id,contract_id,from_state,to_state,reason,actor) values (%s,%s,%s,%s,%s,%s)", (ctx.tenant_id, cid, frm, to, reason, ctx.user_id))


@r.post("/contracts", status_code=201)
def new_contract(body: ContractIn, ctx: Ctx = Depends(write_ctx)):
    """Staff with manage_contracts (or the owner) draft. Nothing is active until it has been approved."""
    require_perm(ctx, "manage_contracts") if not ctx.owner else None
    c = ctx.conn
    if body.end_on <= body.start_on:
        raise ApiError(422, "bad_dates", "the end date must be after the start date")
    if body.min_qty is not None and body.max_qty is not None and body.min_qty > body.max_qty:
        raise ApiError(422, "bad_volume", "minimum volume is above the maximum")
    if not c.execute("select 1 from parties where id=%s and tenant_id=%s and role='supplier'", (body.supplier_id, ctx.tenant_id)).fetchone():
        raise ApiError(404, "not_found", "supplier not found")
    for it in body.items:
        get_product(ctx, it.product_id)
    with guarded():
        cid = c.execute("""insert into contracts(tenant_id,supplier_id,name,price_model,start_on,end_on,renewal,notice_days,price_reviews,min_qty,max_qty,value,payment_days,
                                                 sla_lead_days,terms_note,created_by) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
                         (ctx.tenant_id, body.supplier_id, body.name.strip(), body.price_model, body.start_on, body.end_on, body.renewal, body.notice_days,
                          sorted(body.price_reviews), body.min_qty, body.max_qty, body.value, body.payment_days, body.sla_lead_days, body.terms_note, ctx.user_id)).fetchone()["id"]
        for it in body.items:
            c.execute("insert into contract_items(tenant_id,contract_id,product_id,pack_size,price_per_pack) values (%s,%s,%s,%s,%s)",
                      (ctx.tenant_id, cid, it.product_id, it.pack_size, it.price_per_pack))
    event(ctx, cid, None, "draft")
    audit(ctx, "contracts", cid, "contract drafted", None, {"name": body.name, "value": body.value})
    return out({"id": cid, "state": "draft"}, 201)


def contract_view(ctx: Ctx, c: dict, t: date) -> dict:
    eff = E.effective_state(c, t)
    names = {str(x["id"]): x["name"] for x in ctx.conn.execute("select id,name from products where tenant_id=%s", (ctx.tenant_id,)).fetchall()}
    k = E.commitment(c, t)
    return {"id": c["id"], "name": c["name"], "supplier_id": c["supplier_id"], "supplier_name": c["supplier_name"], "state": eff, "stored_state": c["state"],
            "start": c["start"], "end": c["end"], "days_left": E.days_left(c["end"], t), "notice_days": c["notice_days"], "renewal": c["renewal"],
            "notice_deadline": E.notice_deadline(c["end"], c["notice_days"]), "price_model": c["price_model"], "value": c["value"],
            "min_qty": c["min_qty"], "max_qty": c["max_qty"], "used_qty": c["used_qty"], "payment_days": c["payment_days"], "sla_lead_days": c["sla_lead_days"],
            "terms_note": c["terms_note"], "acknowledged_at": c["acknowledged_at"], "created_by": c["created_by"], "approved_by": c["approved_by"],
            "items": [{"product_id": i["product_id"], "product_name": names.get(str(i["product_id"])), "pack_size": i["pack_size"], "price_per_pack": i["price_per_pack"]}
                      for i in c["items"]],
            "milestones": [{**m, "days": (m["date"] - t).days} for m in E.milestones(c)],
            "progress": round(k["progress"], 4), "volume_used_pct": float(c["used_qty"] / c["max_qty"]) if c["max_qty"] else None,
            "projected": k["projected"], "shortfall": k["shortfall"], "overage": k["overage"]}


@r.get("/contracts")
def contracts(state: str | None = Query(None, pattern="^[a-z_]+$"), supplier_id: UUID | None = None, ctx: Ctx = Depends(read_ctx)):
    gate(ctx)
    t = today()
    res = [contract_view(ctx, c, t) for c in load_contracts(ctx) if not supplier_id or c["supplier_id"] == str(supplier_id)]
    return out([c for c in res if not state or c["state"] == state])


@r.get("/contracts/timeline")
def timeline(group: str = Query("supplier", pattern="^(supplier|product)$"), ctx: Ctx = Depends(read_ctx)):
    gate(ctx)
    t, cs = today(), load_contracts(ctx)
    views = [contract_view(ctx, c, t) for c in cs]
    lanes: dict = {}
    for v, c in zip(views, cs):
        keys = [(v["supplier_id"], v["supplier_name"])] if group == "supplier" else [(i["product_id"], i["product_name"]) for i in v["items"]]
        for k in keys:
            lanes.setdefault(k, []).append(v)
    gaps = {}
    lo, hi = t, t + timedelta(days=540)  # coverage ahead: a gap in the past is not actionable
    for p in ctx.conn.execute("select id,name from products where tenant_id=%s", (ctx.tenant_id,)).fetchall():
        g = E.coverage_gaps(cs, str(p["id"]), lo, hi)
        if any(str(p["id"]) in c["products"] for c in cs):
            gaps[str(p["id"])] = {"name": p["name"], "gaps": g["gaps"], "overlaps": g["overlaps"]}
    return out({"today": t, "group": group, "lanes": [{"id": str(k[0]), "name": k[1], "contracts": v} for k, v in lanes.items()], "coverage": gaps,
                "reminders": [{"contract_id": v["id"], "name": v["name"], **m} for v, c in zip(views, cs) if v["state"] in ("active", "expiring", "renewal")
                              for m in E.reminder_dates(c) if m["date"] >= t][:40]})


@r.get("/contracts/coverage")
def coverage(product_id: UUID, on: date | None = None, qty: Decimal | None = Query(None, gt=0), ctx: Ctx = Depends(read_ctx)):
    gate(ctx)
    get_product(ctx, product_id)
    return out(E.classify(load_contracts(ctx), str(product_id), on or today(), qty))


@r.get("/contracts/{cid}")
def contract(cid: UUID, ctx: Ctx = Depends(read_ctx)):
    gate(ctx)
    c = next((x for x in load_contracts(ctx) if x["id"] == str(cid)), None)
    if not c:
        raise ApiError(404, "not_found", "contract not found")
    v = contract_view(ctx, c, today())
    v["events"] = ctx.conn.execute("select from_state,to_state,reason,actor,at from contract_events where contract_id=%s order by at, seq", (cid,)).fetchall()
    v["purchases"] = ctx.conn.execute("select bought_on,qty,amount,status from purchases where contract_id=%s order by bought_on desc limit 50", (cid,)).fetchall()
    insights = []
    for it in c["items"]:
        res = compare(ctx, it["product_id"], c["max_qty"] / 12 if c["max_qty"] else D(1), None, {})
        cpb = it["price_per_pack"] / it["pack_size"]
        rec = res["recommended"]
        if rec:
            insights.append({"product_id": it["product_id"], "contract_per_base": cpb, "market_lowest_per_base": rec["landed"]["per_base_unit"],
                             "market_supplier": rec["supplier_name"],
                             **E.market_insight(cpb, rec["landed"]["per_base_unit"], settings(ctx)["market_gap_pct"],
                                                next((d for d in sorted(c["price_reviews"] or []) if d >= today()), None), today())})
    v["market"] = insights
    v["boundary"] = "Tracks your agreement. Not legal advice. Keep the signed copy."
    return out(v)


class Move(BaseModel, extra="forbid"):
    to: str = Field(pattern="^(pending_approval|active|draft|expiring|renewal|renewed|expired|terminated)$")
    reason: str | None = Field(None, max_length=500)


@r.post("/contracts/{cid}/transition")
def contract_move(cid: UUID, body: Move, ctx: Ctx = Depends(write_ctx)):
    c = ctx.conn.execute("select * from contracts where id=%s and tenant_id=%s for update", (cid, ctx.tenant_id)).fetchone()
    if not c:
        raise ApiError(404, "not_found", "contract not found")
    try:
        E.check_transition(c["state"], body.to, body.reason)
    except E.ContractError as e:
        raise ApiError(409, "bad_transition", str(e))
    approving = c["state"] == "pending_approval"  # approve or send back
    if approving:
        if c["created_by"] == ctx.user_id and not ctx.owner:
            raise ApiError(403, "self_approval", "someone else must approve a contract you drafted")
        lim = settings(ctx)["manager_limit"]
        role_class = "owner" if ctx.owner else ("manager" if "approve_contracts" in ctx.perms else "staff")
        if not E.may_approve(role_class, c["value"], lim):
            raise ApiError(403, "approval_limit", "this contract needs the owner" if role_class == "manager" else "you cannot approve contracts")
    elif not ctx.owner:
        require_perm(ctx, "manage_contracts")
        if body.to in ("terminated", "renewed"):
            raise ApiError(403, "owner_only", "only the owner can do this")
    with guarded():
        ctx.conn.execute("update contracts set state=%s, approved_by = case when %s then %s else approved_by end where id=%s",
                         (body.to, approving and body.to == "active", ctx.user_id, cid))
    event(ctx, cid, c["state"], body.to, body.reason)
    audit(ctx, "contracts", cid, f"contract {c['state']} -> {body.to}", {"state": c["state"]}, {"state": body.to, "reason": body.reason})
    return out({"id": cid, "state": body.to})


@r.post("/contracts/{cid}/acknowledge")
def acknowledge(cid: UUID, ctx: Ctx = Depends(write_ctx)):
    """Simulated 'supplier acknowledged' step for the demo. Not an e-signature."""
    require_perm(ctx, "manage_contracts") if not ctx.owner else None
    n = ctx.conn.execute("update contracts set acknowledged_at=now() where id=%s and tenant_id=%s and state in ('active','pending_approval') returning id", (cid, ctx.tenant_id)).fetchone()
    if not n:
        raise ApiError(409, "bad_state", "only a contract waiting for approval or active can be acknowledged")
    audit(ctx, "contracts", cid, "supplier acknowledged (simulated)")
    return out({"ok": True})


@r.get("/contracts/{cid}/renewal-pack")
def renewal_pack(cid: UUID, ctx: Ctx = Depends(read_ctx)):
    """Performance, market comparison and three options for the human to choose from. Nothing renews by itself."""
    gate(ctx)
    c = next((x for x in load_contracts(ctx) if x["id"] == str(cid)), None)
    if not c:
        raise ApiError(404, "not_found", "contract not found")
    t = today()
    prof = ctx.conn.execute("select on_time_pct, price_stability_pct from supplier_profiles where supplier_id=%s", (c["supplier_id"],)).fetchone() or {}
    rows = []
    for it in c["items"]:
        res = compare(ctx, it["product_id"], c["max_qty"] / 12 if c["max_qty"] else D(1), None, {})
        cheapest = next((x for x in res["qualified"] if x["supplier_id"] != c["supplier_id"]), None)
        mine = next((x for x in res["qualified"] if x["supplier_id"] == c["supplier_id"]), None)
        cpb = it["price_per_pack"] / it["pack_size"]
        target = (res["recommended"]["landed"]["per_base_unit"] * it["pack_size"]).quantize(D("0.01")) if res["recommended"] else None
        rows.append({"product_id": it["product_id"], "contract_per_base": cpb, "market_lowest_per_base": res["recommended"]["landed"]["per_base_unit"] if res["recommended"] else None,
                     "current_supplier_offer_per_base": mine["landed"]["per_base_unit"] if mine else None,
                     "alternative": {"supplier_name": cheapest["supplier_name"], "per_base": cheapest["landed"]["per_base_unit"]} if cheapest else None,
                     "suggested_target_per_pack": target})
    return out({"contract_id": cid, "days_left": E.days_left(c["end"], t), "notice_deadline": E.notice_deadline(c["end"], c["notice_days"]),
                "performance": {"on_time_pct": prof.get("on_time_pct"), "price_stability_pct": prof.get("price_stability_pct"),
                                "volume_used": c["used_qty"], "volume_min": c["min_qty"], "volume_max": c["max_qty"]},
                "market": rows, "options": ["renew_as_is", "renegotiate", "switch_supplier"],
                "note": "Choose one. Nothing renews or is sent automatically."})


# ---------- orders: the in-contract guard ----------
class PurchaseIn(BaseModel, extra="forbid"):
    product_id: UUID
    supplier_id: UUID
    qty: Decimal = Field(gt=0)
    amount: Decimal = Field(ge=0)
    reason: str | None = Field(None, max_length=500)


@r.post("/purchases/check")
def purchase_check(body: PurchaseIn, ctx: Ctx = Depends(read_ctx)):
    gate(ctx)
    get_product(ctx, body.product_id)
    cs, t = load_contracts(ctx), today()
    g = E.off_contract_guard(cs, str(body.product_id), str(body.supplier_id), t)
    return out({"coverage": E.classify(cs, str(body.product_id), t, body.qty), "guard": g})


@r.post("/purchases", status_code=201)
def purchase(body: PurchaseIn, ctx: Ctx = Depends(write_ctx)):
    """Records an order. A contracted product bought from another supplier needs a reason and a manager's or owner's approval:
    an approver's order is recorded at once, anyone else's waits as 'pending' in the Needs-you list."""
    gate(ctx)
    require_perm(ctx, "manage_contracts") if not ctx.owner else None
    get_product(ctx, body.product_id)
    cs, t = load_contracts(ctx), today()
    g = E.off_contract_guard(cs, str(body.product_id), str(body.supplier_id), t)
    cov = E.classify(cs, str(body.product_id), t, body.qty)
    contract_id = None
    if not g and cov["status"] in ("in_contract", "expiring"):
        contract_id = cov["contract_id"]
    status, approved_by = "approved", None
    if g:
        if not (body.reason or "").strip():
            raise ApiError(422, "reason_needed", "this product is under contract with another supplier: give a reason")
        if ctx.owner or "approve_contracts" in ctx.perms:
            approved_by = ctx.user_id
        else:
            status = "pending"
    pid = ctx.conn.execute("""insert into purchases(tenant_id,product_id,supplier_id,bought_on,qty,amount,contract_id,off_contract_reason,approved_by,status,requested_by)
                              values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
                           (ctx.tenant_id, body.product_id, body.supplier_id, t, body.qty, body.amount, contract_id, body.reason if g else None, approved_by, status, ctx.user_id)).fetchone()["id"]
    if contract_id and status == "approved":
        ctx.conn.execute("insert into contract_usage(tenant_id,contract_id,product_id,qty,amount,used_on) values (%s,%s,%s,%s,%s,%s)",
                         (ctx.tenant_id, contract_id, body.product_id, body.qty, body.amount, t))
    ctx.conn.execute("update supplier_profiles set last_order_on=%s where supplier_id=%s", (t, body.supplier_id))
    audit(ctx, "purchases", pid, "off-contract order " + status if g else "order recorded", None, {"reason": body.reason, "contract_id": contract_id})
    return out({"id": pid, "status": status, "off_contract": bool(g), "contract_id": contract_id}, 201)


@r.get("/purchases/pending")
def purchases_pending(ctx: Ctx = Depends(read_ctx)):
    gate(ctx)
    return out(ctx.conn.execute("""select pu.id, pu.qty, pu.amount, pu.bought_on, pu.off_contract_reason reason, pr.name product_name, p.name supplier_name
                                   from purchases pu join products pr on pr.id=pu.product_id join parties p on p.id=pu.supplier_id
                                   where pu.tenant_id=%s and pu.status='pending' order by pu.bought_on, pu.id""", (ctx.tenant_id,)).fetchall())


@r.post("/purchases/{pid}/decide")
def purchase_decide(pid: UUID, approve: bool = Query(...), ctx: Ctx = Depends(write_ctx)):
    if not (ctx.owner or "approve_contracts" in ctx.perms):
        raise ApiError(403, "permission_required", "you cannot approve off-contract orders")
    x = ctx.conn.execute("update purchases set status=%s, approved_by=%s where id=%s and tenant_id=%s and status='pending' returning id", ("approved" if approve else "rejected", ctx.user_id, pid, ctx.tenant_id)).fetchone()
    if not x:
        raise ApiError(404, "not_found", "no pending order with that id")
    audit(ctx, "purchases", pid, "off-contract order " + ("approved" if approve else "rejected"))
    return out({"id": pid, "status": "approved" if approve else "rejected"})


@r.get("/purchases/nudges")
def nudges(ctx: Ctx = Depends(read_ctx)):
    """Products bought often from one supplier with no contract. Optional, explained, and based only on your own purchases."""
    gate(ctx)
    t, cs, res = today(), load_contracts(ctx), []
    for p in ctx.conn.execute("select id,name from products where tenant_id=%s", (ctx.tenant_id,)).fetchall():
        if E.classify(cs, str(p["id"]), t)["status"] != "not_in_contract":
            continue
        rows = ctx.conn.execute("select bought_on, amount, supplier_id from purchases where tenant_id=%s and product_id=%s and status='approved' and bought_on >= %s",
                                (ctx.tenant_id, p["id"], t - timedelta(days=90))).fetchall()
        n = E.nudge([(x["bought_on"], x["amount"], str(x["supplier_id"])) for x in rows])
        if n:
            res.append({"product_id": p["id"], "product_name": p["name"], **n})
    return out(res)


@r.post("/suppliers-demo", status_code=201)
def load_demo(ctx: Ctx = Depends(write_ctx)):
    """Owner: load the synthetic demo suppliers, offers and contracts (once)."""
    require_owner(ctx)
    ctx.conn.execute("select seed_supplier_demo(%s)", (ctx.tenant_id,))
    audit(ctx, "tenants", ctx.tenant_id, "demo suppliers loaded")
    return out({"ok": True}, 201)
