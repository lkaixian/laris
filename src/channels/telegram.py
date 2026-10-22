import os
from datetime import datetime, timezone

import httpx

from .base import InboundMessage


def _ok(r, what):
    """raise_for_status without the URL: it embeds the bot token and ends up in logs."""
    if r.status_code >= 400:
        raise RuntimeError(f"telegram {what} failed: HTTP {r.status_code}")


def _api(method, token=None):
    return f"https://api.telegram.org/bot{token or os.environ['TELEGRAM_BOT_TOKEN']}/{method}"


def parse_update(update: dict) -> InboundMessage | None:
    m = update.get("message")
    if not m:
        return None
    msg = InboundMessage(
        "telegram", f"{m['chat']['id']}:{m['message_id']}", str(m["chat"]["id"]),
        text=m.get("text") or m.get("caption"),
        at=datetime.fromtimestamp(m["date"], timezone.utc),
    )
    if "voice" in m or "audio" in m:
        msg.media_kind, msg.media_ref = "audio", (m.get("voice") or m["audio"])["file_id"]
    elif "photo" in m:
        msg.media_kind, msg.media_ref = "image", m["photo"][-1]["file_id"]  # largest last
    elif "document" in m:
        msg.media_kind, msg.media_ref = "document", m["document"]["file_id"]
    return msg


def send_message(chat_id, text, *, client=None, token=None) -> str:
    r = (client or httpx.Client(timeout=20)).post(
        _api("sendMessage", token), json={"chat_id": chat_id, "text": text}
    )
    _ok(r, "sendMessage")
    res = r.json()["result"]
    return f"{res['chat']['id']}:{res['message_id']}"


def get_file(file_id, *, client=None, token=None) -> bytes:
    token = token or os.environ["TELEGRAM_BOT_TOKEN"]
    c = client or httpx.Client(timeout=30)
    r = c.get(_api("getFile", token), params={"file_id": file_id})
    _ok(r, "getFile")
    path = r.json()["result"]["file_path"]
    r = c.get(f"https://api.telegram.org/file/bot{token}/{path}")
    _ok(r, "file download")
    if len(r.content) > 20_000_000:
        raise ValueError("file over 20 MB")
    return r.content


def get_updates(offset=None, timeout=25, *, client=None, token=None) -> list[dict]:
    """Long-poll helper; caller passes offset=last update_id+1."""
    params = {"timeout": timeout, **({"offset": offset} if offset is not None else {})}
    r = (client or httpx.Client(timeout=timeout + 10)).get(_api("getUpdates", token), params=params)
    _ok(r, "getUpdates")
    return r.json()["result"]


def set_webhook(url, secret, *, client=None, token=None) -> dict:
    r = (client or httpx.Client(timeout=20)).post(
        _api("setWebhook", token),
        json={"url": url, "secret_token": secret, "allowed_updates": ["message"], "drop_pending_updates": True})
    _ok(r, "setWebhook")
    return r.json()


def webhook_info(*, client=None, token=None) -> dict:
    r = (client or httpx.Client(timeout=20)).get(_api("getWebhookInfo", token))
    _ok(r, "getWebhookInfo")
    return r.json()["result"]
