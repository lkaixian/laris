import os
import re
from datetime import datetime, timezone

import httpx

from .base import MAX_MEDIA, InboundMessage, read_capped


def _ok(r, what):
    """raise_for_status without the URL: it embeds the bot token and ends up in logs."""
    if r.status_code >= 400:
        raise RuntimeError(f"telegram {what} failed: HTTP {r.status_code}")


TG_CONTACT = re.compile(r"^\s*(?:tg|telegram):(-?\d+)\s*$", re.I)  # a party contact that means "send on Telegram"
NOT_STARTED = "supplier must open the bot and press Start first"


def chat_of(contact) -> str | None:
    m = TG_CONTACT.match(contact or "")
    return m.group(1) if m else None


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
    msg.username = (m.get("from") or {}).get("username")
    if (rt := m.get("reply_to_message")) and "message_id" in rt:
        msg.reply_to = f"{m['chat']['id']}:{rt['message_id']}"  # same shape send_message/send_photo return
    if "voice" in m or "audio" in m:
        msg.media_kind, msg.media_ref = "audio", (m.get("voice") or m["audio"])["file_id"]
    elif "photo" in m:
        msg.media_kind, msg.media_ref = "image", m["photo"][-1]["file_id"]  # largest last
    elif "document" in m:
        msg.media_kind, msg.media_ref = "document", m["document"]["file_id"]
        msg.media_name = m["document"].get("file_name")
    return msg


def send_message(chat_id, text, *, client=None, token=None, reply_markup=None) -> str:
    r = (client or httpx.Client(timeout=20)).post(
        _api("sendMessage", token), json={"chat_id": chat_id, "text": text, **({"reply_markup": reply_markup} if reply_markup else {})}
    )
    _ok(r, "sendMessage")
    res = r.json()["result"]
    return f"{res['chat']['id']}:{res['message_id']}"


def react(chat_id, message_id, emoji, *, client=None, token=None) -> None:
    """One bot reaction per message; setting another replaces it. Raises like send_message; the caller decides if it matters."""
    r = (client or httpx.Client(timeout=10)).post(
        _api("setMessageReaction", token),
        json={"chat_id": chat_id, "message_id": int(message_id), "reaction": [{"type": "emoji", "emoji": emoji}]})
    _ok(r, "setMessageReaction")


def chat_action(chat_id, action="typing", *, client=None, token=None) -> None:
    """Shows for 5 seconds or until the bot sends a message."""
    r = (client or httpx.Client(timeout=10)).post(_api("sendChatAction", token), json={"chat_id": chat_id, "action": action})
    _ok(r, "sendChatAction")


def send_photo(chat_id, image_bytes, mime, caption, *, client=None, token=None) -> str:
    r = (client or httpx.Client(timeout=30)).post(
        _api("sendPhoto", token), data={"chat_id": str(chat_id), "caption": caption[:1024]},
        files={"photo": ("photo." + ("png" if mime == "image/png" else "jpg"), image_bytes, mime)})
    if r.status_code == 403 or (r.status_code == 400 and "chat not found" in r.text.lower()):
        raise RuntimeError(NOT_STARTED)  # never pressed Start (or blocked the bot); no URL, it carries the token
    _ok(r, "sendPhoto")
    res = r.json()["result"]
    return f"{res['chat']['id']}:{res['message_id']}"


def send_document(chat_id, data: bytes, mime: str, filename: str, caption: str, *, client=None, token=None) -> str:
    r = (client or httpx.Client(timeout=30)).post(
        _api("sendDocument", token), data={"chat_id": str(chat_id), "caption": caption[:1024]}, files={"document": (filename, data, mime)})
    if r.status_code == 403 or (r.status_code == 400 and "chat not found" in r.text.lower()):
        raise RuntimeError("the customer must open the bot and press Start first")  # no URL: it carries the token
    _ok(r, "sendDocument")
    res = r.json()["result"]
    return f"{res['chat']['id']}:{res['message_id']}"


def get_file(file_id, *, client=None, token=None) -> bytes:
    token = token or os.environ["TELEGRAM_BOT_TOKEN"]
    c = client or httpx.Client(timeout=30)
    r = c.get(_api("getFile", token), params={"file_id": file_id})
    _ok(r, "getFile")
    path = r.json()["result"]["file_path"]
    with c.stream("GET", f"https://api.telegram.org/file/bot{token}/{path}") as r:
        _ok(r, "file download")
        return read_capped(r, MAX_MEDIA)


def get_updates(offset=None, timeout=25, *, client=None, token=None) -> list[dict]:
    """Long-poll helper; caller passes offset=last update_id+1."""
    params = {"timeout": timeout, **({"offset": offset} if offset is not None else {})}
    r = (client or httpx.Client(timeout=timeout + 10)).get(_api("getUpdates", token), params=params)
    _ok(r, "getUpdates")
    return r.json()["result"]


def set_webhook(url, secret, *, client=None, token=None, updates=("message",)) -> dict:
    r = (client or httpx.Client(timeout=20)).post(
        _api("setWebhook", token),
        json={"url": url, "secret_token": secret, "allowed_updates": list(updates), "drop_pending_updates": True})
    _ok(r, "setWebhook")
    return r.json()


COMMANDS = [{"command": "start", "description": "How to use this bot"}, {"command": "help", "description": "What you can send"},
            {"command": "catalog", "description": "Staff: caption a product photo with this"}]


def set_commands(*, client=None, token=None) -> dict:
    """The blue Menu button next to the message box."""
    r = (client or httpx.Client(timeout=20)).post(_api("setMyCommands", token), json={"commands": COMMANDS})
    _ok(r, "setMyCommands")
    return r.json()


def webhook_info(*, client=None, token=None) -> dict:
    r = (client or httpx.Client(timeout=20)).get(_api("getWebhookInfo", token))
    _ok(r, "getWebhookInfo")
    return r.json()["result"]


def get_me(token, *, client=None) -> dict:
    """The bot behind a token: {id, username, first_name, ...}. Raises on a refused token (HTTP 401) like the others."""
    r = (client or httpx.Client(timeout=20)).get(_api("getMe", token))
    _ok(r, "getMe")
    return r.json()["result"]


def managed_bot_token(bot_id, *, client=None, token=None) -> str:
    """The token of a bot created through this (manager) bot, by the managed bot's user id. Raises like the others; never log the result."""
    r = (client or httpx.Client(timeout=20)).post(_api("getManagedBotToken", token), json={"user_id": bot_id})
    _ok(r, "getManagedBotToken")
    return r.json()["result"]


def delete_webhook(token, *, client=None) -> None:
    r = (client or httpx.Client(timeout=20)).post(_api("deleteWebhook", token), json={"drop_pending_updates": True})
    _ok(r, "deleteWebhook")
