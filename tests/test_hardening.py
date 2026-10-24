"""Step 112: isolation / proxy startup rules, the header-mode rule, all-or-nothing schema install, no transaction held while the vision model runs,
and a durable trace for an inbound message we could not process."""
import asyncio
import logging
import shutil

import psycopg
import pytest

from src import auth, db
from src.app import app, lifespan
from support.fixtures import env, pg_url  # noqa: F401
from test_listings import lenv, photo, up  # noqa: F401
from test_rfq import tg_in, tg_setup
from test_webhook_tenancy import _catalog


# ---------------------------------------------------------------- A1 check_rls
class Fake:
    def __init__(self, row, tenants=1): self.row, self.tenants, self.last = row, tenants, None
    def execute(self, q): self.last = q; return self
    def fetchone(self): return (self.tenants,) if "tenants" in self.last else self.row


def test_check_rls_bypass_refuses_on_a_deployment_or_with_many_tenants(monkeypatch, caplog):
    for k in ("REQUIRE_RLS", "REPL_DEPLOYMENT", "ALLOW_RLS_BYPASS"):
        monkeypatch.delenv(k, raising=False)
    with caplog.at_level(logging.WARNING, logger="laris"):
        db.check_rls(Fake((True, False)))  # one tenant, not a deployment: the old warning only
    assert "tenant isolation OFF" in caplog.text
    with pytest.raises(RuntimeError, match="ALLOW_RLS_BYPASS=1"):
        db.check_rls(Fake((True, False), tenants=2))
    monkeypatch.setenv("REPL_DEPLOYMENT", "1")
    with pytest.raises(RuntimeError, match="tenant isolation OFF"):
        db.check_rls(Fake((True, False)))
    db.check_rls(Fake((False, False), tenants=5))  # a safe role is never refused
    caplog.clear()
    monkeypatch.setenv("ALLOW_RLS_BYPASS", "1")
    with caplog.at_level(logging.ERROR, logger="laris"):
        db.check_rls(Fake((True, False), tenants=2))
    assert "ALLOW_RLS_BYPASS=1" in caplog.text
    monkeypatch.setenv("REQUIRE_RLS", "1")  # REQUIRE_RLS still wins over the opt-out
    with pytest.raises(RuntimeError, match="REQUIRE_RLS=1"):
        db.check_rls(Fake((True, False)))


# ---------------------------------------------------------------- A2 startup warnings
@pytest.mark.parametrize("dep,proxy", [("1", None), (None, None), ("1", "1")])
def test_startup_warns_once_about_proxy_and_scheduler(monkeypatch, caplog, dep, proxy):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("SCHEDULER", raising=False)
    for k, v in (("REPL_DEPLOYMENT", dep), ("TRUST_PROXY", proxy)):
        monkeypatch.delenv(k, raising=False) if v is None else monkeypatch.setenv(k, v)

    async def go():
        async with lifespan(app):
            pass
    with caplog.at_level(logging.WARNING, logger="laris"):
        asyncio.run(go())
    assert caplog.text.count("TRUST_PROXY is not 1") == (dep == "1" and proxy is None)
    assert caplog.text.count("follow-ups, expiry, retention and job reminders will not run") == 1


# ---------------------------------------------------------------- A3 header mode
class NoUsers:
    def execute(self, q): return self
    def fetchone(self): return None


@pytest.mark.parametrize("url,extra,expect", [
    ("postgresql://u:p@127.0.0.1:5432/x", {}, True), ("postgresql://u@localhost/x", {}, True), ("postgresql://u@[::1]/x", {}, True),
    ("postgresql:///x?host=/var/run/postgresql", {}, True),
    ("postgresql://u:p@db.internal:5432/x", {}, False),  # a remote database: header mode needs DEMO_MODE=1
    ("postgresql://u@localhost/x", {"APP_TOKEN": "t"}, False), ("postgresql://u@localhost/x", {"REPL_DEPLOYMENT": "1"}, False),
    ("postgresql://u:p@db.internal/x", {"DEMO_MODE": "1"}, True)])
def test_header_mode_only_when_clearly_local_or_demo(monkeypatch, url, extra, expect):
    for k in ("DEMO_MODE", "APP_TOKEN", "REPL_DEPLOYMENT", "REQUIRE_USER_TOKEN"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("DATABASE_URL", url)
    for k, v in extra.items():
        monkeypatch.setenv(k, v)
    assert auth.header_mode_allowed(NoUsers()) is expect


# ---------------------------------------------------------------- C4 schema install is all or nothing
def test_broken_transitions_leaves_nothing_and_the_next_start_installs(pg_url, monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", pg_url)
    monkeypatch.delenv("DATABASE_URL_OWNER", raising=False)
    with psycopg.connect(pg_url, autocommit=True) as c:
        c.execute("drop schema public cascade; create schema public")
    bad = tmp_path / "db"
    shutil.copytree(db.DB_DIR, bad)
    (bad / "transitions.sql").write_text("select 1;\nthis is not sql;\n", encoding="utf-8")
    good = db.DB_DIR
    monkeypatch.setattr(db, "DB_DIR", bad)
    with pytest.raises(RuntimeError, match=r"applying transitions\.sql failed: syntax error"):
        db.apply_schema(seed=False)
    with psycopg.connect(pg_url, autocommit=True) as c:
        assert c.execute("select to_regclass('public.tenants')").fetchone()[0] is None  # schema.sql was rolled back with it
        assert c.execute("select pg_try_advisory_lock(%s)", (db.SCHEMA_LOCK,)).fetchone()[0]  # and the lock was released
        c.execute("select pg_advisory_unlock(%s)", (db.SCHEMA_LOCK,))
    monkeypatch.setattr(db, "DB_DIR", good)
    db.apply_schema(seed=False)
    with psycopg.connect(pg_url, autocommit=True) as c:
        assert c.execute("select to_regclass('public.tenants')").fetchone()[0]
        assert c.execute("select 1 from pg_proc where proname='promote_document'").fetchone()


# ---------------------------------------------------------------- C2 the model runs with no transaction open
@pytest.fixture
def watch(monkeypatch):
    """Records every connection psycopg opens; the returned function lists their transaction status right now (open ones only)."""
    conns, real = [], psycopg.connect

    def spy(*a, **k):
        conns.append(real(*a, **k))
        return conns[-1]
    monkeypatch.setattr(psycopg, "connect", spy)
    return lambda: [c.info.transaction_status for c in conns if not c.closed]


def _spy_describe(monkeypatch, watch, seen):
    from src import vision
    real = vision.describe_listing

    def describe(*a, **k):
        seen.append(watch())
        return real(*a, **k)
    monkeypatch.setattr(vision, "describe_listing", describe)


def test_upload_holds_no_transaction_while_the_model_runs(lenv, monkeypatch, watch):
    seen = []
    _spy_describe(monkeypatch, watch, seen)
    r = up(lenv)
    assert r.status_code == 201 and len(r.json()["items"]) == 2
    assert len(seen) == 1 and all(s == psycopg.pq.TransactionStatus.IDLE for s in seen[0]), seen
    assert lenv.sql("select count(*) n from listings")[0]["n"] == 1


def test_chat_catalog_holds_no_transaction_while_the_model_runs(lenv, monkeypatch, watch):
    seen = []
    _spy_describe(monkeypatch, watch, seen)
    assert _catalog(lenv, monkeypatch, photo()).status_code == 200
    assert len(seen) == 1 and all(s == psycopg.pq.TransactionStatus.IDLE for s in seen[0]), seen
    assert lenv.sql("select count(*) n from listings")[0]["n"] == 1 and "queued for review" in lenv.svc.sent[-1][2]


def test_catalog_vision_failure_is_sorry_and_traced(lenv, monkeypatch):
    lenv.vis.answers, lenv.vis.calls = [500], 0
    assert _catalog(lenv, monkeypatch, photo()).status_code == 200
    assert "could not process" in lenv.svc.sent[-1][2] and lenv.sql("select count(*) n from listings")[0]["n"] == 0
    assert lenv.sql("select count(*) n from audit_log where event = 'inbound failed: vision_unavailable' and actor = 'system:webhook'")[0]["n"] == 1


# ---------------------------------------------------------------- C1 a failed inbound message leaves a trace
def test_failed_inbound_leaves_audit_row_and_the_raw_message(env, monkeypatch):
    e = env
    tg_setup(e, monkeypatch)
    e.ai.fail = True  # the model is down: the enquiry cannot be processed
    before = e.sql("select count(*) n from messages")[0]["n"]
    assert tg_in(e, "need 10 secret parts", chat=9876, mid=41).status_code == 200
    assert "could not process" in e.svc.sent[-1][2]  # the customer reply is unchanged
    rows = e.sql("select actor, entity, event, before, after from audit_log where event like 'inbound failed:%%'")
    assert len(rows) == 1 and rows[0]["actor"] == "system:webhook" and rows[0]["entity"] == "messages"
    assert "secret" not in str(rows[0]) and "9876" not in str(rows[0])  # no text, no number
    assert e.sql("select count(*) n from messages where body like '%%secret parts%%'")[0]["n"] == 1
    assert e.sql("select count(*) n from messages")[0]["n"] == before + 1


def test_replit_sets_replit_deployment_so_both_names_count(monkeypatch):
    # Replit documents REPLIT_DEPLOYMENT; REPL_DEPLOYMENT is accepted too. Either must trip the deployment checks.
    for k in ("REQUIRE_RLS", "REPL_DEPLOYMENT", "REPLIT_DEPLOYMENT", "ALLOW_RLS_BYPASS", "DEMO_MODE", "APP_TOKEN", "REQUIRE_USER_TOKEN"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u@localhost/x")
    assert auth._local()  # sanity: local before the variable appears
    monkeypatch.setenv("REPLIT_DEPLOYMENT", "1")
    assert not auth._local()
    with pytest.raises(RuntimeError, match="tenant isolation OFF"):
        db.check_rls(Fake((True, False)))
