"""Channel setup. Usage (from the repo root, env or .env loaded by you):
  python scripts/setup_channels.py check                 # which keys are set, never prints values
  python scripts/setup_channels.py telegram-webhook URL  # URL = https://<host>/webhooks/telegram
  python scripts/setup_channels.py telegram-info
  python scripts/setup_channels.py telegram-poll [BASE]  # dev without a public URL: long-poll and forward to BASE (default http://localhost:5000)
WhatsApp is configured in the Meta dashboard: callback https://<host>/webhooks/whatsapp, verify token = WHATSAPP_VERIFY_TOKEN."""
import os
import sys

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.channels import telegram  # noqa: E402

KEYS = {"ILMU_API_KEY": "voice notes + extraction", "WHATSAPP_TOKEN": "send/download", "WHATSAPP_PHONE_NUMBER_ID": "send",
        "WHATSAPP_VERIFY_TOKEN": "Meta GET verify", "WHATSAPP_APP_SECRET": "HMAC of inbound POSTs",
        "WHATSAPP_FOLLOWUP_TEMPLATE": "optional: outside the 24h window", "TELEGRAM_BOT_TOKEN": "bot",
        "TELEGRAM_WEBHOOK_SECRET": "required: webhook 403s without it", "APP_TOKEN": "bearer for /api (set on public hosts)"}


def main(a):
    cmd = a[0] if a else "check"
    if cmd == "check":
        for k, why in KEYS.items():
            print(f"{'set    ' if os.environ.get(k) else 'MISSING'} {k:28} {why}")
    elif cmd == "telegram-webhook" and len(a) == 2:
        if not a[1].startswith("https://"):
            sys.exit("Telegram only accepts https URLs")
        print(telegram.set_webhook(a[1], os.environ["TELEGRAM_WEBHOOK_SECRET"]))
    elif cmd == "telegram-info":
        i = telegram.webhook_info()
        print({k: i.get(k) for k in ("url", "pending_update_count", "last_error_date", "last_error_message")})
    elif cmd == "telegram-poll":
        base = (a[1] if len(a) > 1 else "http://localhost:5000").rstrip("/")
        httpx.post(f"https://api.telegram.org/bot{os.environ['TELEGRAM_BOT_TOKEN']}/deleteWebhook")  # polling and webhook are exclusive
        off = None
        while True:
            for u in telegram.get_updates(off):
                off = u["update_id"] + 1
                r = httpx.post(f"{base}/webhooks/telegram", json=u,
                               headers={"X-Telegram-Bot-Api-Secret-Token": os.environ["TELEGRAM_WEBHOOK_SECRET"]})
                print(u["update_id"], r.status_code, "chat", (u.get("message") or {}).get("chat", {}).get("id"))  # the chat id for a supplier's tg: contact
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
