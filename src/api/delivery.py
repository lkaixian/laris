"""Order chain step 3 (docs/order-chain-plan.md): the delivery order and the customer's tap-to-sign proof of delivery.
Staff: POST /api/jobs/{id}/delivery-orders and POST /api/deal-docs/{id}/delivery-link (issue_delivery). Public (no login, no cookies):
GET /api/public/delivery/{token}, POST .../sign. Every public read and write goes through the two SECURITY DEFINER functions in db/delivery.sql;
this file validates input, limits rates and shapes the answer. Errors are built here, not raised, so the error log never prints the token path.
What a typed name plus a tap is worth in law is for the lawyer (docs/order-chain-plan.md section 7): the page says what is recorded, no more."""
import base64
import io
import re
import secrets
import struct
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .. import auth, clock, db, doc_layout, mailer, pipeline, quote_doc
from ..errors import ApiError
from .accept import TOKEN, _err, _gone, _name, _slow
from .chain import _delivery, _issue, _job, _net, _order_model, _total, money, stage
from .deps import JR, Ctx, audit, guarded, reply, require_owner, require_perm, throttle, write_ctx
from .routes import MAGIC

r = APIRouter(prefix="/api")
MARK_BYTES = 100_000  # decoded; also the cap after the PNG is rebuilt
MARK_PX = (600, 300)  # width, height
MAX_BODY = 150_000


# ---------------------------------------------------------------- staff
class DLine(BaseModel, extra="forbid"):
    no: int = Field(ge=1)  # the order line's number
    qty: Decimal = Field(gt=0, lt=Decimal(10) ** 9, decimal_places=3)


class DeliveryIn(BaseModel, extra="forbid"):
    lines: list[DLine] | None = Field(None, min_length=1, max_length=200)  # null = everything still to deliver
    override_reason: str | None = Field(None, min_length=3, max_length=300)  # owner only; used only when the deposit is not recorded


@r.post("/jobs/{job_id}/delivery-orders")
def issue_delivery_order(job_id: UUID, request: Request, body: DeliveryIn = DeliveryIn(), ctx: Ctx = Depends(write_ctx)):
    """Freeze (part of) the order into a delivery order. Never more than ordered across the live delivery orders (the database enforces it under
    a lock). The proforma deposit must be recorded, else only the owner with override_reason (stored on the document, audited). Prices on the
    paper follow the layout's show_prices, off by default; this response never carries them."""
    require_perm(ctx, "issue_delivery")
    if body.override_reason:
        require_owner(ctx)
    c = ctx.conn
    j = _job(ctx, job_id, lock=True)
    m = _order_model(ctx, j)
    paid, dep = _net(c, job_id)
    pf = c.execute("select extra from deal_docs where job_id=%s and kind='proforma' and status <> 'void'", (job_id,)).fetchone()
    gated = stage(_total(ctx, j), paid, Decimal(pf["extra"]["deposit_amount"]) if pf else None, dep, False, False) == "awaiting_deposit"
    if gated and not body.override_reason:
        raise ApiError(409, "deposit_missing", "the deposit has not been recorded yet; the owner can override with a reason")
    if body.lines and len({x.no for x in body.lines}) != len(body.lines):
        raise ApiError(422, "duplicate_line", "each order line may be listed once")
    left = {x["no"]: x["ordered"] - x["issued"] for x in _delivery(c, job_id)}
    want = {x.no: x.qty for x in body.lines} if body.lines else {n: q for n, q in left.items() if q > 0}
    src = {x["no"]: x for x in m["lines"] if not x["is_header"]}
    if bad := [n for n in want if n not in src]:
        raise ApiError(422, "bad_line", f"line {bad[0]} is not on this order")
    if not want:
        raise ApiError(409, "nothing_to_deliver", "everything ordered is already on a delivery order")
    lines = [{**src[n], "qty": quote_doc._trim(q), "amount": money(q * (src[n]["unit_price"] or 0) * (1 - (src[n]["discount_pct"] or 0) / Decimal(100)))}
             for n, q in sorted(want.items())]
    sub = sum(x["amount"] for x in lines)
    why = body.override_reason.strip() if gated else None
    with guarded():  # ponytail: the totals are the delivered goods before SST; the invoice carries the tax
        d = _issue(ctx, job_id, "delivery_order", {"lines": lines, "subtotal": sub, "tax_total": None, "total": sub}, {"override_reason": why} if why else {})
    audit(ctx, "jobs", job_id, f"delivery order {d['doc_no']} issued" + (f" (deposit not recorded, override: {why})" if why else ""), None, {"deal_doc_id": d["id"]})
    from . import deposits  # local: deposits imports chain
    deposits.after_receipt(ctx, request.app.state.svc, d)  # the delivery order goes to the customer on Telegram; never raises
    return reply(ctx, {"id": d["id"], "doc_no": d["doc_no"], "status": d["status"], "issued_at": d["issued_at"], "override": bool(why),
                       "lines": [{k: x[k] for k in ("no", "description", "qty", "uom")} for x in lines]}, 201)


@r.post("/deal-docs/{doc_id}/delivery-link")
def delivery_link(doc_id: UUID, request: Request, send: bool = False, ctx: Ctx = Depends(write_ctx)):
    """A fresh sign link for an unsigned delivery order (30 days); older links of it stop working. Returns the URL only: the repo has no QR
    library, so the screen draws the code from the URL. The URL is shown once, only its SHA-256 is stored."""
    require_perm(ctx, "issue_delivery")
    c = ctx.conn
    d = c.execute("select id, job_id, doc_no, status from deal_docs where id=%s and tenant_id=%s and kind='delivery_order' for update", (doc_id, ctx.tenant_id)).fetchone()
    if not d:
        raise ApiError(404, "not_found", "delivery order not found")
    if d["status"] != "issued":
        raise ApiError(409, "not_linkable", f"{d['doc_no']} is {d['status']}; a link works while it is issued and unsigned")
    base = mailer.base_url()
    if not base:
        raise ApiError(409, "public_url_missing", "The server has no public address configured (APP_PUBLIC_URL), so it cannot build the link.")
    throttle(f"deliverylink:{ctx.tenant_id}", 30, 3600, "Too many links in an hour. Wait a while.")
    tok = secrets.token_urlsafe(24)
    c.execute("update delivery_links set revoked_at = now() where deal_doc_id=%s and revoked_at is null", (doc_id,))
    exp = c.execute("""insert into delivery_links(tenant_id, deal_doc_id, token_hash, created_by, expires_at) values (%s,%s,%s,%s, now() + interval '30 days')
                       returning expires_at""", (ctx.tenant_id, doc_id, auth.token_hash(tok), ctx.user_id)).fetchone()["expires_at"]
    audit(ctx, "jobs", d["job_id"], f"delivery link created for {d['doc_no']}", None, {"deal_doc_id": doc_id})
    url = f"{base}/#/d/{tok}"
    out = {"url": url, "expires_at": exp}
    if send:  # the customer gets the link on Telegram to confirm what arrived
        from . import deposits  # local: deposits imports chain
        out["sent"] = deposits.send_text(c, request.app.state.svc, ctx.tenant_id, doc_id, f"Delivery order {d['doc_no']}: please check what arrived and confirm it here: {url}")
    return reply(ctx, out)


# ---------------------------------------------------------------- public
def _open(c, token: str):
    """(link dict, None) or (None, error response). Leaves the connection narrowed to the link's tenant."""
    link = c.execute("select delivery_link_open(%s, to_timestamp(%s)) as l", (auth.token_hash(token), clock.trusted_now(c)["now"])).fetchone()["l"]
    if not link:
        return None, _gone()
    c.execute("select set_config('laris.role', 'staff', true), set_config('laris.tenant', %s, true)", (link["tenant_id"],))
    return link, None


@r.get("/public/delivery/{token}")
def view(token: str, request: Request):
    if bad := _slow(f"pd-get:ip:{auth.client_ip(request)}", 30, 60):
        return bad
    if not TOKEN.fullmatch(token):
        return _gone()
    with db.tx("staff", "customer:link", tenant=db.ALL_TENANTS) as c:
        link, bad = _open(c, token)
        if bad:
            return bad
        d = c.execute("select doc_no, status, lines, total, issued_at, layout_snapshot from deal_docs where id=%s", (link["deal_doc_id"],)).fetchone()
        lang = c.execute("select doc_language from tenants where id=%s", (link["tenant_id"],)).fetchone()["doc_language"]
        i = quote_doc.org(c, link["tenant_id"])
    show = d["layout_snapshot"]["show_prices"]
    return JR({"notice": doc_layout.WORDS["do_notice"][lang], "language": lang, "issuer": {"name": i["name"], "logo_url": i["logo_data_url"]},
               "delivery_order": {"doc_no": d["doc_no"], "issued_on": d["issued_at"].astimezone(pipeline.MY).date(), "status": d["status"], "currency": "RM",
                                  "show_prices": show, **({"total": d["total"]} if show else {}),
                                  "lines": [{"description": x["description"], "qty": x["qty"], "uom": x["uom"],
                                             **({"unit_price": x["unit_price"], "line_total": x["amount"]} if show else {})}
                                            for x in d["lines"] if not x.get("is_header")]},
               "can_sign": d["status"] == "issued",
               "signed": {"name": link["signed_name"], "at": link["signed_at"], "problems": link["problems"]} if d["status"] == "signed" else None})


class Sign(BaseModel, extra="forbid"):
    name: str = Field(max_length=300)
    agree: bool
    problems: str | None = Field(None, max_length=300)  # "received with problems"
    mark: str | None = Field(None, max_length=MAX_BODY)  # optional drawn mark, a PNG data URL


def mark_ok(v: str) -> str:
    """A clean PNG data URL rebuilt from the bytes (not from what the client says), or ValueError. PNG only (sniffed like the logo), at most
    MARK_BYTES, and at most MARK_PX pixels read from the header BEFORE any decode, so a small file cannot unpack into a huge bitmap."""
    m = re.fullmatch(r"data:image/png;base64,([A-Za-z0-9+/]+={0,2})", v)
    try:
        data = base64.b64decode(m.group(1), validate=True) if m else b""
    except ValueError:
        data = b""
    if len(data) < 24 or next((t for sig, t in MAGIC if data.startswith(sig)), None) != "image/png" or data[12:16] != b"IHDR":
        raise ValueError("the mark must be a PNG image")
    if len(data) > MARK_BYTES:
        raise ValueError("the mark is over 100 KB")
    w, h = struct.unpack(">II", data[16:24])
    if not (0 < w <= MARK_PX[0] and 0 < h <= MARK_PX[1]):
        raise ValueError(f"the mark must be at most {MARK_PX[0]} x {MARK_PX[1]} pixels")
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data))
        im.load()
        buf = io.BytesIO()
        im.convert("RGBA").save(buf, "PNG")
    except Exception as e:
        raise ValueError("the mark could not be read as a PNG image") from e
    if len(buf.getvalue()) > MARK_BYTES:
        raise ValueError("the mark is over 100 KB")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


@r.post("/public/delivery/{token}/sign")
def sign(token: str, body: Sign, request: Request):
    ip, cl = auth.client_ip(request), request.headers.get("content-length") or "0"
    if not cl.isdigit() or int(cl) > MAX_BODY + 2048:
        return _err(413, "too_large", "request body too large")
    h = auth.token_hash(token)
    if bad := _slow(f"pd-do:ip:{ip}", 10, 3600):
        return bad
    if not TOKEN.fullmatch(token):
        return _gone()
    if bad := _slow(f"pd-do:tok:{h}", 10, 3600):
        return bad
    name = _name(body.name)
    if not 2 <= len(name) <= 80:
        return _err(422, "bad_name", "Type your full name (2 to 80 characters).")
    if body.agree is not True:
        return _err(422, "must_agree", "Tick the box to confirm you received these goods.")
    try:
        mark = mark_ok(body.mark) if body.mark else None
    except ValueError as e:
        return _err(422, "bad_mark", str(e))
    with db.tx("staff", "customer:link", tenant=db.ALL_TENANTS) as c:
        res = c.execute("select delivery_link_sign(%s, %s, %s, %s, %s, to_timestamp(%s)) as r",
                        (h, name, auth.token_hash(f"{ip}|{h}")[:16], _name(body.problems or "") or None, mark, clock.trusted_now(c)["now"])).fetchone()["r"]
    if res["result"] == "not_found":
        return _gone()
    if res["result"] == "already_signed":
        return _err(409, "already_signed", "This delivery order has already been signed.", signed={"at": res["signed_at"], "name": res["signer_name"]})
    return JR({"status": "signed", "signed_at": res["signed_at"], "problems_reported": res["problems"]})
