# Privacy and breach runbook

Applies once LARIS holds real customer or supplier data. The demo uses synthetic data only. Legal points are from the vault (`knowledge/04-regulation/pdpa-malaysia.md`); confirm with a lawyer before relying on them.

## Contacts (fill in before real customers)

| Role | Name | Channel |
|---|---|---|
| Person responsible for personal data (DPO equivalent) | [REAL DATA] | [REAL DATA] |
| Shop owner (tenant) | [REAL DATA] | [REAL DATA] |
| Hosting (Replit) and AI vendors (ILMU, RunPod, Meta, Telegram) | see `docs/tech-and-tools-declaration.md` | vendor consoles |

## What personal data is held and where

| Data | Where | Control built in the code |
|---|---|---|
| Customer name, chat number or id | `parties`, `messages` | erase endpoint `POST /api/parties/{id}/erase` (owner); chat text blanked after `RETENTION_DAYS` |
| Chat text, transcripts | `messages` | retention job; staff never see supplier chat text |
| Supplier prices | documents and cost items | staff scrubbing, owner only |
| Sent to vendors | message text to ILMU (contact details and NRIC masked first), audio to ILMU or RunPod, messages through Meta and Telegram | `redact()` in `src/pipeline.py`; audio cannot be masked |
| API tokens | `users.token_sha256` | only the SHA-256 is stored |
| Logs | app logs | sender ids are hashed; no tokens in error text |

## Requests from a person

- **Delete my data:** owner calls the erase endpoint for that customer. Quotes stay as financial records, without the name or contact. Reply within the time the law gives (check the vault note).
- **What do you hold about me:** query `parties`, `messages` and the linked documents for that contact; send a plain export.

## If you suspect a breach

1. **Contain (first hour).** Revoke affected tokens (`python scripts/create_token.py revoke <user>`), rotate `WHATSAPP_APP_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `WHATSAPP_TOKEN`, `ILMU_API_KEY`, `APP_TOKEN` in Replit Secrets, and redeploy. If the database URL leaked, rotate the database password.
2. **Preserve.** Do not edit the audit log (it cannot be edited by `laris_app`). Save app logs and the `audit_log` rows around the time. Note times in Malaysia time.
3. **Assess.** Which tables, which tenants, how many people, what kind of data (names and numbers, or prices only). Was it read or only exposed?
4. **Notify.** If personal data was accessed without authority and harm is likely, notify the regulator and the affected people as the law requires (confirm current thresholds and deadlines in the vault note and with a lawyer; the vault flags the rules as changing). The shop owner decides and signs.
5. **Fix and record.** Close the cause, add a test, and log what happened, what data, who was told and when, in `docs/BUILD_LOG.md` (no personal data in the entry).

## Known limits to state honestly

Postgres row-level security is not enabled (the API scopes every query by tenant, the database does not enforce it). Outbound WhatsApp uses one number and token. Audio cannot be redacted before ILMU. A login screen is not built: access is by per-user bearer token.
