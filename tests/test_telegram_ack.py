"""Telegram users see 'received' (eyes), a typing indicator while we work, then thumbs up or sad face. No network, no database."""
import time
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api import webhooks
from src.channels.base import InboundMessage

SECRET = "s3"


def client(monkeypatch, outcome, calls):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", SECRET)
    monkeypatch.setattr(webhooks, "TG_ACK", True)

    def react(chat, mid, emoji, *, client=None):
        calls.append(("react", chat, mid, emoji))
        if emoji == "👀":
            raise RuntimeError("telegram setMessageReaction failed: HTTP 400")  # must not stop the reply

    def process(s, msgs, statuses=()):
        calls.append(("process",))
        time.sleep(0.3)  # a slow voice note: the typing task gets to run
        s.send("telegram", msgs[0].sender, "reply")
        return outcome(msgs)

    monkeypatch.setattr(webhooks.telegram, "react", react)
    monkeypatch.setattr(webhooks.telegram, "chat_action", lambda chat, action, *, client=None: calls.append(("action", action)))
    monkeypatch.setattr(webhooks, "_process", process)
    app = FastAPI()
    app.include_router(webhooks.r)
    app.state.svc = SimpleNamespace(http=None, send=lambda *a: calls.append(("send", a[2])))
    return TestClient(app)


def post(c):
    upd = {"message": {"message_id": 7, "chat": {"id": 5551}, "date": 1700000000, "voice": {"file_id": "f"}}}
    return c.post("/webhooks/telegram", json=upd, headers={"X-Telegram-Bot-Api-Secret-Token": SECRET})


def test_voice_update_is_acknowledged_in_order_and_a_failing_reaction_does_not_stop_the_reply(monkeypatch):
    calls = []
    assert post(client(monkeypatch, lambda msgs: [(msgs[0], True)], calls)).status_code == 200
    assert calls[0] == ("react", "5551", "7", "👀")
    assert ("action", "typing") in calls and calls.index(("action", "typing")) < calls.index(("send", "reply"))
    assert calls.index(("send", "reply")) < calls.index(("react", "5551", "7", "👍")) == len(calls) - 1


def test_a_sorry_outcome_ends_with_the_sad_reaction(monkeypatch):
    calls = []
    post(client(monkeypatch, lambda msgs: [(msgs[0], False)], calls))
    assert calls[-1] == ("react", "5551", "7", "😢")


def test_an_unheard_voice_note_gets_the_friendly_reply(monkeypatch):
    def deaf(*a):
        raise RuntimeError("stt down")

    monkeypatch.setattr(webhooks, "resolve_tenant", lambda conn, m, d: ("t", None))
    monkeypatch.setattr(webhooks, "_limited", lambda *a, **k: False)
    monkeypatch.setattr(webhooks.lic, "configured", lambda: False)
    monkeypatch.setattr(webhooks.pipeline, "party", lambda *a: "p")
    monkeypatch.setattr(webhooks.pipeline, "transcribe", deaf)

    class Conn:  # no duplicate, no staff, no party
        def execute(self, *a, **k):
            return SimpleNamespace(fetchone=lambda: None)

    s = SimpleNamespace(download=lambda *a: (b"x", "audio/ogg"), ilmu=None)
    m = InboundMessage("telegram", "5551:7", "5551", media_kind="audio", media_ref="f")
    assert webhooks._handle(Conn(), s, m) == webhooks.VOICE_SORRY
    assert "could not hear that clearly" in webhooks.VOICE_SORRY
