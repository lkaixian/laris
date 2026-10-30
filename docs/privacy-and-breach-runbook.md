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

- **Delete my data:** owner calls the erase endpoint for that customer. Quotes stay as business records, without the name or contact (the law that requires keeping them has not been checked). Reply to an access or correction request within 21 days (Act 709 ss.31 and 35, extendable by written notice, then 14 more days); the Act sets no deadline for erasure, only the s.10 duty to destroy data no longer needed.
- **What do you hold about me (an access request, s.30):** owner calls `GET /api/parties/{id}/export` (JSON: contact fields, enquiries, chat text with direction, channel and time, quotes with line descriptions, quantities and sold prices, supplier reply text). This is an access answer, not a s.43A portability transfer (sending the data to another controller on a written electronic request; the completion period is not prescribed yet). It never carries a cost or margin figure, holds at most 5000 rows of each kind (`truncated: true` if cut), and is audited (counts only). See "Export and erase procedure" below.

## If you suspect a breach

1. **Contain (first hour).** Revoke affected tokens (`python scripts/create_token.py revoke <user>`), rotate `WHATSAPP_APP_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `WHATSAPP_TOKEN`, `ILMU_API_KEY`, `APP_TOKEN` in Replit Secrets, and redeploy. If the database URL leaked, rotate the database password.
2. **Preserve.** Do not edit the audit log (it cannot be edited by `laris_app`). Save app logs and the `audit_log` rows around the time. Note times in Malaysia time.
3. **Assess.** Which tables, which tenants, how many people, what kind of data (names and numbers, or prices only). Was it read or only exposed?
4. **Notify.** If personal data was accessed without authority and harm is likely, notify the regulator and the affected people as the law requires (confirm current thresholds and deadlines in the vault note and with a lawyer; the vault flags the rules as changing). The shop owner decides and signs.
5. **Fix and record.** Close the cause, add a test, and log what happened, what data, who was told and when, in `docs/BUILD_LOG.md` (no personal data in the entry).

## Known limits to state honestly

Postgres row-level security (`db/rls.sql`) keeps one tenant's rows from another's, but only when the app connects as `laris_app`; on the owner connection it is bypassed. Not tried on Replit's Postgres. Staff cost hiding is still done by the API. Outbound WhatsApp uses one token for every tenant (each tenant sends from its own number). Audio cannot be redacted before ILMU. Sign-in is by username and password (or a per-user bearer token).

## Data protection officer

The owner records the officer's name and an email or phone under Settings, Privacy. Put the name and contact in the privacy notice shown to customers, and raise `notice_version` when the notice text changes. The health page shows `privacy_dpo_missing` until a name and one contact are saved; that is stricter than the law for a small business. The Commissioner's DPO Guideline (4.2 to 4.5) requires a DPO only above 20,000 people's data, above 10,000 with sensitive or financial data, or for regular and systematic monitoring; below that, record your reasons for not appointing. If you do appoint, register at daftar.pdp.gov.my within 21 days and publish the contact.

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
   - Kept: the quote, its lines, dates, status and prices (business record), the customer PO reference, enquiry rows (no text).
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

Vendors (from each vendor's own pages on 2026-10-30; re-check before relying): ILMU (text and audio transcription, contact details masked first; its docs say processed and stored in Malaysia, nothing kept after the request, not used for training; no DPA or API terms found), RunPod (catalog-photo vision, and audio when configured; data centres worldwide incl. the US, results kept 1 to 30 minutes; DPA with SCCs), Meta WhatsApp (processor for the business; messages kept up to 30 days; country not stated; not connected yet), Telegram (message transport; Telegram says bots are independent of it and it is the controller of its own users' data, so it is not our processor; no DPA for bot developers), Mailtrap (email, US; DPA), Replit (hosting and database; region not stated; DPA with SCCs). Details: `docs/lawyer-review-brief.md` section 4.

## Privacy in the chat (notice and customer rights)

- **Notice.** The first time a customer messages a business (Telegram business bot, env bot, or WhatsApp), the bot sends a short privacy notice as its own message, then handles their message as usual. It covers the Act's s.7 items: what we collect and why, that giving it is voluntary, how long chat text is kept (`RETENTION_DAYS`, default 180), that voice audio is not kept by us, who sees it, that processors may be outside Malaysia, the data protection contact if set under Settings, Privacy, and the choices (`/mydata`, `/forget`, correct or limit by telling us). It is sent in Bahasa Melayu and English together in one message (s.7(3)), on every channel. It is recorded in `customer_consent` (`basis = notice_shown`, `notice_shown_at`, `notice_version`). If the owner turns on "ask new customers to reply YES" (Settings, Privacy), the first enquiry is held until the customer replies YES or YA; the answer is recorded (`basis = agreed_in_chat`, `agreed_at`) and the rights commands still work before it. Staff, suppliers and the helper bot never get it. Raise `notice_version` when the wording changes; existing customers are not re-shown it automatically.
- **Commands (customers only, any case, optional `@botname`).** `/privacy` shows the notice again. `/mydata` sends the customer a JSON file of their own record (the same export as `GET /api/parties/{id}/export`, never a cost or margin). If the file cannot be sent they get a plain sentence. `/forget` creates one pending request (`data_requests`) and tells the customer the business will confirm after checking quotes it must keep. Nothing is erased automatically. At most 5 of these commands per sender per 10 minutes.
- **How the owner handles a request.** Settings, Privacy lists requests (`GET /api/privacy/requests`), pending first. Check the person is who they say (the chat is the only proof we have), then choose erase (runs the normal erase, marks it done, tells the customer) or dismiss (tells the customer the business could not erase it and to contact the data protection contact). Health warns after 3 days pending. Answer within 21 days for an access request (s.31).
- **Honest limits.** By default the notice is shown once and the enquiry goes ahead; whether that is enough under the PDPA, or whether a customer's own quote request is covered by s.6(2)(b), is a question for the lawyer (`docs/lawyer-review-brief.md` Q5). The owner can switch on the recorded YES above. The notice is recorded as shown when the reply is queued, not when the person read it; a failed send is not retried. Erase keeps quotes, lines and prices (business records), and earlier audit rows. Vendor copies (ILMU, RunPod, Meta, Telegram, Replit) are not erasable from here. `/mydata` includes the owner's notes on that customer, because they are about the person; remove internal remarks before relying on that. Anyone who controls the chat account can ask for the data: there is no second check.

## Legal points: verified and still open

Checked on 2026-10-30 against the official documents (details and URLs in `docs/lawyer-review-brief.md`; no lawyer has read it).

**Verified from official documents:** start dates 1 April 2025 and 1 June 2025 (Gazette P.U.(B) 522); 72 hours to the Commissioner and 7 days after that to the people affected (Circular 2/2025, Breach Guideline); notifiable when significant harm or more than 1,000 people, where the 1,000 test applies to the Commissioner only; register kept 2 years; DPO thresholds 20,000 / 10,000 / regular and systematic monitoring (DPO Guideline); access and correction in 21 days; portability exists (s.43A) with no completion period prescribed yet; no standalone erasure right; notice in Malay and English; penalties RM250,000 or 2 years for failing to notify the Commissioner and RM1,000,000 or 3 years for breaching the principles, processors included.

**Still open, for the lawyer:** whether the 72 hours run from the breach or from awareness (the app uses the earlier of occurrence and detection, the safe reading); whether the register's 2 years run from the breach or from the notice (the register is never deleted); whether the Commissioner's thresholds bind; how a multi-tenant processor counts people; whether a transcribed voice note or an OCR photo is biometric data; whether a default notice without a tick is valid consent; which s.129 basis covers each overseas vendor; which law lets us keep quotes after a `/forget`; whether Circular 1/2026 (controller registration) applies.

## AI guide

Optional, off by default, switched on only by the owner (Settings, AI). Modes: Off, Guide only, Guide plus my data (lets the existing Assistant run). The owner picks hosted ILMU or their own AI server.

**What leaves the system:** the question the person types, with emails, Malaysian mobile numbers, NRIC numbers and any run of 6 or more digits replaced first (`src/api/ai_guide.py`), plus the names and menu paths of the screens listed by the page. Since 2026-10-30 every model call is masked in one place (`src/parse_util.py` `Mask`): emails, phone numbers (mobile and landline), NRIC numbers, card numbers, bank account numbers after a bank or account word, and the names in the business's own contact book become placeholders and are put back in the reply. Addresses and names that are not in the contact book are NOT removed. Measured misses and the way out are in `docs/technical-debt.md` row 1. The Assistant sends only its masked question too. No quote, customer, cost or margin record is sent. The model can only pick from the supplied screens; it cannot run an action, and only supplied links are returned.

**Not kept:** the question is not stored or logged (only a count, `usage_events` kind `guide`). The custom server key is stored encrypted and never returned.

**Consent log:** every change is a row in `ai_consent_log` (when, who, action, mode, provider, host name of a custom server only, notice version). It cannot be edited or deleted. Turning on, or changing provider or server host, needs the owner to accept the notice shown by `GET /api/settings/ai`.

**Owner responsibilities:** tell customers in your privacy notice that questions typed in the app can go to an AI provider; the provider's own retention applies to ILMU; for your own server, security, retention and any cross-border transfer are yours. Turn it off at any time. Review the consent log after staff changes. Health shows `ai_not_reviewed` until a choice is saved.

**Limits:** the own-server call refuses private addresses and pins the connection to the checked address, but this was tested with a fake transport only, not a real TLS server.

## AI reading records (opt-in mode `rag`)

A fourth AI mode, "Guide plus my data, read by the AI", off until the owner turns it on and ticks agreement to the version 2 notice (`RAG_DISCLOSURE` in `src/api/ai_guide.py`). It is recorded in `ai_consent_log` with notice version 2. Moving to it from any other mode asks again; leaving it is one click and is logged.

**What leaves the system:** the question and up to 5 extracts of 300 characters from that business's own quotes, contacts and catalog (and costs or supplier prices only when the person asking holds the See costs permission), after masking. Never another business's data, never an owner-only section, never a margin. An AI tool connected through MCP gets the same extracts for the role its key is bound to.

**Not kept:** the question, the extracts and the answer are not stored or logged. `ai_calls` holds one row per call with the time, kind, provider, result, duration and how many values of each type were hidden. It is purged after 90 days. The owner sees every call; anyone else sees only their own.

**Cross-border transfer:** the notice names the provider the owner chose, and a custom server's host is logged. ILMU's own docs say Malaysia, nothing kept after the request and no training (not confirmed by a DPA); RunPod, Mailtrap, Replit and Meta process outside Malaysia or in an unstated region, so the notice now says some processors are outside Malaysia. Which s.129 basis applies to each is open (`docs/lawyer-review-brief.md` Q7).

**Owner responsibilities:** put the AI use in your privacy notice for customers and suppliers; keep MCP keys to tools you trust and revoke any you stop using (API access). Switching the mode off stops every MCP key at once.

**Limits:** the notice has not had a legal review, masking misses some names and all addresses, and nothing has been run against a live model. See `docs/technical-debt.md`.

