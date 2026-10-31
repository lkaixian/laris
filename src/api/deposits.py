"""Deposits paid online, and the order's documents sent to the customer on Telegram.

Each business uses ITS OWN Stripe account: it pastes its keys under Settings (encrypted like its Telegram bot token) and the deposit goes straight to
its Stripe account; LARIS never holds the money. When the customer accepts a quote on its link and the quote has a deposit, LARIS issues the proforma,
makes a Stripe Checkout link for the deposit and sends both on Telegram. A payment is recorded exactly once: from Stripe's signed webhook, or from
"Check now" (which asks Stripe directly), through the same code as a payment keyed in by hand, so the receipt is issued and sent too.
Everything that talks to the customer is best effort: a failed message never undoes an issued document or a recorded payment, it is written down."""
import json
import logging
import re
import secrets
from decimal import Decimal
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from .. import db, mailer, perms, pipeline, quote_pdf, tgbots
from ..channels import telegram
from ..errors import ApiError
from .chain import _job, _net, deal_doc_model, make_payment, make_proforma, money
from .deps import Ctx, audit, read_ctx, reply, require_owner, require_perm, svc, throttle, write_ctx
from .license_pay import MAX_BODY, verify

log = logging.getLogger("laris")
r = APIRouter()
STRIPE = "https://api.stripe.com/v1"
SENDABLE = ("proforma", "receipt", "delivery_order", "invoice")
LABEL = {"proforma": "Proforma invoice", "receipt": "Receipt", "delivery_order": "Delivery order", "invoice": "Invoice"}
LINK_HOURS = 20  # a Stripe Checkout link lives 24 hours; reuse one for 20, then make a fresh one


def system_ctx(conn, tenant_id, name="LARIS") -> Ctx:
    """The acting context for things LARIS does by itself (an accepted quote, a confirmed payment): owner-class, no user."""
    return Ctx(conn=conn, role="owner", user_id=None, tenant_id=tenant_id, name=name, perms=perms.ALL)


# ---------------------------------------------------------------- Telegram
def _target(conn, job_id):
    """Where the order's customer can be reached on Telegram: {to, pn, name, quote_id, tenant_id} or None."""
    row = conn.execute("""select j.tenant_id, j.quote_id, p.name, p.contact, e.channel, t.wa_phone_number_id pn
                          from jobs j left join documents q on q.id = j.quote_id left join parties p on p.id = coalesce(q.party_id, j.party_id)
                          left join enquiries e on e.id = q.enquiry_id join tenants t on t.id = j.tenant_id where j.id = %s""", (job_id,)).fetchone()
    if not row or not row["contact"]:
        return None
    to = row["contact"].strip() if row["channel"] == "telegram" else telegram.chat_of(row["contact"])  # a Telegram enquiry keeps the bare chat id; others need tg:<id>
    return {**row, "to": to} if to else None


def _note(conn, tenant_id, doc_id, status: str, detail: str | None = None):
    conn.execute("insert into deal_doc_sends(tenant_id, deal_doc_id, channel, status, detail) values (%s,%s,'telegram',%s,%s)", (tenant_id, doc_id, status, (detail or "")[:300] or None))
    return {"status": status, "detail": detail}


def send_doc(conn, s, tenant_id, doc_id, extra: str = "") -> dict:
    """The issued document as a PDF to the customer's Telegram chat. Never raises: the outcome is written to deal_doc_sends and returned."""
    d = conn.execute("select * from deal_docs where id=%s and tenant_id=%s", (doc_id, tenant_id)).fetchone()
    if not d or d["kind"] not in SENDABLE or d["status"] == "void":
        return {"status": "skipped", "detail": "this document is not sent"}
    tgt = _target(conn, d["job_id"])
    if not tgt:
        return _note(conn, tenant_id, doc_id, "skipped", "no Telegram chat on file for this customer")
    try:
        ctx = system_ctx(conn, tenant_id)
        m = deal_doc_model(ctx, d)
        lang = conn.execute("select doc_language from tenants where id=%s", (tenant_id,)).fetchone()["doc_language"]
        pdf = quote_pdf.render(d["kind"], m, d["layout_snapshot"], lang)
        no = d["doc_no"]
        head = {"proforma": f"Proforma invoice {no}: deposit RM{Decimal(d['extra']['deposit_amount']):,.2f}" if d["kind"] == "proforma" else "",
                "receipt": f"Receipt {no}: RM{Decimal(d['total']):,.2f} received. Thank you.",
                "delivery_order": f"Delivery order {no}", "invoice": f"Invoice {no}: RM{Decimal(d['total']):,.2f}"}[d["kind"]]
        wid = s.send_document("telegram", tgt["to"], pdf, re.sub(r"[^A-Za-z0-9_-]", "_", no) + ".pdf", head + (f"\n{extra}" if extra else ""), tgbots.via(conn, tenant_id, "telegram", tgt["pn"]))
    except RuntimeError as e:  # the channel's own plain reasons ("the customer must open the bot and press Start first"); they carry no token
        return _note(conn, tenant_id, doc_id, "failed", str(e))
    except Exception as e:
        log.warning("deal doc %s: Telegram send failed (%s)", doc_id, type(e).__name__)
        return _note(conn, tenant_id, doc_id, "failed", "Telegram did not accept it; try Send again")
    if tgt["quote_id"]:
        conn.execute("insert into messages(enquiry_id, document_id, direction, channel, body, external_id) values (null,%s,'out','telegram',%s,%s) on conflict do nothing",
                     (tgt["quote_id"], f"{LABEL[d['kind']]} {d['doc_no']} sent as a PDF", wid))
    return _note(conn, tenant_id, doc_id, "sent")


# ---------------------------------------------------------------- Stripe (the business's own account)
def stripe_of(conn, tenant_id) -> dict | None:
    row = conn.execute("select secret_enc, webhook_secret_enc, webhook_key from tenant_stripe where tenant_id=%s", (tenant_id,)).fetchone()
    if not row:
        return None
    return {"secret": tgbots.decrypt(row["secret_enc"]), "whsec": tgbots.decrypt(row["webhook_secret_enc"]) if row["webhook_secret_enc"] else None, "key": row["webhook_key"]}


def _stripe(conf, method: str, path: str, **kw):
    try:
        resp = httpx.request(method, STRIPE + path, auth=(conf["secret"], ""), timeout=15, **kw)
    except httpx.HTTPError as e:
        log.warning("stripe %s failed: %s", path, type(e).__name__)  # never the body: it can echo customer details
        raise ApiError(502, "stripe_unreachable", "Stripe could not be reached. Try again in a minute.") from None
    if resp.status_code in (401, 403):
        raise ApiError(422, "stripe_rejected", "Stripe refused the key. Check it in Settings.")
    if resp.status_code >= 400:
        log.warning("stripe %s: HTTP %s", path, resp.status_code)
        raise ApiError(502, "stripe_error", "Stripe could not do that. Try again in a minute.")
    return resp.json()


def deposit_due(conn, job_id, pf) -> Decimal:
    return money(Decimal(pf["extra"]["deposit_amount"]) - _net(conn, job_id)[1])


def ensure_link(ctx: Ctx, job_id, pf) -> dict | None:
    """The order's open deposit link (reused for 20 hours), a fresh one when none is open, or None: Stripe not set up, or nothing left to pay."""
    c = ctx.conn
    conf = stripe_of(c, ctx.tenant_id)
    due = deposit_due(c, job_id, pf)
    if not conf or due <= 0:
        return None
    live = c.execute("""select * from deposit_links where tenant_id=%s and job_id=%s and deal_doc_id=%s and status='open' and amount=%s
                        and created_at > now() - make_interval(hours => %s) order by created_at desc limit 1""", (ctx.tenant_id, job_id, pf["id"], due, LINK_HOURS)).fetchone()
    if live:
        return live
    c.execute("update deposit_links set status='expired' where tenant_id=%s and job_id=%s and status='open'", (ctx.tenant_id, job_id))
    base = mailer.base_url() or ""
    sess = _stripe(conf, "POST", "/checkout/sessions", data={
        "mode": "payment", "line_items[0][quantity]": 1, "line_items[0][price_data][currency]": "myr",
        "line_items[0][price_data][unit_amount]": int(due * 100), "line_items[0][price_data][product_data][name]": f"Deposit for {pf['doc_no']}",
        "client_reference_id": str(job_id), "metadata[job_id]": str(job_id), "metadata[proforma]": pf["doc_no"],
        "success_url": f"{base}/#/paid", "cancel_url": f"{base}/#/paid?cancelled=1"})
    return c.execute("""insert into deposit_links(tenant_id, job_id, deal_doc_id, session_id, url, amount) values (%s,%s,%s,%s,%s,%s) returning *""",
                     (ctx.tenant_id, job_id, pf["id"], sess["id"], sess["url"], due)).fetchone()


def after_proforma(ctx: Ctx, s, pf: dict) -> None:
    """A proforma was issued: make the deposit link (when Stripe is connected) and send the proforma on Telegram. Never raises, never undoes the proforma."""
    try:
        with ctx.conn.transaction():
            link = None
            try:
                link = ensure_link(ctx, pf["job_id"], pf)
            except ApiError as e:
                log.warning("deposit link not made: %s", e.code)
            send_doc(ctx.conn, s, ctx.tenant_id, pf["id"], f"Pay the deposit securely online: {link['url']}" if link else "")
    except Exception as e:
        log.warning("after proforma failed: %s", type(e).__name__)


def after_receipt(ctx: Ctx, s, rc: dict) -> None:
    try:
        with ctx.conn.transaction():
            send_doc(ctx.conn, s, ctx.tenant_id, rc["id"])
    except Exception as e:
        log.warning("after receipt failed: %s", type(e).__name__)


def on_accepted(s, quote_id) -> None:
    """The customer accepted on the link and an order now exists: when the quote has a deposit, issue the proforma, make the deposit link and send both."""
    try:
        with db.tx("owner", "system:accept-link", tenant=db.ALL_TENANTS) as c:
            q = c.execute("select tenant_id, deposit_pct from documents where id=%s", (quote_id,)).fetchone()
            j = c.execute("select id from jobs where quote_id=%s", (quote_id,)).fetchone()
            if not q or not j or not q["deposit_pct"] or q["deposit_pct"] <= 0:
                return
            if c.execute("select 1 from deal_docs where job_id=%s and kind='proforma' and status <> 'void'", (j["id"],)).fetchone():
                return
            ctx = system_ctx(c, q["tenant_id"])
            pf = make_proforma(ctx, j["id"], None)
            after_proforma(ctx, s, pf)
    except Exception as e:
        log.warning("after accept failed: %s", type(e).__name__)


def settle_in(c, session: dict) -> tuple[str, object, object]:
    """Record the deposit for a PAID Checkout session on connection `c`, once. -> (outcome, tenant id, receipt id); outcome is 'recorded', 'already',
    'unknown' or 'mismatch'. Safe to call twice (Stripe retries): the payment's idempotency key is the session id."""
    sid = session.get("id") or ""
    link = c.execute("select * from deposit_links where session_id=%s for update", (sid,)).fetchone()
    if not link:
        return "unknown", None, None
    if link["status"] == "paid":
        return "already", link["tenant_id"], None
    if session.get("payment_status") != "paid":
        return "unknown", link["tenant_id"], None
    if session.get("amount_total") != int(link["amount"] * 100) or str(session.get("currency", "")).lower() != link["currency"].lower():
        log.warning("stripe session amount does not match its deposit link; not recorded")
        return "mismatch", link["tenant_id"], None
    ctx = system_ctx(c, link["tenant_id"], "Stripe")
    j = _job(ctx, link["job_id"], lock=True)
    p, rc = make_payment(ctx, j, link["amount"], "card", sid[:100], pipeline.today_my(), "deposit", f"stripe:{sid}")
    c.execute("update deposit_links set status='paid', paid_at=now(), payment_id=%s where id=%s", (p["id"], link["id"]))
    return "recorded", link["tenant_id"], rc["id"]


def settle(s, session: dict, source: str) -> str:
    """settle_in on its own transaction (the webhook), then the receipt goes to the customer."""
    with db.tx("owner", f"system:{source}", tenant=db.ALL_TENANTS) as c:
        outcome, tenant_id, rc_id = settle_in(c, session)
    if rc_id:
        with db.tx("owner", f"system:{source}", tenant=db.ALL_TENANTS) as c:
            send_doc(c, s, tenant_id, rc_id)
    return outcome


# ---------------------------------------------------------------- routes: Stripe settings (owner)
class StripeIn(BaseModel, extra="forbid"):
    secret_key: str = Field(min_length=8, max_length=300)
    webhook_secret: str | None = Field(None, max_length=300)


def _conf_out(conf) -> dict:
    return {"configured": bool(conf), **({"mode": "test" if "_test_" in conf["secret"] else "live", "webhook_path": f"/webhooks/stripe/{conf['key']}", "webhook_secret_set": bool(conf["whsec"])} if conf else {})}


@r.get("/api/settings/stripe")
def get_stripe(ctx: Ctx = Depends(read_ctx)):
    require_owner(ctx)
    return reply(ctx, _conf_out(stripe_of(ctx.conn, ctx.tenant_id)))


@r.put("/api/settings/stripe")
def put_stripe(body: StripeIn, ctx: Ctx = Depends(write_ctx)):
    """Save the business's own Stripe keys (encrypted). The secret key is tested with Stripe before it is kept. Never echoes a key back."""
    require_owner(ctx)
    key, wh = body.secret_key.strip(), (body.webhook_secret or "").strip() or None
    if not re.fullmatch(r"(sk|rk)_(test|live)_[A-Za-z0-9]+", key):
        raise ApiError(422, "bad_key", "That is not a Stripe secret key. It starts with sk_test_ or sk_live_ (or rk_ for a restricted key).")
    if wh and not re.fullmatch(r"whsec_[A-Za-z0-9]+", wh):
        raise ApiError(422, "bad_webhook_secret", "The webhook signing secret starts with whsec_.")
    throttle(f"stripe-keys:{ctx.tenant_id}", 10, 3600, "Too many attempts. Wait a while.")
    _stripe({"secret": key}, "GET", "/balance")  # a wrong key is refused here, before anything is stored
    old = ctx.conn.execute("select webhook_key from tenant_stripe where tenant_id=%s", (ctx.tenant_id,)).fetchone()
    ctx.conn.execute("""insert into tenant_stripe(tenant_id, secret_enc, webhook_secret_enc, webhook_key) values (%s,%s,%s,%s)
                        on conflict (tenant_id) do update set secret_enc=excluded.secret_enc, webhook_secret_enc=excluded.webhook_secret_enc, updated_at=now()""",
                     (ctx.tenant_id, tgbots.encrypt(key), tgbots.encrypt(wh) if wh else None, old["webhook_key"] if old else secrets.token_urlsafe(18)))
    audit(ctx, "tenant_stripe", ctx.tenant_id, f"Stripe connected ({'test' if '_test_' in key else 'live'} mode)")  # the key is never logged
    return reply(ctx, _conf_out(stripe_of(ctx.conn, ctx.tenant_id)))


@r.delete("/api/settings/stripe")
def delete_stripe(ctx: Ctx = Depends(write_ctx)):
    require_owner(ctx)
    ctx.conn.execute("delete from tenant_stripe where tenant_id=%s", (ctx.tenant_id,))
    audit(ctx, "tenant_stripe", ctx.tenant_id, "Stripe disconnected")
    return reply(ctx, {"configured": False})


# ---------------------------------------------------------------- routes: the order
def _live_pf(ctx: Ctx, job_id):
    pf = ctx.conn.execute("select * from deal_docs where job_id=%s and tenant_id=%s and kind='proforma' and status <> 'void'", (job_id, ctx.tenant_id)).fetchone()
    if not pf:
        raise ApiError(409, "no_proforma", "this order has no proforma yet")
    return pf


def _link_out(link) -> dict | None:
    return {k: link[k] for k in ("status", "amount", "url", "created_at", "paid_at")} if link else None


@r.post("/api/jobs/{job_id}/deposit-link")
def deposit_link(job_id: UUID, request: Request, ctx: Ctx = Depends(write_ctx)):
    """Make (or reuse) the Stripe deposit link for the order and send the proforma with it on Telegram again."""
    require_perm(ctx, "record_payments")
    _job(ctx, job_id)
    pf = _live_pf(ctx, job_id)
    if not stripe_of(ctx.conn, ctx.tenant_id):
        raise ApiError(409, "stripe_off", "Stripe is not connected. The owner can connect it under Settings.")
    throttle(f"depositlink:{ctx.tenant_id}", 30, 3600, "Too many links in an hour. Wait a while.")
    link = ensure_link(ctx, job_id, pf)
    if not link:
        raise ApiError(409, "nothing_due", "the deposit is already paid")
    sent = send_doc(ctx.conn, svc(request), ctx.tenant_id, pf["id"], f"Pay the deposit securely online: {link['url']}")
    audit(ctx, "jobs", job_id, f"deposit link for {pf['doc_no']} made and sent ({sent['status']})")
    return reply(ctx, {"link": _link_out(link), "sent": sent})


@r.post("/api/jobs/{job_id}/deposit/check")
def deposit_check(job_id: UUID, request: Request, ctx: Ctx = Depends(write_ctx)):
    """Ask Stripe whether the deposit link was paid and record it if so. For a business without the webhook set up, or a webhook that did not arrive."""
    require_perm(ctx, "record_payments")
    _job(ctx, job_id)
    conf = stripe_of(ctx.conn, ctx.tenant_id)
    link = ctx.conn.execute("select * from deposit_links where tenant_id=%s and job_id=%s order by created_at desc limit 1", (ctx.tenant_id, job_id)).fetchone()
    if not conf or not link:
        raise ApiError(409, "no_deposit_link", "no deposit link has been made for this order")
    throttle(f"depositcheck:{ctx.tenant_id}", 60, 3600, "Too many checks in an hour. Wait a while.")
    if link["status"] == "open":
        sess = _stripe(conf, "GET", f"/checkout/sessions/{link['session_id']}")
        outcome, tenant_id, rc_id = settle_in(ctx.conn, sess)  # on this request's own connection
        if rc_id:
            send_doc(ctx.conn, svc(request), tenant_id, rc_id)
    again = ctx.conn.execute("select * from deposit_links where id=%s", (link["id"],)).fetchone()
    return reply(ctx, {"link": _link_out(again)})


@r.post("/api/deal-docs/{doc_id}/send")
def resend(doc_id: UUID, request: Request, ctx: Ctx = Depends(write_ctx)):
    """Send an issued document to the customer on Telegram again."""
    if not ctx.perms & {"record_payments", "issue_delivery"}:
        require_perm(ctx, "record_payments")  # a role with neither is refused before the document is even looked up
    d = ctx.conn.execute("select kind, job_id from deal_docs where id=%s and tenant_id=%s", (doc_id, ctx.tenant_id)).fetchone()
    if not d:
        raise ApiError(404, "not_found", "document not found")
    require_perm(ctx, "issue_delivery" if d["kind"] == "delivery_order" else "record_payments")
    throttle(f"docsend:{ctx.tenant_id}", 60, 3600, "Too many sends in an hour. Wait a while.")
    link = None
    if d["kind"] == "proforma":
        try:
            link = ensure_link(ctx, d["job_id"], _live_pf(ctx, d["job_id"]))
        except ApiError:
            link = None
    return reply(ctx, send_doc(ctx.conn, svc(request), ctx.tenant_id, doc_id, f"Pay the deposit securely online: {link['url']}" if link else ""))


def order_extras(c, tenant_id, job_id, doc_ids) -> dict:
    """What the order screen adds: the latest deposit link and the latest Telegram send of each document."""
    link = c.execute("select * from deposit_links where tenant_id=%s and job_id=%s order by created_at desc limit 1", (tenant_id, job_id)).fetchone()
    sends = {str(x["deal_doc_id"]): {"status": x["status"], "detail": x["detail"], "at": x["at"]} for x in c.execute(
        "select distinct on (deal_doc_id) deal_doc_id, status, detail, at from deal_doc_sends where tenant_id=%s and deal_doc_id = any(%s) order by deal_doc_id, at desc", (tenant_id, doc_ids)).fetchall()}
    return {"deposit_link": _link_out(link), "stripe_on": bool(c.execute("select 1 from tenant_stripe where tenant_id=%s", (tenant_id,)).fetchone()), "sent": sends}


# ---------------------------------------------------------------- Stripe's webhook (one address per business)
@r.post("/webhooks/stripe/{key}")
async def stripe_deposit_webhook(key: str, request: Request):
    raw = await request.body()
    if len(raw) > MAX_BODY or not re.fullmatch(r"[A-Za-z0-9_-]{16,40}", key):
        return PlainTextResponse("bad request", status_code=400)

    def secret():
        with db.tx(tenant=db.ALL_TENANTS) as c:
            row = c.execute("select webhook_secret_enc from tenant_stripe where webhook_key=%s", (key,)).fetchone()
            return tgbots.decrypt(row["webhook_secret_enc"]) if row and row["webhook_secret_enc"] else None
    whsec = await run_in_threadpool(secret)
    if not whsec or not verify(raw, request.headers.get("stripe-signature", ""), whsec):
        return PlainTextResponse("bad signature", status_code=400)
    try:
        ev = json.loads(raw)
        obj = ev["data"]["object"]
        typ = ev["type"]
    except (ValueError, KeyError, TypeError):
        return PlainTextResponse("ok")
    if typ in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
        await run_in_threadpool(settle, svc(request), obj, "stripe")
    elif typ == "checkout.session.expired":
        def expire():
            with db.tx("owner", "system:stripe", tenant=db.ALL_TENANTS) as c:
                c.execute("update deposit_links set status='expired' where session_id=%s and status='open'", (obj.get("id"),))
        await run_in_threadpool(expire)
    return PlainTextResponse("ok")
