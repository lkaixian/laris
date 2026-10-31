"""LARIS_APP_PASSWORD: apply_schema creates laris_app from the one URL and the app switches to it (never on a failure)."""
import psycopg
import pytest

from src import db
from support.pg import pg_url  # noqa: F401


def test_app_role_url_keeps_host_and_escapes_password():
    u = db.app_role_url("postgresql://owner:old@db.example:5433/app?sslmode=require", "p@ss/w:rd")
    assert u == "postgresql://laris_app:p%40ss%2Fw%3Ard@db.example:5433/app?sslmode=require"
    with pytest.raises(ValueError):
        db.app_role_url("host=x dbname=y", "pw")


def test_one_url_switches_to_laris_app(pg_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", pg_url)
    monkeypatch.delenv("DATABASE_URL_OWNER", raising=False)
    monkeypatch.setenv("LARIS_APP_PASSWORD", "app-pw-1")
    db.apply_schema(seed=True)
    import os
    assert os.environ["DATABASE_URL_OWNER"] == pg_url
    assert os.environ["DATABASE_URL"] == db.app_role_url(pg_url, "app-pw-1")
    with psycopg.connect(pg_url) as c:
        assert c.execute("select rolcanlogin, rolsuper from pg_roles where rolname='laris_app'").fetchone() == (True, False)
    db.apply_schema(seed=True)  # second start in the same process: owner URL is already set, nothing breaks


def test_failure_keeps_owner_url(pg_url, monkeypatch, caplog):
    monkeypatch.setenv("DATABASE_URL", pg_url)
    monkeypatch.delenv("DATABASE_URL_OWNER", raising=False)
    monkeypatch.setenv("LARIS_APP_PASSWORD", "app-pw-2")
    real = db.app_role_url
    monkeypatch.setattr(db, "app_role_url", lambda *a: (_ for _ in ()).throw(ValueError("boom")))
    db.apply_schema(seed=True)
    monkeypatch.setattr(db, "app_role_url", real)
    import os
    assert os.environ["DATABASE_URL"] == pg_url and "DATABASE_URL_OWNER" not in os.environ
    assert "staying on the owner login" in caplog.text and "app-pw-2" not in caplog.text
