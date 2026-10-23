"""First sign-in without a shell: BOOTSTRAP_OWNER_* secrets set the first owner's password once."""
import pytest

from src import auth, db
from support.fixtures import env, pg_url  # noqa: F401


def run(e):
    with db.tx("owner", "bootstrap") as c:
        return db.bootstrap_owner(c)


def test_bootstrap_owner_once(env, monkeypatch):
    e = env
    e.sql("update users set username=null, password_hash=null")  # the seed has no passwords
    assert run(e) == "off"  # nothing configured, nothing changes
    monkeypatch.setenv("BOOTSTRAP_OWNER_USERNAME", "boss")
    monkeypatch.setenv("BOOTSTRAP_OWNER_PASSWORD", "short")
    assert run(e).startswith("refused")
    monkeypatch.setenv("BOOTSTRAP_OWNER_PASSWORD", "correct horse 1")
    assert "boss" in run(e)
    row = e.sql("select username, role from users where username='boss'")
    assert len(row) == 1 and row[0]["role"] == "owner"
    assert run(e).startswith("skipped")  # a password exists now: the secrets do nothing more
    monkeypatch.setenv("BOOTSTRAP_OWNER_USERNAME", "other")
    assert run(e).startswith("skipped")
    assert e.sql("select count(*) n from users where password_hash is not null")[0]["n"] == 1


def test_bootstrap_refuses_common_password(env, monkeypatch):
    e = env
    e.sql("update users set username=null, password_hash=null")
    monkeypatch.setenv("BOOTSTRAP_OWNER_USERNAME", "boss")
    monkeypatch.setenv("BOOTSTRAP_OWNER_PASSWORD", "password1234")
    assert run(e).startswith("refused")
    assert e.sql("select count(*) n from users where password_hash is not null")[0]["n"] == 0


def test_login_works_after_bootstrap(env, monkeypatch):
    e = env
    e.sql("update users set username=null, password_hash=null")
    monkeypatch.setenv("BOOTSTRAP_OWNER_USERNAME", "boss")
    monkeypatch.setenv("BOOTSTRAP_OWNER_PASSWORD", "correct horse 1")
    run(e)
    r = e.c.post("/api/login", json={"username": "boss", "password": "correct horse 1"})
    assert r.status_code == 200
    assert e.c.get("/api/me", headers={"X-Role": "owner"}).status_code == 401  # demo mode is closed now
