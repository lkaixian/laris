# Privacy and breach runbook

Applies once LARIS holds real customer or supplier data. The demo uses synthetic data only. Legal points are from the vault (`knowledge/04-regulation/pdpa-malaysia.md`); confirm with a lawyer before relying on them.

## Contacts (fill in before real customers)

| Role | Name | Channel |
|---|---|---|
| Data protection officer (DPO) | set in the app under Settings, Privacy (`POST /api/settings/privacy`); health warns `privacy_dpo_missing` until set | [REAL DATA] |
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
- **What do you hold about me / move my data:** owner calls `GET /api/parties/{id}/export` (JSON: contact fields, enquiries, chat text with direction, channel and time, quotes with line descriptions, quantities and sold prices, supplier reply text). It never carries a cost or margin figure, holds at most 5000 rows of each kind (`truncated: true` if cut), and is audited (counts only). See "Export and erase procedure" below.

## If you suspect a breach

1. **Contain (first hour).** Revoke affected tokens (`python scripts/create_token.py revoke <user>`), rotate `WHATSAPP_APP_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `WHATSAPP_TOKEN`, `ILMU_API_KEY`, `APP_TOKEN` in Replit Secrets, and redeploy. If the database URL leaked, rotate the database password.
2. **Preserve.** Do not edit the audit log (it cannot be edited by `laris_app`). Save app logs and the `audit_log` rows around the time. Note times in Malaysia time.
3. **Assess.** Which tables, which tenants, how many people, what kind of data (names and numbers, or prices only). Was it read or only exposed?
4. **Notify.** If personal data was accessed without authority and harm is likely, notify the regulator and the affected people as the law requires (confirm current thresholds and deadlines in the vault note and with a lawyer; the vault flags the rules as changing). The shop owner decides and signs.
5. **Fix and record.** Close the cause, add a test, and log what happened, what data, who was told and when, in `docs/BUILD_LOG.md` (no personal data in the entry).

## Known limits to state honestly

Postgres row-level security (`db/rls.sql`) keeps one tenant's rows from another's, but only when the app connects as `laris_app`; on the owner connection it is bypassed. Not tried on Replit's Postgres. Staff cost hiding is still done by the API. Outbound WhatsApp uses one token for every tenant (each tenant sends from its own number). Audio cannot be redacted before ILMU. Sign-in is by username and password (or a per-user bearer token).

## Data protection officer

The owner records the officer's name and an email or phone under Settings, Privacy. Put the name and contact in the privacy notice shown to customers, and raise `notice_version` when the notice text changes. The health page shows `privacy_dpo_missing` until a name and one contact are saved.

## Breach register and the clock

Record every incident in the app (`/api/privacy/breaches`): when it was detected (with time zone), a short summary with no names, numbers or message text, the kinds of data, how many people, and whether significant harm is likely. Rows cannot be deleted (a database trigger refuses it) because the register is kept for at least 2 years. Every change is audited.

- Commissioner notice: due 72 hours after `detected_at` when the incident is notifiable (significant harm, or more than 1,000 people). Record `commissioner_notified_at` when sent.
- People affected: due 7 days after the Commissioner notice when significant harm is likely. Record `subjects_notified_at`.
- The list shows the due times, overdue flags and hours left. An open notifiable incident past 72 hours with no Commissioner notice is a critical item on the health page (`breach_overdue`).
- Every response says the deadlines must be confirmed at pdp.gov.my (see "Unverified legal claims").

## Export and erase procedure

1. Confirm who is asking and which contact record is theirs.
2. Export: `GET /api/parties/{id}/export`; send the JSON or a readable copy to that person.
3. Erase (customers only): `POST /api/parties/{id}/erase`.
   - Removed: name (replaced by "Erased customer" and 8 characters of the id), chat number, email, address, attention, company and tax numbers, notes; the text and transcript of every chat message of that customer's enquiries and quotes (set to "[erased]"); the media reference of those messages; the raw AI / OCR extraction and storage key of that customer's documents; any supplier reply text linked to that record.
   - Kept: the quote, its lines, dates, status and prices (financial record), the customer PO reference, enquiry rows (no text).
   - Not removable: earlier `audit_log` rows (append-only by design). A past contact edit stored the old and new chat number in that row. Tell the person.
   - Vendors keep their own copies under their own terms (ILMU, RunPod, Meta, Telegram); erasing here does not reach them.

## Raw audio and media

Voice notes are downloaded from Meta or Telegram and sent to ILMU or RunPod for transcription: transcribed in memory and discarded. No code writes `messages.media_key` or `documents.source_object_key`, so raw audio and customer photos sent on chat are never stored (erase and the chat purge still clear those columns). The only stored images are catalog photos (`listings.image`, `listing_items.crop`) and request photos sent to suppliers (`rfq_items.image`); the scheduler empties each after 90 days. Supplier reply text is cleared after 180 days. Chat text and transcripts follow `RETENTION_DAYS` (default 180).

## What is stored where, and the processors

| Data | Where |
|---|---|
| Contacts | `parties` (Postgres on Replit) |
| Chat text, transcripts | `messages` |
| Quotes and prices | `documents`, `document_lines` |
| Photos for suppliers and catalog | `rfq_items`, `listings`, `listing_items` (bytes in the row) |
| DPO contact, breach register | `tenant_privacy`, `breach_incidents` |

Processors: ILMU (text and audio transcription, contact details masked first), RunPod (audio or vision when configured), Telegram and Meta WhatsApp (message transport), Mailtrap (email), Replit (hosting and database). Processing agreements and data regions are not confirmed (see `docs/tech-and-tools-declaration.md`).

## Unverified legal claims

Taken from law-firm summaries and the vault note; the pdp.gov.my pages could not be read in full on 2026-10-29 and the guidelines were not checked: the 1 June 2025 start of the DPO duty and whether a small business must appoint and publish one; the 72-hour Commissioner deadline and whether it runs from occurrence or awareness; "significant harm" versus "more than 1,000 people" as the trigger (the app treats either as notifiable); the 7-day period for notifying people; the 2-year minimum for the register; the scope of data portability. Confirm with a lawyer.
