from dataclasses import dataclass
from datetime import datetime

MAX_MEDIA = 20_000_000


def read_capped(r, cap: int = MAX_MEDIA) -> bytes:
    """Body of a streamed httpx response, aborting as soon as it passes the cap (never buffers more than cap + one chunk)."""
    buf = bytearray()
    for chunk in r.iter_bytes():
        buf += chunk
        if len(buf) > cap:
            raise ValueError(f"media over {cap // 1_000_000} MB")
    return bytes(buf)


@dataclass
class InboundMessage:
    channel: str  # "whatsapp" | "telegram"
    external_id: str
    sender: str
    text: str | None = None
    media_kind: str | None = None  # audio | image | document
    media_ref: str | None = None  # WA media id / Telegram file_id
    media_name: str | None = None  # a document's file name, when the channel gives one
    at: datetime | None = None
    to: str | None = None  # the business number it arrived on (WhatsApp phone_number_id)
    reply_to: str | None = None  # provider id of the message this replies to: WhatsApp wamid, or Telegram "chat:message_id"
