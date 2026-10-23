"""Step 102: one error envelope, request ids, logging, central handlers."""
import importlib
import logging
import os

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src import app as app_mod
from src import logsetup
from src import db
from src.app import SPA, app
from support.fixtures import env, pg_url  # noqa: F401

SEC = ("x-content-type-options", "x-frame-options", "content-security-policy", "referrer-policy")


def boom(exc):
    def f(*a, **k):
        raise exc
    return f


def test_500_is_json_with_ids_and_security_headers(env, monkeypatch, caplog):
    monkeypatch.setattr(db, "tx", boom(RuntimeError("secret detail /tmp/x.py")))  # any route that opens the DB
    c = TestClient(app, raise_server_exceptions=False)
    r = c.get("/api/me?token=hunter2", headers={**env.O, "X-Request-Id": "abc12345"})
    j = r.json()["error"]
    assert r.status_code == 500 and j["code"] == "internal" and j["request_id"] == "abc12345" == r.headers["x-request-id"]
    assert all(h in r.headers for h in SEC)
    assert "secret detail" not in r.text and "Traceback" not in r.text
    assert "hunter2" not in caplog.text and "GET /api/me" in caplog.text


def test_request_id_echo_and_replace():
    c = TestClient(app)
    assert c.get("/health", headers={"X-Request-Id": "good-id.1234"}).headers["x-request-id"] == "good-id.1234"
    for bad in ("short", "has space in it!", "x" * 65):
        got = c.get("/health", headers={"X-Request-Id": bad}).headers["x-request-id"]
        assert got != bad and len(got) == 12
    r = c.get("/nope-404")  # Starlette's own error also carries it
    assert "x-request-id" in r.headers
    assert c.post("/api/enquiries/simulate", content=iter([b"{}"])).headers["x-request-id"]  # the 411 early return


def test_integrity_error_is_409_without_names(env, monkeypatch):
    err = psycopg.errors.UniqueViolation("duplicate key value violates unique constraint \"uq_secret_name\"")
    monkeypatch.setattr(db, "tx", boom(err))
    r = TestClient(app).get("/api/me", headers=env.O)
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict" and "uq_secret_name" not in r.text


@pytest.mark.parametrize("exc", [psycopg.OperationalError("host db.internal refused"), psycopg.InterfaceError("closed")])
def test_db_down_is_503(env, monkeypatch, exc):
    monkeypatch.setattr(db, "tx", boom(exc))
    r = TestClient(app).get("/api/me", headers=env.O)
    assert r.status_code == 503 and r.json()["error"]["code"] == "db_unavailable" and "db.internal" not in r.text
    assert "x-request-id" in r.headers and "x-frame-options" in r.headers


def test_validation_shape(env):
    r = env.c.post("/api/enquiries/simulate", json={"channel": "web"}, headers=env.S)
    e = r.json()["error"]
    assert r.status_code == 422 and e["code"] == "invalid_request" and e["request_id"]
    assert e["fields"][0]["field"] == "text" and not e["message"].startswith("body") and e["message"].startswith("text: ")
    assert "body." not in r.text


def test_unknown_routes_json_404_and_405(tmp_path):
    (tmp_path / "index.html").write_text("<html>app</html>")
    a = FastAPI()
    for exc, h in app.exception_handlers.items():
        a.add_exception_handler(exc, h)

    @a.get("/api/only-get")
    def only_get():
        return {}

    a.mount("/", SPA(directory=tmp_path, html=True))
    c = TestClient(a)
    for m in ("get", "post", "put", "delete"):
        r = getattr(c, m)("/api/nope")
        assert r.status_code == 404 and r.json()["error"]["code"] == "not_found", m
    assert c.post("/webhooks/nope").json()["error"]["code"] == "not_found"
    r = c.post("/api/only-get")
    assert r.status_code == 405 and r.json()["error"]["code"] == "http_error"
    assert c.get("/some/page").text == "<html>app</html>"
    assert TestClient(app).post("/api/nope", content=b"{}").json()["error"]["code"] == "not_found"  # the real app


def test_access_log_masks_webhook_secret():
    rec = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                            ("1.2.3.4:5", "GET", "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=SEKRET&hub.challenge=7", "1.1", 200), None)
    assert logsetup.MaskWebhookQuery().filter(rec)
    assert "SEKRET" not in rec.getMessage() and "hub.verify_token=***" in rec.getMessage() and "hub.challenge=7" in rec.getMessage()
    other = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s "%s %s" %d', ("c", "GET", "/api/x?token=1", 200), None)
    logsetup.MaskWebhookQuery().filter(other)
    assert "token=1" in other.getMessage()


def test_log_format_has_request_id():
    h = logging.Handler()
    h.addFilter(logsetup.RequestIdFilter())
    seen = []
    h.emit = lambda r: seen.append(logging.Formatter(logsetup.FORMAT).format(r))
    lg = logging.getLogger("laris.t")
    lg.addHandler(h)
    try:
        lg.warning("outside")
        tok = logsetup.request_id.set("rid-123456")
        lg.warning("inside")
        logsetup.request_id.reset(tok)
    finally:
        lg.removeHandler(h)
    assert "[-] outside" in seen[0] and "[rid-123456] inside" in seen[1]


def test_logging_setup_idempotent():
    root = logging.getLogger()
    snap = lambda: (len(root.handlers), [len(x.filters) for x in root.handlers], len(logging.getLogger("uvicorn.access").filters))
    importlib.reload(app_mod)
    before = snap()
    importlib.reload(app_mod)
    importlib.reload(app_mod)
    assert snap() == before


def test_ready_reasons(env, monkeypatch, caplog):
    c = TestClient(app)
    assert c.get("/ready").json() == {"status": "ready"}
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@127.0.0.1:1/none")
    monkeypatch.setattr(app_mod.db, "tx", boom(psycopg.OperationalError("refused")))
    r = c.get("/ready")
    assert r.status_code == 503 and r.json() == {"status": "not_ready", "reason": "db_unreachable"}
    monkeypatch.delenv("DATABASE_URL")
    assert c.get("/ready").json()["reason"] == "db_url_missing"
    assert "not ready: db_url_missing" in caplog.text


def test_ready_schema_missing(env):
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as c:
        c.execute("alter table tenants rename to tenants_x")
    try:
        r = TestClient(app).get("/ready")
        assert r.status_code == 503 and r.json()["reason"] == "schema_missing"
    finally:
        with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as c:
            c.execute("alter table tenants_x rename to tenants")
