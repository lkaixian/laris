"""Buying a licence with Stripe Checkout: the signed webhook issues the key. No network (Stripe's create-session call is faked)."""
import hashlib
import hmac
import json
import time

import httpx
import pytest
from cryptography.hazmat.primitives import serialization

from src.api import license_pay as lp
from support.fixtures import env, pg_url  # noqa: F401
from test_license import KEY, MAIL, on, status, verified_owner  # noqa: F401

SECRET = "whsec_test"


@pytest.fixture
def pay(env, on, monkeypatch):
    pem = KEY.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    for k, v in {"STRIPE_SECRET_KEY": "sk_test", "STRIPE_WEBHOOK_SECRET": SECRET, "STRIPE_PRICE_STANDARD": "price_1", "LICENSE_PRIVATE_KEY": pem,
                 "APP_PUBLIC_URL": "https://laris.test"}.items():
        monkeypatch.setenv(k, v)
    sent = []
    monkeypatch.setattr(lp.httpx, "post", lambda url, **kw: sent.append(kw["data"]) or httpx.Response(200, json={"url": "https://checkout.stripe.test/s"}, request=httpx.Request("POST", url)))
    verified_owner(env)
    env.sent = sent
    return env


def hook(e, rid, paid="paid", ts=None, secret=SECRET, typ="checkout.session.completed"):
    raw = json.dumps({"type": typ, "data": {"object": {"client_reference_id": rid, "payment_status": paid}}}).encode()
    t = str(int(ts or time.time()))
    sig = hmac.new(secret.encode(), t.encode() + b"." + raw, hashlib.sha256).hexdigest()
    return e.c.post("/webhooks/stripe", content=raw, headers={"Stripe-Signature": f"t={t},v1={sig}"})


def start(e):
    r = e.c.post("/api/license/checkout", json={"plan": "standard"}, headers=e.O)
    assert r.status_code == 200 and r.json()["url"].startswith("https://checkout.stripe.test")
    rid = e.sent[-1]["client_reference_id"]
    assert e.sent[-1]["line_items[0][price]"] == "price_1" and e.sent[-1]["customer_email"] == MAIL
    return rid


def test_paid_checkout_issues_an_offer_once(pay):
    e = pay
    rid = start(e)
    assert status(e)["offer"] is None  # nothing before payment
    assert hook(e, rid, paid="unpaid").status_code == 200 and status(e)["offer"] is None
    assert hook(e, rid).status_code == 200
    offer = status(e)["offer"]
    assert offer["plan"] == "standard" and offer["seats"] == 10
    assert hook(e, rid).status_code == 200  # Stripe retry: still one licence
    assert e.sql("select count(*) n from license_requests where status='issued'")[0]["n"] == 1
    assert e.c.post("/api/license/accept-offer", headers=e.O).status_code == 200
    assert status(e)["status"] == "active"


def test_webhook_refuses_forged_stale_and_unknown(pay):
    e = pay
    rid = start(e)
    assert hook(e, rid, secret="whsec_other").status_code == 400
    assert hook(e, rid, ts=time.time() - 3600).status_code == 400
    assert e.c.post("/webhooks/stripe", content=b"{}").status_code == 400
    assert hook(e, "not-a-uuid").status_code == 200 and hook(e, "0b0f6f06-8d0b-4a39-9d0e-5d4e2a8a7c11").status_code == 200  # ignored, not retried
    assert status(e)["offer"] is None


def test_checkout_needs_setup_owner_and_verified_email(pay, monkeypatch):
    e = pay
    assert e.c.post("/api/license/checkout", json={"plan": "standard"}, headers=e.S).status_code == 403
    assert e.c.post("/api/license/checkout", json={"plan": "pro"}, headers=e.O).status_code == 409  # no STRIPE_PRICE_PRO
    e.sql("update users set email_verified_at=null where id=%s", (e.owner,))
    assert e.c.post("/api/license/checkout", json={"plan": "standard"}, headers=e.O).status_code == 422
