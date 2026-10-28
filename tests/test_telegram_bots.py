"""Telegram: each business's own bot, the LARIS helper bot and account linking. Telegram is faked (httpx MockTransport): no network."""
import hashlib
import json
import logging
import re

import httpx
import pytest

from src.api import telegram_bots, webhooks
from support.fixtures import env, pg_url  # noqa: F401
from test_api import PART
from test_listings import lenv, photo  # noqa: F401

HELPER = "777000:" + "H" * 35
HSECRET = "helper-secret"
BOT_A = "111111:" + "A" * 35
BOT_B = "222222:" + "B" * 35
BOT_BAD = "999999:" + "X" * 35  # Telegram answers 401


class TG:
    """Records (token, method, json) and answers like Telegram. `down` = network failure."""

    def __init__(self):
        self.calls, self.down = [], False
        self.client = httpx.Client(transport=httpx.MockTransport(self))

    def __call__(self, req):
        tok, meth = re.match(r"/bot([^/]+)/(\w+)", req.url.path).groups()
        self.calls.append((tok, meth, json.loads(req.content) if req.content and req.headers.get("content-type") == "application/json" else {}))
        if self.down:
            raise httpx.ConnectError("down")
        if tok.startswith("999999"):
            return httpx.Response(401, json={"ok": False})
        bid = int(tok.split(":")[0])
        res = {"getMe": {"id": bid, "username": f"bot{bid}", "first_name": "Shop"}, "getWebhookInfo": {"url": "https://x"}}.get(meth, True)
        return httpx.Response(200, json={"ok": True, "result": res})

    def of(self, meth):
        return [(t, b) for t, m, b in self.calls if m == meth]


@pytest.fixture
def tge(env, monkeypatch):
    e = env
    for k, v in {"SECRET_KEY": "test-secret-key", "APP_PUBLIC_URL": "https://laris.test", "LARIS_HELPER_BOT_TOKEN": HELPER,
                 "LARIS_HELPER_WEBHOOK_SECRET": HSECRET}.items():
        monkeypatch.setenv(k, v)
    for k in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_TENANT_ID", "TELEGRAM_WEBHOOK_SECRET"):
        monkeypatch.delenv(k, raising=False)
    telegram_bots._LIVE.clear()
    telegram_bots._HELPER.clear()
    e.tg = TG()
    e.svc.http = e.tg.client
    e.seed_t = str(e.sql("select id from tenants")[0]["id"])
    e.att = str(e.sql("insert into tenants(name, trade_template, min_margin_pct) values ('Other Shop','made_to_order',20) returning id")[0]["id"])
    e.att_owner = str(e.sql("insert into users(tenant_id,name,role) values (%s,'Other Owner','owner') returning id", (e.att,))[0]["id"])
    e.AO = {"X-Role": "owner", "X-User": e.att_owner}
    return e


def connect(e, token=BOT_A, headers=None):
    return e.c.post("/api/settings/telegram/connect", json={"token": token}, headers=headers or e.O)


def helper(e, text, chat=5551, mid=1, secret=HSECRET, **m):
    upd = {"message": {"message_id": mid, "chat": {"id": chat}, "date": 1700000000, "text": text, **m}}
    return e.c.post("/webhooks/telegram/helper", json=upd, headers={"X-Telegram-Bot-Api-Secret-Token": secret})


def newcode(e, uid=None, headers=None):
    r = e.c.post(f"/api/users/{uid}/telegram-link" if uid else "/api/me/telegram-link", headers=headers or e.O)
    assert r.status_code == 200, r.text
    return r.json()


def handle(e, uid):
    return e.sql("select channel_handle h from users where id=%s", (uid,))[0]["h"]


def counts(e):
    return [e.sql(f"select count(*) n from {t}")[0]["n"] for t in ("messages", "enquiries", "parties", "documents", "listings")] + [e.ai.calls]


# ---------------------------------------------------------------- connect
def test_connect_stores_the_token_encrypted_and_never_returns_or_logs_it(tge, caplog):
    e = tge
    caplog.set_level(logging.DEBUG)
    r = connect(e)
    assert r.status_code == 200, r.text
    assert r.json() == {"connected": True, "username": "bot111111", "name": "Shop", "webhook_ok": True, "last_error": None, "source": "dashboard"}
    row = e.sql("select * from tenant_telegram_bots")[0]
    assert str(e.seed_t) == str(row["tenant_id"]) and BOT_A not in json.dumps(row, default=str) and row["token_enc"] != BOT_A
    (tok, hook), = [(t, b) for t, b in e.tg.of("setWebhook")]
    assert tok == BOT_A and hook["url"] == f"https://laris.test/webhooks/telegram/b/{row['bot_key']}" and hook["allowed_updates"] == ["message"]
    assert e.tg.of("setMyCommands")
    g = e.c.get("/api/settings/telegram", headers=e.O)
    assert g.status_code == 200 and g.json()["bot"]["source"] == "dashboard" and g.json()["helper"] == {
        "configured": True, "username": "bot777000", "link": "https://t.me/bot777000"}
    assert {s["user_id"] for s in g.json()["staff"]} >= {e.owner, e.staff} and all(s["linked"] is False for s in g.json()["staff"])
    audit = json.dumps(e.sql("select event, before, after from audit_log where event like 'telegram%%'"), default=str)
    assert "telegram bot connected" in audit
    for blob in (r.text, g.text, audit, caplog.text):
        assert BOT_A not in blob and BOT_A.split(":")[1] not in blob and row["secret_enc"] not in blob


def test_connect_refusals(tge, monkeypatch):
    e = tge
    for bad in ("nonsense", "12:short"):
        assert connect(e, bad).json()["error"]["code"] == "bad_token"
    r = connect(e, BOT_BAD)
    assert (r.status_code, r.json()["error"]["code"]) == (422, "bad_token")
    e.tg.down = True
    r = connect(e)
    assert (r.status_code, r.json()["error"]["code"]) == (502, "telegram_unreachable")
    e.tg.down = False
    monkeypatch.delenv("APP_PUBLIC_URL")
    assert (connect(e).status_code, connect(e).json()["error"]["code"]) == (422, "public_url_unset")
    monkeypatch.setenv("APP_PUBLIC_URL", "https://laris.test")
    monkeypatch.delenv("SECRET_KEY")
    r = connect(e)
    assert (r.status_code, r.json()["error"]["code"]) == (422, "secret_key_unset") and not e.tg.of("setWebhook")
    assert e.sql("select count(*) n from tenant_telegram_bots")[0]["n"] == 0


def test_a_bot_belongs_to_one_business_and_the_other_is_never_touched(tge):
    e = tge
    assert connect(e).status_code == 200
    n = len(e.tg.of("setWebhook"))
    r = connect(e, BOT_A, e.AO)
    assert (r.status_code, r.json()["error"]["code"]) == (409, "bot_in_use")
    assert "Other Shop" not in r.text and str(e.seed_t) not in r.text and len(e.tg.of("setWebhook")) == n  # webhook not hijacked
    assert connect(e, BOT_A).status_code == 200  # the same business may reconnect
    assert connect(e, BOT_B).status_code == 200  # replacing: the old bot's webhook is removed
    assert [t for t, _ in e.tg.of("deleteWebhook")] == [BOT_A]
    assert e.sql("select count(*) n from tenant_telegram_bots")[0]["n"] == 1


def test_disconnect_and_owner_only(tge):
    e = tge
    connect(e)
    for h in (e.S,):
        assert e.c.get("/api/settings/telegram", headers=h).status_code == 403
        assert connect(e, headers=h).status_code == 403
        assert e.c.post("/api/settings/telegram/disconnect", headers=h).status_code == 403
    r = e.c.post("/api/settings/telegram/disconnect", headers=e.O)
    assert r.status_code == 200 and r.json()["connected"] is False
    assert e.sql("select count(*) n from tenant_telegram_bots")[0]["n"] == 0 and e.tg.of("deleteWebhook")


def test_the_env_bot_shows_as_environment_for_its_business(tge, monkeypatch):
    e = tge
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "333333:" + "E" * 35)
    monkeypatch.setenv("TELEGRAM_TENANT_ID", e.seed_t)
    assert e.c.get("/api/settings/telegram", headers=e.O).json()["bot"]["source"] == "environment"
    assert e.c.get("/api/settings/telegram", headers=e.AO).json()["bot"]["connected"] is False


# ---------------------------------------------------------------- the business bot's webhook
def tg_b(e, key, text, secret, chat=777, mid=1):
    upd = {"message": {"message_id": mid, "chat": {"id": chat}, "date": 1700000000, "text": text}}
    return e.c.post(f"/webhooks/telegram/b/{key}", json=upd, headers={"X-Telegram-Bot-Api-Secret-Token": secret})


def test_business_bot_secret_unknown_key_and_cross_tenant(tge):
    e = tge
    assert connect(e, BOT_A, e.AO).status_code == 200  # the OTHER business owns the bot
    key = e.sql("select bot_key from tenant_telegram_bots")[0]["bot_key"]
    secret = e.tg.of("setWebhook")[0][1]["secret_token"]
    e.sql("update users set channel_handle='tg:777' where id=%s", (e.staff,))  # chat 777 is a staff member of the seeded business
    e.ai.payload = {"items": [PART]}
    assert tg_b(e, "nope", "hi", secret).status_code == 404
    assert tg_b(e, key, "10 small parts", "wrong").status_code == 403
    before = counts(e)
    seed_before = e.sql("select (select count(*) from enquiries where tenant_id=%s) a, (select count(*) from documents where tenant_id=%s) b", (e.seed_t, e.seed_t))
    assert before == counts(e)  # nothing yet
    assert tg_b(e, key, "10 small parts", secret).status_code == 200
    assert e.sql("select (select count(*) from enquiries where tenant_id=%s) a, (select count(*) from documents where tenant_id=%s) b",
                 (e.seed_t, e.seed_t)) == seed_before  # never processed for the seeded business, nor as its staff
    assert e.sql("select count(*) n from enquiries where tenant_id=%s", (e.att,))[0]["n"] == 1
    assert e.sql("select count(*) n from parties where tenant_id=%s and role='customer' and contact='777'", (e.att,))[0]["n"] == 1
    assert e.svc.via[-1] == BOT_A  # answered by that business's own bot
    assert e.svc.sent[-1][1] == "777"
    assert [t for t, _ in e.tg.of("setMessageReaction")] == [BOT_A, BOT_A]  # eyes, then the outcome, each with its own token


def test_the_legacy_endpoint_is_unchanged_and_ignores_business_bots(tge, monkeypatch):
    e = tge
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "legacy")
    r = e.c.post("/webhooks/telegram", json={"message": {"message_id": 1, "chat": {"id": 5}, "date": 1700000000, "text": "hi"}},
                 headers={"X-Telegram-Bot-Api-Secret-Token": "legacy"})
    assert r.status_code == 200
    assert e.c.post("/webhooks/telegram", json={}, headers={"X-Telegram-Bot-Api-Secret-Token": HSECRET}).status_code == 403


# ---------------------------------------------------------------- link codes
def test_link_code_shape_hash_only_single_use_and_expiry(tge):
    e = tge
    r = newcode(e, e.staff)
    code = r["code"]
    assert re.fullmatch(r"[A-HJ-NP-Z2-9]{8}", code) and r["url"] == f"https://t.me/bot777000?start=link_{code}" and r["expires_at"]
    stored = e.sql("select * from telegram_link_codes")
    assert len(stored) == 1 and stored[0]["code_hash"] == hashlib.sha256(code.encode()).hexdigest() and code not in json.dumps(stored, default=str)
    assert helper(e, f"/start link_{code}").status_code == 200
    assert handle(e, e.staff) == "tg:5551" and "Linked to" in e.svc.sent[-1][2] and e.svc.via[-1] == HELPER
    assert "/catalog" in e.svc.sent[-1][2] and "/unlink" in e.svc.sent[-1][2]
    assert e.sql("select used_at from telegram_link_codes")[0]["used_at"] is not None
    assert [x["event"] for x in e.sql("select event from audit_log where event like 'telegram linked'")] == ["telegram linked"]
    helper(e, f"/link {code}", chat=6000, mid=2)  # single use
    assert webhooks.BAD_CODE == e.svc.sent[-1][2] and handle(e, e.staff) == "tg:5551"
    code2 = newcode(e, e.owner)["code"]
    e.sql("update telegram_link_codes set expires_at = now() - interval '1 minute'")
    helper(e, f"/link {code2.lower()}", chat=6001, mid=3)  # expired (and a lower-case code is accepted when valid)
    assert webhooks.BAD_CODE == e.svc.sent[-1][2] and handle(e, e.owner) is None


def test_a_new_code_voids_the_old_one_and_codes_are_case_insensitive(tge):
    e = tge
    old, new = newcode(e, e.staff)["code"], newcode(e, e.staff)["code"]
    helper(e, f"/link {old}")
    assert handle(e, e.staff) is None
    helper(e, f"/link {new.lower()}", mid=2)
    assert handle(e, e.staff) == "tg:5551"


def test_wrong_codes_are_rate_limited_per_chat(tge):
    e = tge
    good = newcode(e, e.staff)["code"]
    for i in range(5):
        helper(e, f"/link WRONG{i}XY", mid=i + 1)
        assert e.svc.sent[-1][2] == webhooks.BAD_CODE
    helper(e, f"/link {good}", mid=9)  # the sixth try in the hour is refused even with the right code
    assert "Too many tries" in e.svc.sent[-1][2] and handle(e, e.staff) is None
    helper(e, f"/link {good}", chat=7001, mid=1)  # another chat is not affected
    assert handle(e, e.staff) == "tg:7001"


def test_link_permissions(tge):
    e = tge
    assert e.c.post(f"/api/users/{e.owner}/telegram-link", headers=e.S).status_code == 403  # staff cannot link someone else
    assert e.c.delete(f"/api/users/{e.owner}/telegram-link", headers=e.S).status_code == 403
    assert e.c.post(f"/api/users/{e.att_owner}/telegram-link", headers=e.O).status_code == 404  # another business
    assert e.c.post("/api/users/not-a-uuid/telegram-link", headers=e.O).status_code in (404, 422)
    assert newcode(e, headers=e.S)["code"]  # for themselves
    assert e.sql("select user_id::text u from telegram_link_codes")[0]["u"] == e.staff
    assert e.c.get("/api/users", headers=e.O).json()[0]["telegram_linked"] is False


def test_link_is_refused_without_a_helper_bot(tge, monkeypatch):
    e = tge
    monkeypatch.delenv("LARIS_HELPER_BOT_TOKEN")
    r = e.c.post("/api/me/telegram-link", headers=e.O)
    assert (r.status_code, r.json()["error"]["code"]) == (409, "helper_not_configured")
    assert e.c.get("/api/settings/telegram", headers=e.O).json()["helper"] == {"configured": False, "username": None, "link": None}
    assert helper(e, "/start").status_code == 200  # token unset: nothing happens
    assert helper(e, "/start", secret="nope").status_code == 403


def test_a_chat_linked_to_someone_else_in_the_business_is_refused(tge):
    e = tge
    helper(e, f"/link {newcode(e, e.staff)['code']}")
    helper(e, f"/link {newcode(e, e.owner)['code']}", mid=2)
    assert "already linked" in e.svc.sent[-1][2] and handle(e, e.owner) is None


def test_unlink_from_the_dashboard_and_from_the_bot(tge):
    e = tge
    e.sql("update users set channel_handle='60123456789' where id=%s", (e.owner,))
    assert e.c.delete("/api/me/telegram-link", headers=e.O).status_code == 200
    assert handle(e, e.owner) == "60123456789"  # a phone number is not a Telegram link
    helper(e, f"/link {newcode(e, e.staff)['code']}")
    assert e.c.get("/api/users", headers=e.O).json() and {u["id"]: u["telegram_linked"] for u in e.c.get("/api/users", headers=e.O).json()}[e.staff] is True
    assert e.c.delete(f"/api/users/{e.staff}/telegram-link", headers=e.O).status_code == 200 and handle(e, e.staff) is None
    helper(e, f"/link {newcode(e, e.staff)['code']}", mid=2)
    helper(e, "/unlink", mid=3)
    assert handle(e, e.staff) is None and "Disconnected" in e.svc.sent[-1][2]
    assert e.sql("select count(*) n from audit_log where event='telegram unlinked'")[0]["n"] == 2


# ---------------------------------------------------------------- what the helper bot processes
def test_the_helper_ignores_chats_that_are_not_linked(lenv, monkeypatch):
    e = lenv
    for k, v in {"LARIS_HELPER_BOT_TOKEN": HELPER, "LARIS_HELPER_WEBHOOK_SECRET": HSECRET}.items():
        monkeypatch.setenv(k, v)
    e.svc.http = TG().client
    e.svc.media["P"] = (photo(), "image/jpeg")
    before = counts(e)
    for i, kw in enumerate(({}, {"photo": [{"file_id": "P"}]})):
        assert helper(e, "/catalog shoes" if kw else "10 small parts", mid=i + 1, **kw).status_code == 200
        assert e.svc.sent[-1][2] == webhooks.NOT_LINKED and e.svc.via[-1] == HELPER
    assert helper(e, "/start", mid=5).status_code == 200 and e.svc.sent[-1][2] == webhooks.NOT_LINKED
    assert counts(e) == before and not getattr(e.svc, "dl_tokens", [])  # no row, no model call, no download
    assert e.sql("select count(*) n from audit_log where actor like 'system:%%' and event like 'inbound%%'")[0]["n"] == 0


def test_a_linked_staff_catalog_photo_through_the_helper_reaches_the_catalog_path(lenv, monkeypatch):
    e = lenv
    for k, v in {"SECRET_KEY": "k", "APP_PUBLIC_URL": "https://laris.test", "LARIS_HELPER_BOT_TOKEN": HELPER, "LARIS_HELPER_WEBHOOK_SECRET": HSECRET}.items():
        monkeypatch.setenv(k, v)
    for k in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_TENANT_ID"):
        monkeypatch.delenv(k, raising=False)
    telegram_bots._HELPER.clear()
    e.tg = TG()
    e.svc.http = e.tg.client
    e.svc.media["P"] = (photo(), "image/jpeg")
    helper(e, f"/start link_{newcode(e, e.staff)['code']}")
    assert helper(e, "/help", mid=2).status_code == 200 and "linked to LARIS" in e.svc.sent[-1][2]
    assert helper(e, "/catalog Ali shoes", mid=3, photo=[{"file_id": "P"}]).status_code == 200
    rows = e.sql("select created_by::text cb, source_channel, note from listings")
    assert rows == [{"cb": e.staff, "source_channel": "telegram", "note": "/catalog Ali shoes"}]
    assert e.sql("select count(*) n from listing_items where status='needs_review'")[0]["n"] == 2
    assert "2 product(s)" in e.svc.sent[-1][2] and e.svc.via[-1] == HELPER and e.svc.dl_tokens == [HELPER]
    assert e.tg.of("sendChatAction") or e.tg.of("setMessageReaction")
    assert all(t == HELPER for t, _ in e.tg.of("setMessageReaction"))
