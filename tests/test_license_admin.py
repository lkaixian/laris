"""Issuing licences from the web page (docs/licensing.md "Issuing from the web page"): the browser signs, the server verifies. No network."""
import base64
import json

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from src import license as lic
from support.fixtures import env, pg_url  # noqa: F401
from test_license import KEY, MAIL, PUB, activate, fresh, on, script, status, token, verified_owner  # noqa: F401
from test_rfq import other_tenant

ISSUER = "issuer@laris.test"
A = "/api/license/admin"
OTHER = Ed25519PrivateKey.generate()
OTHER_PUB = base64.b64encode(OTHER.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()


@pytest.fixture
def admin(env, monkeypatch):
    """The platform admin: an owner of ANOTHER tenant whose verified email is LICENSE_ISSUER_EMAIL. env.O is the customer (MAIL)."""
    monkeypatch.setenv("LICENSE_ISSUER_EMAIL", ISSUER)
    verified_owner(env)
    h = other_tenant(env)
    env.sql("update users set email=%s, email_verified_at=now() where id=%s", (ISSUER.upper(), h["X-User"]))  # case-insensitive
    return h


def ask(e, plan="standard", seats=10):
    r = e.c.post("/api/license/request", json={"plan": plan, "seats": seats}, headers=e.O)
    assert r.status_code == 202
    return r.json()["id"]


def test_everyone_but_the_admin_gets_404(env, on, admin):
    e = env
    paths = [("get", f"{A}/config", None), ("get", f"{A}/requests", None), ("post", f"{A}/public-key", {"public_key": PUB}),
             ("post", f"{A}/issue", {"request_id": "x", "token": "y"})]
    for who in (e.S, e.O):  # staff, and an owner whose email is not the issuer's
        for m, path, body in paths:
            r = getattr(e.c, m)(path, headers=who, **({"json": body} if body else {}))
            assert r.status_code == 404, (path, who)
    assert e.c.get(f"{A}/config", headers=admin).status_code == 200


def test_public_key_from_the_page(env, admin, monkeypatch):
    e = env
    assert e.c.get(f"{A}/config", headers=admin).json() == {"public_key": None, "source": None, "enforced": False}
    assert e.c.post(f"{A}/public-key", json={"public_key": "nope"}, headers=admin).status_code == 422
    assert e.c.post(f"{A}/public-key", json={"public_key": base64.b64encode(b"short").decode()}, headers=admin).json()["error"]["code"] == "bad_key"
    r = e.c.post(f"{A}/public-key", json={"public_key": PUB}, headers=admin)
    assert r.status_code == 200 and r.json() == {"public_key": PUB, "source": "dashboard", "enforced": True}
    assert lic.configured() and e.sql("select public_key from license_config") == [{"public_key": PUB}]
    audit = e.sql("select after from audit_log where entity='license_config'")
    assert len(audit) == 1 and PUB not in json.dumps(audit) and len(audit[0]["after"]["fingerprint"]) == 12
    # a stored licence signed under the old key: replacing the key needs confirm
    verified_owner(e)
    assert activate(e, token()).status_code == 200
    r = e.c.post(f"{A}/public-key", json={"public_key": OTHER_PUB}, headers=admin)
    assert r.status_code == 409 and r.json()["error"]["code"] == "would_invalidate" and r.json()["error"]["licences"] == 1
    assert lic.raw_key() == PUB
    assert e.c.post(f"{A}/public-key", json={"public_key": PUB}, headers=admin).status_code == 200  # same key: nothing to invalidate
    assert e.c.post(f"{A}/public-key", json={"public_key": OTHER_PUB, "confirm": True}, headers=admin).status_code == 200
    assert status(e)["status"] == "invalid"
    # the environment wins and cannot be changed from the page
    monkeypatch.setenv("LICENSE_PUBLIC_KEY", PUB)
    assert e.c.get(f"{A}/config", headers=admin).json()["source"] == "environment"
    r = e.c.post(f"{A}/public-key", json={"public_key": OTHER_PUB}, headers=admin)
    assert r.status_code == 409 and r.json()["error"]["code"] == "key_from_environment"


def test_issue_offer_accept(env, on, admin):
    e = env
    rid = ask(e, "standard", 10)
    rows = e.c.get(f"{A}/requests", headers=admin).json()
    assert [(q["id"], q["org"] is not None, q["email"], q["plan"], q["seats"], q["status"], q["offer_expires_at"]) for q in rows] == [(rid, True, MAIL, "standard", 10, "pending", None)]
    assert status(e)["offer"] is None
    tok = token(seats=5)  # fewer seats than asked is fine
    r = e.c.post(f"{A}/issue", json={"request_id": rid, "token": tok}, headers=admin)
    assert r.status_code == 200 and r.json() == {"ok": True, "emailed": True}
    mail = [m for m in e.svc.outbox if m[4] == "license"]
    assert len(mail) == 1 and mail[0][0] == MAIL and tok in mail[0][2]
    q = e.c.get(f"{A}/requests", headers=admin).json()[0]
    assert q["status"] == "issued" and q["offer_expires_at"]
    assert e.sql("select count(*) n from audit_log where event like 'license issued%%'")[0]["n"] == 1
    assert tok not in json.dumps(e.sql("select after from audit_log"), default=str)
    # the customer sees an offer (never the token); staff and the other tenant see nothing
    s = e.c.get("/api/license", headers=e.O)
    assert s.json()["offer"]["plan"] == "standard" and s.json()["offer"]["seats"] == 5 and tok not in s.text
    assert e.c.get("/api/license", headers=e.S).json()["offer"] is None
    assert e.c.get("/api/license", headers=admin).json()["offer"] is None
    assert e.c.post("/api/license/accept-offer", headers=admin).json()["error"]["code"] == "no_offer"
    assert e.c.post("/api/license/accept-offer", headers=e.S).status_code == 403
    r = e.c.post("/api/license/accept-offer", headers=e.O)
    assert r.status_code == 200 and r.json()["status"] == "active" and r.json()["seats"] == 5
    assert status(e)["offer"] is None
    assert e.c.post("/api/license/accept-offer", headers=e.O).json()["error"]["code"] == "no_offer"


def test_issue_refuses_a_token_that_does_not_match(env, on, admin):
    e = env
    rid = ask(e, "standard", 10)
    bad = {"email": token(email="someone@else.test"), "seats": token(seats=11), "plan": token(plan="pro"), "other key": token(key=OTHER),
           "custom plan": token(plan="gold")}
    for why, tok in bad.items():
        r = e.c.post(f"{A}/issue", json={"request_id": rid, "token": tok}, headers=admin)
        assert r.status_code == 422, why
    assert [e.c.post(f"{A}/issue", json={"request_id": rid, "token": bad[k]}, headers=admin).json()["error"]["code"] for k in ("email", "seats", "plan")] == ["token_mismatch"] * 3
    head, body, sig = token().split(".")
    flip = lic._b64(bytes([lic._unb64(sig)[0] ^ 1]) + lic._unb64(sig)[1:])
    assert e.c.post(f"{A}/issue", json={"request_id": rid, "token": f"{head}.{body}.{flip}"}, headers=admin).json()["error"]["code"] == "invalid_license"
    assert e.c.post(f"{A}/issue", json={"request_id": "not-a-uuid", "token": token()}, headers=admin).status_code == 404
    assert e.sql("select status from license_requests") == [{"status": "new"}]
    assert status(e)["offer"] is None


def test_seat_check_still_applies_to_an_offer(env, on, admin):
    e = env
    assert e.sql("select count(*) n from users where tenant_id=(select tenant_id from users where id=%s) and active", (e.owner,))[0]["n"] >= 2
    rid = ask(e, "starter", 1)
    assert e.c.post(f"{A}/issue", json={"request_id": rid, "token": token(plan="starter", seats=1)}, headers=admin).status_code == 200
    r = e.c.post("/api/license/accept-offer", headers=e.O)
    assert r.status_code == 409 and r.json()["error"]["code"] == "too_many_users"
    assert status(e)["status"] == "missing" and status(e)["offer"] is not None


def test_offer_needs_the_owners_verified_email(env, on, admin):
    e = env
    rid = ask(e)
    assert e.c.post(f"{A}/issue", json={"request_id": rid, "token": token()}, headers=admin).status_code == 200
    e.sql("update users set email_verified_at = null where id=%s", (e.owner,))
    assert status(e)["offer"] is None and e.c.post("/api/license/accept-offer", headers=e.O).status_code == 404


def test_interop_vector_with_the_issuer_script_key(env, admin, tmp_path):
    """The browser must produce exactly this: payload JSON with sorted keys and no spaces, ed25519 over those bytes, base64url without padding."""
    e = env
    pub = script.keygen(tmp_path / "k.pem")  # the helper the CLI uses
    priv = script.load_private(tmp_path / "k.pem")
    assert e.c.post(f"{A}/public-key", json={"public_key": pub}, headers=admin).json()["source"] == "dashboard"
    rid = ask(e, "pro", 25)
    payload = {"v": 1, "lid": "0b0f6f06-8d0b-4a39-9d0e-5d4e2a8a7c11", "email": MAIL, "org": "Shop", "plan": "pro", "seats": 25,
               "issued_at": 1800000000, "expires_at": 1831536000}
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    assert body == (b'{"email":"owner@shop.test","expires_at":1831536000,"issued_at":1800000000,"lid":"0b0f6f06-8d0b-4a39-9d0e-5d4e2a8a7c11",'
                    b'"org":"Shop","plan":"pro","seats":25,"v":1}')
    b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
    tok = f"LARIS1.{b64(body)}.{b64(priv.sign(body))}"
    r = e.c.post(f"{A}/issue", json={"request_id": rid, "token": tok}, headers=admin)
    assert r.status_code == 200, r.text
    assert tok == lic.sign(priv, MAIL, "pro", 25, 365, "Shop", now=1800000000, lid=payload["lid"])  # ed25519 is deterministic: byte for byte the CLI token
