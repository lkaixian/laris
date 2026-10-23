from dataclasses import dataclass
from datetime import datetime


@dataclass
class InboundMessage:
    channel: str  # "whatsapp" | "telegram"
    external_id: str
    sender: str
    text: str | None = None
    media_kind: str | None = None  # audio | image | document
    media_ref: str | None = None  # WA media id / Telegram file_id
    at: datetime | None = None
    to: str | None = None  # the business number it arrived on (WhatsApp phone_number_id)
    reply_to: str | None = None  # provider id of the message this replies to: WhatsApp wamid, or Telegram "chat:message_id"
