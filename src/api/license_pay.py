"""Buy a licence with Stripe Checkout. The owner picks a plan, gets a Stripe pay page; when Stripe's signed webhook says it was paid,
the server signs the licence, stores it as the offer on the request and emails it (same path as the web issuer page: docs/licensing.md).
Needs env STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_<PLAN> (a Stripe Price id per plan) and LICENSE_PRIVATE_KEY (PEM).
The price lives in Stripe, never here: the plan and seats come from our own request row, not from the webhook body."""
import hashlib
import hmac
import json
import logging
import os
import time
from uuid import UUID, uuid4

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from .. import db, license as lic, mailer
from ..errors import ApiError
from .deps import Ctx, audit, reply, require_owner, throttle, write_ctx

log = logging.getLogger("laris")
r = APIRouter()
DAYS = 365
TOLERANCE = 300  # seconds a webhook timestamp may be off (Stripe's own default)
MAX_BODY = 1_000_000


def price_id(plan: str) -> str:
    return os.environ.get(f"STRIPE_PRICE_{plan.upper()}", "").strip()


def enabled() -> bool:
    return bool(os.environ.get("STRIPE_SECRET_KEY") and os.environ.get("STRIPE_WEBHOOK_SECRET") and os.environ.get("LICENSE_PRIVATE_KEY"))


def private_key() -> Ed25519PrivateKey:
    pem = os.environ.get("LICENSE_PRIVATE_KEY", "").replace("\\n", "\n").encode()
    key = serialization.load_pem_private_key(pem, password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("LICENSE_PRIVATE_KEY is not an Ed25519 key")
    return key


class Checkout(BaseModel, extra="forbid"):
    plan: str = Field(pattern="^(" + "|".join(lic.PLANS) + ")$")


@r.post("/api/license/checkout")  # under /api/license: allowed while unlicensed (lic.ALLOWED)
def checkout(body: Checkout, ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    price = price_id(body.plan)
    if not enabled() or not price or not mailer.base_url():
        raise ApiError(409, "payment_off", "Online payment is not set up. Use Request a licence instead.")
    u = ctx.conn.execute("select lower(email) e from users where id=%s and email_verified_at is not null", (ctx.user_id,)).fetchone()
    if not u or not u["e"]:
        raise ApiError(422, "email_needed", "Your account needs a verified email: the licence is bound to it.")
    throttle(f"licpay:{ctx.tenant_id}", 5, 3600, "Too many checkout attempts. Wait a while.")
    seats = lic.PLANS[body.plan]["seats"]
    rid = ctx.conn.execute("insert into license_requests(tenant_id, requested_by, email, plan, seats, note) values (%s,%s,%s,%s,%s,'paid online') returning id",
                           (ctx.tenant_id, ctx.user_id, u["e"], body.plan, seats)).fetchone()["id"]
    b = mailer.base_url()
    try:
        resp = httpx.post("https://api.stripe.com/v1/checkout/sessions", auth=(os.environ["STRIPE_SECRET_KEY"], ""), timeout=15, data={
            "mode": "payment", "line_items[0][price]": price, "line_items[0][quantity]": 1, "client_reference_id": str(rid),
            "customer_email": u["e"], "success_url": f"{b}/#/licence?paid=1", "cancel_url": f"{b}/#/purchase"})
        resp.raise_for_status()
        url = resp.json()["url"]
    except (httpx.HTTPError, KeyError, ValueError) as e:
        log.warning("stripe checkout failed: %s", type(e).__name__)  # never log the body: it can echo the email
        raise ApiError(502, "payment_unavailable", "The payment page could not be opened. Try again in a minute.")
    audit(ctx, "license_requests", rid, f"licence checkout started: {body.plan}")
    return reply(ctx, {"url": url})


def verify(raw: bytes, header: str, secret: str, now: float | None = None) -> bool:
    """Stripe-Signature: t=<unix>,v1=<hex hmac-sha256 of "<t>.<raw body>">[,v1=...]. Constant-time compare, replay window."""
    parts = [p.split("=", 1) for p in header.split(",") if "=" in p]
    t = next((v for k, v in parts if k == "t"), "")
    if not t.isdigit() or abs((time.time() if now is None else now) - int(t)) > TOLERANCE:
        return False
    want = hmac.new(secret.encode(), t.encode() + b"." + raw, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(want, v) for k, v in parts if k == "v1")


def issue_paid(rid: str) -> bool:
    """Sign and store the licence for a paid request; mail it. Safe to run twice (Stripe retries): only a 'new' request is issued."""
    with db.tx(tenant=db.ALL_TENANTS) as c:
        q = c.execute("""select q.id, q.email, q.plan, q.seats, coalesce(t.display_name, t.name) org from license_requests q
                         join tenants t on t.id = q.tenant_id where q.id = %s and q.status = 'new' for update of q""", (rid,)).fetchone()
        if not q:
            return False
        lid = str(uuid4())
        token = lic.sign(private_key(), q["email"], q["plan"], q["seats"], DAYS, q["org"][:200], lid=lid)
        c.execute("update license_requests set status='issued', issued_token=%s, issued_at=now(), issued_license_id=%s where id=%s", (token, lid, rid))
        c.execute("""insert into audit_log(tenant_id, actor, entity, entity_id, event, after)
                     select tenant_id, 'system:stripe', 'license_requests', id, 'license issued after payment', %s::jsonb from license_requests where id=%s""",
                  (json.dumps({"license_id": lid, "plan": q["plan"], "seats": q["seats"]}), rid))  # never the token
    mailer.send(q["email"], *mailer.license_mail(q["plan"], q["seats"], token), category="license")  # best effort; the offer is on the Licence page anyway
    return True


@r.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    raw = await request.body()
    if not secret or len(raw) > MAX_BODY or not verify(raw, request.headers.get("stripe-signature", ""), secret):
        return PlainTextResponse("bad signature", status_code=400)
    try:
        ev = json.loads(raw)
        obj = ev["data"]["object"]
        paid = ev["type"] in ("checkout.session.completed", "checkout.session.async_payment_succeeded") and obj.get("payment_status") == "paid"
        rid = str(UUID(obj.get("client_reference_id") or ""))
    except (ValueError, KeyError, TypeError):
        return PlainTextResponse("ok")  # some other event, or not ours: Stripe must not keep retrying it
    if paid and not await run_in_threadpool(issue_paid, rid):
        log.info("stripe: request already issued or unknown")
    return PlainTextResponse("ok")
