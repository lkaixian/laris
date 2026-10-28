"""Mailtrap HTTP API sender (httpx). send() never raises: a failed or disabled email is a False, never an error for the caller.
MAILTRAP_API_TOKEN (unset = email is off), MAILTRAP_INBOX_ID (set = sandbox inbox, nothing is delivered), MAILTRAP_SENDER_EMAIL, MAILTRAP_SENDER_NAME."""
import base64
import logging
import os

import httpx

from .email_layout import render

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


def base_url() -> str | None:
    return (os.environ.get("APP_PUBLIC_URL") or "").strip().rstrip("/") or None


def _mail(subject: str, title: str, preheader: str, blocks: list, footer: str, brand: str = "LARIS", via: str | None = None) -> tuple[str, str, str]:
    text, html = render(title=title, preheader=preheader, blocks=blocks, brand=brand, via=via, footer=footer, base_url=base_url())
    return subject, text, html


def _code_mail(subject: str, title: str, what: str, code: str, ignore: str, footer: str) -> tuple[str, str, str]:
    return _mail(subject, title, f"Your LARIS {what} is inside. It expires in 10 minutes.", [("p", "Hello,"), ("p", f"Enter this code {ignore[0]}."),
                 ("code", code, "Expires in 10 minutes"), ("note", ignore[1])], footer)


def verification_mail(code: str) -> tuple[str, str, str]:
    """(subject, text, html) for send(to, *verification_mail(...)). The greeting is fixed: it goes to an address nobody has proven yet,
    so no user-supplied text (name, business) is echoed."""
    return _code_mail("Your LARIS verification code", "Your verification code", "verification code", code,
                      ("to verify your email address", "If you did not sign up, ignore this email."),
                      "You got this email because someone signed up to LARIS with this address.")


def reset_mail(code: str) -> tuple[str, str, str]:
    return _code_mail("Your LARIS password reset code", "Reset your password", "password reset code", code,
                      ("to choose a new password", "If you did not ask for it, ignore this email. Your password has not changed."),
                      "You got this email because a password reset was requested for this address.")


def quote_mail(m: dict, note: str | None = None, accept_url: str | None = None) -> tuple[str, str, str]:
    """(subject, text, html) for a quotation sent as a PDF attachment. Built from the customer model: no cost data.
    accept_url: the customer's simulated-signature link, shown as a button."""
    org, doc = m["issuer"]["name"], m["doc_no"]
    facts = [("Quotation", doc)]
    if m["valid_until"]:
        facts.append(("Valid until", str(m["valid_until"])))
    if m.get("total") is not None:
        facts.append(("Total", f"{m['currency']} {m['total']:.2f}"))
    blocks = [("p", f"Dear {m['customer']['attention'] or m['customer']['name']},"), ("p", f"Please find our quotation {doc} from {org}.")]
    if note:
        blocks.append(("p", note))
    blocks.append(("facts", facts))
    if accept_url:
        blocks += [("button", "Review and accept", accept_url), ("note", "Simulated signature for demonstration; not a legal e-signature.")]
    blocks.append(("note", "The quotation is attached as a PDF."))
    return _mail(f"Quotation {doc} from {org}", f"Quotation {doc}", f"Quotation {doc} from {org}.", blocks,
                 f"You got this email because {org} sent you a quotation from LARIS.", brand=org, via="LARIS")


def job_reminder_mail(name: str, jobs: list[dict], link: str | None = None) -> tuple[str, str, str]:
    """(subject, text, html) listing jobs due today or overdue: quote number, customer and days late only, never cost or margin."""
    def when(n: int) -> str:
        return "due today" if n == 0 else f"{n} day{'s' if n != 1 else ''} overdue"
    n = len(jobs)
    blocks = [("p", f"Hello {name},"), ("p", f"{n} job{'s are' if n != 1 else ' is'} due today or overdue:"),
              ("table", ["Quote", "Customer", "Status"], [[j["doc_no"], j["customer"], when(j["days_overdue"])] for j in jobs])]
    if link:
        blocks.append(("button", "Open the job board", link))
    return _mail(f"Jobs to do: {n} due or overdue", f"{n} job{'s' if n != 1 else ''} due or overdue", f"{jobs[0]['doc_no']}: {when(jobs[0]['days_overdue'])}." if jobs else "Jobs to do.",
                 blocks, "You got this email because you have job reminders turned on in LARIS.")


def license_mail(plan: str, seats: int, token: str) -> tuple[str, str, str]:
    """(subject, text, html) telling a customer their licence is ready: a button to the Licence page and the key to paste."""
    b = base_url()
    blocks = [("p", f"Your LARIS licence ({plan}, {seats} seats) is ready."),
              ("p", "Sign in as the owner with this email address, open Licence and accept it, or paste this key.")]
    if b:
        blocks.append(("button", "Open the Licence page", f"{b}/#/licence"))
    blocks += [("mono", token), ("note", "Keep it private: it works for one organisation.")]
    return _mail("Your LARIS licence key", "Your LARIS licence is ready", f"Your {plan} licence for {seats} seats is ready.", blocks,
                 "You got this email because a LARIS licence was issued for this address.")
