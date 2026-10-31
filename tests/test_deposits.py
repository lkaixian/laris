"""The order's documents go to the customer on Telegram, and the deposit is paid through the business's OWN Stripe account:
accepted on the link -> proforma + Stripe link on Telegram -> paid -> payment and receipt recorded once -> receipt on Telegram. Stripe is faked at the HTTP layer."""
import hashlib
import hmac
import json
import time
from decimal import Decimal as D
from types import SimpleNamespace

import pytest

from src.api import deposits
from support.fixtures import env, pg_url  # noqa: F401
from test_accept import accept, e as accept_env, link, sent  # noqa: F401  (accept_env: a business with a public address)
from test_chain_api import pay, quote_job
from test_roles import member, role

SK, WH = "sk_test_abc123def456", "whsec_testsecret123"


class Stripe:
    """What Stripe would answer: /balance, creating a Checkout session, and reading one back."""
    def __init__(self):
        self.sessions, self.calls = {}, []

    def request(self, method, url, auth=None, timeout=None, data=None, **kw):
        path = url.split("/v1", 1)[1]
        self.calls.append((method, path, auth[0] if auth else None, dict(data or {})))
        if auth and auth[0] != SK:
            return SimpleNamespace(status_code=401, json=lambda: {})
        if path == "/balance":
            return SimpleNamespace(status_code=200, json=lambda: {"object": "balance"})
        if method == "POST" and path == "/checkout/sessions":
            sid = f"cs_test_{len(self.sessions) + 1}"
            self.sessions[sid] = {"id": sid, "url": f"https://checkout.stripe.test/{sid}", "amount_total": data["line_items[0][price_data][unit_amount]"], "currency": "myr", "payment_status": "unpaid"}
            return SimpleNamespace(status_code=200, json=lambda: self.sessions[sid])
        if method == "GET" and path.startswith("/checkout/sessions/"):
            return SimpleNamespace(status_code=200, json=lambda: self.sessions[path.rsplit("/", 1)[1]])
        return SimpleNamespace(status_code=404, json=lambda: {})


@pytest.fixture
def stripe(monkeypatch):
    s = Stripe()
    monkeypatch.setenv("SECRET_KEY", "k" * 40)
    monkeypatch.setenv("APP_PUBLIC_URL", "https://shop.test")
    monkeypatch.setattr(deposits.httpx, "request", s.request)
    return s


def connect(e, wh=WH):
    r = e.c.put("/api/settings/stripe", json={"secret_key": SK, **({"webhook_secret": wh} if wh else {})}, headers=e.O)
    assert r.status_code == 200, r.text
    return r.json()


def order(e, tg="tg:5551234"):
    j = quote_job(e, pct=30)
    e.sql("update parties set contact=%s where id=(select party_id from documents where id=(select quote_id from jobs where id=%s))", (tg, j))
    return j


def pf(e, j):
    r = e.c.post(f"/api/jobs/{j}/proforma", headers=e.O)
    assert r.status_code == 201, r.text
    return r.json()


def signed(body: bytes, secret=WH):
    t = str(int(time.time()))
    return f"t={t},v1=" + hmac.new(secret.encode(), t.encode() + b"." + body, hashlib.sha256).hexdigest()


def paid_event(session, **over):
    return json.dumps({"type": "checkout.session.completed", "data": {"object": {**session, "payment_status": "paid", **over}}}).encode()


def hook(e, key, body, secret=WH):
    return e.c.post(f"/webhooks/stripe/{key}", content=body, headers={"Stripe-Signature": signed(body, secret), "Content-Type": "application/json"})


# ---------------------------------------------------------------- Telegram
def test_the_proforma_goes_to_the_customer_on_telegram(env):
    e = env
    j = order(e)
    d = pf(e, j)
    assert [(x[0], x[1], x[2]) for x in e.svc.docs] == [("telegram", "5551234", f"{d['doc_no']}.pdf")]
    assert "Proforma invoice" in e.svc.docs[0][3] and e.svc.docs[0][4][:4] == b"%PDF"
    assert e.sql("select status from deal_doc_sends where deal_doc_id=%s", (d["id"],))[0]["status"] == "sent"
    ch = e.c.get(f"/api/jobs/{j}/chain", headers=e.O).json()
    assert ch["sent"][d["id"]]["status"] == "sent" and ch["stripe_on"] is False and ch["deposit_link"] is None


def test_a_customer_without_telegram_is_skipped_not_failed(env):
    e = env
    j = order(e, tg="cust@shop.test")
    d = pf(e, j)                                                   # issuing still works
    assert e.svc.docs == []
    row = e.sql("select status, detail from deal_doc_sends where deal_doc_id=%s", (d["id"],))[0]
    assert row["status"] == "skipped" and "Telegram" in row["detail"]


def test_a_telegram_failure_never_undoes_the_document(env, monkeypatch):
    e = env
    j = order(e)
    monkeypatch.setattr(e.svc, "send_document", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("the customer must open the bot and press Start first")))
    d = pf(e, j)
    row = e.sql("select status, detail from deal_doc_sends where deal_doc_id=%s", (d["id"],))[0]
    assert row["status"] == "failed" and "press Start" in row["detail"]
    assert e.sql("select count(*) n from deal_docs where kind='proforma'")[0]["n"] == 1


def test_a_receipt_is_sent_when_a_payment_is_recorded_and_resend_works(env):
    e = env
    j = order(e)
    d = pf(e, j)
    n = len(e.svc.docs)
    assert pay(e, j, "100.00").status_code == 201
    assert len(e.svc.docs) == n + 1 and "Receipt" in e.svc.docs[-1][3]
    again = e.c.post(f"/api/deal-docs/{d['id']}/send", headers=e.O)
    assert again.status_code == 200 and again.json()["status"] == "sent" and len(e.svc.docs) == n + 2
    nobody = member(e, role(e, "Nobody", []), "N")
    assert e.c.post(f"/api/deal-docs/{d['id']}/send", headers=nobody).status_code == 403


# ---------------------------------------------------------------- Stripe: the business's own keys
def test_stripe_keys_are_checked_encrypted_and_never_echoed(env, stripe):
    e = env
    assert e.c.put("/api/settings/stripe", json={"secret_key": "not-a-key-at-all"}, headers=e.O).json()["error"]["code"] == "bad_key"
    assert e.c.put("/api/settings/stripe", json={"secret_key": "sk_test_wrongwrong"}, headers=e.O).json()["error"]["code"] == "stripe_rejected"   # Stripe refuses it
    assert e.sql("select count(*) n from tenant_stripe")[0]["n"] == 0                                                                           # nothing kept
    out = connect(e)
    assert out["configured"] and out["mode"] == "test" and out["webhook_secret_set"] and out["webhook_path"].startswith("/webhooks/stripe/")
    assert SK not in json.dumps(out) and SK not in e.c.get("/api/settings/stripe", headers=e.O).text
    row = e.sql("select secret_enc, webhook_secret_enc from tenant_stripe")[0]
    assert SK not in row["secret_enc"] and WH not in row["webhook_secret_enc"]                                                                  # encrypted at rest
    assert e.c.get("/api/settings/stripe", headers=e.S).status_code == 403 and e.c.put("/api/settings/stripe", json={"secret_key": SK}, headers=e.S).status_code == 403
    assert e.c.delete("/api/settings/stripe", headers=e.O).json() == {"configured": False}


def test_the_deposit_link_is_made_and_sent_with_the_proforma(env, stripe):
    e = env
    connect(e)
    j = order(e)
    d = pf(e, j)
    li = e.sql("select amount, session_id, url, status from deposit_links")[0]
    assert li["status"] == "open" and li["amount"] == D(d["extra"]["deposit_amount"]) and "checkout.stripe.test" in li["url"]
    create = next(c for c in stripe.calls if c[0] == "POST" and c[1] == "/checkout/sessions")
    assert create[3]["line_items[0][price_data][currency]"] == "myr" and create[3]["line_items[0][price_data][unit_amount]"] == int(li["amount"] * 100) and create[2] == SK
    assert li["url"] in e.svc.docs[0][3]                                                                    # the link is in the Telegram message
    ch = e.c.get(f"/api/jobs/{j}/chain", headers=e.O).json()
    assert ch["stripe_on"] and ch["deposit_link"]["status"] == "open"
    e.c.post(f"/api/jobs/{j}/deposit-link", headers=e.O)                                                    # the same open link is reused
    assert e.sql("select count(*) n from deposit_links")[0]["n"] == 1


# ---------------------------------------------------------------- Stripe: paid -> recorded once -> receipt on Telegram
def test_the_webhook_records_the_deposit_once_and_sends_the_receipt(env, stripe):
    e = env
    key = connect(e)["webhook_path"].rsplit("/", 1)[1]
    j = order(e)
    pf(e, j)
    sess = next(iter(stripe.sessions.values()))
    body = paid_event(sess)
    assert hook(e, key, body, secret="whsec_wrong").status_code == 400                                          # a bad signature records nothing
    assert e.sql("select count(*) n from payments")[0]["n"] == 0
    docs_before = len(e.svc.docs)
    assert hook(e, key, body).status_code == 200
    p = e.sql("select amount, method, purpose, reference, recorded_by from payments")[0]
    assert (p["method"], p["purpose"], p["reference"], p["recorded_by"]) == ("card", "deposit", sess["id"], None) and p["amount"] == D(sess["amount_total"]) / 100
    assert e.sql("select status from deposit_links")[0]["status"] == "paid"
    assert e.sql("select count(*) n from deal_docs where kind='receipt'")[0]["n"] == 1
    assert len(e.svc.docs) == docs_before + 1 and "Receipt" in e.svc.docs[-1][3]
    assert hook(e, key, body).status_code == 200                                                                # Stripe retries: nothing doubles
    assert e.sql("select count(*) n from payments")[0]["n"] == 1 and len(e.svc.docs) == docs_before + 1
    assert e.c.get(f"/api/jobs/{j}/chain", headers=e.O).json()["deposit_link"]["status"] == "paid"


def test_an_amount_that_does_not_match_is_not_recorded(env, stripe):
    e = env
    key = connect(e)["webhook_path"].rsplit("/", 1)[1]
    pf(e, order(e))
    sess = next(iter(stripe.sessions.values()))
    assert hook(e, key, paid_event(sess, amount_total=100)).status_code == 200
    assert hook(e, key, paid_event(sess, currency="usd")).status_code == 200
    assert hook(e, key, json.dumps({"type": "checkout.session.completed", "data": {"object": {**sess, "payment_status": "unpaid"}}}).encode()).status_code == 200
    assert e.sql("select count(*) n from payments")[0]["n"] == 0 and e.sql("select status from deposit_links")[0]["status"] == "open"


def test_check_now_asks_stripe_and_records_once(env, stripe):
    e = env
    connect(e, wh=None)                                                                                         # no webhook set up: Check now is the way
    j = order(e)
    pf(e, j)
    assert e.c.post(f"/api/jobs/{j}/deposit/check", headers=e.O).json()["link"]["status"] == "open"            # not paid yet
    sid = next(iter(stripe.sessions))
    stripe.sessions[sid]["payment_status"] = "paid"
    out = e.c.post(f"/api/jobs/{j}/deposit/check", headers=e.O)
    assert out.status_code == 200 and out.json()["link"]["status"] == "paid"
    assert e.c.post(f"/api/jobs/{j}/deposit/check", headers=e.O).json()["link"]["status"] == "paid"
    assert e.sql("select count(*) n from payments")[0]["n"] == 1 and "Receipt" in e.svc.docs[-1][3]


# ---------------------------------------------------------------- the whole way: accepted on the link
def test_accepting_on_the_link_issues_the_proforma_and_sends_the_stripe_link(accept_env, stripe):
    e = accept_env
    connect(e)
    d = sent(e)
    e.sql("update documents set deposit_pct=30 where id=%s", (d,))
    e.sql("update parties set contact='tg:5551234' where id=(select party_id from documents where id=%s)", (d,))
    tok = link(e, d)
    before = len(e.svc.docs)
    assert accept(e, tok).status_code == 200                                                                    # the customer's own tap
    assert e.sql("select count(*) n from deal_docs where kind='proforma'")[0]["n"] == 1                          # the proforma issued by itself
    assert e.sql("select count(*) n from deposit_links where status='open'")[0]["n"] == 1
    assert len(e.svc.docs) == before + 1 and "checkout.stripe.test" in e.svc.docs[-1][3] and "Proforma" in e.svc.docs[-1][3]
    assert accept(e, tok).status_code == 200                                                                    # a double tap changes nothing
    assert e.sql("select count(*) n from deal_docs where kind='proforma'")[0]["n"] == 1


def test_no_deposit_agreed_means_no_automatic_proforma(accept_env, stripe):
    e = accept_env
    connect(e)
    d = sent(e)
    e.sql("update documents set deposit_pct=null where id=%s", (d,))
    assert accept(e, link(e, d)).status_code == 200
    assert e.sql("select count(*) n from deal_docs where kind='proforma'")[0]["n"] == 0                          # the owner decides the deposit by hand, as before
