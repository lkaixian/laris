"""Invitation email templates: (subject, text, html) for svc.mail(to, *invite_mail(...))."""
from html import escape


def invite_mail(business: str, role: str, inviter: str, link: str) -> tuple[str, str, str]:
    subject = f"You are invited to {business} on LARIS"
    lines = [f"{inviter} invited you to join {business} on LARIS as {role}.", "This invitation expires in 7 days."]
    text = "\n\n".join([*lines, f"Accept it here: {link}", "If you did not expect this, ignore this email."])
    html = ("".join(f"<p>{escape(x)}</p>" for x in lines) + f'<p><a href="{escape(link)}">Accept the invitation</a></p>'
            + f"<p>{escape(link)}</p><p>If you did not expect this, ignore this email.</p>")
    return subject, text, html
