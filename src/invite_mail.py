"""Invitation email templates: (subject, text, html) for svc.mail(to, *invite_mail(...))."""
from .mailer import _mail


def invite_mail(business: str, role: str, inviter: str, link: str) -> tuple[str, str, str]:
    return _mail(f"You are invited to {business} on LARIS", f"You are invited to {business}", f"{inviter} invited you to join {business} on LARIS.",
                 [("p", f"{inviter} invited you to join {business} on LARIS as {role}."), ("button", "Accept the invitation", link),
                  ("note", "This invitation expires in 7 days. If you did not expect this, ignore this email.")],
                 "You got this email because someone invited this address to LARIS.")
