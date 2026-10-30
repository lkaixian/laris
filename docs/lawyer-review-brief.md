# LARIS: brief for a Malaysian lawyer (PDPA review)

Prepared 2026-10-30 by a student team. This is our own research for you to confirm or correct, not legal advice. Every legal point is marked **[P]** (read in an official document) or **[S]** (secondary source only). Where we could not check, we say so and do not guess. All data in the demo is synthetic; no real customer data is held.

## 1. What LARIS is

A quotation tracker for small made-to-order businesses (SMEs). The SME's customers message a Telegram bot (WhatsApp is built but not connected to Meta). Text and voice notes are transcribed and read by AI into draft quotes. Prices come from rules, never from AI, and the owner approves every quote. The owner can also upload supplier price lists and catalog photos.

Facts that change the answer:
- **Our role (our view, please confirm):** processor for each SME's customer and supplier data; controller for its own owner and staff accounts.
- **Size:** far below 20,000 data subjects today. Multi-tenant, one database, row-level security per business.
- **Data held:** names, phone numbers, chat text, voice-note transcripts, product photos, quote history. We do not deliberately collect sensitive or biometric data.
- **Voice notes:** the audio is read into memory, sent to ILMU for transcription and not stored by LARIS (`src/api/webhooks.py:269-276`). Only the transcript is kept. Photos are used for OCR and product matching.
- **AI:** off by default for the optional guide. The owner opts in and the consent version is recorded. Question text is masked for emails, phone numbers and ID numbers before it leaves (`src/api/ai_guide.py:27-41`). The AI notice already says processing may be outside Malaysia and that the owner must tell customers.
- **Breach process:** register, 72-hour and 7-day clocks, in `docs/privacy-and-breach-runbook.md`.

## 2. What we verified (official documents)

| Point | Result | Source |
|---|---|---|
| Start dates | 1 Apr 2025 (definitions, penalties, s.129); 1 Jun 2025 (DPO s.12A, breach s.12B, portability s.43A) **[P]** | Gazette P.U.(B) 522 |
| Breach: tell Commissioner | 72 hours; significant harm **or** more than 1,000 people **[P]** | Circular 2/2025 para 4; Breach Guideline 5-6 |
| Breach: tell people | 7 days after the Commissioner notice; the 1,000 test does not apply **[P]** | Circular 5(2); Guideline 8.2, 9.1 |
| Breach register | 2 years **[P]**, start date inconsistent (see Q6) | Circular 4(7); Guideline 14.1 |
| DPO | Duty covers controllers and processors. Guideline thresholds: more than 20,000 people, or more than 10,000 with sensitive or financial data, or regular and systematic monitoring. Below those, record reasons for not appointing. Register on daftar.pdp.gov.my within 21 days of appointment **[P]** | A1727 s.6; DPO Guideline 4.2-4.5 |
| Processor duty | Processors comply with the Security Principle directly (s.5(1A)); s.12B breach duty is the controller's **[P]** | A1727; Breach Guideline 12.1 |
| Penalties | Principles: RM1,000,000 or 3 years or both. Failing to notify the Commissioner: RM250,000 or 2 years or both. Officer liability s.133 **[P]** | A1727 s.5(2), s.12B(3) |
| Rights | Access and correction 21 days (+14); portability s.43A, completion period not prescribed anywhere we found; no standalone erasure right, only s.10 destruction duty **[P]** | Act 709; A1727 |
| Notice | s.7: 8 content items, Malay and English, separate recorded consent per JPDP Notice Guide **[P]** | Act 709 s.7; JPDP Notice Guide |
| Cross-border | Whitelist removed; s.129 now needs substantially similar law, adequate protection, or an exception (consent, contract, due diligence) **[P]** | A1727; CBPDT Guideline (29 Apr 2025) |

Official English Guidelines (v1.0, 25 Feb 2025): https://www.pdp.gov.my/wp-content/uploads/2025/08/GP_DBN_ENG.pdf and https://www.pdp.gov.my/wp-content/uploads/2025/08/GP_DPO_ENG.pdf. A1727: https://www.pdp.gov.my/wp-content/uploads/2024/11/Act-A1727.pdf. The Circulars are Malay only; the research notes quote the Malay with our English translation.

## 3. Questions we narrowed to

Each has the conservative default we propose to follow until you say otherwise. Not all of them are built yet; the repo still behaves as described in section 5.

| # | Question | Why it is open | Our default |
|---|---|---|---|
| 1 | Is the 72-hour clock from occurrence or from awareness? | Guideline 6.1 says "selepas berlakunya" (after occurrence); the 6.2 examples run it from being told or confirming. Circular 4(4) says "daripada pelanggaran" | Start at the earliest of occurrence, detection and the vendor telling us |
| 2 | Are the Commissioner's thresholds legally binding, given s.12A is unconditional? | Guideline is issued under s.48(g); neither it nor the Circular says binding or best practice | Treat as binding; record reasons for not appointing a DPO; name a contact anyway |
| 3 | Does a multi-tenant processor count data subjects across all customers? | No aggregation rule in any text | Count across all customers; re-check as users grow |
| 4 | Is a transcribed-and-discarded voice note, or a photo used for OCR, "biometric data"? | No source says either way | Audio is already not stored; keep transcript only; proposed: avoid face photos |
| 5 | Is "by continuing to message us you accept this" valid consent for ordinary data? Does s.6(2)(b) cover a customer's own quote request? | JPDP says notice is not a consent vehicle; no chat guidance; Regulations 2013 not readable as text | Proposed: a recorded opt-in on first contact (not built) |
| 6 | Register retention: 2 years from the breach (Circular 4(7)) or from the Commissioner notice (Guideline 14.1)? | Texts conflict | Keep from the later of the two |
| 7 | Which s.129 basis covers each overseas vendor (consent after notice naming the recipient class, contract clauses, other)? | See section 4: most vendors process outside Malaysia | Consent in the notice plus vendor DPAs |
| 8 | Which Malaysian record-keeping law lets us keep quotes after a customer says `/forget`, and for how long? | We call them "financial records" with no cited law | Keep, and say so plainly |
| 9 | Who answers access, correction, withdrawal and s.43A portability: LARIS or the SME? Is a chat command acceptable as "written notice by electronic means"? | Role and format open | Proposed: SME owner decides; relabel our JSON export "access" (not done) |
| 10 | Does Circular 1/2026 (registration of data controllers) apply to LARIS or its SME customers? | Scanned image, not read | None |
| 11 | Penalty for failing to appoint or register a DPO? | No offence subsection found in s.12A | None |

## 4. Where the data goes (vendor facts, each from the vendor's own page; re-check the URL before relying)

The research tool summarised these pages, so treat quotes as pointers. Full table with URLs: `research_notes/Malaysia PDPA lawyer review package/vendor_data_flows.md`.

| Vendor | Gets | Where | Retention and training | Contract |
|---|---|---|---|---|
| ILMU | Voice audio, extraction text, AI questions | Malaysia (its docs say processed and stored in Malaysia) | Nothing stored after the request; not used for training (docs.ilmu.ai) | No DPA, API terms or subprocessor list found |
| Replit | Whole app and Postgres | Region not stated; subprocessors mostly USA | Deleted up to 90 days after termination | Online DPA with SCCs |
| RunPod | Catalog photos (vision) | "throughout the world, including the United States"; we choose data centres | Job results kept 1 to 30 minutes; terms allow aggregated, anonymised use | DPA with SCCs |
| Mailtrap | Emails (invites, notices) | US (AWS, Google) | Email body retention not found | DPA, EU-US DPF |
| Telegram | Chat messages | Not stated for Malaysian users | Telegram calls bots "independent from us" and is controller of its users' data | No DPA for bot developers |
| Meta WhatsApp | Chat (not live) | Country not stated | Up to 30 days | Business Data Processing Terms |

Our own docs are out of date against this: they say ILMU residency and no-training terms are unconfirmed, list Telegram as a processor, omit Mailtrap from the declaration, and say "audio discarded" without noting RunPod's 1 to 30 minute result window. These docs are not yet corrected.

## 5. Repo text for you to read

1. Customer notice: `src/api/bot_text.py:9-43` (English, Malay; WhatsApp English only; omits right to correct, obligatory or voluntary supply, overseas processing, named contact).
2. Runbook: `docs/privacy-and-breach-runbook.md` (breach steps, retention 180 and 90 days, erase versus keep).
3. Breach register and clocks: `src/api/privacy.py:73-108`; owner screens `web/src/Privacy.tsx`.
4. AI notices (v1 and v2): `src/api/ai_guide.py:27-41`.
5. Retention and erase wording: `web/src/Privacy.tsx:244-245,299-300`.

## 6. What we do not know

- No consolidated, official, post-amendment English text of Act 709. pdp.gov.my lists an "Act 709 (Reprint) 2026" (published 2026-10-16) but both PDF links return the homepage. We applied A1727 to the 2022 reprint by hand. Please check against the official text.
- The Circulars' effective-date sections are page images we could not read.
- The AI and personal data consultation paper (1/2026) and the 2026 ADM, DPIA and data-protection-by-design papers are drafts; we do not know if any is final.
- The Personal Data Protection Regulations 2013 (consent recording) and the fees regulations could not be read as text.
- Vendor retention and region details are from vendor pages only.

Anything you confirm, please date it: these instruments are still moving.
