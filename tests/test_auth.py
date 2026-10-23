"""Credential lifecycle: token expiry and revocation, login throttling, scrypt upgrade, password rules, own sessions."""
import hashlib
import importlib.util
import pathlib

import pytest

from src import auth
from support.fixtures import env, pg_url  # noqa: F401

PW = "correct horse 1"


@pytest.fixture(autouse=True)
def fresh_throttle():
    auth._ACCT.clear()
    auth._IPS.clear()


def bearer(t):
    return {"Authorization": "Bearer " + t}


def account(e, who, username, pw=PW):
    e.sql("update users set username=%s, password_hash=%s where id=%s", (username, auth.hash_password(pw), who))


def login(e, username, pw=PW, **h):
    return e.c.post("/api/login", json={"username": username, "password": pw}, headers=h)


def tok(e, username, pw=PW):
    r = login(e, username, pw)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def give_token(e, who, name="api-tok", expires="now() + interval '1 day'"):
    e.sql(f"update users set token_sha256=%s, token_expires_at={expires} where id=%s", (auth.token_hash(name), who))
    return bearer(name)


def state(e, who):
    return e.sql("select token_sha256 is not null t, (select count(*) from sessions where user_id=users.id) s from users where id=%s", (who,))[0]


# ---------------------------------------------------------------- 1. token expiry and revocation
def test_expired_token_is_401_like_unknown(env):
    e = env
    H = give_token(e, e.owner, expires="now() - interval '1 second'")
    bad = e.c.get("/api/me", headers=H)
    unknown = e.c.get("/api/me", headers=bearer("nope"))
    assert bad.status_code == unknown.status_code == 401 and bad.json() == unknown.json()
    assert give_token(e, e.owner) and e.c.get("/api/me", headers=H).status_code == 200
    e.sql("update users set token_expires_at=null where id=%s", (e.owner,))  # legacy / hand-set: no expiry
    assert e.c.get("/api/me", headers=H).status_code == 200


@pytest.mark.parametrize("change", [{"role": "owner"}, {"active": False}, {"password": "a brand new phrase 9"}])
def test_owner_edit_kills_token_and_sessions(env, change):
    e = env
    account(e, e.owner, "boss")
    account(e, e.staff, "aisyah")
    O = bearer(tok(e, "boss"))
    give_token(e, e.staff)
    tok(e, "aisyah")
    tok(e, "aisyah")
    assert state(e, e.staff) == {"t": True, "s": 2}
    assert e.c.post(f"/api/users/{e.staff}", json=change, headers=O).status_code == 200
    assert state(e, e.staff) == {"t": False, "s": 0}
    assert e.c.get("/api/me", headers=bearer("api-tok")).status_code == 401


def test_change_password_kills_token_and_other_sessions_only(env):
    e = env
    account(e, e.staff, "aisyah")
    give_token(e, e.staff)
    keep, other = tok(e, "aisyah"), tok(e, "aisyah")
    r = e.c.post("/api/me/password", json={"current": PW, "new": "fresh phrase 7777"}, headers=bearer(keep))
    assert r.status_code == 200
    assert e.c.get("/api/me", headers=bearer(keep)).status_code == 200
    assert e.c.get("/api/me", headers=bearer(other)).status_code == 401
    assert e.c.get("/api/me", headers=bearer("api-tok")).status_code == 401
    assert state(e, e.staff)["t"] is False


def script():
    spec = importlib.util.spec_from_file_location("create_token", pathlib.Path(__file__).resolve().parent.parent / "scripts" / "create_token.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_create_token_script(env, monkeypatch, capsys):
    e, ct = env, script()
    account(e, e.staff, "aisyah")
    name = e.sql("select name from users where id=%s", (e.staff,))[0]["name"]
    ct.main(["issue", e.staff])
    out = capsys.readouterr().out
    assert "Expires" in out
    days = e.sql("select round(extract(epoch from token_expires_at - now()) / 86400)::int d from users where id=%s", (e.staff,))[0]["d"]
    assert days == 90
    ct.main(["issue", e.staff, "--days", "7"])
    assert e.sql("select round(extract(epoch from token_expires_at - now()) / 86400)::int d from users where id=%s", (e.staff,))[0]["d"] == 7
    tok(e, "aisyah")
    assert state(e, e.staff) == {"t": True, "s": 1}
    ct.main(["revoke", name])
    assert state(e, e.staff) == {"t": False, "s": 0}
    # account never silently re-activates
    e.sql("update users set active=false where id=%s", (e.staff,))
    monkeypatch.setattr(ct.getpass, "getpass", lambda _: "new account pw 1")
    with pytest.raises(SystemExit) as x:
        ct.main(["account", e.staff, "aisyah2"])
    assert "deactivated" in str(x.value)
    assert e.sql("select active, username from users where id=%s", (e.staff,))[0] == {"active": False, "username": "aisyah"}
    ct.main(["account", e.staff, "aisyah2", "--reactivate"])
    assert e.sql("select active, username from users where id=%s", (e.staff,))[0] == {"active": True, "username": "aisyah2"}
    monkeypatch.setattr(ct.getpass, "getpass", lambda _: "password123")
    with pytest.raises(SystemExit):
        ct.main(["account", e.staff, "aisyah2"])


# ---------------------------------------------------------------- 2. throttling
def test_lock_doubles_and_lapsed_lock_does_not_relock_on_one_try(env, monkeypatch):
    e, t = env, [1000.0]
    monkeypatch.setattr(auth, "_now", lambda: t[0])
    account(e, e.owner, "boss")
    bad = lambda: login(e, "boss", "wrong").status_code
    assert [bad() for _ in range(5)] == [401] * 5
    assert login(e, "boss").status_code == 429  # locked, even for the right password
    t[0] = 1059
    assert login(e, "boss").status_code == 429
    t[0] = 1061  # 60 s lapsed
    assert bad() == 401  # one try does not re-lock
    assert [bad() for _ in range(3)] == [401] * 3
    assert bad() == 401  # 5th failure since the lapse: second lock, 120 s
    t[0] = 1061 + 119
    assert login(e, "boss").status_code == 429
    t[0] = 1061 + 121
    assert login(e, "boss").status_code == 200  # success resets the level
    assert [bad() for _ in range(5)] == [401] * 5
    t[0] += 61
    assert login(e, "boss").status_code == 200  # back to the 60 s lock


def test_lock_caps_at_15_minutes_and_empty_buckets_are_pruned(monkeypatch):
    t = [1000.0]
    monkeypatch.setattr(auth, "_now", lambda: t[0])
    delays = []
    for _ in range(8):
        for _ in range(auth.LIMIT):
            auth.failed("x", "1.2.3.4")
        delays.append(auth._ACCT["x"][2] - t[0])
        t[0] = auth._ACCT["x"][2] + 1
    assert delays == [60, 120, 240, 480, 900, 900, 900, 900]
    t[0] += auth.WINDOW + 1  # quiet: everything is forgotten
    assert not auth.throttled("x", "1.2.3.4") and not auth._ACCT and not auth._IPS


def test_ip_bucket_spans_usernames_and_uses_last_forwarded_entry_only_when_trusted(env, monkeypatch):
    e = env
    monkeypatch.delenv("TRUST_PROXY", raising=False)
    codes = [login(e, f"ghost{i}", "x", **{"X-Forwarded-For": f"spoof{i}, 10.0.0.1"}).status_code for i in range(31)]
    assert codes == [401] * 30 + [429]  # without TRUST_PROXY the header is ignored: one bucket, spoofing the first entry changes nothing
    assert login(e, "ghost99", "x", **{"X-Forwarded-For": "8.8.8.8"}).status_code == 429
    auth._IPS.clear()
    monkeypatch.setenv("TRUST_PROXY", "1")
    codes = [login(e, f"ghost{i}", "x", **{"X-Forwarded-For": f"spoof{i}, 10.0.0.1"}).status_code for i in range(31)]
    assert codes == [401] * 30 + [429]  # same last entry: same bucket, rotating the first entry does not help
    assert login(e, "ghost99", "x", **{"X-Forwarded-For": "spoof, 8.8.8.8"}).status_code == 401  # another real client is not locked out


def test_password_check_is_throttled_per_user(env):
    e = env
    account(e, e.staff, "aisyah")
    H = bearer(tok(e, "aisyah"))
    ask = lambda cur: e.c.post("/api/me/password", json={"current": cur, "new": "fresh phrase 7777"}, headers=H).status_code
    assert [ask("wrong") for _ in range(5)] == [403] * 5
    assert ask(PW) == 429
    assert login(e, "aisyah").status_code == 200  # login has its own bucket


# ---------------------------------------------------------------- 3. hashing and password rules
def test_old_hash_verifies_and_is_upgraded_on_login(env):
    e = env
    salt = b"s" * 16
    h = hashlib.scrypt(PW.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    old = f"scrypt$16384$8$1${salt.hex()}${h.hex()}"
    assert auth.verify_password(PW, old) and auth.needs_rehash(old) and not auth.needs_rehash(auth.hash_password(PW))
    e.sql("update users set username='boss', password_hash=%s where id=%s", (old, e.owner))
    assert login(e, "boss", "wrong").status_code == 401
    assert e.sql("select password_hash from users where id=%s", (e.owner,))[0]["password_hash"] == old
    assert login(e, "boss").status_code == 200
    new = e.sql("select password_hash from users where id=%s", (e.owner,))[0]["password_hash"]
    assert new.startswith(f"scrypt${auth.N}$") and auth.verify_password(PW, new)
    assert login(e, "boss").status_code == 200


def test_common_and_username_passwords_are_refused(env):
    e = env
    account(e, e.owner, "boss")
    O = bearer(tok(e, "boss"))
    mk = lambda u, p: e.c.post("/api/users", json={"name": "X", "username": u, "role": "staff", "password": p}, headers=O)
    assert mk("someone1", "Password123").json()["error"]["code"] == "weak_password"
    assert mk("longusername1", "LongUsername1").json()["error"]["code"] == "weak_password"
    assert mk("someone1", "a decent phrase 5").status_code == 201
    uid = e.sql("select id from users where username='someone1'")[0]["id"]
    assert e.c.post(f"/api/users/{uid}", json={"password": "qwertyuiop"}, headers=O).status_code == 422
    assert e.c.post("/api/me/password", json={"current": PW, "new": "12345678910"}, headers=O).json()["error"]["code"] == "weak_password"
    assert auth.weak_password("qwerty12345", None) and auth.weak_password("a decent phrase 5", "boss") is None


# ---------------------------------------------------------------- 4. own sessions
def test_session_list_revoke_one_and_others(env):
    e = env
    account(e, e.owner, "boss")
    account(e, e.staff, "aisyah")
    a, b, c = tok(e, "boss"), tok(e, "boss"), tok(e, "aisyah")
    r = e.c.get("/api/me/sessions", headers={**bearer(a), "User-Agent": "pytest-ua"})
    rows = r.json()
    assert len(rows) == 2 and [x["current"] for x in rows].count(True) == 1
    assert set(rows[0]) == {"id", "created_at", "last_seen_at", "user_agent", "current"}
    cur = next(x for x in rows if x["current"])
    assert cur["last_seen_at"] is not None  # stamped by the request above or its predecessors
    other = next(x for x in rows if not x["current"])
    # another user's session (same tenant) and another tenant's session: 404, untouched
    foreign = e.sql("select id from sessions where token_sha256=%s", (auth.token_hash(c),))[0]["id"]
    t2 = e.sql("insert into tenants(name, trade_template, min_margin_pct) select 'Other', trade_template, 10 from tenants limit 1 returning id")[0]["id"]
    u2 = e.sql("insert into users(tenant_id, name, role) values (%s, 'Eve', 'owner') returning id", (t2,))[0]["id"]
    e.sql("insert into sessions(token_sha256, user_id, expires_at) values ('zz', %s, now() + interval '1 hour')", (u2,))
    alien = e.sql("select id from sessions where token_sha256='zz'")[0]["id"]
    for sid in (foreign, alien):
        assert e.c.delete(f"/api/me/sessions/{sid}", headers=bearer(a)).status_code == 404
    assert e.sql("select count(*) n from sessions")[0]["n"] == 4
    # revoke one device
    assert e.c.delete(f"/api/me/sessions/{other['id']}", headers=bearer(a)).status_code == 200
    assert e.c.get("/api/me", headers=bearer(b)).status_code == 401
    b = tok(e, "boss")
    tok(e, "boss")
    out = e.c.post("/api/me/sessions/revoke-others", headers=bearer(a))
    assert out.status_code == 200 and out.json() == {"revoked": 2}
    assert e.c.get("/api/me", headers=bearer(a)).status_code == 200 and e.c.get("/api/me", headers=bearer(b)).status_code == 401
    assert e.c.get("/api/me", headers=bearer(c)).status_code == 200  # someone else's session is untouched


def test_last_seen_is_throttled_and_sessions_are_capped_and_purged(env):
    e = env
    account(e, e.owner, "boss")
    a = tok(e, "boss")
    sid = auth.token_hash(a)
    e.c.get("/api/me", headers=bearer(a))
    first = e.sql("select last_seen_at from sessions where token_sha256=%s", (sid,))[0]["last_seen_at"]
    assert first is not None
    e.c.get("/api/me", headers=bearer(a))
    assert e.sql("select last_seen_at from sessions where token_sha256=%s", (sid,))[0]["last_seen_at"] == first  # at most once a minute
    e.sql("update sessions set last_seen_at = now() - interval '2 minutes' where token_sha256=%s", (sid,))
    e.c.get("/api/me", headers=bearer(a))
    assert e.sql("select last_seen_at > now() - interval '1 minute' ok from sessions where token_sha256=%s", (sid,))[0]["ok"]
    # cap: the 11th login drops the oldest (a); expired sessions are purged on login
    e.sql("insert into sessions(token_sha256, user_id, expires_at) values ('old', %s, now() - interval '1 hour')", (e.owner,))
    for _ in range(auth.MAX_SESSIONS):
        tok(e, "boss")
    n = e.sql("select count(*) n from sessions where user_id=%s", (e.owner,))[0]["n"]
    assert n == auth.MAX_SESSIONS
    assert e.c.get("/api/me", headers=bearer(a)).status_code == 401
    assert e.sql("select count(*) n from sessions where token_sha256='old'")[0]["n"] == 0
