"""Invite a person to a business by emailed link: owner endpoints, public preview / accept, isolation, throttles. Mail goes to the outbox fake."""
import re

import pytest

from src import auth, clock, db
from src import license as lic
from src.api import deps
from support.fixtures import env, pg_url  # noqa: F401
from test_license import KEY, PUB, Net, activate, token, verified_owner

PW = "correct horse 1"
INVALID = {"code": "invite_invalid", "message": "This invitation is no longer valid"}


@pytest.fixture(autouse=True)
def fresh(monkeypatch, tmp_path):
    auth._ACCT.clear()
    auth._IPS.clear()
    monkeypatch.delenv("APP_PUBLIC_URL", raising=False)
    monkeypatch.delenv("MAILTRAP_API_TOKEN", raising=False)
    monkeypatch.delenv("LICENSE_PUBLIC_KEY", raising=False)
    monkeypatch.setattr(lic, "KEYFILE", tmp_path / "none.key")
    clock.reset()
    lic.invalidate()
    yield
    clock.reset()
    lic.invalidate()


def bearer(e, uid):
    """Real session for a user: once somebody has a password, header-only demo mode is off."""
    with db.tx("owner") as c:
        return {"Authorization": "Bearer " + auth.new_session(c, uid)[0]}


@pytest.fixture
def O(env):
    return bearer(env, env.owner)


def invite(e, O, email="Bob@Example.com", **kw):
    return e.c.post("/api/invites", json={"email": email, **({"role": "staff"} if not kw else kw)}, headers=O)


def tok(e):
    return re.search(r"#/invite\?token=([A-Za-z0-9_-]+)", e.svc.outbox[-1][2]).group(1)


def preview(e, t):
    return e.c.post("/api/invites/preview", json={"token": t})


def accept(e, t, username="bob", name="Bob Tan", password=PW):
    return e.c.post("/api/invites/accept", json={"token": t, "name": name, "username": username, "password": password})


def listing(e, O):
    return e.c.get("/api/invites", headers=O).json()


def pending(e):
    return e.sql("select count(*) n from invites where status='pending'")[0]["n"]


def test_create_invite_mails_a_link_and_stores_only_the_hash(env, O):
    e = env
    e.sql("update tenants set display_name='<b>Acme</b> Print'")
    r = invite(e, O)
    assert r.status_code == 201
    j = r.json()
    assert set(j) == {"id", "email", "role_key", "role_name", "status", "created_at", "expires_at"}
    assert (j["email"], j["role_key"], j["role_name"], j["status"]) == ("bob@example.com", "staff", "Staff", "pending")
    to, subject, text, html, cat = e.svc.outbox[0]
    t = tok(e)
    assert to == "bob@example.com" and cat == "invite" and len(t) >= 43 and "http://testserver/#/invite?token=" + t in text
    assert "&lt;b&gt;Acme&lt;/b&gt; Print" in html and "<b>" not in html and "<b>Acme</b> Print" in subject
    assert "Staff" in text and "invited you" in text
    row = e.sql("select * from invites")[0]
    assert row["token_sha256"] == auth.token_hash(t) and t not in str(dict(row))
    assert e.sql("select expires_at - created_at between interval '6 days 23 hours' and interval '7 days 1 hour' ok from invites")[0]["ok"]
    assert not any(t in str(x) for x in e.sql("select * from audit_log"))


def test_link_uses_app_public_url_not_the_host_header(env, O, monkeypatch):
    e = env
    monkeypatch.setenv("APP_PUBLIC_URL", "https://laris.example.com/")
    assert e.c.post("/api/invites", json={"email": "a@example.com", "role": "staff"}, headers={**O, "Host": "evil.test"}).status_code == 201
    assert "https://laris.example.com/#/invite?token=" in e.svc.outbox[-1][2] and "evil.test" not in e.svc.outbox[-1][2]


def test_without_app_public_url_only_a_plain_host_builds_the_link(env, O):
    e = env
    assert e.c.post("/api/invites", json={"email": "a@example.com", "role": "staff"}, headers={**O, "Host": "laris.example.com:8443"}).status_code == 201
    assert "http://laris.example.com:8443/#/invite?token=" in e.svc.outbox[-1][2]
    for bad in ("evil.test/x", "user@evil.test", "evil.test#", "a b"):
        r = e.c.post("/api/invites", json={"email": "b@example.com", "role": "staff"}, headers={**O, "Host": bad})
        assert r.status_code == 409 and r.json()["error"]["code"] == "public_url_missing", bad
    assert len(e.svc.outbox) == 1 and e.sql("select count(*) n from invites where email='b@example.com'")[0]["n"] == 0  # nothing half-created


def test_role_by_id_custom_role_and_validation(env, O):
    e = env
    rid = str(e.sql("insert into roles(tenant_id,key,name,class,permissions) select id,'packer','Packer','staff','{}' from tenants returning id")[0]["id"])
    assert invite(e, O, email="a@example.com", role_id=rid).json()["role_name"] == "Packer"
    assert invite(e, O, email="b@example.com", role="owner").json()["role_key"] == "owner"  # an owner-class role may be invited: the owner decides
    assert invite(e, O, email="c@example.com", role="staff", role_id=rid).status_code == 422  # exactly one
    assert e.c.post("/api/invites", json={"email": "c@example.com"}, headers=O).status_code == 422
    assert invite(e, O, email="c@example.com", role="nope").json()["error"]["code"] == "unknown_role"
    assert invite(e, O, email="c@example.com", role_id="00000000-0000-0000-0000-000000000000").status_code == 422
    for bad in ("nope", "a@b", "a b@x.com", "x" * 250 + "@x.com"):
        assert invite(e, O, email=bad).status_code == 422, bad
    assert pending(e) == 2


def test_staff_cannot_invite_list_resend_or_revoke(env, O):
    e = env
    S = bearer(e, e.staff)
    iid = invite(e, O).json()["id"]
    assert invite(e, S).status_code == 403
    assert e.c.get("/api/invites", headers=S).status_code == 403
    assert e.c.post(f"/api/invites/{iid}/resend", headers=S).status_code == 403
    assert e.c.delete(f"/api/invites/{iid}", headers=S).status_code == 403
    assert pending(e) == 1


def test_already_member_in_this_business_only(env, O):
    e = env
    e.sql("update users set email='Staff@Example.com' where id=%s", (e.staff,))
    r = invite(e, O, email="STAFF@example.com")
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_member"
    assert pending(e) == 0 and not e.svc.outbox
    # the same address in ANOTHER business is fine
    other = e.sql("insert into tenants(name,trade_template,min_margin_pct) values ('Other Shop','made_to_order',20) returning id")[0]["id"]
    e.sql("insert into users(tenant_id,name,role,email) values (%s,'Other','owner','bob@example.com')", (other,))
    assert invite(e, O).status_code == 201


def test_new_invite_replaces_the_pending_one(env, O):
    e = env
    first = invite(e, O).json()["id"]
    t1 = tok(e)
    second = invite(e, O, email="bob@example.com", role="owner").json()
    t2 = tok(e)
    assert t1 != t2 and second["id"] != first and second["role_key"] == "owner"
    assert preview(e, t1).status_code == 404 and preview(e, t2).status_code == 200
    assert pending(e) == 1 and e.sql("select status from invites where id=%s", (first,))[0]["status"] == "revoked"
    assert [x["status"] for x in listing(e, O)] == ["pending", "revoked"]  # newest first


def test_resend_kills_the_old_token_and_is_throttled(env, O):
    e = env
    iid = invite(e, O).json()["id"]
    t1 = tok(e)
    e.sql("update invites set expires_at = now() + interval '1 hour'")
    r = e.c.post(f"/api/invites/{iid}/resend", headers=O)
    assert r.status_code == 200 and set(r.json()) == {"id", "email", "role_key", "role_name", "status", "created_at", "expires_at"}
    t2 = tok(e)
    assert len(e.svc.outbox) == 2 and t1 != t2
    assert preview(e, t1).status_code == 404 and preview(e, t2).status_code == 200
    assert e.sql("select expires_at > now() + interval '6 days' ok from invites")[0]["ok"]
    assert e.c.post(f"/api/invites/{iid}/resend", headers=O).status_code == 200
    assert e.c.post(f"/api/invites/{iid}/resend", headers=O).status_code == 200
    r = e.c.post(f"/api/invites/{iid}/resend", headers=O)
    assert r.status_code == 429 and len(e.svc.outbox) == 4  # 3 per hour per invite (the first send is not a resend)
    e.c.delete(f"/api/invites/{iid}", headers=O)
    deps.HITS.clear()
    assert e.c.post(f"/api/invites/{iid}/resend", headers=O).status_code == 409  # revoked
    assert e.c.post("/api/invites/00000000-0000-0000-0000-000000000000/resend", headers=O).status_code == 404


def test_resend_revives_an_expired_invite(env, O):
    e = env
    iid = invite(e, O).json()["id"]
    t1 = tok(e)
    e.sql("update invites set expires_at = now() - interval '1 second'")
    assert listing(e, O)[0]["status"] == "expired"
    assert e.c.post(f"/api/invites/{iid}/resend", headers=O).json()["status"] == "pending"
    assert preview(e, t1).status_code == 404 and preview(e, tok(e)).status_code == 200


def test_revoke(env, O):
    e = env
    iid = invite(e, O).json()["id"]
    t = tok(e)
    assert e.c.delete(f"/api/invites/{iid}", headers=O).json() == {"ok": True}
    assert preview(e, t).status_code == 404 and accept(e, t).status_code == 404
    assert listing(e, O)[0]["status"] == "revoked"
    assert e.c.delete(f"/api/invites/{iid}", headers=O).status_code == 409
    assert e.c.delete("/api/invites/00000000-0000-0000-0000-000000000000", headers=O).status_code == 404
    assert invite(e, O).status_code == 201  # the address can be invited again


def test_preview_and_accept_happy_path_with_a_custom_role(env, O):
    e = env
    e.sql("update tenants set display_name='Acme Print'")
    rid = str(e.sql("insert into roles(tenant_id,key,name,class,permissions) select id,'packer','Packer','staff','{view_costs}' from tenants returning id")[0]["id"])
    invite(e, O, role_id=rid)
    t = tok(e)
    p = preview(e, t)
    assert p.status_code == 200 and p.json() == {"business_name": "Acme Print", "role_name": "Packer", "email": "bob@example.com"}
    r = accept(e, t)
    assert r.status_code == 201 and r.json() == {"ok": True}  # no auto-login: no token
    u = e.sql("select tenant_id, name, role, role_id, active, email, email_verified_at, password_hash from users where username='bob'")[0]
    assert (u["name"], u["role"], str(u["role_id"]), u["active"], u["email"]) == ("Bob Tan", "staff", rid, True, "bob@example.com")
    assert u["email_verified_at"] is not None and PW not in u["password_hash"]
    assert str(u["tenant_id"]) == str(e.sql("select tenant_id from users where id=%s", (e.owner,))[0]["tenant_id"])
    for who in ("bob", "bob@example.com", "BOB@example.com"):
        lg = e.c.post("/api/login", json={"username": who, "password": PW})
        assert lg.status_code == 200 and lg.json()["user"]["role"] == "staff", who
    me = e.c.get("/api/me", headers={"Authorization": "Bearer " + lg.json()["token"]}).json()
    assert me["org"]["name"] == "Acme Print"
    j = listing(e, O)[0]
    assert j["status"] == "accepted" and j["role_key"] == "packer" and j["invited_by_name"]
    assert preview(e, t).status_code == 404 and accept(e, t, username="bob2").status_code == 404  # used
    ev = [x["event"] for x in e.sql("select event from audit_log where actor=%s", (str(e.sql("select id from users where username='bob'")[0]["id"]),))]
    assert any("created via invite" in x for x in ev) and not any(t in x or PW in x for x in ev)


def test_owner_role_invite_makes_an_owner(env, O):
    e = env
    invite(e, O, role="owner")
    assert accept(e, tok(e)).status_code == 201
    assert e.sql("select role from users where username='bob'")[0]["role"] == "owner"


def test_expired_used_unknown_and_tampered_tokens_are_one_uniform_404(env, O):
    e = env
    invite(e, O)
    t = tok(e)
    invite(e, O, email="c@example.com")
    t_used = tok(e)
    assert accept(e, t_used, username="carl").status_code == 201
    e.sql("update invites set expires_at = now() - interval '1 second' where email='bob@example.com'")
    tampered = t[:-1] + ("A" if t[-1] != "A" else "B")
    seen = []
    for bad in (t, t_used, tampered, "nope", "x" * 200, t.upper()):
        for res in (preview(e, bad), accept(e, bad, username="zed")):
            assert res.status_code == 404 and res.json()["error"] == {**INVALID, "request_id": res.json()["error"]["request_id"]}, bad
            seen.append({k: v for k, v in res.json()["error"].items() if k != "request_id"})
    assert all(x == seen[0] for x in seen)
    assert preview(e, "x" * 201).status_code == 422 and e.c.post("/api/invites/preview", json={}).status_code == 422
    assert e.sql("select count(*) n from users where username='zed'")[0]["n"] == 0


def test_seat_limit_at_create_and_at_accept(env, O, monkeypatch):
    e = env
    net = Net().adopt(monkeypatch)
    monkeypatch.setenv("LICENSE_PUBLIC_KEY", PUB)
    verified_owner(e)
    used = e.sql("select count(*) n from users where active")[0]["n"]
    assert activate(e, token(seats=used + 1), O).status_code == 200
    assert invite(e, O).status_code == 201  # one seat is free
    t = tok(e)
    e.sql("insert into users(tenant_id,name,role) select tenant_id,'filler','staff' from users limit 1")  # somebody takes it meanwhile
    lic.invalidate()
    r = accept(e, t)
    assert r.status_code == 409 and r.json()["error"]["code"] == "seat_limit"
    assert e.sql("select status from invites")[0]["status"] == "pending"  # rolled back: the invite is still usable
    assert e.sql("select count(*) n from users where username='bob'")[0]["n"] == 0
    r = invite(e, O, email="d@example.com")
    assert r.status_code == 409 and r.json()["error"]["code"] == "seat_limit"
    e.sql("update users set active=false where name='filler'")
    assert accept(e, t).status_code == 201
    assert net


def test_accept_takes_the_tenant_row_lock(env, O, monkeypatch):
    """PGlite has one connection, so real concurrent accepts are untested; this proves the lock statement runs on the accept path."""
    e = env
    seen = []
    real = db.tx

    from contextlib import contextmanager

    @contextmanager
    def spy(*a, **k):
        with real(*a, **k) as c:
            ex = c.execute
            c.execute = lambda q, *p, **kw: (seen.append(q), ex(q, *p, **kw))[1]
            yield c
    monkeypatch.setattr(db, "tx", spy)
    invite(e, O)
    assert accept(e, tok(e)).status_code == 201
    assert any("from tenants where id=%s for update" in str(q) for q in seen)


def test_username_taken_weak_password_and_email_taken_keep_the_invite_usable(env, O):
    e = env
    invite(e, O)
    t = tok(e)
    e.sql("update users set username='bob' where id=%s", (e.staff,))
    r = accept(e, t)
    assert r.status_code == 409 and r.json()["error"]["code"] == "username_taken" and pending(e) == 1
    r = accept(e, t, username="bobby", password="password1234")
    assert r.status_code == 422 and r.json()["error"]["code"] == "weak_password" and pending(e) == 1
    assert accept(e, t, username="bobby", password="bobby").status_code == 422  # too short
    # the address got an account in this business after the invite went out
    invite(e, O, email="late@example.com")
    t2 = tok(e)
    e.sql("insert into users(tenant_id,name,role,email) select tenant_id,'late','staff','LATE@example.com' from users limit 1")
    r = accept(e, t2, username="late1")
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_member"
    assert e.sql("select status from invites where email='late@example.com'")[0]["status"] == "pending"
    for bad in ({"username": "a b"}, {"username": "ab"}, {"name": ""}, {"name": "x" * 81}):
        assert accept(e, t2, **{"username": "okname", **bad}).status_code == 422


def test_password_equal_to_username_is_weak(env, O):
    e = env
    invite(e, O)
    assert accept(e, tok(e), username="bobbybobby", password="bobbybobby").json()["error"]["code"] == "weak_password"


def test_same_email_may_belong_to_several_businesses(env, O):
    e = env
    other = e.sql("insert into tenants(name,trade_template,min_margin_pct) values ('Other Shop','made_to_order',20) returning id")[0]["id"]
    e.sql("insert into users(tenant_id,name,role,email,email_verified_at,username,password_hash,active) values (%s,'Bob','owner','bob@example.com',now(),'bobother',%s,true)",
          (other, auth.hash_password("another pass 77")))
    invite(e, O)
    assert accept(e, tok(e)).status_code == 201
    assert e.sql("select count(*) n from users where email='bob@example.com'")[0]["n"] == 2
    r = e.c.post("/api/login", json={"username": "bob@example.com", "password": PW})
    assert r.status_code == 200  # only the invited account has this password


def test_cross_tenant_isolation(env, O):
    e = env
    iid = invite(e, O).json()["id"]
    t = tok(e)
    other = e.sql("insert into tenants(name,trade_template,min_margin_pct) values ('Other Shop','made_to_order',20) returning id")[0]["id"]
    ou = e.sql("insert into users(tenant_id,name,role) values (%s,'Other Owner','owner') returning id", (other,))[0]["id"]
    B = bearer(e, ou)
    assert e.c.get("/api/invites", headers=B).json() == []
    assert e.c.delete(f"/api/invites/{iid}", headers=B).status_code == 404
    assert e.c.post(f"/api/invites/{iid}/resend", headers=B).status_code == 404
    assert pending(e) == 1 and preview(e, t).status_code == 200
    assert invite(e, B).status_code == 201  # same address, other business: its own invite
    assert [x["email"] for x in listing(e, O)] == ["bob@example.com"]
    assert accept(e, t).status_code == 201
    assert e.sql("select tenant_id from users where username='bob'")[0]["tenant_id"] != other


def test_throttles(env, O):
    e = env
    for i in range(20):
        assert invite(e, O, email=f"u{i}@example.com").status_code == 201
    r = invite(e, O, email="over@example.com")
    assert r.status_code == 429 and r.json()["error"]["code"] == "slow_down"
    deps.HITS.clear()
    for _ in range(30):
        assert preview(e, "nope").status_code == 404
    assert preview(e, "nope").status_code == 429
    deps.HITS.clear()
    for _ in range(20):
        assert accept(e, "nope").status_code == 404
    assert accept(e, "nope").status_code == 429


def test_two_accepts_of_one_token_create_one_user(env, O):
    e = env
    invite(e, O)
    t = tok(e)
    # the conditional update is what makes this atomic; Postgres lets only one of two concurrent runs of it return a row (simulated sequentially)
    sql = "update invites set status='accepted' where token_sha256=%s and status='pending' and expires_at > now() returning id"
    assert len(e.sql(sql, (auth.token_hash(t),))) == 1 and e.sql(sql, (auth.token_hash(t),)) == []
    e.sql("update invites set status='pending'")
    assert accept(e, t).status_code == 201
    assert accept(e, t, username="bob2").status_code == 404
    assert e.sql("select count(*) n from users where lower(email)='bob@example.com'")[0]["n"] == 1
    assert e.sql("select count(*) n from invites where accepted_user_id is not null")[0]["n"] == 1


def test_list_is_capped_at_100_newest_first(env, O):
    e = env
    e.sql("""insert into invites(tenant_id,email,role_id,token_sha256,created_at)
             select u.tenant_id, 'm' || g || '@example.com', u.role_id, 'h' || g, now() - g * interval '1 minute'
             from generate_series(1, 105) g, (select tenant_id, role_id from users limit 1) u""")
    j = listing(e, O)
    assert len(j) == 100 and j[0]["email"] == "m1@example.com"


def test_apply_schema_twice_and_rls_is_forced(env):
    db.apply_schema(seed=True)
    db.apply_schema(seed=True)
    assert env.sql("select relrowsecurity r, relforcerowsecurity f from pg_class where relname='invites'")[0] == {"r": True, "f": True}
    assert env.sql("select count(*) n from pg_indexes where indexname='invites_pending_uq'")[0]["n"] == 1
