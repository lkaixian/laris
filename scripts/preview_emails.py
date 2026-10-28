"""python scripts/preview_emails.py OUTDIR : writes sample emails (.html and .txt) plus index.html, with fake data."""
import sys
from html import escape
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.email_layout import render  # noqa: E402

CODE = ("code", "482913", "Expires in 10 minutes")
SAMPLES = {
    "verification": dict(title="Your verification code", preheader="Your LARIS verification code is 482913.",
                         blocks=[("p", "Hello,"), ("p", "Enter this code to verify your email address."), CODE,
                                 ("note", "If you did not sign up, ignore this email.")],
                         footer="You got this email because someone signed up to LARIS with this address."),
    "reset": dict(title="Reset your password", preheader="Your LARIS password reset code is 482913.",
                  blocks=[("p", "Hello,"), ("p", "Enter this code to choose a new password."), CODE,
                          ("note", "If you did not ask for it, ignore this email. Your password has not changed.")],
                  footer="You got this email because a password reset was requested for this address."),
    "quotation": dict(title="Quotation Q-2026-0001", preheader="Quotation Q-2026-0001 from SAMPLE Sdn Bhd.", brand="SAMPLE Sdn Bhd", via="via LARIS",
                      blocks=[("p", "Dear Sample Customer,"), ("p", "Please find our quotation below. Thank you for the chance to quote."),
                              ("facts", [("Quotation", "Q-2026-0001"), ("Valid until", "30 Nov 2026"), ("Total", "RM 1,250.00")]),
                              ("note", "The quotation is attached as a PDF.")],
                      footer="You got this email because SAMPLE Sdn Bhd sent you a quotation from LARIS."),
    "job_reminder": dict(title="3 jobs due or overdue", preheader="Q-2026-0001 is 2 days overdue.",
                         blocks=[("p", "Hello Sample,"), ("p", "These jobs are due today or overdue."),
                                 ("table", ["Quote", "Customer", "Status"],
                                  [["Q-2026-0001", "Sample Customer", "2 days overdue"], ["Q-2026-0002", "Example Trading", "due today"],
                                   ["Q-2026-0003", "A very long customer name that keeps going on and on", "due today"]]),
                                 ("button", "Open the job board", "https://example.com/jobs")],
                         footer="You got this email because you have job reminders turned on in LARIS."),
    "licence": dict(title="Your LARIS licence is ready", preheader="Download your licence file.",
                    blocks=[("p", "Hello,"), ("p", "Your licence has been issued. Use the button to open it."),
                            ("button", "Get your licence", "https://example.com/licence/abc123"),
                            ("note", "The link works for 7 days.")],
                    footer="You got this email because a LARIS licence was issued for this address."),
    "invite": dict(title="You are invited to SAMPLE Sdn Bhd", preheader="Sample Owner invited you to join SAMPLE Sdn Bhd on LARIS.",
                   blocks=[("p", "Sample Owner invited you to join SAMPLE Sdn Bhd on LARIS as staff."),
                           ("button", "Accept the invitation", "https://example.com/invite/xyz789"),
                           ("note", "This invitation expires in 7 days. If you did not expect it, ignore this email.")],
                   footer="You got this email because someone invited this address to LARIS."),
}


def main(out: str) -> None:
    d = Path(out)
    d.mkdir(parents=True, exist_ok=True)
    links = []
    for name, kw in SAMPLES.items():
        text, html = render(base_url=None, **kw)
        (d / f"{name}.html").write_text(html, encoding="utf-8")
        (d / f"{name}.txt").write_text(text, encoding="utf-8")
        links.append(f'<li><a href="{name}.html">{escape(name)}</a> (<a href="{name}.txt">text</a>)</li>')
        print(d / f"{name}.html", d / f"{name}.txt")
    (d / "index.html").write_text(f'<!DOCTYPE html><html lang="en"><meta charset="utf-8"><title>Email previews</title><ul>{"".join(links)}</ul></html>', encoding="utf-8")
    print(d / "index.html")


if __name__ == "__main__":
    main(sys.argv[1])
