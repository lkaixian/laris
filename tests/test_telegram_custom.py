"""Telegram: one-tap bot creation (managed bots) and the owner's customisation of the customer bot. Telegram is faked: no network."""
import json
import logging
import re
from datetime import datetime

import pytest

from src import pipeline
from src.api import telegram_bots, webhooks
from support.fixtures import env, pg_url  # noqa: F401
from test_api import PART
from test_telegram_bots import BOT_A, BOT_B, HELPER, HSECRET, connect, helper, newcode, tg_b, tge  # noqa: F401

URL = "/api/settings/telegram/bot-settings"
WED_NIGHT = datetime(2026, 10, 28, 20, 0, tzinfo=pipeline.MY)  # a Wednesday, 20:00 Malaysia
WED_NOON = datetime(2026, 10, 28, 12, 0, tzinfo=pipeline.MY)


def link(e, who=None, chat=5551):
    helper(e, f"/start link_{newcode(e, who or e.owner)['code']}", chat=chat)


def managed(e, uid=5551, bot=222222, **extra):
    upd = {"managed_bot": {"user": {"id": uid, **extra}, "bot": {"id": bot, "is_bot": True}}}
    return e.c.post("/webhooks/telegram/helper", json=upd, headers={"X-Telegram-Bot-Api-Secret-Token": HSECRET})


def tg_get(e, headers=None):
    return e.c.get("/api/settings/telegram", headers=headers or e.O).json()["bot"]


def bots(e):
    return e.sql("select tenant_id::text t, bot_id from tenant_telegram_bots")


# ---------------------------------------------------------------- one-tap creation
def test_managed_bot_is_connected_for_the_linked_owner_only(tge, caplog):
    e = tge
    caplog.set_level(logging.DEBUG)
    link(e)
    r = managed(e, tenant_id=e.att)  # a tenant claim in the update is never used
    assert r.status_code == 200
    assert bots(e) == [{"t": e.seed_t, "bot_id": 222222}]
    assert e.tg.of("getManagedBotToken") == [(HELPER, {"user_id": 222222})]
    (tok, hook), = e.tg.of("setWebhook")
    assert tok == BOT_B and hook["url"].startswith("https://laris.test/webhooks/telegram/b/") and e.tg.of("setMyCommands")
    assert e.svc.sent[-1] == ("telegram", "5551", "Your bot @bot222222 is connected. Customers can message it now.") and e.svc.via[-1] == HELPER
    assert "telegram bot connected" in json.dumps(e.sql("select event from audit_log"))
    assert tg_get(e)["connected"] is True
    for blob in (caplog.text, json.dumps(e.sql("select event, before, after from audit_log"), default=str), e.svc.sent[-1][2]):
        assert BOT_B not in blob and "B" * 35 not in blob


def test_managed_bot_from_someone_who_is_not_a_linked_owner_connects_nothing(tge):
    e = tge
    managed(e)  # never linked
    assert bots(e) == [] and "owner" in e.svc.sent[-1][2] and not e.tg.of("getManagedBotToken")
    link(e, e.staff, chat=5552)  # linked, but staff
    managed(e, uid=5552)
    assert bots(e) == [] and "owner" in e.svc.sent[-1][2] and not e.tg.of("getManagedBotToken")
    link(e, e.owner)
    e.sql("update users set channel_handle='tg:5551' where id=%s", (e.att_owner,))  # the same chat owns two businesses: never guess
    managed(e)
    assert bots(e) == [] and not e.tg.of("getManagedBotToken") and not e.tg.of("setWebhook")
    for junk in ({"managed_bot": "x"}, {"managed_bot": {"user": {"id": "abc"}, "bot": {"id": 1}}}, {"managed_bot": {"user": {"id": 5551}}}):
        assert e.c.post("/webhooks/telegram/helper", json=junk, headers={"X-Telegram-Bot-Api-Secret-Token": HSECRET}).status_code == 200
    assert e.c.post("/webhooks/telegram/helper", json={"managed_bot": {}}, headers={"X-Telegram-Bot-Api-Secret-Token": "nope"}).status_code == 403
    assert bots(e) == []


def test_managed_bot_already_used_by_another_business_is_refused(tge):
    e = tge
    assert connect(e, BOT_B, e.AO).status_code == 200
    n = len(e.tg.of("setWebhook"))
    link(e)
    managed(e)
    assert bots(e) == [{"t": e.att, "bot_id": 222222}] and len(e.tg.of("setWebhook")) == n
    assert "already connected" in e.svc.sent[-1][2] and "Other Shop" not in e.svc.sent[-1][2]


def test_managed_bot_telegram_failure_is_a_plain_sentence_and_logs_only_the_type(tge, caplog):
    e = tge
    caplog.set_level(logging.DEBUG)
    link(e)
    e.tg.down = True
    managed(e)
    assert bots(e) == [] and "could not connect" in e.svc.sent[-1][2]
    assert "ConnectError" in caplog.text and HELPER not in caplog.text and HELPER.split(":")[1] not in caplog.text


def test_helper_webhook_registration_asks_for_managed_bot_updates(monkeypatch, capsys):
    import httpx
    import sys
    sys.path.insert(0, "scripts")
    import setup_channels
    seen = []
    monkeypatch.setattr(httpx.Client, "post", lambda self, url, json=None, **k: seen.append((url.rsplit("/", 1)[1], json)) or httpx.Response(200, json={"ok": True, "result": True}, request=httpx.Request("POST", url)))
    monkeypatch.setenv("LARIS_HELPER_WEBHOOK_SECRET", "s")
    monkeypatch.setenv("LARIS_HELPER_BOT_TOKEN", HELPER)
    setup_channels.main(["helper-webhook", "https://x.test/webhooks/telegram/helper"])
    assert dict(seen)["setWebhook"]["allowed_updates"] == ["message", "managed_bot"]


def test_create_link_and_blocked_states(tge, monkeypatch):
    e = tge
    b = tg_get(e)
    assert (b["create_link"], b["create_blocked"]) == (None, "link_first")
    link(e)
    e.sql("update tenants set name=%s where id=%s", ("Kedai Ünï Çafé - Sdn Bhd & Sons Extremely Long Name", e.seed_t))
    b = tg_get(e)
    m = re.fullmatch(r"https://t\.me/newbot/bot777000/([A-Za-z0-9_]+)\?name=(.+)", b["create_link"])
    assert b["create_blocked"] is None and m and 5 <= len(m.group(1)) <= 32 and m.group(1).endswith("_laris_bot") and m.group(1)[0].isalpha()
    e.sql("update tenants set name=%s where id=%s", ("日本語", e.seed_t))
    assert re.fullmatch(r"https://t\.me/newbot/bot777000/shop_laris_bot\?name=.+", tg_get(e)["create_link"])
    assert tg_get(e, e.AO)["create_blocked"] == "link_first"  # the other business's owner is not linked
    assert e.c.get("/api/settings/telegram", headers=e.S).status_code == 403
    telegram_bots._HELPER.clear()
    e.tg.manage = False
    b = tg_get(e)
    assert (b["create_link"], b["create_blocked"]) == (None, "unavailable")
    telegram_bots._HELPER.clear()
    monkeypatch.delenv("LARIS_HELPER_BOT_TOKEN")
    assert tg_get(e)["create_blocked"] == "unavailable"


# ---------------------------------------------------------------- customisation: settings API
def put(e, body, headers=None):
    return e.c.post(URL, json=body, headers=headers or e.O)


def test_bot_settings_defaults_roundtrip_validation_and_owner_only(tge):
    e = tge
    g = e.c.get(URL, headers=e.O).json()
    d = webhooks.T["en"]
    assert g == {"welcome": d["welcome"], "help": d["help"], "language": "auto", "quick_replies": [],
                 "after_hours": {"enabled": False, "message": d["after"], "open": "09:00", "close": "18:00", "days": [1, 2, 3, 4, 5, 6, 7]},
                 "reactions": True, "defaults": {"welcome": d["welcome"], "help": d["help"], "after_hours_message": d["after"]}}
    r = put(e, {"welcome": "Hi\x00\x07 there", "language": "ms", "quick_replies": [" Price list ", "Opening hours"], "reactions": False,
                "after_hours": {"enabled": True, "open": "08:30", "days": [5, 1, 1]}})
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["welcome"] == "Hi there" and v["help"] == d["help"] and v["language"] == "ms" and v["reactions"] is False
    assert v["quick_replies"] == ["Price list", "Opening hours"]
    assert v["after_hours"] == {"enabled": True, "message": d["after"], "open": "08:30", "close": "18:00", "days": [1, 5]}
    assert e.c.get(URL, headers=e.O).json() == v
    assert put(e, {"after_hours": {"message": "Back at 9"}}).json()["after_hours"]["open"] == "08:30"  # a partial update keeps the rest
    assert put(e, {"welcome": ""}).json()["welcome"] == d["welcome"]  # empty = the default
    assert e.sql("select welcome from tenant_bot_settings")[0]["welcome"] is None
    audit = json.dumps(e.sql("select event, after from audit_log where event like 'telegram bot settings%%'"))
    assert "telegram bot settings changed" in audit and "Back at 9" not in audit
    bad = [("welcome", {"welcome": "x" * 601}), ("help", {"help": "x" * 1001}), ("quick_replies", {"quick_replies": list("abcde")}),
           ("quick_replies", {"quick_replies": [""]}), ("quick_replies", {"quick_replies": ["  "]}), ("quick_replies", {"quick_replies": ["x" * 41]}),
           ("after_hours.message", {"after_hours": {"message": "x" * 301}}), ("after_hours.open", {"after_hours": {"open": "25:00"}}),
           ("after_hours.close", {"after_hours": {"close": "9:00"}}), ("after_hours.days", {"after_hours": {"days": [0]}}),
           ("after_hours.days", {"after_hours": {"days": [8]}}), ("after_hours.days", {"after_hours": {"days": []}}),
           ("language", {"language": "fr"}), ("defaults", {"defaults": {}}), ("nonsense", {"nonsense": 1}), ("after_hours.nonsense", {"after_hours": {"nonsense": 1}})]
    for field, body in bad:
        r = put(e, body)
        assert r.status_code == 422 and field in r.json()["error"]["message"], (body, r.text)
    assert e.c.get(URL, headers=e.O).json()["language"] == "ms"  # nothing from the refused requests was kept
    assert put(e, {"welcome": "x" * 600, "help": "y" * 1000, "quick_replies": ["z" * 40] * 4}).status_code == 200
    for h in (e.S,):
        assert e.c.get(URL, headers=h).status_code == 403 and put(e, {"reactions": True}, h).status_code == 403


def test_bot_settings_are_per_business(tge):
    e = tge
    put(e, {"welcome": "Seed welcome", "quick_replies": ["One"]})
    assert e.c.get(URL, headers=e.AO).json()["welcome"] == webhooks.T["en"]["welcome"] and e.c.get(URL, headers=e.AO).json()["quick_replies"] == []
    put(e, {"language": "en"}, e.AO)
    assert e.c.get(URL, headers=e.O).json()["language"] == "auto" and e.c.get(URL, headers=e.AO).json()["language"] == "en"
    assert e.sql("select count(*) n from tenant_bot_settings")[0]["n"] == 2


# ---------------------------------------------------------------- customisation: what the bots do
def biz(e, token=BOT_A, headers=None):
    """Connect a business bot -> (key, secret)."""
    assert connect(e, token, headers).status_code == 200
    return e.sql("select bot_key from tenant_telegram_bots")[-1]["bot_key"], e.tg.of("setWebhook")[-1][1]["secret_token"]


def test_start_sends_the_welcome_with_a_persistent_keyboard_and_help_the_help_text(tge):
    e = tge
    put(e, {"welcome": "Welcome to the shop", "help": "Send a list", "quick_replies": ["Price list", "Talk to us"]})
    key, sec = biz(e)
    assert tg_b(e, key, "/start", sec).status_code == 200
    (_, sent), = e.tg.of("sendMessage")
    assert sent["text"] == "Welcome to the shop" and "parse_mode" not in sent
    assert sent["reply_markup"] == {"keyboard": [[{"text": "Price list"}], [{"text": "Talk to us"}]], "resize_keyboard": True, "is_persistent": True}
    tg_b(e, key, "/help", sec, mid=2)
    assert e.svc.sent[-1][2] == "Send a list" and len(e.tg.of("sendMessage")) == 1
    put(e, {"quick_replies": []})
    tg_b(e, key, "/start", sec, mid=3)
    assert e.svc.sent[-1][2] == "Welcome to the shop" and len(e.tg.of("sendMessage")) == 1  # no keyboard: the normal send


def test_start_for_a_business_without_settings_and_isolation_between_businesses(tge):
    e = tge
    put(e, {"welcome": "Seed welcome", "quick_replies": ["One"]})
    key, sec = biz(e, BOT_A, e.AO)  # the other business's bot
    tg_b(e, key, "/start", sec)
    assert e.svc.sent[-1][2] == webhooks.HELP and not e.tg.of("sendMessage")


def test_legacy_env_bot_uses_the_same_settings(tge, monkeypatch):
    e = tge
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "333333:" + "E" * 35)
    monkeypatch.setenv("TELEGRAM_TENANT_ID", e.seed_t)
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "legacy")
    put(e, {"welcome": "Legacy welcome", "quick_replies": ["Menu"]})
    upd = {"message": {"message_id": 1, "chat": {"id": 5}, "date": 1700000000, "text": "/start"}}
    assert e.c.post("/webhooks/telegram", json=upd, headers={"X-Telegram-Bot-Api-Secret-Token": "legacy"}).status_code == 200
    (tok, sent), = e.tg.of("sendMessage")
    assert tok.startswith("333333") and sent["text"] == "Legacy welcome" and sent["reply_markup"]["keyboard"] == [[{"text": "Menu"}]]


def test_after_hours_note_is_appended_only_outside_hours(tge, monkeypatch):
    e = tge
    e.stock_costs()
    e.ai.payload = {"items": [PART]}
    put(e, {"language": "en", "after_hours": {"enabled": True, "message": "We are closed, back at 9.", "open": "09:00", "close": "18:00", "days": [1, 2, 3, 4, 5]}})
    key, sec = biz(e)
    for i, (now, late) in enumerate([(WED_NOON, False), (WED_NIGHT, True), (datetime(2026, 10, 31, 12, 0, tzinfo=pipeline.MY), True)]):  # Saturday noon: not a selected day
        monkeypatch.setattr(webhooks, "_now", lambda now=now: now)
        tg_b(e, key, "10 small parts", sec, mid=i + 1)
        out = e.svc.sent[-1][2]
        assert out.startswith("Thanks, we received your enquiry") and out.endswith("\n\nWe are closed, back at 9.") == late, out
    put(e, {"after_hours": {"enabled": False}})
    monkeypatch.setattr(webhooks, "_now", lambda: WED_NIGHT)
    tg_b(e, key, "10 small parts", sec, mid=9)
    assert "closed" not in e.svc.sent[-1][2]
    put(e, {"after_hours": {"enabled": True, "message": "", "open": "22:00", "close": "06:00", "days": [3]}})  # overnight window, default message
    tg_b(e, key, "10 small parts", sec, mid=10)
    assert e.svc.sent[-1][2].endswith(webhooks.T["en"]["after"])  # 20:00 is outside 22:00-06:00


@pytest.mark.parametrize("lang,text,word", [("ms", "10 small parts", "Terima kasih"), ("en", "berapa harga 10 small parts", "Thanks, we received"),
                                            ("auto", "berapa harga 10 small parts", "Terima kasih"), ("auto", "10 small parts", "Thanks, we received")])
def test_language_choice(tge, lang, text, word):
    e = tge
    e.stock_costs()
    e.ai.payload = {"items": [PART]}
    put(e, {"language": lang})
    key, sec = biz(e)
    tg_b(e, key, text, sec)
    assert e.svc.sent[-1][2].startswith(word)


def test_malay_clarify_welcome_and_apology(tge):
    e = tge
    e.ai.payload = {"items": []}
    put(e, {"language": "auto"})
    key, sec = biz(e)
    tg_b(e, key, "tolong beri harga", sec)
    assert e.svc.sent[-1][2].startswith("Maaf, kami tidak pasti") and "Sila balas" in e.svc.sent[-1][2]
    tg_b(e, key, "/start", sec, mid=2)
    assert e.svc.sent[-1][2] == webhooks.T["en"]["welcome"]  # nothing in "/start" says Malay
    put(e, {"language": "ms"})
    tg_b(e, key, "/start", sec, mid=3)
    assert e.svc.sent[-1][2].startswith("Hai!")
    assert webhooks.T["en"].keys() == webhooks.T["ms"].keys() and all(webhooks.T["ms"].values())
    e.ai.fail = True
    e.ai.payload = {"items": [PART]}
    tg_b(e, key, "10 small parts", sec, mid=4)
    e.ai.fail = False
    assert e.svc.sent[-1][2] in webhooks.SORRYS


def test_reactions_off_switches_off_the_reaction_and_typing_indicator(tge, monkeypatch):
    e = tge
    monkeypatch.setattr(webhooks, "TG_ACK", True)
    e.stock_costs()
    e.ai.payload = {"items": [PART]}
    key, sec = biz(e)
    tg_b(e, key, "10 small parts", sec)
    assert len(e.tg.of("setMessageReaction")) == 2
    put(e, {"reactions": False})
    n = len(e.tg.calls)
    tg_b(e, key, "10 small parts", sec, mid=2)
    assert not [m for _, m, _ in e.tg.calls[n:] if m in ("setMessageReaction", "sendChatAction")] and "received your enquiry" in e.svc.sent[-1][2]
