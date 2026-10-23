"""Self-service signup with emailed code, password reset by code, email login, the mailer."""
import logging
import re

import httpx
import psycopg
import pytest

from src import auth, db, mailer
from src.api import deps
from support.fixtures import env, pg_url  # noqa: F401

PW = "correct horse 1"
BODY = {"business_name": "Acme Print", "owner_name": "Ann Lee", "email": "Ann@Example.com", "password": PW, "trade_template": "made_to_order"}
NEW = "brand new pass 9"


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    auth._ACCT.clear()
    auth._IPS.clear()
    monkeypatch.delenv("SIGNUP_DEV_ECHO", raising=False)
    monkeypatch.delenv("MAILTRAP_API_TOKEN", raising=False)


def signup(e, **kw):
    return e.c.post("/api/signup", json={**BODY, **kw})


def last_code(e):
    return re.search(r"\b(\d{6})\b", e.svc.outbox[-1][2]).group(1)


def wrong(code):
    return "000000" if code != "000000" else "111111"


def verify(e, code, email="ann@example.com"):
    return e.c.post("/api/signup/verify", json={"email": email, "code": code})


def login(e, who, pw=PW):
    return e.c.post("/api/login", json={"username": who, "password": pw})


def forgot(e, email="ann@example.com"):
    return e.c.post("/api/password/forgot", json={"email": email})


def reset(e, code, email="ann@example.com", pw=NEW):
    return e.c.post("/api/password/reset", json={"email": email, "code": code, "new_password": pw})


def made(e):
    """Sign up and verify the default account."""
    assert signup(e).status_code == 202
    assert verify(e, last_code(e)).status_code == 200


def test_signup_happy_path(env):
    e = env
    r = signup(e)
    assert r.status_code == 202 and r.json()["ok"] and "dev_code" not in r.json()
    to, subject, text, html, cat = e.svc.outbox[0]
    assert to == "ann@example.com" and "verification" in subject and cat == "signup"
    t = e.sql("select id, name, display_name, trade_template from tenants where display_name='Acme Print'")[0]
    assert t["trade_template"] == "made_to_order"
    u = e.sql("select role, active, email_verified_at, username, role_id from users where email='ann@example.com'")[0]
    assert u["role"] == "owner" and not u["active"] and u["email_verified_at"] is None and u["role_id"]
    assert e.sql("select count(*) n from tenant_fields where tenant_id=%s", (t["id"],))[0]["n"] > 0  # fields seeded right away
    assert {x["key"] for x in e.sql("select key from roles where tenant_id=%s", (t["id"],))} == {"owner", "staff"}
    assert e.sql("select code_hash from email_codes")[0]["code_hash"] != last_code(e)  # stored hashed
    assert verify(e, last_code(e)).json() == {"ok": True}
    assert e.sql("select active, email_verified_at from users where email='ann@example.com'")[0]["active"]


def test_unverified_cannot_login_verified_can_by_email_and_username(env):
    e = env
    signup(e)
    assert login(e, "ann@example.com").status_code == 401
    assert login(e, "ann@example.com").json()["error"]["code"] == "bad_credentials"
    verify(e, last_code(e))
    r = login(e, "ANN@example.com")
    assert r.status_code == 200 and r.json()["user"]["role"] == "owner"
    e.sql("update users set username='ann' where email='ann@example.com'")
    assert login(e, "ann").status_code == 200
    assert login(e, "ann@example.com", "wrong password 1").status_code == 401
    me = e.c.get("/api/me", headers={"Authorization": "Bearer " + login(e, "ann").json()["token"]}).json()
    assert me["role"] == "owner" and me["org"]["name"] == "Acme Print"


def test_uniform_responses_and_existing_account_mail(env):
    e = env
    made(e)
    n = len(e.svc.outbox)
    again = signup(e, business_name="Other Co")
    fresh_ = signup(e, email="new@example.com")
    assert again.status_code == fresh_.status_code == 202 and again.json() == fresh_.json()
    assert e.svc.outbox[n][1].startswith("You already have")  # best-effort notice, no code
    assert e.sql("select count(*) n from tenants where display_name='Other Co'")[0]["n"] == 0
    for path, b in (("/api/signup/resend", {"email": "ann@example.com"}), ("/api/signup/resend", {"email": "ghost@example.com"}),
                    ("/api/password/forgot", {"email": "ghost@example.com"}), ("/api/password/forgot", {"email": "ann@example.com"})):
        r = e.c.post(path, json=b)
        assert r.status_code == 202 and r.json() == again.json(), path


def test_wrong_code_five_times_then_dead(env):
    e = env
    signup(e)
    code = last_code(e)
    for _ in range(5):
        r = verify(e, wrong(code))
        assert r.status_code == 400 and r.json()["error"] == {"code": "invalid_code", "message": "invalid or expired code"}
    assert verify(e, code).status_code == 400  # even the right one is dead now
    assert not e.sql("select active from users where email='ann@example.com'")[0]["active"]
    assert verify(e, wrong(code), email="nobody@example.com").json() == verify(e, wrong(code)).json()  # unknown email: same answer
    e.c.post("/api/signup/resend", json={"email": "ann@example.com"})
    assert verify(e, last_code(e)).status_code == 200  # a new code works


def test_expired_code(env):
    e = env
    signup(e)
    assert e.sql("select expires_at - created_at between interval '9 minutes 50 seconds' and interval '10 minutes 10 seconds' ok from email_codes")[0]["ok"]
    e.sql("update email_codes set expires_at = now() - interval '1 second'")
    assert verify(e, last_code(e)).status_code == 400


def test_resend_limit_and_only_for_unverified(env):
    e = env
    signup(e)
    n = len(e.svc.outbox)
    for _ in range(3):
        assert e.c.post("/api/signup/resend", json={"email": "ann@example.com"}).status_code == 202
    assert e.c.post("/api/signup/resend", json={"email": "ann@example.com"}).status_code == 429
    assert len(e.svc.outbox) == n + 3
    assert e.sql("select count(*) n from email_codes where used_at is null")[0]["n"] == 1  # older codes died
    assert verify(e, last_code(e)).status_code == 200
    n = len(e.svc.outbox)
    deps.HITS.clear()
    e.c.post("/api/signup/resend", json={"email": "ann@example.com"})
    assert len(e.svc.outbox) == n  # verified: nothing sent


def test_duplicate_business_name_gets_unique_key_same_display_name(env):
    e = env
    signup(e)
    signup(e, email="b@example.com")
    rows = e.sql("select name, display_name from tenants where display_name='Acme Print' order by name")
    assert len(rows) == 2 and rows[0]["name"] != rows[1]["name"] and rows[0]["name"].startswith("Acme Print")


def test_retry_replaces_pending_signup(env):
    e = env
    signup(e)
    first = last_code(e)
    assert signup(e, business_name="Acme Two", owner_name="Ann Two").status_code == 202
    assert e.sql("select count(*) n from users where email='ann@example.com'")[0]["n"] == 1
    assert e.sql("select count(*) n from tenants where display_name='Acme Print'")[0]["n"] == 0
    assert e.sql("select count(*) n from tenants where display_name='Acme Two'")[0]["n"] == 1
    assert e.sql("select count(*) n from tenant_fields f left join tenants t on t.id=f.tenant_id where t.id is null")[0]["n"] == 0
    assert e.sql("select count(*) n from email_codes")[0]["n"] == 1
    if first != last_code(e):
        assert verify(e, first).status_code == 400  # the old attempt's code is gone
    assert verify(e, last_code(e)).status_code == 200


def test_validation(env):
    e = env
    assert signup(e, password="short").status_code == 422
    assert signup(e, password="password1234").json()["error"]["code"] == "weak_password"
    for bad in ("nope", "a@b", "@x.com", "a b@x.com", "a@x.", "x" * 250 + "@x.com"):
        assert signup(e, email=bad).status_code == 422, bad
    assert signup(e, trade_template="nope").status_code == 422
    assert signup(e, trade_template="../x").status_code == 422
    assert signup(e, business_name=" \x00\x07 ").status_code == 422
    assert signup(e, email="local@example.com", business_name="  <b>Shop</b>\x00 ", owner_name="O\x07wen").status_code == 202
    assert e.sql("select display_name from tenants where display_name like '%%Shop%%'")[0]["display_name"] == "<b>Shop</b>"  # plain text, control chars gone
    assert e.sql("select name from users where email='local@example.com'")[0]["name"] == "Owen"
    # the password may not equal the email's local part (the user name for this check)
    assert signup(e, email="adminadmin@example.com", password="adminadmin").status_code == 422


def test_ip_throttle_429(env):
    e = env
    for i in range(5):
        assert signup(e, email=f"u{i}@example.com").status_code == 202
    r = signup(e, email="u9@example.com")
    assert r.status_code == 429 and r.json()["error"]["code"] == "slow_down"


def test_email_throttle_429(env):
    e = env
    for _ in range(3):
        assert signup(e).status_code == 202
    assert signup(e).status_code == 429


def test_dev_echo_only_when_set_and_email_off(env, monkeypatch):
    e = env
    assert "dev_code" not in signup(e).json()
    monkeypatch.setenv("SIGNUP_DEV_ECHO", "1")
    r = signup(e, email="d@example.com")
    assert re.fullmatch(r"\d{6}", r.json()["dev_code"])
    assert verify(e, r.json()["dev_code"], "d@example.com").status_code == 200
    monkeypatch.setenv("MAILTRAP_API_TOKEN", "t")  # email on: never echoed
    assert "dev_code" not in signup(e, email="f@example.com").json()


def test_email_off_does_not_crash(env, caplog):
    e = env
    e.svc.mail = mailer.send  # the real sender, token unset
    with caplog.at_level(logging.WARNING, logger="laris"):
        assert signup(e).status_code == 202
    assert "email is off" in caplog.text
    assert e.sql("select count(*) n from users where email='ann@example.com'")[0]["n"] == 1


def test_forgot_reset_happy_path_revokes_sessions_single_use(env):
    e = env
    made(e)
    e.sql("update users set username='ann' where email='ann@example.com'")
    t1 = login(e, "ann").json()["token"]
    for _ in range(5):
        login(e, "ann", "wrong password 1")  # locks the username
    assert login(e, "ann").status_code == 429
    e.sql("update users set token_sha256='x' where email='ann@example.com'")
    assert forgot(e).status_code == 202
    assert e.svc.outbox[-1][1].startswith("Your LARIS password reset")
    code = last_code(e)
    r = reset(e, code)
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert e.c.get("/api/me", headers={"Authorization": "Bearer " + t1}).status_code == 401  # session revoked
    assert e.sql("select token_sha256 from users where email='ann@example.com'")[0]["token_sha256"] is None
    assert login(e, "ann", PW).status_code == 401
    assert login(e, "ann", NEW).status_code == 200  # the lock was cleared
    again = reset(e, code, pw="another new pass 9")
    assert again.status_code == 400 and again.json()["error"]["message"] == "invalid or expired code"  # single use


def test_reset_errors_are_uniform_and_weak_password_refused(env):
    e = env
    made(e)
    forgot(e)
    code = last_code(e)
    w = reset(e, code, pw="password1234")
    assert w.status_code == 422 and w.json()["error"]["code"] == "weak_password"
    a, b = reset(e, wrong(code)), reset(e, wrong(code), email="ghost@example.com")
    assert a.status_code == b.status_code == 400 and a.json() == b.json()
    assert reset(e, code).status_code == 200  # the weak try did not spend the code


def test_reset_code_attempts_limit_and_forgot_throttle(env):
    e = env
    made(e)
    forgot(e)
    code = last_code(e)
    for _ in range(5):
        reset(e, wrong(code))
    assert reset(e, code).status_code == 400
    assert forgot(e).status_code == 202
    assert forgot(e).status_code == 202
    assert forgot(e).status_code == 429


def test_forgot_ignores_unverified_and_inactive(env):
    e = env
    signup(e)
    n = len(e.svc.outbox)
    assert forgot(e).status_code == 202
    assert len(e.svc.outbox) == n  # unverified: no reset code
    verify(e, last_code(e))
    e.sql("update users set active=false where email='ann@example.com'")
    forgot(e)
    assert len(e.svc.outbox) == n  # deactivated: none either


def test_new_tenant_is_isolated_and_unverified_owner_not_counted(env):
    e = env
    made(e)
    row = e.sql("select id, tenant_id from users where email='ann@example.com'")[0]
    signup(e, email="pending@example.com", business_name="Pending Co")
    h = {"Authorization": "Bearer " + login(e, "ann@example.com").json()["token"]}
    assert e.c.get("/api/tracker", headers=h).json() == {"received": [], "sent": []}
    assert e.c.get("/api/cost-items", headers=h).json() == []
    assert [u["id"] for u in e.c.get("/api/users", headers=h).json()] == [str(row["id"])]
    assert e.sql("select count(*) n from users where tenant_id=%s and role='owner' and active", (row["tenant_id"],))[0]["n"] == 1
    assert e.c.post(f"/api/users/{row['id']}", json={"active": False}, headers=h).status_code == 409  # last owner


def test_email_unique_globally_case_insensitive(env):
    e = env
    signup(e)
    with pytest.raises(psycopg.errors.UniqueViolation):
        e.sql("insert into users(tenant_id, name, role, email) select tenant_id, 'x', 'staff', 'ANN@example.com' from users where email='ann@example.com'")


def test_apply_schema_twice(env):
    db.apply_schema(seed=True)
    db.apply_schema(seed=True)
    assert env.sql("select count(*) n from tenant_fields")[0]["n"] > 0


# ---------------------------------------------------------------- mailer
def test_mailer_never_raises_and_never_logs_token(monkeypatch, caplog):
    monkeypatch.setenv("MAILTRAP_API_TOKEN", "SECRET-TOKEN-123")
    seen = {}

    def boom(url, **kw):
        seen["url"], seen["headers"] = url, kw["headers"]
        raise httpx.ConnectError("could not reach " + url + " with SECRET-TOKEN-123 for bob@x.com")
    monkeypatch.setattr(httpx, "post", boom)
    with caplog.at_level(logging.DEBUG):
        assert mailer.send("bob@x.com", "s", "t") is False
    assert seen["url"] == mailer.LIVE and seen["headers"]["Authorization"] == "Bearer SECRET-TOKEN-123"
    assert "SECRET-TOKEN-123" not in caplog.text and "bob@x.com" not in caplog.text
    monkeypatch.setattr(httpx, "post", lambda url, **kw: httpx.Response(401, text="bob@x.com SECRET-TOKEN-123"))
    with caplog.at_level(logging.DEBUG):
        assert mailer.send("bob@x.com", "s", "t", "<p>h</p>", "cat") is False
    assert "SECRET-TOKEN-123" not in caplog.text and "bob@x.com" not in caplog.text


def test_mailer_sandbox_url_payload_and_off(monkeypatch, caplog):
    got = {}
    monkeypatch.setattr(httpx, "post", lambda url, **kw: got.update(url=url, json=kw["json"]) or httpx.Response(200, request=httpx.Request("POST", url)))
    monkeypatch.setattr(mailer, "_warned", False)
    with caplog.at_level(logging.WARNING, logger="laris"):
        assert mailer.send("a@x.com", "s", "t") is False and mailer.send("a@x.com", "s", "t") is False
    assert caplog.text.count("email is off") == 1 and not got  # logged once, no request
    monkeypatch.setenv("MAILTRAP_API_TOKEN", "t")
    monkeypatch.setenv("MAILTRAP_INBOX_ID", "42")
    monkeypatch.setenv("MAILTRAP_SENDER_EMAIL", "from@x.com")
    assert mailer.send("a@x.com", "subj", "text", "<p>h</p>", "cat") is True
    assert got["url"] == mailer.SANDBOX + "/42"
    assert got["json"]["to"] == [{"email": "a@x.com"}] and got["json"]["from"]["email"] == "from@x.com" and got["json"]["category"] == "cat"


def test_mail_templates_escape_html():
    _, text, html = mailer.verification_mail("123456", "<script>x</script>")
    assert "123456" in text and "<script>" not in html and "&lt;script&gt;" in html
