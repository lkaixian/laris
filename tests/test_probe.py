"""GET /api/system/health?live=1: the outside services are called only when asked, only when configured, and nothing secret comes back."""
import httpx
import pytest

from src import probe
from support.fixtures import env, pg_url  # noqa: F401
from test_mcp import mcp_key, opt_in, staff_role_id

SECRETS = {"TELEGRAM_BOT_TOKEN": "sekret-tg", "LARIS_HELPER_BOT_TOKEN": "sekret-helper", "LARIS_HELPER_WEBHOOK_SECRET": "sekret-hook",
           "WHATSAPP_TOKEN": "sekret-wa", "WHATSAPP_PHONE_NUMBER_ID": "99887766", "ILMU_API_KEY": "sekret-ilmu",
           "RUNPOD_API_KEY": "sekret-rp", "RUNPOD_VISION_URL": "https://sekret-pod.example/v1", "MAILTRAP_API_TOKEN": "sekret-mt"}
NAMES = ("TELEGRAM_BOT_TOKEN", "LARIS_HELPER_BOT_TOKEN", "LARIS_HELPER_WEBHOOK_SECRET", "WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "ILMU_API_KEY",
         "RUNPOD_API_KEY", "RUNPOD_VISION_URL", "MAILTRAP_API_TOKEN", "MAILTRAP_INBOX_ID")


@pytest.fixture
def calls(monkeypatch):
    """Replaces the HTTP client; `answer(request)` can be changed per test. Every request the probes make is recorded."""
    class Seen(list):
        pass
    seen = Seen()
    state = {"answer": lambda r: httpx.Response(200, json={"result": {"url": "https://hook.example"}})}

    def handler(r):
        seen.append(r)
        return state["answer"](r)
    monkeypatch.setattr(probe, "client", lambda: httpx.Client(transport=httpx.MockTransport(handler), timeout=4))
    probe._CACHE.clear()
    for n in NAMES:
        monkeypatch.delenv(n, raising=False)
    seen.state = state
    return seen


def live(e, force=False, headers=None):
    return e.c.get("/api/system/health", params={"live": 1, **({"force": 1} if force else {})}, headers=headers or e.O)


def svc(e, **kw):
    r = live(e, **kw)
    assert r.status_code == 200, r.text
    return {s["key"]: s for s in r.json()["services"]}, r


def test_everything_answers(env, calls, monkeypatch):
    for k, v in SECRETS.items():
        monkeypatch.setenv(k, v)
    calls.state["answer"] = lambda r: httpx.Response(422 if r.method == "POST" else 200, json={"result": {"url": "https://hook.example"}})
    sv, r = svc(env)
    for k in ("telegram", "telegram_helper", "whatsapp", "ilmu", "vision", "email"):
        assert sv[k]["state"] == "ok" and "why" not in sv[k] and isinstance(sv[k]["ms"], int), (k, sv[k])
    assert r.json()["checked_at"]
    hosts = {x.url.host for x in calls}
    assert hosts == {"api.telegram.org", "graph.facebook.com", "api.ilmu.ai", "sekret-pod.example", "send.api.mailtrap.io"}
    assert all(x.method == "GET" for x in calls if x.url.host != "send.api.mailtrap.io")
    mail = [x for x in calls if x.url.host == "send.api.mailtrap.io"]
    assert [x.content for x in mail] == [b"{}"]  # an empty body: it cannot deliver an email


def test_rejected_key_timeout_and_missing_webhook(env, calls, monkeypatch):
    for k, v in SECRETS.items():
        monkeypatch.setenv(k, v)

    def answer(r):
        if r.url.host == "api.ilmu.ai":
            return httpx.Response(401)
        if r.url.host == "graph.facebook.com":
            raise httpx.ConnectTimeout("slow")
        if r.url.host == "sekret-pod.example":
            raise httpx.ConnectError("refused")
        if r.url.host == "send.api.mailtrap.io":
            return httpx.Response(503)
        if r.url.path.endswith("getWebhookInfo"):
            return httpx.Response(200, json={"result": {"url": ""}})
        return httpx.Response(200, json={"result": {}})
    calls.state["answer"] = answer
    sv, _ = svc(env)
    assert (sv["ilmu"]["state"], sv["ilmu"]["why"]) == ("down", "key_rejected")
    assert (sv["whatsapp"]["state"], sv["whatsapp"]["why"]) == ("down", "timeout")
    assert (sv["vision"]["state"], sv["vision"]["why"]) == ("down", "unreachable")
    assert (sv["email"]["state"], sv["email"]["why"]) == ("down", "http_error")
    assert (sv["telegram"]["state"], sv["telegram"]["why"]) == ("down", "webhook_missing")


def test_not_configured_is_not_called(env, calls):
    sv, _ = svc(env)
    assert not calls
    assert all(sv[k]["state"] == "off" for k in ("telegram", "whatsapp", "ilmu", "vision", "email", "rag", "mcp"))


def test_nothing_secret_comes_back(env, calls, monkeypatch):
    for k, v in SECRETS.items():
        monkeypatch.setenv(k, v)
    calls.state["answer"] = lambda r: (_ for _ in ()).throw(httpx.ConnectError(f"cannot reach {r.url}"))
    r = live(env)
    assert r.status_code == 200 and "sekret" not in r.text and "telegram.org" not in r.text and "99887766" not in r.text
    assert "http" not in str(r.json()["services"])
    assert all(s.get("why") in (None, *probe.WHY) for s in r.json()["services"])


def test_owner_only_and_plain_health_makes_no_call(env, calls, monkeypatch):
    monkeypatch.setenv("ILMU_API_KEY", "sekret-ilmu")
    assert live(env, headers=env.S).status_code == 403
    r = env.c.get("/api/system/health", headers=env.O)
    assert r.status_code == 200 and "checked_at" not in r.json() and not calls
    assert {s["key"]: s["state"] for s in r.json()["services"]}["ilmu"] == "set"


def test_cache_and_force(env, calls, monkeypatch):
    monkeypatch.setenv("ILMU_API_KEY", "sekret-ilmu")
    svc(env)
    assert len(calls) == 1
    svc(env)
    svc(env, force=True)  # inside 10 s: the cached answer
    assert len(calls) == 1
    t, out, at = probe._CACHE[next(iter(probe._CACHE))]
    probe._CACHE[next(iter(probe._CACHE))] = (t - 15, out, at)
    svc(env)  # 15 s old: a plain live call still uses the 30 s cache
    assert len(calls) == 1
    svc(env, force=True)  # 15 s old: a forced check runs again
    assert len(calls) == 2


def test_rag_and_mcp(env, calls):
    e = env
    sv, _ = svc(e)
    assert sv["rag"]["state"] == "off" and sv["mcp"]["state"] == "off"
    opt_in(e)
    mcp_key(e, str(staff_role_id(e)))
    probe._CACHE.clear()
    sv, _ = svc(e)
    assert sv["rag"]["state"] == "ok" and sv["mcp"]["state"] == "ok" and not calls  # local checks: no network
    e.c.post("/api/settings/ai", json={"mode": "off"}, headers=e.O)
    probe._CACHE.clear()
    sv, _ = svc(e)
    assert sv["rag"]["state"] == "off" and (sv["mcp"]["state"], sv["mcp"]["why"]) == ("warn", "no_consent")
