"""Failure paths must not put emails, phone numbers, tokens or message text in the log."""
import logging

from src import logsetup
from support.fixtures import env, pg_url  # noqa: F401

SECRETS = ("victim@example.com", "60123456789", "SEKRET-TOKEN", "my private message")


def test_failure_paths_log_no_personal_data(env, caplog):
    e = env
    caplog.handler.addFilter(logsetup.ScrubTraceback())
    caplog.set_level(logging.DEBUG)
    e.c.post("/api/login", json={"username": SECRETS[0], "password": SECRETS[2]})
    e.c.post("/api/invites/accept", json={"token": SECRETS[2], "name": "x", "username": "victim", "password": "correct horse 1"})
    e.c.post("/api/signup", json={"business": "B", "name": "N", "email": SECRETS[0], "password": SECRETS[2]})
    e.c.get(f"/api/documents?q={SECRETS[3]}&token={SECRETS[2]}")
    e.c.post("/webhooks/whatsapp?hub.verify_token=" + SECRETS[2], json={"entry": [{"changes": [{"value": {"messages": [
        {"from": SECRETS[1], "id": "m1", "type": "text", "text": {"body": SECRETS[3]}}]}}]}]})
    try:
        raise ValueError(f"Key (email)=({SECRETS[0]}) already exists")
    except ValueError:
        logging.getLogger("laris").exception("boom")
    mine = [r for r in caplog.records if r.name.startswith("laris")]  # not httpx, which logs the test client's own URL
    assert mine
    text = " ".join(logging.Formatter().format(r) for r in mine)
    for s in SECRETS:
        assert s not in text, s
    assert "ValueError" in text
