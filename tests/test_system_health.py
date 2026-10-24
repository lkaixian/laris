"""GET /api/system/health: owner-only, fixed shape, one item per problem, never a secret value."""
import pytest

from src import health, scheduler
from support.fixtures import env, pg_url  # noqa: F401

SECRETS = {"MAILTRAP_API_TOKEN": "sekret-mail-tok", "SECRET_KEY": "sekret-signing-key", "WHATSAPP_TOKEN": "sekret-wa-tok",
           "TELEGRAM_BOT_TOKEN": "sekret-tg-tok", "RUNPOD_API_KEY": "sekret-runpod", "RUNPOD_VISION_URL": "https://sekret.example/v1",
           "APP_PUBLIC_URL": "https://sekret-shop.example", "ILMU_API_KEY": "sekret-ilmu"}


def get(e, headers=None):
    return e.c.get("/api/system/health", headers=headers or e.O)


def codes(e):
    return {i["code"] for i in get(e).json()["items"]}


def test_owner_shape_and_ordering(env, monkeypatch):
    for k in ("MAILTRAP_API_TOKEN", "SECRET_KEY", "SCHEDULER"):
        monkeypatch.delenv(k, raising=False)
    r = get(env)
    assert r.status_code == 200
    j = r.json()
    assert set(j) == {"level", "items"} and j["items"]
    for i in j["items"]:
        assert set(i) == {"level", "code", "message", "fix"} and i["level"] in ("info", "warn", "critical") and i["message"] and i["fix"]
    ranks = [health.RANK[i["level"]] for i in j["items"]]
    assert ranks == sorted(ranks, reverse=True) and j["level"] == j["items"][0]["level"]
    assert {"email_off", "scheduler_off", "secret_key_unset", "demo_mode"} <= {i["code"] for i in j["items"]}


def test_non_owner_refused(env):
    assert get(env, env.S).status_code == 403
    assert env.c.get("/api/system/health", headers={}).status_code == env.c.get("/api/system/scheduler", headers={}).status_code


def test_codes_follow_env(env, monkeypatch):
    monkeypatch.delenv("MAILTRAP_API_TOKEN", raising=False)
    monkeypatch.delenv("MAILTRAP_INBOX_ID", raising=False)
    monkeypatch.delenv("SCHEDULER", raising=False)
    monkeypatch.delenv("REPL_DEPLOYMENT", raising=False)
    monkeypatch.delenv("REPLIT_DEPLOYMENT", raising=False)
    c = codes(env)
    assert "email_off" in c and "scheduler_off" in c and "email_sandbox" not in c and "proxy_not_trusted" not in c
    monkeypatch.setenv("MAILTRAP_API_TOKEN", "x")
    monkeypatch.setenv("MAILTRAP_INBOX_ID", "123")
    monkeypatch.setenv("SCHEDULER", "1")
    c = codes(env)
    assert "email_off" not in c and "scheduler_off" not in c and "email_sandbox" in c
    monkeypatch.setenv("REPL_DEPLOYMENT", "1")
    monkeypatch.delenv("TRUST_PROXY", raising=False)
    monkeypatch.delenv("SECRET_KEY", raising=False)
    j = get(env).json()
    by = {i["code"]: i["level"] for i in j["items"]}
    assert by["proxy_not_trusted"] == "warn" and by["secret_key_unset"] == "critical"


def test_scheduler_failing_and_failed_check_is_skipped(env, monkeypatch):
    monkeypatch.setitem(scheduler.last_run, "errors", 2)
    assert "scheduler_failing" in codes(env)
    monkeypatch.setitem(scheduler.last_run, "errors", 0)
    assert "scheduler_failing" not in codes(env)

    def boom(ctx):
        raise RuntimeError("sekret-in-exception")
    monkeypatch.setattr(health, "CHECKS", (boom, health.email_off))
    monkeypatch.delenv("MAILTRAP_API_TOKEN", raising=False)
    r = get(env)
    assert r.status_code == 200 and [i["code"] for i in r.json()["items"]] == ["email_off"] and "sekret" not in r.text


def test_no_secret_value_in_response(env, monkeypatch, caplog):
    for k, v in SECRETS.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setenv("MAILTRAP_INBOX_ID", "sekret-inbox")
    monkeypatch.setenv("REPL_DEPLOYMENT", "1")
    r = get(env)
    assert r.status_code == 200 and "sekret" not in r.text and "sekret" not in caplog.text
