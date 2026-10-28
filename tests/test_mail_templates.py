"""The mail builders render through email_layout: one code, no cost words, escaped tables, no U+2014, logo only with APP_PUBLIC_URL."""
import re
from datetime import date
from decimal import Decimal

from src import mailer
from src.invite_mail import invite_mail

M = {"doc_no": "Q-1", "customer": {"name": "Acme", "attention": None}, "issuer": {"name": "Shop Sdn Bhd"}, "valid_until": date(2026, 12, 1),
     "currency": "MYR", "total": Decimal("12.5")}


def _all(monkeypatch, url):
    (monkeypatch.setenv if url else monkeypatch.delenv)("APP_PUBLIC_URL", *([url] if url else []), **({} if url else {"raising": False}))
    return [mailer.verification_mail("123456"), mailer.reset_mail("123456"), mailer.quote_mail(M, "Thanks"),
            mailer.job_reminder_mail("Ann", [{"doc_no": "Q-1", "customer": "Acme", "days_overdue": 2}], "https://a.test/#/jobs"),
            invite_mail("Shop", "staff", "Bo", "https://a.test/#/invite?token=t"), mailer.license_mail("standard", 5, "KEY.abc")]


def test_no_em_dash_and_logo_only_with_base_url(monkeypatch):
    for s, t, h in _all(monkeypatch, "https://a.test/"):
        assert "\u2014" not in s + t + h and '<img src="https://a.test/brand/laris-logo.png"' in h
    for s, t, h in _all(monkeypatch, None):
        assert "<img" not in h


def test_code_once_and_quote_has_no_cost_words(monkeypatch):
    v, r, q, j, i, lc = _all(monkeypatch, "https://a.test")
    assert v[2].count("123456") == 1 and "Expires in 10 minutes" in v[2] and r[2].count("123456") == 1
    low = (q[1] + re.sub(r"<style>.*?</style>|<[^>]+>", " ", q[2])).lower()  # visible words, not CSS
    assert not any(w in low for w in ("cost", "margin", "supplier")) and "Q-1" in q[1] and "MYR 12.50" in q[1] and "attached as a PDF" in q[1]
    assert "Shop Sdn Bhd" in q[2] and "Thanks" in q[1]
    assert "Accept the invitation" in i[2] and "token=t" in i[1]
    assert 'href="https://a.test/#/licence"' in lc[2] and "KEY.abc" in lc[1] and lc[2].count("KEY.abc") == 1


def test_jobs_table_escapes_names(monkeypatch):
    _, text, html = mailer.job_reminder_mail("Ann", [{"doc_no": "Q-1", "customer": "<script>x</script>", "days_overdue": 0}])
    assert "<script>" not in html and "&lt;script&gt;" in html and "due today" in html
