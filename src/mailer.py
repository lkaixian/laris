"""Mailtrap HTTP API sender (httpx). send() never raises: a failed or disabled email is a False, never an error for the caller.
MAILTRAP_API_TOKEN (unset = email is off), MAILTRAP_INBOX_ID (set = sandbox inbox, nothing is delivered), MAILTRAP_SENDER_EMAIL, MAILTRAP_SENDER_NAME."""
import base64
import logging
import os
from html import escape

import httpx

log = logging.getLogger("laris")
LIVE = "https://send.api.mailtrap.io/api/send"
SANDBOX = "https://sandbox.api.mailtrap.io/api/send"
MAX_ATTACH = 8_000_000  # bytes of attachments per email, before base64
_warned = False


def enabled() -> bool:
    return bool(os.environ.get("MAILTRAP_API_TOKEN"))


def send(to: str, subject: str, text: str, html: str | None = None, category: str | None = None,
         attachments: list[dict] | None = None) -> bool:
    """True only on a 2xx from Mailtrap. attachments = [{filename, content (bytes), mime}], at most MAX_ATTACH in all (else False).
    Logs neither the token nor the recipient nor the body."""
    global _warned
    token = os.environ.get("MAILTRAP_API_TOKEN")
    if not token:
        if not _warned:
            log.warning("email is off: MAILTRAP_API_TOKEN is not set, no email will be sent")
            _warned = True
        return False
    inbox = (os.environ.get("MAILTRAP_INBOX_ID") or "").strip()
    body = {"from": {"email": os.environ.get("MAILTRAP_SENDER_EMAIL") or "noreply@example.com", "name": os.environ.get("MAILTRAP_SENDER_NAME") or "LARIS"},
            "to": [{"email": to}], "subject": subject, "text": text}
    if html:
        body["html"] = html
    if category:
        body["category"] = category
    if attachments:
        if sum(len(a["content"]) for a in attachments) > MAX_ATTACH:
            log.warning("email not sent: attachments over %s bytes", MAX_ATTACH)
            return False
        body["attachments"] = [{"filename": a["filename"], "type": a["mime"], "disposition": "attachment",
                                "content": base64.b64encode(a["content"]).decode()} for a in attachments]
    try:
        r = httpx.post(f"{SANDBOX}/{inbox}" if inbox else LIVE, json=body, headers={"Authorization": f"Bearer {token}"}, timeout=10)
        if r.is_success:
            return True
        log.warning("mailtrap refused an email: HTTP %s", r.status_code)
    except Exception as e:  # never raises; the exception type only, its text can carry the request URL
        log.warning("mailtrap request failed: %s", type(e).__name__)
    return False


def _mail(subject: str, lines: list[str]) -> tuple[str, str, str]:
    return subject, "\n\n".join(lines), "".join(f"<p>{escape(x)}</p>" for x in lines)


def verification_mail(code: str, name: str) -> tuple[str, str, str]:
    """(subject, text, html) for send(to, *verification_mail(...))."""
    return _mail("Your LARIS verification code", [f"Hello {name},", f"Your LARIS verification code is {code}. It expires in 10 minutes.",
                                                  "If you did not sign up, ignore this email."])


def reset_mail(code: str, name: str) -> tuple[str, str, str]:
    return _mail("Your LARIS password reset code", [f"Hello {name},", f"Your LARIS password reset code is {code}. It expires in 10 minutes.",
                                                    "If you did not ask for it, ignore this email; your password has not changed."])


def quote_mail(m: dict, note: str | None = None) -> tuple[str, str, str]:
    """(subject, text, html) for a quotation sent as a PDF attachment. Built from the customer model: no cost data."""
    org = m["issuer"]["name"]
    lines = [f"Dear {m['customer']['attention'] or m['customer']['name']},", f"Please find our quotation {m['doc_no']} from {org}."]
    if note:
        lines.append(note)
    if m["valid_until"]:
        lines.append(f"Valid until {m['valid_until']}.")
    lines.append("The quotation is attached as a PDF.")
    return _mail(f"Quotation {m['doc_no']} from {org}", lines)
