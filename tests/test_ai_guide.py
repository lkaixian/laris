"""Optional AI guide: default off, consent, the owner's own server (SSRF-safe client), candidate-only links, redaction, gating of the
Assistant. The provider is faked (httpx MockTransport): no network."""
import json
import logging
import socket

import httpx
import pytest

from src.api import ai_guide
from support.fixtures import env, pg_url  # noqa: F401
from test_public_api import other_tenant_owner
from test_roles import member, role

URL = "https://ai.example.com/v1"
CAND = [{"id": "quotes", "label": "Quotes", "path": "Sales > Quotes", "href": "#/tracker"},
        {"id": "jobs", "label": "Job board", "path": "Work > Jobs", "href": "#/jobs"}]
HOSTS = {"ai.example.com": "93.184.216.34", "evil.example.com": "10.0.0.5", "mixed.example.com": ["93.184.216.34", "192.168.1.9"]}
real_gai = socket.getaddrinfo


class Provider:
    def __init__(self):
        self.calls, self.reply, self.status = [], {"answer": "Open Quotes.", "ids": ["quotes"]}, 200

    def __call__(self, req: httpx.Request):
        self.calls.append(req)
        if self.status != 200:
            return httpx.Response(self.status, headers={"Location": "http://10.0.0.1/"}, text="no")
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(self.reply)}}]})


@pytest.fixture
def p(env, monkeypatch):
    ai_guide._HITS.clear()
    monkeypatch.setenv("SECRET_KEY", "k" * 40)

    def gai(host, port, *a, **k):
        if host in HOSTS:
            ips = HOSTS[host] if isinstance(HOSTS[host], list) else [HOSTS[host]]
            return [(2, 1, 6, "", (ip, port)) for ip in ips]
        return real_gai(host, port, *a, **k)
    monkeypatch.setattr(socket, "getaddrinfo", gai)
    prov = Provider()
    env.svc.ai_http = httpx.Client(transport=httpx.MockTransport(prov))
    prov.e = env
    return prov


def save(e, mode="guide", who=None, accept=True, **kw):
    return e.c.post("/api/settings/ai", json={"mode": mode, "accept_disclosure": accept, **kw}, headers=who or e.O)


def custom(url=URL, key="sk-secret-123456"):
    return {"provider": "custom", "custom": {"base_url": url, "model": "m1", **({"api_key": key} if key else {})}}


def ask(e, q="where are my quotes", who=None, cands=CAND):
    return e.c.post("/api/assistant/guide", json={"question": q, "candidates": cands}, headers=who or e.O)


def test_default_off_and_legacy_assistant(env, p):
    e = env
    assert ask(e).json()["error"]["code"] == "ai_off" and ask(e).status_code == 403
    v = e.c.get("/api/settings/ai", headers=e.O).json()
    assert v["mode"] == "off" and v["legacy_assistant"] is True and v["available"] == {"ilmu": True}
    assert v["disclosure"]["version"] == 1 and v["custom"] == {"base_url": None, "model": None, "has_key": False}
    assert e.c.post("/api/assistant", json={"message": "jobs?"}, headers=e.O).status_code == 200  # legacy
    assert "ai_not_reviewed" in [i["code"] for i in e.c.get("/api/system/health", headers=e.O).json()["items"]]
    save(e, "off")
    assert "ai_not_reviewed" not in [i["code"] for i in e.c.get("/api/system/health", headers=e.O).json()["items"]]


def test_disclosure_required_then_consent_logged(env, p):
    e = env
    r = save(e, accept=False)
    assert r.status_code == 422 and r.json()["error"]["code"] == "disclosure_required"
    assert e.sql("select count(*) n from tenant_ai")[0]["n"] == 0
    v = save(e).json()
    assert v["mode"] == "guide" and v["legacy_assistant"] is False and v["consent"]["version"] == 1 and v["consent"]["at"] and v["consent"]["by"]
    assert save(e, "guide_data", accept=False).status_code == 200  # same provider: no new disclosure
    assert save(e, "off", accept=False).status_code == 200  # off never needs it
    assert save(e, "guide", accept=False).json()["error"]["code"] == "disclosure_required"  # on again
    log = e.sql("select action, mode, provider, host, disclosure_version from ai_consent_log order by at")
    assert [(x["action"], x["mode"]) for x in log] == [("enable", "guide"), ("change", "guide_data"), ("disable", "off")]
    assert all(x["provider"] == "ilmu" and x["host"] is None for x in log) and e.sql("select count(*) n from audit_log where entity='tenant_ai'")[0]["n"] == 3


def test_consent_log_is_append_only(env, p):
    e = env
    save(e)
    for q in ("update ai_consent_log set mode='off'", "delete from ai_consent_log"):
        with pytest.raises(Exception, match="append-only"):
            e.sql(q)
    assert e.sql("select count(*) n from ai_consent_log")[0]["n"] == 1


def test_off_to_on_with_provider_change_needs_disclosure_and_logs_host_only(env, p):
    e = env
    assert save(e, **custom()).status_code == 200
    assert save(e, "guide", accept=False).status_code == 200  # nothing changed
    assert save(e, "guide", accept=False, provider="ilmu").json()["error"]["code"] == "disclosure_required"  # provider change while on
    assert save(e, "guide", **custom("https://other.example.com/v1", key=None)).json()["error"]["code"] == "bad_url"  # (unresolvable here)
    log = e.sql("select host from ai_consent_log where provider='custom'")
    assert log == [{"host": "ai.example.com"}] * 2  # the save and the unchanged re-save
    blob = json.dumps(e.sql("select before, after from audit_log where entity='tenant_ai'"), default=str)
    assert "/v1" not in blob and "ai.example.com" in blob


def test_key_encrypted_at_rest_never_returned_and_kept_on_update(env, p):
    e = env
    r = save(e, **custom())
    assert r.status_code == 200 and r.json()["custom"] == {"base_url": URL, "model": "m1", "has_key": True}
    row = e.sql("select custom_key_enc from tenant_ai")[0]["custom_key_enc"]
    assert "sk-secret-123456" not in row and row.startswith("gAAAA")
    assert "sk-secret-123456" not in e.c.get("/api/settings/ai", headers=e.O).text + r.text
    assert save(e, custom=None, provider="custom").json()["custom"]["has_key"] is True  # key omitted: kept
    assert e.sql("select custom_key_enc from tenant_ai")[0]["custom_key_enc"] == row
    assert save(e, **custom(key=None)).json()["custom"]["has_key"] is True
    assert save(e, provider="ilmu").json()["custom"] == {"base_url": None, "model": None, "has_key": False}  # leaving custom wipes the key
    assert e.sql("select custom_key_enc from tenant_ai")[0]["custom_key_enc"] is None
    assert save(e, **custom(key=None)).json()["error"]["code"] == "custom_incomplete"


def test_secret_key_unset_refuses_custom(env, p, monkeypatch):
    e = env
    monkeypatch.delenv("SECRET_KEY")
    r = save(e, **custom())
    assert r.status_code == 422 and r.json()["error"]["code"] == "secret_key_unset"
    assert e.sql("select count(*) n from tenant_ai")[0]["n"] == 0
    assert save(e).status_code == 200  # hosted ILMU needs no stored key


@pytest.mark.parametrize("url", [
    "http://ai.example.com/v1", "https://user:pw@ai.example.com/v1", "https://ai.example.com@10.0.0.1/v1", "https://ai.example.com:22/v1",
    "https://ai.example.com:80/v1", "https://localhost/v1", "https://127.0.0.1/v1", "https://10.1.2.3/v1", "https://192.168.0.10/v1",
    "https://172.16.5.5/v1", "https://169.254.169.254/latest", "https://[::1]/v1", "https://[fd00::1]/v1", "https://[fe80::1]/v1",
    "https://[::ffff:127.0.0.1]/v1", "https://0.0.0.0/v1", "https://224.0.0.1/v1", "https://2130706433/v1", "https://evil.example.com/v1",
    "https://mixed.example.com/v1", "https://ai.example.com/v1?x=1", "https://ai.example.com\\@10.0.0.1/", "ftp://ai.example.com", "https://",
    "https://[64:ff9b::7f00:1]/v1"])
def test_ssrf_urls_refused_at_save_and_never_call(env, p, url):
    e = env
    r = save(e, "guide", provider="custom", custom={"base_url": url, "model": "m", "api_key": "sk-secret-123456"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "bad_url"
    with pytest.raises(ai_guide.AiError):
        ai_guide.check_url(url)
    assert e.sql("select count(*) n from tenant_ai")[0]["n"] == 0 and not p.calls


def test_every_call_rechecks_dns_and_the_connection_is_pinned(env, p):
    e = env
    save(e, **custom())
    assert ask(e).status_code == 200
    req = p.calls[-1]
    assert req.url.host == "93.184.216.34" and req.headers["host"] == "ai.example.com" and req.extensions["sni_hostname"] == "ai.example.com"
    assert str(req.url) == "https://93.184.216.34/v1/chat/completions" and req.headers["authorization"] == "Bearer sk-secret-123456"
    body = json.loads(req.content)
    assert body["max_tokens"] == 200 and body["temperature"] == 0 and body["model"] == "m1" and len(req.content) < 8192
    HOSTS["ai.example.com"] = "10.9.9.9"  # rebinding after save
    try:
        r = ask(e)
    finally:
        HOSTS["ai.example.com"] = "93.184.216.34"
    assert r.status_code == 503 and r.json()["error"]["code"] == "ai_unavailable" and len(p.calls) == 1


def test_redirect_is_not_followed_and_reply_is_capped(env, p):
    e = env
    save(e, **custom())
    p.status = 302
    r = e.c.post("/api/settings/ai/test", headers=e.O)
    assert r.json()["ok"] is False and len(p.calls) == 1 and "10.0.0.1" not in r.text and "no" != r.json()["message"]
    big = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(200, content=b"x" * 70_000)))
    with pytest.raises(ai_guide.AiError):
        ai_guide.chat(URL, "m", "k", [], big)
    for bad in (httpx.Response(200, text="not json"), httpx.Response(200, json={"choices": []}), httpx.Response(200, json={"choices": [{"message": {"content": 5}}]})):
        with pytest.raises(ai_guide.AiError):
            ai_guide.chat(URL, "m", "k", [], httpx.Client(transport=httpx.MockTransport(lambda req, b=bad: b)))


def test_test_endpoint_messages_and_owner_only(env, p):
    e = env
    assert e.c.post("/api/settings/ai/test", headers=e.S).json()["error"]["code"] == "owner_only"
    assert e.c.post("/api/settings/ai/test", headers=e.O).json()["ok"] is True  # hosted ILMU fake
    save(e, **custom())
    r = e.c.post("/api/settings/ai/test", headers=e.O).json()
    assert r == {"ok": True, "message": "The AI provider answered."} and "OK" in json.dumps(json.loads(p.calls[-1].content)["messages"])
    e.ai.fail = True
    save(e, "guide", provider="ilmu")
    r = e.c.post("/api/settings/ai/test", headers=e.O).json()
    assert r["ok"] is False and "boom" not in r["message"] and "500" not in r["message"]


def test_only_candidate_links_come_back(env, p):
    e = env
    save(e, **custom())
    p.reply = {"answer": "Go to javascript:alert(1) now\n\x00" + "x" * 500, "ids": ["jobs", "evil", "jobs", 5, "quotes", "../admin"], "href": "javascript:alert(1)"}
    r = ask(e).json()
    assert r["links"] == [{"label": "Job board", "href": "#/jobs"}, {"label": "Quotes", "href": "#/tracker"}] and len(r["answer"]) <= 400 and "\x00" not in r["answer"]
    p.reply = {"answer": 7, "ids": "quotes"}
    r = ask(e).json()
    assert r["links"] == [] and r["answer"]
    bad = [{**CAND[0], "href": "javascript:alert(1)"}]
    assert ask(e, cands=bad).status_code == 422 and ask(e, cands=[]).status_code == 422 and ask(e, cands=CAND * 5).status_code == 422
    assert ask(e, q="x").status_code == 422 and ask(e, q="x" * 301).status_code == 422
    assert "href" not in p.calls[0].content.decode()  # the model never sees hrefs


def test_question_is_redacted_before_it_leaves_and_never_stored_or_logged(env, p, caplog):
    e = env
    caplog.set_level(logging.DEBUG)
    save(e, **custom())
    q = "mail ali@shop.my or call 012-345 6789 or +65 9123 4567 ic 900101-14-5678 acct 123456789012 about unicorns"
    assert ask(e, q).status_code == 200
    sent = p.calls[-1].content.decode()
    for secret in ("ali@shop.my", "345 6789", "9123 4567", "900101", "123456789012"):
        assert secret not in sent
    assert "unicorns" in sent and "[redacted]" in sent
    e.ai.fail = True
    save(e, "guide", accept=True, provider="ilmu")
    assert ask(e, q).status_code == 503
    dump = json.dumps([e.sql(f"select * from {t}") for t in ("usage_events", "audit_log", "ai_consent_log", "tenant_ai", "ai_actions")], default=str)
    assert "unicorns" not in dump + caplog.text and "sk-secret" not in dump + caplog.text
    assert e.sql("select count(*) n from usage_events where kind='guide'")[0]["n"] == 1  # the failed call is not counted


def test_rate_limit_20_per_user_per_minute(env, p):
    e = env
    save(e)
    e.ai.payload = {"answer": "ok", "ids": []}
    assert [ask(e).status_code for _ in range(20)] == [200] * 20
    assert ask(e).status_code == 429
    assert ask(e, who=e.S).status_code == 200  # another user has their own allowance


def test_staff_and_zero_permission_roles_can_use_the_guide_but_not_settings(env, p):
    e = env
    save(e)
    e.ai.payload = {"answer": "ok", "ids": ["jobs"]}
    nothing = member(e, role(e, "Nothing", []))
    for who in (e.S, nothing):
        assert ask(e, who=who).json()["links"] == [{"label": "Job board", "href": "#/jobs"}]
        assert e.c.get("/api/settings/ai", headers=who).json()["error"]["code"] == "owner_only"
        assert save(e, "off", who=who).status_code == 403


def test_tenants_are_isolated(env, p):
    e = env
    other = other_tenant_owner(e)
    save(e, **custom())
    assert ask(e, who=other).json()["error"]["code"] == "ai_off"
    v = e.c.get("/api/settings/ai", headers=other).json()
    assert v["mode"] == "off" and v["custom"]["has_key"] is False and v["legacy_assistant"] is True
    assert save(e, "guide", who=other).status_code == 200
    assert e.c.get("/api/settings/ai", headers=e.O).json()["provider"] == "custom"


def test_assistant_gating_and_custom_provider(env, p):
    e = env
    ask_a = lambda: e.c.post("/api/assistant", json={"message": "how are the jobs"}, headers=e.O)  # noqa: E731
    save(e)  # guide only
    r = ask_a()
    assert r.status_code == 403 and r.json()["error"] == {**r.json()["error"], "code": "ai_off", "message": "The Assistant is switched off in AI settings."}
    save(e, "off")
    assert ask_a().status_code == 403
    save(e, "guide_data")
    e.ai.payload = {"intent": "jobs"}
    assert ask_a().json()["source"] == "model" and e.ai.calls == 1
    save(e, "guide_data", **custom())
    p.reply = {"intent": "jobs", "query": None}
    r = ask_a().json()
    assert r["source"] == "model" and r["intent"] == "jobs" and e.ai.calls == 1 and len(p.calls) == 1  # the owner's server, not ILMU
    assert b"how are the jobs" in p.calls[0].content
    p.status = 500
    assert ask_a().json()["source"] == "keywords"  # provider down: the keyword fallback, same as for ILMU
