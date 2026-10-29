"""FORCE ROW LEVEL SECURITY: a non-superuser table owner obeys tenant policies; startup check reports bypass."""
import logging

import psycopg
import pytest

from src import db
from src.app import lifespan, app

from support.pg import pg_url  # noqa: F401


@pytest.fixture
def owner_url(pg_url):
    """Schema created and seeded by a plain (non-superuser, no BYPASSRLS) owner, as on a one-URL deploy with a safe user."""
    with psycopg.connect(pg_url, autocommit=True) as c:
        c.execute("do $$ begin if not exists (select 1 from pg_roles where rolname='laris_owner_t') then "
                  "create role laris_owner_t login password 'x' nosuperuser nobypassrls; end if; end $$")
        c.execute("drop schema public cascade; create schema public authorization laris_owner_t")
        c.execute("grant all on schema public to laris_owner_t")
    yield pg_url
    with psycopg.connect(pg_url, autocommit=True) as c:
        c.execute("reset role")  # PGlite shares one session across connections; do not leak the role


def test_owner_obeys_rls_and_apply_schema_twice(owner_url, monkeypatch):
    real = psycopg.connect

    def as_owner(*a, **k):  # PGlite ignores the login user, so become the owner role after connecting
        c = real(*a, **k)
        c.execute("set role laris_owner_t")
        return c
    monkeypatch.setattr(psycopg, "connect", as_owner)
    monkeypatch.setenv("DATABASE_URL", owner_url)
    monkeypatch.delenv("DATABASE_URL_OWNER", raising=False)
    db.apply_schema(seed=True)
    db.apply_schema(seed=True)
    with db.tx(tenant=db.ALL_TENANTS) as c:
        assert c.execute("select count(*) n from tenants").fetchone()["n"] == 1
        assert c.execute("select count(*) n from tenant_fields").fetchone()["n"] > 0
        a = c.execute("select id from tenants").fetchone()["id"]
        c.execute("insert into tenants(name,trade_template,min_margin_pct) values ('B','made_to_order',20)")
        b = c.execute("select id from tenants where name='B'").fetchone()["id"]
        c.execute("insert into parties(tenant_id,role,name) values (%s,'customer','B cust')", (b,))
    n = lambda t, q="": t.execute(f"select count(*) n from parties {q}").fetchone()["n"]  # noqa: E731
    with db.tx(tenant=str(a)) as c:
        assert n(c, "where name='B cust'") == 0 and n(c) > 0
    with db.tx(tenant=str(b)) as c:
        assert n(c) == 1
    with db.tx(tenant="") as c:
        assert n(c) == 0
    with db.tx(tenant="*") as c:
        assert n(c, "where name='B cust'") == 1
        assert db.rls_status(c) == (False, True)  # owner: no bypass, but owns audit_log


def test_rls_status_superuser(pg_url):
    with psycopg.connect(pg_url) as c:
        bypass, _ = db.rls_status(c)
    assert bypass is True  # PGlite/default postgres user is a superuser


class Fake:
    def __init__(self, row): self.row = row
    def execute(self, q): return self
    def fetchone(self): return self.row


def test_check_rls_warns_and_require_raises(monkeypatch, caplog):
    monkeypatch.delenv("REQUIRE_RLS", raising=False)
    with caplog.at_level(logging.WARNING, logger="laris"):
        db.check_rls(Fake((True, True)))
    assert "tenant isolation OFF" in caplog.text and "owns audit_log" in caplog.text
    caplog.clear()
    db.check_rls(Fake((False, False)))
    assert caplog.text == ""
    monkeypatch.setenv("REQUIRE_RLS", "1")
    db.check_rls(Fake((False, False)))
    with pytest.raises(RuntimeError, match="tenant isolation OFF"):
        db.check_rls(Fake((True, False)))


def test_lifespan_refuses_when_required(pg_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", pg_url)
    monkeypatch.setenv("REQUIRE_RLS", "1")
    monkeypatch.delenv("SCHEDULER", raising=False)
    monkeypatch.setattr(db, "apply_schema", lambda: None)

    async def go():
        async with lifespan(app):
            pass
    import asyncio
    with pytest.raises(RuntimeError):
        asyncio.run(go())
