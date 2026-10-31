"""Pay-online licence: races, clocks, network failures and odd input. No network: Stripe's create-session call and the mailer are faked."""
import hashlib
import hmac
import json
import threading
import time

import httpx
import pytest

from src import license as lic
from src.api import license_pay as lp
from support.fixtures import env, pg_url  # noqa: F401
from test_license import MAIL, on, status, verified_owner  # noqa: F401
from test_license_pay import SECRET, hook, pay, start  # noqa: F401

DAY = 86400


def signed(raw: bytes, ts=None, secret=SECRET, header=None):
    t = str(int(time.time() if ts is None else ts))
    sig = hmac.new(secret.encode(), t.encode() + b"." + raw, hashlib.sha256).hexdigest()
    return {"Stripe-Signature": header if header is not None else f"t={t},v1={sig}"}


def event(rid, paid="paid", typ="checkout.session.completed"):
    return json.dumps({"type": typ, "data": {"object": {"client_reference_id": rid, "payment_status": paid}}}).encode()


def post_raw(e, raw: bytes):
    return e.c.post("/webhooks/stripe", content=raw, headers=signed(raw))


def issued(e):
    return e.sql("select count(*) n from license_requests where status='issued'")[0]["n"]


def token_of(e, rid):
    return e.sql("select issued_token from license_requests where id=%s", (rid,))[0]["issued_token"]


# ---------------------------------------------------------------- races
def test_parallel_webhook_deliveries_issue_exactly_one_licence(pay):
    e = pay
    rid = start(e)
    n, barrier, out = 8, threading.Barrier(8), []

    def go():
        barrier.wait()
        out.append(lp.issue_paid(rid))

    ts = [threading.Thread(target=go) for _ in range(n)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(out) == [False] * (n - 1) + [True]  # Stripe retried at the same moment: one winner
    assert issued(e) == 1
    assert e.sql("select count(*) n from audit_log where event='license issued after payment'")[0]["n"] == 1
    assert status(e)["offer"]["plan"] == "standard"


def test_two_separate_payments_issue_two_licences(pay):
    e = pay
    a, b = start(e), start(e)  # double-clicked Pay online: two pay pages, the owner paid both
    assert a != b
    assert hook(e, a).status_code == 200 and hook(e, b).status_code == 200
    assert issued(e) == 2
    lids = {r["issued_license_id"] for r in e.sql("select issued_license_id from license_requests where status='issued'")}
    assert len(lids) == 2  # every licence id is new, so the unique-per-tenant index never collides


def test_webhook_after_the_operator_already_issued_it_changes_nothing(pay):
    e = pay
    rid = start(e)
    e.sql("update license_requests set status='issued', issued_token='LARIS1.x.y' where id=%s", (rid,))
    assert hook(e, rid).status_code == 200
    assert token_of(e, rid) == "LARIS1.x.y"


def test_payment_for_a_rejected_request_issues_nothing(pay):
    e = pay
    rid = start(e)
    e.sql("update license_requests set status='rejected' where id=%s", (rid,))
    assert hook(e, rid).status_code == 200 and issued(e) == 0


def test_activation_races_the_webhook_without_a_server_error(pay):
    e = pay
    rid = start(e)
    barrier, res = threading.Barrier(2), {}

    def pay_it():
        barrier.wait()
        res["pay"] = hook(e, rid).status_code

    def poll():
        barrier.wait()
        res["accept"] = [e.c.post("/api/license/accept-offer", headers=e.O).status_code for _ in range(5)]

    ts = [threading.Thread(target=pay_it), threading.Thread(target=poll)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert res["pay"] == 200 and set(res["accept"]) <= {200, 404}  # 404 = nothing to accept yet, never a 5xx
    if 200 not in res["accept"]:
        assert e.c.post("/api/license/accept-offer", headers=e.O).status_code == 200
    assert issued(e) == 1 and status(e)["status"] == "active"


# ---------------------------------------------------------------- time
@pytest.mark.parametrize("skew,ok", [(0, True), (299, True), (-299, True), (301, False), (-301, False), (86400, False), (-86400 * 365, False)])
def test_signature_timestamp_window(skew, ok):
    raw, now = b"{}", 1_800_000_000
    t = str(now + skew)
    sig = hmac.new(b"s", t.encode() + b"." + raw, hashlib.sha256).hexdigest()
    assert lp.verify(raw, f"t={t},v1={sig}", "s", now=now) is ok


@pytest.mark.parametrize("t", ["", "abc", "-5", "1.5", "²", "٣٣٣", "1e9", " 1800000000", "99999999999999999999999999"])
def test_garbage_timestamps_are_refused_not_crashed(t):
    assert lp.verify(b"{}", f"t={t},v1=00", "s", now=1_800_000_000) is False


def test_licence_runs_a_full_year_from_the_day_it_is_issued_not_from_checkout(pay, monkeypatch):
    e = pay
    rid = start(e)
    real = time.time
    monkeypatch.setattr(lic.time, "time", lambda: real() + 3 * DAY)  # the webhook arrives 3 days after checkout (async bank payment)
    assert hook(e, rid, ts=real() + 3 * DAY, typ="checkout.session.async_payment_succeeded").status_code == 200
    p, why = lic.inspect(token_of(e, rid))
    assert why is None and p["expires_at"] - p["issued_at"] == 365 * DAY and abs(p["issued_at"] - (real() + 3 * DAY)) < 5


def test_an_offer_that_expired_before_it_was_accepted_is_not_offered(pay, monkeypatch):
    import src.api.license_routes as lr
    e = pay
    rid = start(e)
    assert hook(e, rid).status_code == 200 and status(e)["offer"]
    real = time.time
    monkeypatch.setattr(lr.time, "time", lambda: real() + 400 * DAY)
    assert status(e)["offer"] is None
    assert e.c.post("/api/license/accept-offer", headers=e.O).status_code == 404


# ---------------------------------------------------------------- network
def _raise(exc):
    def f(url, **kw):
        raise exc
    return f


@pytest.mark.parametrize("exc", [httpx.ConnectTimeout("t"), httpx.ReadTimeout("t"), httpx.ConnectError("c"), httpx.RemoteProtocolError("p")])
def test_stripe_unreachable_gives_502_and_leaves_no_orphan_request(pay, monkeypatch, exc):
    e = pay
    monkeypatch.setattr(lp.httpx, "post", _raise(exc))
    r = e.c.post("/api/license/checkout", json={"plan": "standard"}, headers=e.O)
    assert r.status_code == 502 and r.json()["error"]["code"] == "payment_unavailable"
    assert e.sql("select count(*) n from license_requests")[0]["n"] == 0  # the half-made request rolled back with the failed call


@pytest.mark.parametrize("resp", [httpx.Response(500, text="oops"), httpx.Response(401, json={"error": {"message": "bad key"}}),
                                  httpx.Response(200, json={}), httpx.Response(200, text="<html>not json</html>"), httpx.Response(200, json=["x"])])
def test_stripe_bad_answers_give_502(pay, monkeypatch, resp):
    e = pay
    monkeypatch.setattr(lp.httpx, "post", lambda url, **kw: (setattr(resp, "_request", httpx.Request("POST", url)), resp)[1])
    r = e.c.post("/api/license/checkout", json={"plan": "standard"}, headers=e.O)
    assert r.status_code == 502 and "bad key" not in r.text and "oops" not in r.text  # nothing Stripe said is echoed to the browser
    assert e.sql("select count(*) n from license_requests")[0]["n"] == 0


def test_mail_failure_does_not_lose_a_paid_licence(pay, monkeypatch):
    e = pay
    rid = start(e)
    monkeypatch.setattr(lp.mailer, "send", lambda *a, **k: False)
    assert hook(e, rid).status_code == 200
    assert status(e)["offer"]  # the owner still gets it from the Licence page


def test_mail_crash_still_answers_200_so_stripe_stops_retrying(pay, monkeypatch):
    e = pay
    rid = start(e)

    def boom(*a, **k):
        raise RuntimeError("smtp down")
    monkeypatch.setattr(lp.mailer, "send", boom)
    assert hook(e, rid).status_code == 200 and issued(e) == 1


def test_signing_failure_is_retryable_and_nothing_is_half_issued(pay, monkeypatch):
    e = pay
    rid = start(e)
    monkeypatch.setenv("LICENSE_PRIVATE_KEY", "not a pem")
    c = e.c
    r = c.post("/webhooks/stripe", content=event(rid), headers=signed(event(rid)))
    assert r.status_code >= 500  # Stripe will retry once the operator fixes the Secret
    assert issued(e) == 0 and e.sql("select status from license_requests where id=%s", (rid,))[0]["status"] == "new"


def test_a_wrong_key_type_is_refused(monkeypatch):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    pem = rsa.generate_private_key(65537, 2048).private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    monkeypatch.setenv("LICENSE_PRIVATE_KEY", pem)
    with pytest.raises(ValueError):
        lp.private_key()


# ---------------------------------------------------------------- odd input
def test_bad_signature_shapes(pay):
    e = pay
    rid = start(e)
    raw = event(rid)
    t, v1 = signed(raw)["Stripe-Signature"].split(",")
    for h in ("", "garbage", "t=,v1=", t, v1, f"{t},v1=", f"{t},v1={'0' * 64}", f"{t},{v1.upper()}", f"{t}x,{v1}"):
        assert e.c.post("/webhooks/stripe", content=raw, headers=signed(raw, header=h)).status_code == 400, h
    assert issued(e) == 0
    several = f"{t},v1={'0' * 64},{v1}"  # Stripe sends more than one v1 while a secret is being rotated
    assert e.c.post("/webhooks/stripe", content=raw, headers=signed(raw, header=several)).status_code == 200
    assert issued(e) == 1


def test_a_body_edited_after_signing_is_refused(pay):
    e = pay
    rid = start(e)
    raw = event(rid, paid="unpaid")
    h = signed(raw)
    assert e.c.post("/webhooks/stripe", content=raw.replace(b"unpaid", b"paid  "), headers=h).status_code == 400 and issued(e) == 0


def test_oversized_body_is_refused_before_it_is_parsed(pay):
    raw = b"x" * (lp.MAX_BODY + 1)
    assert pay.c.post("/webhooks/stripe", content=raw, headers=signed(raw)).status_code in (400, 413)  # the app-wide body limit (413) answers first


ODD = [b"", b"null", b"[]", b'"x"', b"123", b"{", b'{"type":1}', b'{"type":"checkout.session.completed"}',
       b'{"type":"checkout.session.completed","data":null}', b'{"type":"checkout.session.completed","data":{"object":"x"}}',
       b'{"type":"checkout.session.completed","data":{"object":[]}}',
       b'{"type":"checkout.session.completed","data":{"object":{"client_reference_id":5,"payment_status":"paid"}}}',
       b'{"type":"checkout.session.completed","data":{"object":{"client_reference_id":["a"],"payment_status":"paid"}}}',
       b'{"type":"checkout.session.completed","data":{"object":{"client_reference_id":null,"payment_status":"paid"}}}',
       b"\xff\xfe\x00"]


@pytest.mark.parametrize("body", ODD)
def test_signed_but_odd_payloads_never_crash_and_never_issue(pay, body):
    e = pay
    start(e)
    assert post_raw(e, body).status_code == 200 and issued(e) == 0


@pytest.mark.parametrize("typ,paid", [("checkout.session.expired", "paid"), ("payment_intent.succeeded", "paid"), ("checkout.session.async_payment_failed", "unpaid"),
                                      ("checkout.session.completed", "unpaid"), ("checkout.session.completed", "no_payment_required"), ("checkout.session.completed", "PAID")])
def test_only_a_paid_checkout_issues(pay, typ, paid):
    e = pay
    rid = start(e)
    assert hook(e, rid, paid=paid, typ=typ).status_code == 200 and issued(e) == 0


def test_the_webhook_trusts_our_row_not_the_event(pay):
    e = pay
    rid = start(e)
    raw = json.dumps({"type": "checkout.session.completed", "data": {"object": {
        "client_reference_id": rid, "payment_status": "paid", "customer_email": "evil@x.test", "metadata": {"plan": "pro", "seats": 9999}}}}).encode()
    assert post_raw(e, raw).status_code == 200
    p, _ = lic.inspect(token_of(e, rid))
    assert (p["email"], p["plan"], p["seats"]) == (MAIL, "standard", 10)


def test_webhook_is_off_without_its_secret(pay, monkeypatch):
    e = pay
    rid = start(e)
    monkeypatch.delenv("STRIPE_WEBHOOK_SECRET")
    assert hook(e, rid, secret="").status_code == 400 and issued(e) == 0  # an empty secret must never validate


def test_unicode_and_long_org_names_still_sign(pay):
    e = pay
    rid = start(e)
    e.sql("update tenants set display_name=%s where id=(select tenant_id from license_requests where id=%s)", ("店" * 300 + " Sdn Bhd", rid))
    assert hook(e, rid).status_code == 200
    p, why = lic.inspect(token_of(e, rid))
    assert why is None and len(p["org"]) <= 200


def test_checkout_validates_the_plan_and_is_rate_limited(pay):
    e = pay
    for plan in ("", "gold", "STANDARD", "standard ", None, 5):
        assert e.c.post("/api/license/checkout", json={"plan": plan}, headers=e.O).status_code == 422, plan
    assert e.c.post("/api/license/checkout", json={"plan": "standard", "seats": 999}, headers=e.O).status_code == 422  # seats are not the client's to choose
    codes = [e.c.post("/api/license/checkout", json={"plan": "standard"}, headers=e.O).status_code for _ in range(7)]
    assert codes[:5] == [200] * 5 and set(codes[5:]) == {429}


@pytest.mark.parametrize("k", ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "LICENSE_PRIVATE_KEY", "APP_PUBLIC_URL", "STRIPE_PRICE_STANDARD"])
def test_checkout_is_off_when_any_setting_is_missing(pay, monkeypatch, k):
    e = pay
    monkeypatch.delenv(k)
    r = e.c.post("/api/license/checkout", json={"plan": "standard"}, headers=e.O)
    assert r.status_code == 409 and r.json()["error"]["code"] == "payment_off"
