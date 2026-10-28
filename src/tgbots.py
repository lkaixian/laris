"""Per-business Telegram bot tokens: encrypted at rest (Fernet, key from SECRET_KEY), decrypted only to call Telegram."""
import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken

from .errors import ApiError


def _fernet() -> Fernet:
    key = os.environ.get("SECRET_KEY", "").strip()
    if not key:  # never a derived fallback: a token encrypted with a guessable key is not encrypted
        raise ApiError(422, "secret_key_unset", "The server has no SECRET_KEY, so a bot token cannot be stored safely. Ask whoever runs this server to set it.")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(("laris-telegram:" + key).encode()).digest()))


def encrypt(text: str) -> str:
    return _fernet().encrypt(text.encode()).decode()


def decrypt(blob: str) -> str:
    try:
        return _fernet().decrypt(blob.encode()).decode()
    except InvalidToken:
        raise RuntimeError("stored Telegram bot token cannot be decrypted (SECRET_KEY changed?)") from None


def token_for(conn, tenant_id) -> str | None:
    """This business's own bot token, or None = use the env bot (TELEGRAM_BOT_TOKEN)."""
    row = conn.execute("select token_enc from tenant_telegram_bots where tenant_id=%s", (tenant_id,)).fetchone()
    return decrypt(row["token_enc"]) if row else None


def via(conn, tenant_id, channel, default=None):
    """What Services.send / send_document take as `phone_id`: for Telegram the business bot's token (None = env bot),
    for everything else the value the caller already had (the WhatsApp number)."""
    return token_for(conn, tenant_id) if channel == "telegram" else default
