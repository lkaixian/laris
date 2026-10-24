"""Owner health readout: each check is a tiny function returning an item dict or None. Messages name settings, never their values."""
import logging
import os
import shutil

from . import auth, db, mailer, ocr, scheduler, vision
from . import license as lic

log = logging.getLogger("laris")
RANK = {"info": 1, "warn": 2, "critical": 3}


def _item(level, code, message, fix):
    return {"level": level, "code": code, "message": message, "fix": fix}


def _deployed() -> bool:
    return bool(os.environ.get("REPLIT_DEPLOYMENT") or os.environ.get("REPL_DEPLOYMENT"))


def _set(name: str) -> bool:
    return bool(os.environ.get(name, "").strip())


def email_off(ctx):
    if not mailer.enabled():
        return _item("warn", "email_off", "Email is off, so sign-up codes, password resets and quotes cannot be emailed.", "Set MAILTRAP_API_TOKEN in Secrets and restart.")


def email_sandbox(ctx):
    if mailer.enabled() and _set("MAILTRAP_INBOX_ID"):
        return _item("info", "email_sandbox", "Email goes to a test inbox, so nobody receives it.", "Remove MAILTRAP_INBOX_ID from Secrets when you are ready to send real email.")


def rls_bypass(ctx):
    if db.rls_status(ctx.conn)[0]:
        return _item("critical", "rls_bypass", "The database login can see every business's data; businesses are not kept apart.", "Connect as the laris_app role (db/roles.sql) in DATABASE_URL.")


def demo_mode(ctx):
    if auth.header_mode_allowed(ctx.conn):
        return (_item("critical", "demo_mode", "Demo mode is on: anyone who can reach this site can act as the owner without signing in.",
                      "Set a password for the owner (BOOTSTRAP_OWNER_USERNAME / BOOTSTRAP_OWNER_PASSWORD), set REQUIRE_USER_TOKEN=1 and remove DEMO_MODE.")
                if _deployed() else
                _item("info", "demo_mode", "Demo mode is on: no sign-in is needed on this machine.", "Before going live, remove DEMO_MODE and give the owner a password."))


def scheduler_off(ctx):
    if os.environ.get("SCHEDULER") != "1":
        return _item("warn", "scheduler_off", "The background runner is off: follow-ups, expiry, clean-up and job reminders will not run.", "Set SCHEDULER=1 in Secrets and restart.")


def scheduler_failing(ctx):
    st = scheduler.status()
    if st["errors"] or st["ok"] is False:
        return _item("warn", "scheduler_failing", "The last background run had errors, so some follow-ups or reminders may have been skipped.", "Check the server log for 'scheduler' lines.")


def ntp_offline(ctx):
    s = lic.status(ctx.conn, ctx.tenant_id)
    if s["enforced"] and s["clock"] and s["clock"]["source"] != "ntp":
        return _item("info", "ntp_offline", "The server cannot reach an internet time service, so the licence uses the machine's own clock.", "Allow outbound UDP port 123 (pool.ntp.org, time.google.com).")


def licence(ctx):
    s = lic.status(ctx.conn, ctx.tenant_id)
    if s["status"] == "expired":
        return _item("critical", "licence_expiring", "Your licence has expired and changes are paused.", "Owner: open Licence, request or activate a new licence.")
    if s["status"] == "expiring":
        return _item("warn", "licence_expiring", f"Your licence ends in {max(s['days_left'], 0)} day(s).", "Owner: open Licence and request a renewal.")


def ilmu_not_set(ctx):
    if not _set("ILMU_API_KEY"):
        return _item("info", "ilmu_not_set", "The AI that reads customer messages is not set up.", "Set ILMU_API_KEY in Secrets and restart.")


def vision_not_set(ctx):
    if vision.missing_env():
        return _item("info", "vision_not_set", "Reading product photos is not set up.", "Set " + " and ".join(vision.missing_env()) + " in Secrets and restart.")


def whatsapp_not_set(ctx):
    if not (_set("WHATSAPP_TOKEN") and _set("WHATSAPP_PHONE_NUMBER_ID")):
        return _item("info", "whatsapp_not_set", "WhatsApp is not connected.", "Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Secrets.")


def telegram_not_set(ctx):
    if not _set("TELEGRAM_BOT_TOKEN"):
        return _item("info", "telegram_not_set", "Telegram is not connected.", "Set TELEGRAM_BOT_TOKEN in Secrets.")


def ocr_missing(ctx):
    if not (shutil.which("tesseract") or os.path.isdir(ocr.TESS_DIR)):
        return _item("info", "ocr_missing", "Text reading for scanned documents (Tesseract) is not installed.", "Install Tesseract on the server, or install paddleocr.")


def public_url_unset(ctx):
    if not _set("APP_PUBLIC_URL"):
        return _item("warn", "public_url_unset", "The site's public address is not set, so links in emails may be wrong.", "Set APP_PUBLIC_URL (for example https://yourshop.example) in Secrets.")


def secret_key_unset(ctx):
    if not _set("SECRET_KEY"):
        return _item("critical" if _deployed() else "warn", "secret_key_unset", "No secret key is set, so security codes are derived from the database address.", "Set SECRET_KEY to a long random value in Secrets.")


def proxy_not_trusted(ctx):
    if _deployed() and os.environ.get("TRUST_PROXY") != "1":
        return _item("warn", "proxy_not_trusted", "Every visitor looks like the same address, so one bad login streak can lock everyone out.", "Set TRUST_PROXY=1 in Secrets.")


def no_owner_email(ctx):
    if not ctx.conn.execute("select 1 from users where role = 'owner' and active and email is not null and email <> '' limit 1").fetchone():
        return _item("warn", "no_owner_email", "No active owner has an email address, so nobody can recover a lost password.", "Add an email to the owner's account under Team.")


CHECKS = (email_off, email_sandbox, rls_bypass, demo_mode, scheduler_off, scheduler_failing, ntp_offline, licence, ilmu_not_set, vision_not_set,
          whatsapp_not_set, telegram_not_set, ocr_missing, public_url_unset, secret_key_unset, proxy_not_trusted, no_owner_email)


def report(ctx) -> dict:
    items = []
    for chk in CHECKS:
        try:
            if it := chk(ctx):
                items.append(it)
        except Exception as e:  # one broken check yields no item; the type only, the text could carry a URL or a secret
            log.warning("health check %s failed: %s", chk.__name__, type(e).__name__)
    items.sort(key=lambda i: -RANK[i["level"]])
    return {"level": items[0]["level"] if items else "ok", "items": items}
