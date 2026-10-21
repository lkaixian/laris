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
