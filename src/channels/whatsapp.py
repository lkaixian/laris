import hashlib
import hmac
import os
from datetime import datetime, timezone

import httpx

from .base import InboundMessage

GRAPH = "https://graph.facebook.com/v21.0"


def verify_challenge(params: dict, verify_token: str) -> str | None:
    """Meta GET verify: return hub.challenge if token matches, else None (route -> 403)."""
    if params.get("hub.mode") == "subscribe" and hmac.compare_digest(
        str(params.get("hub.verify_token", "")), verify_token
    ):
        return params.get("hub.challenge")
    return None


def verify_signature(raw_body: bytes, header: str | None, app_secret: str) -> bool:
    if not header or not header.startswith("sha256=") or not app_secret:
        return False
    mac = hmac.new(app_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, header[7:])


def _ts(v) -> datetime:
    return datetime.fromtimestamp(int(v), timezone.utc)


def _values(payload: dict):
    for e in payload.get("entry", []):
        for c in e.get("changes", []):
            yield c.get("value", {})


def parse_inbound(payload: dict) -> list[InboundMessage]:
    out = []
    for v in _values(payload):
        for m in v.get("messages", []):
            t = m.get("type")
            msg = InboundMessage(
                "whatsapp", m["id"], m.get("from", ""),
                at=_ts(m["timestamp"]) if "timestamp" in m else None,
            )
            if t == "text":
                msg.text = m["text"]["body"]
            elif t in ("audio", "image", "document"):
                msg.media_kind = t
                msg.media_ref = m[t]["id"]
                msg.text = m[t].get("caption")
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


def send_template(to, name, lang="en", params=(), *, client=None, token=None, phone_id=None) -> str:
    tpl = {"name": name, "language": {"code": lang}}
    if params:
        tpl["components"] = [
            {"type": "body", "parameters": [{"type": "text", "text": p} for p in params]}
        ]
    return _post({"to": to, "type": "template", "template": tpl}, client, token, phone_id)


def download_media(media_id, *, client=None, token=None) -> tuple[bytes, str]:
    """Two steps: GET media metadata (url, mime_type), then GET url with auth."""
    c = _client(client)
    h = {"Authorization": f"Bearer {token or os.environ['WHATSAPP_TOKEN']}"}
    r = c.get(f"{GRAPH}/{media_id}", headers=h)
    r.raise_for_status()
    meta = r.json()
    r = c.get(meta["url"], headers=h)
    r.raise_for_status()
    return r.content, meta.get("mime_type", "")
