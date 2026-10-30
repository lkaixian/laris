"""PDPA in the chat: the privacy notice once per customer, /privacy /mydata /forget, and the owner's decision on a request. No network."""
import json
import logging

from src.api import webhooks
from src.api.deps import STAFF_HIDE
from support.fixtures import env, pg_url  # noqa: F401
from test_api import PART
from test_privacy import keys
from test_telegram_bots import tge, tg_b  # noqa: F401
from test_telegram_custom import biz, put
from test_webhook_tenancy import two, wa  # noqa: F401

NOTICE = "Privacy notice"
CHAT = 123456789


def setup(e, lang=None):
    e.stock_costs()
    e.ai.payload = {"items": [PART]}
    if lang:
        put(e, {"language": lang})
    return biz(e)


def notices(e):
    return [x for x in e.svc.sent if NOTICE in x[2] or "Notis privasi" in x[2]]


def files(e, monkeypatch):
    """Capture what /mydata would upload on Telegram and WhatsApp."""
    got = []
    monkeypatch.setattr(webhooks.telegram, "send_document", lambda to, data, mime, name, cap, **k: got.append(("telegram", to, mime, name, cap, data)))
    monkeypatch.setattr(webhooks.whatsapp, "send_document", lambda to, data, mime, name, cap, **k: got.append(("whatsapp", to, mime, name, cap, data)))
    return got


def requests(e, who=None):
    r = e.c.get("/api/privacy/requests", headers=who or e.O)
    assert r.status_code == 200, r.text
    return r.json()


def test_notice_is_sent_once_before_the_reply_and_the_message_is_still_processed(tge):
    e = tge
    key, sec = setup(e)
    assert tg_b(e, key, "10 small parts", sec, chat=CHAT).status_code == 200
    assert [x[2][:14] for x in e.svc.sent] == [NOTICE, "Thanks, we rec"]  # the notice is its own message, then the normal reply
    n = e.sql("select notice_version, basis, notice_shown_at is not null as shown, channel, withdrawn_at from customer_consent")
    assert n == [{"notice_version": 1, "basis": "notice_shown", "shown": True, "channel": "telegram", "withdrawn_at": None}]
    assert e.sql("select count(*) n from enquiries")[0]["n"] == 1 and e.sql("select count(*) n from documents where direction='out'")[0]["n"] >= 1
    body = e.svc.sent[0][2]
    assert "voice notes are transcribed" in body.lower() and "/privacy" in body and "/mydata" in body and "/forget" in body and "not kept" in body
    tg_b(e, key, "10 small parts", sec, chat=CHAT, mid=2)
    assert len(notices(e)) == 1 and len(e.svc.sent) == 3 and e.sql("select count(*) n from customer_consent")[0]["n"] == 1


def test_notice_language_dpo_and_version(tge):
    e = tge
    key, sec = setup(e, "ms")
    assert e.c.post("/api/settings/privacy", json={"dpo_name": "Aida", "dpo_email": "dpo@example.com", "notice_version": 3}, headers=e.O).status_code == 200
    tg_b(e, key, "10 small parts", sec, chat=CHAT)
    assert e.svc.sent[0][2].startswith(NOTICE) and "Notis privasi" in e.svc.sent[0][2] and "Aida, dpo@example.com" in e.svc.sent[0][2] and "/forget" in e.svc.sent[0][2]
    assert e.sql("select notice_version v from customer_consent")[0]["v"] == 3
    put(e, {"language": "en"})
    tg_b(e, key, "/privacy", sec, chat=CHAT + 1)
    assert e.svc.sent[-1][2].startswith(NOTICE) and "Aida, dpo@example.com" in e.svc.sent[-1][2]
    assert webhooks.T["en"].keys() == webhooks.T["ms"].keys()


def test_privacy_command_answers_with_the_notice_and_sends_it_only_once_on_a_first_message(tge):
    e = tge
    key, sec = setup(e)
    tg_b(e, key, "/privacy", sec, chat=CHAT)
    assert [x[2][:14] for x in e.svc.sent] == [NOTICE] and e.sql("select count(*) n from customer_consent")[0]["n"] == 1
    tg_b(e, key, "/Privacy@my_bot", sec, chat=CHAT, mid=2)
    assert len(notices(e)) == 2 and e.sql("select count(*) n from enquiries")[0]["n"] == 0  # a command is no enquiry


def test_staff_and_suppliers_get_no_notice(tge):
    e = tge
    key, sec = setup(e)
    e.sql("update users set channel_handle='tg:888' where id=%s", (e.staff,))
    e.sql("insert into parties(tenant_id, role, name, contact) values (%s, 'supplier', 'Sup Co', 'tg:999')", (e.seed_t,))
    e.ai.fail = True
    for chat, mid in ((888, 1), (999, 2)):
        for text in ("hello there", "/privacy", "/mydata", "/forget"):
            tg_b(e, key, text, sec, chat=chat, mid=mid * 10 + len(text))
    assert not notices(e) and e.sql("select count(*) n from customer_consent")[0]["n"] == 0 and e.sql("select count(*) n from data_requests")[0]["n"] == 0
    tg_b(e, key, "/start", sec, chat=7, mid=99)  # /start and /help are not a first message
    assert not notices(e) and e.sql("select count(*) n from customer_consent")[0]["n"] == 0


def test_helper_bot_never_sends_the_notice(tge):
    from test_telegram_bots import helper
    e = tge
    helper(e, "hello", chat=4242)
    helper(e, "/privacy", chat=4242, mid=2)
    assert not notices(e) and e.sql("select count(*) n from customer_consent")[0]["n"] == 0


def test_mydata_sends_only_the_senders_own_data_as_a_json_file(tge, monkeypatch):
    e = tge
    key, sec = setup(e)
    got = files(e, monkeypatch)
    tg_b(e, key, "10 small parts", sec, chat=CHAT)
    tg_b(e, key, "10 small parts", sec, chat=CHAT + 1, mid=2)  # a different customer
    tg_b(e, key, "/MyData@my_bot", sec, chat=CHAT, mid=3)
    (ch, to, mime, name, cap, data), = got
    assert (ch, to, mime, name) == ("telegram", str(CHAT), "application/json", "my-data.json") and cap.startswith("A copy of the data")
    doc = json.loads(data)
    assert doc["party"]["name"] == f"telegram {CHAT}" and doc["messages"] and doc["quotes"] and f"telegram {CHAT + 1}" not in data.decode()
    assert not set(keys(doc)) & STAFF_HIDE and not {"cost", "margin", "margin_pct"} & set(keys(doc))
    assert all(f"telegram {CHAT + 1}" not in str(m) for m in doc["messages"]) and len(doc["enquiries"]) == 1
    assert e.sql("select count(*) n from data_requests")[0]["n"] == 0  # nothing erased, nothing requested


def test_mydata_on_whatsapp_and_failure_falls_back_to_text(two, monkeypatch):
    e = two
    got = files(e, monkeypatch)
    wa(e, text="10 small parts", to="PN_B", mid="wamid.1")
    wa(e, text="/mydata", to="PN_B", mid="wamid.2")
    (ch, to, mime, name, cap, data), = got
    assert (ch, to, mime) == ("whatsapp", "60111222333", "application/json") and json.loads(data)["party"]["role"] == "customer"
    monkeypatch.setattr(webhooks.whatsapp, "send_document", lambda *a, **k: 1 / 0)
    wa(e, text="/mydata", to="PN_B", mid="wamid.3")
    assert e.svc.sent[-1][2] == webhooks.T["en"]["mydata_fail"]
    assert len(notices(e)) == 1


def test_forget_creates_one_pending_request_and_erases_nothing(tge):
    e = tge
    key, sec = setup(e)
    tg_b(e, key, "10 small parts", sec, chat=CHAT)
    tg_b(e, key, "/forget", sec, chat=CHAT, mid=2)
    assert e.svc.sent[-1][2] == "We received your request. The business will confirm after checking quotes it must keep."
    tg_b(e, key, "/forget", sec, chat=CHAT, mid=3)
    assert e.svc.sent[-1][2].startswith("We received your request")
    rows = requests(e)
    assert len(rows) == 1 and set(rows[0]) == {"id", "party_id", "party_name", "kind", "status", "channel", "requested_at", "decided_at"}
    assert (rows[0]["kind"], rows[0]["status"], rows[0]["channel"], rows[0]["party_name"], rows[0]["decided_at"]) == ("erase", "pending", "telegram", f"telegram {CHAT}", None)
    assert e.sql("select count(*) n from messages where body = '[erased]'")[0]["n"] == 0
    assert e.sql("select name from parties where contact='123456789'")[0]["name"] == f"telegram {CHAT}"
    assert e.sql("select count(*) n from audit_log where event = 'erase requested in chat'")[0]["n"] == 1
    assert e.c.get("/api/privacy/requests", headers=e.S).status_code == 403


def test_owner_erases_and_the_customer_is_told(tge):
    e = tge
    key, sec = setup(e)
    tg_b(e, key, "10 small parts", sec, chat=CHAT)
    tg_b(e, key, "/forget", sec, chat=CHAT, mid=2)
    rid = requests(e)[0]["id"]
    assert e.c.post(f"/api/privacy/requests/{rid}", json={"action": "nonsense"}, headers=e.O).status_code == 422
    assert e.c.post(f"/api/privacy/requests/{rid}", json={"action": "erase"}, headers=e.S).status_code == 403
    r = e.c.post(f"/api/privacy/requests/{rid}", json={"action": "erase"}, headers=e.O)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "done" and r.json()["decided_at"] and r.json()["party_name"].startswith("Erased customer")
    assert e.svc.sent[-1] == ("telegram", str(CHAT), "Your data has been erased.")
    assert e.sql("select count(*) n from messages where body = '[erased]'")[0]["n"] >= 1
    assert e.c.post(f"/api/privacy/requests/{rid}", json={"action": "dismiss"}, headers=e.O).status_code == 409
    assert requests(e)[0]["status"] == "done"
    tg_b(e, key, "10 small parts", sec, chat=CHAT, mid=5)  # the same chat afterwards is a new person: a fresh notice
    assert len(notices(e)) == 2


def test_dismiss_tells_the_customer_to_contact_the_dpo_and_a_failed_send_does_not_fail_the_request(tge):
    e = tge
    key, sec = setup(e)
    e.c.post("/api/settings/privacy", json={"dpo_name": "Aida", "dpo_phone": "+60123"}, headers=e.O)
    tg_b(e, key, "10 small parts", sec, chat=CHAT)
    tg_b(e, key, "/forget", sec, chat=CHAT, mid=2)
    r = e.c.post(f"/api/privacy/requests/{requests(e)[0]['id']}", json={"action": "dismiss"}, headers=e.O)
    assert r.json()["status"] == "dismissed"
    assert "could not erase" in e.svc.sent[-1][2] and "Aida, +60123" in e.svc.sent[-1][2]
    assert e.sql("select name from parties where contact='123456789'")[0]["name"] == f"telegram {CHAT}"
    tg_b(e, key, "/forget", sec, chat=CHAT, mid=3)  # a new request is allowed once the old one is decided
    assert [x["status"] for x in requests(e)] == ["pending", "dismissed"]  # pending first
    e.svc.send = lambda *a, **k: 1 / 0
    assert e.c.post(f"/api/privacy/requests/{requests(e)[0]['id']}", json={"action": "erase"}, headers=e.O).json()["status"] == "done"


def test_requests_are_isolated_between_businesses(tge):
    e = tge
    key, sec = setup(e)
    tg_b(e, key, "/forget", sec, chat=CHAT)
    rid = requests(e)[0]["id"]
    assert requests(e, e.AO) == []
    assert e.c.post(f"/api/privacy/requests/{rid}", json={"action": "erase"}, headers=e.AO).status_code == 404
    assert requests(e)[0]["status"] == "pending"


def test_rights_commands_are_rate_limited(tge):
    e = tge
    key, sec = setup(e)
    for i in range(8):
        tg_b(e, key, "/privacy", sec, chat=CHAT, mid=i + 1)
    assert len(notices(e)) == webhooks.RIGHTS_LIMIT


def test_pending_requests_older_than_three_days_show_in_health(tge):
    e = tge
    key, sec = setup(e)
    tg_b(e, key, "/forget", sec, chat=CHAT)
    codes = lambda: {i["code"] for i in e.c.get("/api/system/health", headers=e.O).json()["items"]}  # noqa: E731
    assert "privacy_requests_waiting" not in codes()
    e.sql("update data_requests set requested_at = now() - interval '4 days'")
    assert "privacy_requests_waiting" in codes()


def test_no_personal_data_in_logs(tge, caplog, monkeypatch):
    e = tge
    key, sec = setup(e)
    files(e, monkeypatch)
    caplog.set_level(logging.DEBUG)
    for i, t in enumerate(["10 small parts", "/privacy", "/mydata", "/forget"]):
        tg_b(e, key, t, sec, chat=CHAT, mid=i + 1)
    e.svc.send = lambda *a, **k: 1 / 0
    e.c.post(f"/api/privacy/requests/{requests(e)[0]['id']}", json={"action": "erase"}, headers=e.O)
    assert str(CHAT) not in caplog.text and "small parts" not in caplog.text


def test_notice_is_bilingual_and_covers_the_s7_items(tge):
    e = tge
    key, sec = setup(e)
    tg_b(e, key, "/privacy", sec, chat=CHAT)
    n = e.svc.sent[-1][2]
    assert n.startswith(NOTICE) and "Notis privasi" in n  # both national languages in one message, English first
    for word in ("voluntary", "sukarela", "180 days", "outside Malaysia", "luar Malaysia", "correct", "membetulkan", "limit", "menghadkan"):
        assert word in n
    assert "you accept" not in n and "bersetuju" not in n  # no claim that continuing is agreement


def test_require_optin_holds_the_enquiry_until_yes(tge):
    e = tge
    key, sec = setup(e)
    assert e.c.post("/api/settings/privacy", json={"require_optin": True}, headers=e.O).json()["require_optin"] is True
    tg_b(e, key, "10 small parts", sec, chat=CHAT)
    assert "reply YES" in e.svc.sent[-1][2] and "balas YA" in e.svc.sent[-1][2]
    assert e.sql("select count(*) n from enquiries")[0]["n"] == 0  # not read yet
    tg_b(e, key, "/privacy", sec, chat=CHAT, mid=2)  # the rights commands work before agreeing
    assert e.sql("select count(*) n from enquiries")[0]["n"] == 0
    tg_b(e, key, "yes", sec, chat=CHAT, mid=3)
    assert "Please send your request" in e.svc.sent[-1][2]
    r = e.sql("select basis, agreed_at is not null as agreed from customer_consent")
    assert r == [{"basis": "agreed_in_chat", "agreed": True}]
    tg_b(e, key, "10 small parts", sec, chat=CHAT, mid=4)
    assert e.sql("select count(*) n from enquiries")[0]["n"] == 1
