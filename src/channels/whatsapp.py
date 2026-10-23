import hashlib
import hmac
import os
from datetime import datetime, timezone

import httpx

from .base import InboundMessage

GRAPH = "https://graph.facebook.com/v21.0"
MEDIA_HOSTS = (".facebook.com", ".fbsbx.com", ".fbcdn.net", ".whatsapp.net")  # the bearer token only goes to Meta
MAX_MEDIA = 20_000_000
OUTSIDE_WINDOW = "131047"  # Graph error: free-form message outside the 24h customer-service window


def is_outside_window(e: httpx.HTTPStatusError) -> bool:
    return OUTSIDE_WINDOW in e.response.text


def verify_challenge(params: dict, verify_token: str) -> str | None:
    """Meta GET verify: return hub.challenge if token matches, else None (route -> 403)."""
    if params.get("hub.mode") == "subscribe" and hmac.compare_digest(
        str(params.get("hub.verify_token", "")).encode(), verify_token.encode()
    ):
        return params.get("hub.challenge")
    return None


def verify_signature(raw_body: bytes, header: str | None, app_secret: str) -> bool:
    if not header or not header.startswith("sha256=") or not app_secret:
        return False
    mac = hmac.new(app_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac.encode(), header[7:].encode())  # bytes: non-ASCII input must not raise


def _ts(v) -> datetime:
    return datetime.fromtimestamp(int(v), timezone.utc)


def _values(payload: dict):
    for e in payload.get("entry", []):
        for c in e.get("changes", []):
            yield c.get("value", {})


def parse_inbound(payload: dict) -> list[InboundMessage]:
    out = []
    for v in _values(payload):
        to = (v.get("metadata") or {}).get("phone_number_id")
        for m in v.get("messages", []):
            t = m.get("type")
            msg = InboundMessage(
                "whatsapp", m["id"], m.get("from", ""),
                at=_ts(m["timestamp"]) if "timestamp" in m else None, to=to,
                reply_to=(m.get("context") or {}).get("id"),  # wamid of our message this one answers
            )
            if t == "text":
                msg.text = m["text"]["body"]
            elif t in ("audio", "image", "document"):
                msg.media_kind = t
                msg.media_ref = m[t]["id"]
                msg.text = m[t].get("caption")
                msg.media_name = m[t].get("filename")
            else:
                continue
            out.append(msg)
    return out


def parse_status(payload: dict) -> list[tuple[str, str, datetime]]:
    return [
        (s["id"], s["status"], _ts(s["timestamp"]))
        for v in _values(payload)
        for s in v.get("statuses", [])
        if s.get("status") in ("delivered", "read")
    ]


def _client(client):
    return client or httpx.Client(timeout=20)


def _post(body, client, token, phone_id):
    token = token or os.environ["WHATSAPP_TOKEN"]
    phone_id = phone_id or os.environ["WHATSAPP_PHONE_NUMBER_ID"]
    r = _client(client).post(
        f"{GRAPH}/{phone_id}/messages",
        json={"messaging_product": "whatsapp", **body},
        headers={"Authorization": f"Bearer {token}"},
    )
    r.raise_for_status()
    return r.json()["messages"][0]["id"]  # wamid; store as external_id


def send_text(to, text, *, client=None, token=None, phone_id=None) -> str:
    return _post({"to": to, "type": "text", "text": {"body": text}}, client, token, phone_id)


def send_template(to, name, lang="en", params=(), *, header_image=None, client=None, token=None, phone_id=None) -> str:
    """header_image: media id for a template whose header is an image."""
    tpl = {"name": name, "language": {"code": lang}, "components": []}
    if header_image:
        tpl["components"].append({"type": "header", "parameters": [{"type": "image", "image": {"id": header_image}}]})
    if params:
        tpl["components"].append(
            {"type": "body", "parameters": [{"type": "text", "text": p} for p in params]}
        )
    if not tpl["components"]:
        del tpl["components"]
    return _post({"to": to, "type": "template", "template": tpl}, client, token, phone_id)


def send_image(to, media_id, caption, *, client=None, token=None, phone_id=None) -> str:
    return _post({"to": to, "type": "image", "image": {"id": media_id, "caption": caption}}, client, token, phone_id)


def upload_media(data: bytes, mime: str, *, client=None, token=None, phone_id=None) -> str:
    """Upload once, send the id to many: -> media id (valid for the same phone number only)."""
    r = _client(client).post(
        f"{GRAPH}/{phone_id or os.environ['WHATSAPP_PHONE_NUMBER_ID']}/media",
        data={"messaging_product": "whatsapp", "type": mime},
        files={"file": ("item." + mime.split("/")[-1], data, mime)},
        headers={"Authorization": f"Bearer {token or os.environ['WHATSAPP_TOKEN']}"},
    )
    r.raise_for_status()
    return r.json()["id"]


def download_media(media_id, *, client=None, token=None) -> tuple[bytes, str]:
    """Two steps: GET media metadata (url, mime_type), then GET url with auth."""
    c = _client(client)
    h = {"Authorization": f"Bearer {token or os.environ['WHATSAPP_TOKEN']}"}
    r = c.get(f"{GRAPH}/{media_id}", headers=h)
    r.raise_for_status()
    meta = r.json()
    u = httpx.URL(meta["url"])
    if u.scheme != "https" or not (u.host or "").endswith(MEDIA_HOSTS):
        raise ValueError(f"media host not allowed: {u.host}")
    r = c.get(u, headers=h)
    r.raise_for_status()
    if len(r.content) > MAX_MEDIA:
        raise ValueError("media over 20 MB")
    return r.content, meta.get("mime_type", "")
