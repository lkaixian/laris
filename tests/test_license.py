"""Signed licence, trusted time, enforcement, purchase request and the issuer's script (docs/licensing.md). A test keypair is injected; no network."""
import base64
import json
import struct
import sys
import time
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from src import clock, db
from src import license as lic
from support.fixtures import env, pg_url  # noqa: F401
from test_api import PART, TG_SECRET
from test_rfq import other_tenant

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import issue_license as script  # noqa: E402

KEY = Ed25519PrivateKey.generate()
PUB = base64.b64encode(KEY.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
DAY = 86400
MAIL = "owner@shop.test"


class Net:
    """Stands in for ntp_time() / system_time(): set .ntp to a unix time or None (unreachable)."""
    def __init__(self):
        self.ntp, self.sys = time.time(), None

    def adopt(self, mp):
        mp.setattr(clock, "ntp_time", lambda: self.ntp)
        mp.setattr(clock, "system_time", lambda: self.sys if self.sys is not None else time.time())
        return self


@pytest.fixture(autouse=True)
def fresh(monkeypatch, tmp_path):
    monkeypatch.setattr(lic, "KEYFILE", tmp_path / "none.key")
    monkeypatch.delenv("LICENSE_PUBLIC_KEY", raising=False)
    clock.reset()
    lic.invalidate()
    yield
    clock.reset()
    lic.invalidate()


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("LICENSE_PUBLIC_KEY", PUB)
    return Net().adopt(monkeypatch)


def token(email=MAIL, plan="standard", seats=10, days=365, now=None, key=KEY, org="Shop"):
    return lic.sign(key, email, plan, seats, days, org, now=now)


def verified_owner(e, email=MAIL):
    e.sql("update users set email=%s, email_verified_at=now() where id=%s", (email, e.owner))


def activate(e, tok, who=None):
    return e.c.post("/api/license", json={"key": tok}, headers=who or e.O)


def status(e, who=None):
    return e.c.get("/api/license", headers=who or e.O).json()


# ---------------------------------------------------------------- sign / verify
def test_roundtrip_and_strict_rejections(on):
    t = token()
    p, why = lic.inspect(t)
    assert why is None and p["email"] == MAIL and p["seats"] == 10 and p["v"] == 1 and p["expires_at"] - p["issued_at"] == 365 * DAY
    head, body, sig = t.split(".")
    assert head == "LARIS1"
    forged = json.loads(lic._unb64(body))
    enc = lambda o: lic._b64(json.dumps(o, separators=(",", ":")).encode())
    assert lic.inspect(f"LARIS1.{enc({**forged, 'seats': 999})}.{sig}") == (None, "signature")  # tampered payload
    flip = lic._b64(bytes([lic._unb64(sig)[0] ^ 1]) + lic._unb64(sig)[1:])
    assert lic.inspect(f"LARIS1.{body}.{flip}") == (None, "signature")
    assert lic.inspect(token(key=Ed25519PrivateKey.generate())) == (None, "signature")  # someone else's key
    assert lic.inspect(f"LARIS2.{body}.{sig}")[1] == "malformed"  # version prefix
    for junk in ("", "x", "LARIS1..", f"LARIS1.{body}", f"LARIS1.{body}.{sig}.x", "LARIS1.@@.@@", None, 5, "A" * 5000):
        assert lic.inspect(junk)[0] is None
    # signed but wrong shape: version, types, ranges, extra / missing fields
    good = {"v": 1, "lid": forged["lid"], "email": MAIL, "org": "", "plan": "pro", "seats": 5, "issued_at": 1, "expires_at": 2}
    assert lic.inspect(lic.sign.__globals__["PREFIX"] + "." + enc(good) + "." + lic._b64(KEY.sign(json.dumps(good, separators=(",", ":")).encode())))[0] == good
    for bad in ({**good, "v": 2}, {**good, "v": True}, {**good, "seats": "5"}, {**good, "seats": 0}, {**good, "seats": True}, {**good, "email": "A@B.C"},
                {**good, "lid": "not-a-uuid"}, {**good, "expires_at": 1}, {**good, "extra": 1}, {k: v for k, v in good.items() if k != "org"},
                {**good, "plan": "Bad Plan"}, {**good, "issued_at": -1}):
        body = json.dumps(bad, separators=(",", ":")).encode()
        assert lic.inspect(f"LARIS1.{lic._b64(body)}.{lic._b64(KEY.sign(body))}") == (None, "fields"), bad


def test_no_key_configured_means_off(monkeypatch):
    assert not lic.configured() and lic.inspect(token()) == (None, "no_key")
    monkeypatch.setenv("LICENSE_PUBLIC_KEY", "not base64!")  # configured but broken: fails closed, never silently off
    assert lic.configured() and lic.inspect(token()) == (None, "no_key")


def test_key_from_file(monkeypatch, tmp_path):
    f = tmp_path / "pub.key"
    f.write_text(PUB + "\n")
    monkeypatch.setattr(lic, "KEYFILE", f)
    assert lic.configured() and lic.inspect(token())[1] is None


def test_off_means_everything_as_before(env):
    e = env
    s = status(e)
    assert s["enforced"] is False and s["read_only"] is False
    assert e.c.get("/api/license/plans").status_code == 200
    r = activate(e, token())
    assert r.status_code == 409 and r.json()["error"]["code"] == "licensing_off"
    assert e.c.post("/api/settings", json={"brand_color": "#112233"}, headers=e.O).status_code == 200  # writes are never blocked
    assert e.c.post("/api/users", json={"name": "N", "username": "newuser1", "role": "staff", "password": "a-long-password-1"}, headers=e.O).status_code == 201


# ---------------------------------------------------------------- clock
def tclock(e):
    with db.tx() as c:
        return clock.trusted_now(c)


def row(e):
    return e.sql("select extract(epoch from watermark)::float8 w, rollback_flag r, last_ntp_ok from license_clock")[0]


def test_clock_ntp_moves_watermark_forward_and_never_back(env, monkeypatch):
    e, n = env, Net().adopt(monkeypatch)
    base = time.time()
    n.ntp = base + 1000
    c1 = tclock(e)
    assert c1["source"] == "ntp" and abs(c1["now"] - (base + 1000)) < 5 and not c1["unverified"]
    w1 = row(e)["w"]
    assert abs(w1 - (base + 1000)) < 5
    clock.reset()
    n.ntp, n.sys = None, base - 10 * DAY  # offline AND the system clock rolled back ten days
    c2 = tclock(e)
    assert c2["source"] == "system" and c2["now"] >= w1 and c2["rollback"] and c2["unverified"]  # frozen at the watermark, flagged
    assert row(e)["w"] >= w1 and row(e)["r"] is True
    with pytest.raises(Exception, match="cannot be deleted"):
        e.sql("delete from license_clock", role="owner")
    e.sql("update license_clock set watermark = watermark - interval '30 days'")
    assert row(e)["w"] >= w1  # the database itself refuses to move it back


def test_clock_offline_grace(env, monkeypatch):
    e, n = env, Net().adopt(monkeypatch)
    tclock(e)  # NTP ok now
    clock.reset()
    n.ntp = None
    assert not tclock(e)["unverified"]  # offline, inside the 7 days
    e.sql("update license_clock set last_ntp_ok = now() - interval '6 days 23 hours'")
    assert not tclock(e)["unverified"]
    e.sql("update license_clock set last_ntp_ok = now() - interval '8 days'")
    assert tclock(e)["unverified"]
    monkeypatch.setenv("LICENSE_OFFLINE_GRACE_DAYS", "30")
    assert not tclock(e)["unverified"]
    n.ntp = time.time()  # back online: verified again at once
    clock.reset()
    monkeypatch.setenv("LICENSE_OFFLINE_GRACE_DAYS", "7")
    assert not tclock(e)["unverified"]


def test_clock_cache_and_failure_backoff(env, monkeypatch):
    e, n = env, Net().adopt(monkeypatch)
    calls = []
    monkeypatch.setattr(clock, "ntp_time", lambda: calls.append(1) or n.ntp)
    tclock(e)
    tclock(e)
    assert len(calls) == 1  # cached 6 hours
    clock.reset()
    n.ntp = None
    tclock(e)
    tclock(e)
    assert len(calls) == 2  # a failed lookup is not retried for 5 minutes either
    monkeypatch.setattr(clock, "ntp_time", lambda: 1 / 0)  # a crashing lookup never reaches a request
    clock.reset()
    assert tclock(e)["source"] == "system"


def test_sntp_parse():
    sent = bytes([0x1B]) + bytes(39) + struct.pack("!II", 12345, 678)
    def reply(li=0, mode=4, stratum=2, sec=3_900_000_000, echo=sent[40:48]):
        return bytes([li << 6 | 3 << 3 | mode, stratum]) + bytes(22) + echo + bytes(8) + struct.pack("!II", sec, 1 << 31)
    assert clock._parse(reply(), sent) == pytest.approx(3_900_000_000 - clock.EPOCH + 0.5)
    for bad in (reply(li=3), reply(mode=3), reply(stratum=0), reply(stratum=16), reply(sec=0), reply(echo=bytes(8)), reply()[:40]):
        assert clock._parse(bad, sent) is None


# ---------------------------------------------------------------- activation
def test_activation_rules(env, on):
    e = env
    verified_owner(e)
    assert status(e)["status"] == "missing" and status(e)["enforced"] is True
    for junk in ("nope", token(key=Ed25519PrivateKey.generate())):
        r = activate(e, junk)
        assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_license" and "(" not in r.json()["error"]["message"]
    r = activate(e, token(email="someone@else.test"))
    assert r.status_code == 422 and "not for this email" in r.json()["error"]["message"]
    r = activate(e, token(now=int(time.time()) - 400 * DAY, days=365))
    assert r.status_code == 422 and "expired" in r.json()["error"]["message"]
    r = activate(e, token(seats=1))  # the demo tenant has more than one active user
    assert r.status_code == 409 and r.json()["error"]["code"] == "too_many_users"
    assert e.c.post("/api/license", json={"key": token()}, headers=e.S).status_code == 403  # staff cannot activate
    assert status(e)["status"] == "missing"
    t = token()
    r = activate(e, t)
    assert r.status_code == 200 and r.json()["status"] == "active" and r.json()["plan"] == "standard" and r.json()["seats"] == 10
    assert r.json()["days_left"] in (364, 365) and r.json()["seats_used"] >= 2 and r.json()["clock"]["source"] == "ntp"
    assert activate(e, t).status_code == 200  # the same tenant may activate it again
    ev = [x for x in e.c.get("/api/audit", headers=e.O).json() if x["event"] == "license activated"]
    assert ev and t not in json.dumps(ev) and t.split(".")[2] not in json.dumps(ev)  # the token is never logged
    s = status(e, e.S)  # staff see the status, never the key
    assert s["status"] == "active" and "key" not in s and t not in json.dumps(s)


def test_unverified_email_and_licence_reuse(env, on):
    e = env
    r = activate(e, token())  # the owner has no verified email
    assert r.status_code == 422 and "verified email" in r.json()["error"]["message"]
    verified_owner(e)
    t = token()
    assert activate(e, t).status_code == 200
    o2 = other_tenant(env)
    mail2 = "owner2@shop.test"
    e.sql("update users set email=%s, email_verified_at=now() where id=%s", (mail2, o2["X-User"]))
    r = e.c.post("/api/license", json={"key": lic.sign(KEY, mail2, "pro", 25, 30)}, headers=o2)
    assert r.status_code == 200  # a different licence is fine
    e.sql("update users set email='moved@shop.test' where id=%s", (e.owner,))  # the first owner's address changes; emails are unique across tenants
    e.sql("update users set email=%s where id=%s", (MAIL, o2["X-User"]))  # the second tenant's owner now holds the address the key was issued to
    r = e.c.post("/api/license", json={"key": t}, headers=o2)
    assert r.status_code == 409 and r.json()["error"]["code"] == "license_in_use"


def test_licence_status_expiry_and_cache(env, on):
    e = env
    verified_owner(e)
    now = int(time.time())
    assert activate(e, token(now=now - 355 * DAY, days=365)).json()["status"] == "expiring"  # 10 days left
    tid = e.sql("select tenant_id from users where id=%s", (e.owner,))[0]["tenant_id"]
    e.sql("update tenants set license_token=%s where id=%s", (token(now=now - 400 * DAY, days=365), tid))
    assert status(e)["status"] == "expiring"  # cached for 60 s: the row edit is not seen yet
    lic.invalidate(tid)
    s = status(e)
    assert s["status"] == "expired" and s["days_left"] < 0 and s["read_only"] is True
    e.sql("update tenants set license_token='LARIS1.x.y' where id=%s", (tid,))
    lic.invalidate()
    assert status(e)["status"] == "invalid"
    e.sql("update tenants set license_token=%s where id=%s", (token(), tid))
    lic.invalidate()
    assert status(e)["status"] == "active"
    on.ntp = None
    clock.reset()
    e.sql("update license_clock set last_ntp_ok = now() - interval '9 days'")
    lic.invalidate()
    assert status(e)["status"] == "clock_unverified"


# ---------------------------------------------------------------- enforcement
def test_enforcement_402_reads_allowlist_webhooks(env, monkeypatch):
    e = env
    e.stock_costs()  # real flow while licensing is still off
    monkeypatch.setenv("LICENSE_PUBLIC_KEY", PUB)
    Net().adopt(monkeypatch)
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", TG_SECRET)
    verified_owner(e)
    w = lambda: e.c.post("/api/settings", json={"brand_color": "#112233"}, headers=e.O)
    r = w()
    assert r.status_code == 402 and r.json()["error"]["code"] == "license_required" and "missing" in r.json()["error"]["message"]
    assert e.c.post("/api/documents/ingest", data={"text": "x"}, headers=e.S).status_code == 402  # staff writes too
    assert e.c.post("/api/enquiries/simulate", json={"channel": "web", "text": "10 parts"}, headers=e.S).status_code == 402  # outbound work too
    for p in ("/api/me", "/api/tracker", "/api/users", "/api/license"):
        assert e.c.get(p, headers=e.O).status_code == 200, p  # read-only mode
    e.ai.payload = {"items": [PART]}
    upd = {"update_id": 1, "message": {"message_id": 5, "date": 1700000000, "chat": {"id": 4242}, "text": "need 10 small parts"}}
    assert e.c.post("/webhooks/telegram", json=upd, headers={"X-Telegram-Bot-Api-Secret-Token": TG_SECRET}).status_code == 200  # capture goes on
    assert e.sql("select count(*) n from enquiries")[0]["n"] >= 1
    # allowlist: own sessions, password, licence request and activation
    assert e.c.post("/api/me/sessions/revoke-others", headers=e.O).status_code != 402
    assert e.c.post("/api/me/password", json={"current": "x" * 10, "new": "y" * 12}, headers=e.O).status_code != 402
    assert e.c.post("/api/license/request", json={"plan": "starter", "seats": 3}, headers=e.O).status_code == 202
    assert activate(e, token()).status_code == 200
    assert w().status_code == 200  # licensed: writes work
    e.sql("update tenants set license_expires_at = now()")  # (the token, not this column, is what counts)
    tid = e.sql("select tenant_id from users where id=%s", (e.owner,))[0]["tenant_id"]
    e.sql("update tenants set license_token=%s where id=%s", (token(now=int(time.time()) - 400 * DAY), tid))
    lic.invalidate()
    assert w().status_code == 402 and "expired" in w().json()["error"]["message"]


def test_seat_limit(env, on):
    e = env
    verified_owner(e)
    used = e.sql("select count(*) n from users where active")[0]["n"]
    assert activate(e, token(seats=used)).status_code == 200
    new = lambda n: e.c.post("/api/users", json={"name": "N", "username": n, "role": "staff", "password": "a-long-password-1"}, headers=e.O)
    r = new("extra-user")
    assert r.status_code == 409 and r.json()["error"]["code"] == "seat_limit"
    e.sql("update users set active=false where id=%s", (e.staff,))
    e.sql("insert into users(tenant_id,name,role) select tenant_id,'Filler','staff' from users where id=%s", (e.owner,))  # takes the freed seat
    r = e.c.post(f"/api/users/{e.staff}", json={"active": True}, headers=e.O)  # reactivating needs a seat too
    assert r.status_code == 409 and r.json()["error"]["code"] == "seat_limit"


# ---------------------------------------------------------------- purchase request
def test_request_stored_mailed_isolated_and_throttled(env, on, monkeypatch):
    e = env
    monkeypatch.setenv("LICENSE_ISSUER_EMAIL", "issuer@laris.test")
    body = {"plan": "pro", "seats": 20, "note": "need more seats"}
    assert e.c.post("/api/license/request", json=body, headers=e.O).status_code == 422  # owner has no email yet
    verified_owner(e)
    assert e.c.post("/api/license/request", json=body, headers=e.S).status_code == 403
    assert e.c.post("/api/license/request", json={**body, "plan": "gold"}, headers=e.O).status_code == 422
    r = e.c.post("/api/license/request", json=body, headers=e.O)
    assert r.status_code == 202 and r.json()["ok"]
    got = e.sql("select email, plan, seats, note, status from license_requests")
    assert got == [{"email": MAIL, "plan": "pro", "seats": 20, "note": "need more seats", "status": "new"}]
    assert sorted(m[0] for m in e.svc.outbox) == ["issuer@laris.test", MAIL] and all(m[4] == "license-request" for m in e.svc.outbox)
    o2 = other_tenant(env)
    assert e.sql("select count(*) n from license_requests", role="owner")[0]["n"] == 1
    with db.tx("owner", e.owner, tenant=str(e.sql("select tenant_id from users where id=%s", (o2["X-User"],))[0]["tenant_id"])) as c:
        c.execute("set local role laris_app")
        assert c.execute("select count(*) n from license_requests").fetchone()["n"] == 0  # the other tenant sees none
    for _ in range(2):
        assert e.c.post("/api/license/request", json=body, headers=e.O).status_code == 202
    assert e.c.post("/api/license/request", json=body, headers=e.O).status_code == 429  # 3 a day


def test_plans_public_without_prices(env):
    r = env.c.get("/api/license/plans")
    assert [(p["key"], p["seats"]) for p in r.json()["plans"]] == [("starter", 3), ("standard", 10), ("pro", 25)]
    assert all(p["price"] == "Contact us" for p in r.json()["plans"])


def test_apply_schema_twice(env):
    db.apply_schema()
    db.apply_schema()


# ---------------------------------------------------------------- issuer script
def test_script_keygen_issue_inspect_requests(env, on, tmp_path, monkeypatch, capsys):
    out = tmp_path / "k" / "priv.pem"
    pub = script.keygen(out)
    shown = capsys.readouterr().out
    assert out.is_file() and "PRIVATE" not in shown and base64.b64decode(pub) and len(base64.b64decode(pub)) == 32
    pem_b64 = base64.b64encode(out.read_bytes()).decode()
    with pytest.raises(SystemExit, match="refusing to overwrite"):
        script.keygen(out)
    script.main(["keygen", "--out", str(tmp_path / "second.pem")])
    printed = capsys.readouterr().out
    assert "LICENSE_PUBLIC_KEY=" in printed and "PRIVATE KEY" not in printed and pem_b64 not in printed
    assert script.load_private(out).public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw) == base64.b64decode(pub)
    monkeypatch.setenv("LICENSE_PUBLIC_KEY", pub)  # the app now trusts this key
    monkeypatch.setenv("LICENSE_PRIVATE_KEY_FILE", str(out))
    script.main(["issue", "--email", "Buyer@Shop.test", "--plan", "pro", "--days", "30"])
    tok = capsys.readouterr().out.split("\n\n")[1].strip()
    p, why = lic.inspect(tok)
    assert why is None and p["email"] == "buyer@shop.test" and p["seats"] == 25 and p["expires_at"] - p["issued_at"] == 30 * DAY
    script.main(["inspect", tok])
    assert "buyer@shop.test" in capsys.readouterr().out
    with pytest.raises(SystemExit):
        script.main(["inspect", tok[:-4] + "AAAA"])
    sent = []
    from src import mailer
    monkeypatch.setattr(mailer, "enabled", lambda: True)
    monkeypatch.setattr(mailer, "send", lambda to, subject, text, html=None, category=None: sent.append((to, text)) or True)
    script.main(["issue", "--email", "b@shop.test", "--send"])
    assert sent[0][0] == "b@shop.test" and "LARIS1." in sent[0][1]
    monkeypatch.setattr(mailer, "enabled", lambda: False)
    script.main(["issue", "--email", "b@shop.test", "--send"])
    assert "email is OFF" in capsys.readouterr().out and len(sent) == 1
    with pytest.raises(SystemExit):
        script.main(["issue", "--plan", "pro"])  # no email, no request
    # requests
    verified_owner(env)
    assert env.c.post("/api/license/request", json={"plan": "starter", "seats": 3, "note": "hi"}, headers=env.O).status_code == 202
    capsys.readouterr()
    script.main(["requests"])
    listed = capsys.readouterr().out
    rid = listed.split()[0]
    assert MAIL in listed and "starter x3" in listed and "hi" in listed
    script.main(["issue", "--request", rid])
    tok = capsys.readouterr().out.split("\n\n")[1].strip()
    p, _ = lic.inspect(tok)
    assert p["email"] == MAIL and p["plan"] == "starter" and p["seats"] == 3
    q = env.sql("select status, issued_license_id::text lid from license_requests")[0]
    assert q["status"] == "issued" and q["lid"] == p["lid"]
    script.main(["requests"])
    assert "no pending requests" in capsys.readouterr().out
    with pytest.raises(SystemExit, match="no pending"):
        script.main(["issue", "--request", rid])  # already issued
