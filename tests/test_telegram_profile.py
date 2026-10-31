"""Telegram customers: their @username is kept, and the bot asks for a name and phone number before the quote is made."""
from support.fixtures import env, pg_url  # noqa: F401

from src.api.webhooks import parse_profile

SECRET = "tg-secret"


def post(e, chat, text, mid, username=None):
    m = {"message_id": mid, "date": 1700000000, "chat": {"id": chat}, "text": text, **({"from": {"username": username}} if username else {})}
    return e.c.post("/webhooks/telegram", json={"update_id": mid, "message": m}, headers={"X-Telegram-Bot-Api-Secret-Token": SECRET})


def party(e, chat="9001"):
    return e.sql("select name, contact, phone, tg_username, pending_enquiry, profile_tries from parties where contact=%s", (chat,))[0]


def sent(e):
    return [x[-1] if isinstance(x, tuple) else x for x in e.svc.sent]


def test_parse_profile():
    assert parse_profile("Ah Seng 012-3456789") == ("Ah Seng", "0123456789")
    assert parse_profile("my name is Tan Mei Ling, phone +60 12 345 6789") == ("Tan Mei Ling", "+60123456789")
    assert parse_profile("0123456789") == ("", "0123456789")
    assert parse_profile("hello") == ("", "") and parse_profile("Ravi 12345") == ("", "")


def test_bot_asks_for_name_and_phone_then_quotes(env, monkeypatch):
    e = env
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", SECRET)
    monkeypatch.setenv("TELEGRAM_ASK_PROFILE", "1")
    e.stock_costs()
    e.ai.payload = {"items": [{"item_key": "print_part_small", "qty": 10}]}
    assert post(e, 9001, "need 10 small parts", 1, username="ahseng").status_code == 200
    p = party(e)
    assert p["tg_username"] == "ahseng" and p["contact"] == "9001" and p["pending_enquiry"]["text"] == "need 10 small parts"
    assert e.sql("select count(*) n from enquiries")[0]["n"] == 0  # no quote before the name and number
    assert "name and phone number" in sent(e)[-1]

    assert post(e, 9001, "Ah Seng 012-3456789", 2, username="ahseng").status_code == 200
    p = party(e)
    assert (p["name"], p["phone"], p["pending_enquiry"], p["contact"]) == ("Ah Seng", "0123456789", None, "9001")
    assert e.sql("select count(*) n from enquiries")[0]["n"] == 1  # the kept first enquiry was quoted
    assert "Thank you, Ah Seng." in sent(e)[-1]

    assert post(e, 9001, "need 10 small parts", 3).status_code == 200  # known now: no second question
    assert e.sql("select count(*) n from enquiries")[0]["n"] == 2
    assert e.sql("select count(*) n from parties where role='customer' and phone is not null")[0]["n"] == 1  # still the same customer after the rename


def test_asks_twice_then_goes_on_without_a_number(env, monkeypatch):
    e = env
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", SECRET)
    monkeypatch.setenv("TELEGRAM_ASK_PROFILE", "1")
    e.stock_costs()
    e.ai.payload = {"items": [{"item_key": "print_part_small", "qty": 10}]}
    post(e, 9002, "need 10 small parts", 1)
    post(e, 9002, "no thanks", 2)
    assert "could not find a phone number" in sent(e)[-1] and e.sql("select count(*) n from enquiries")[0]["n"] == 0
    post(e, 9002, "still no", 3)
    assert party(e, "9002")["pending_enquiry"] is None and e.sql("select count(*) n from enquiries")[0]["n"] == 1
