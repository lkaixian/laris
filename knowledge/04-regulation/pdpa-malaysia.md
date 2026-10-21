---
source_url: https://www.dfdl.com/insights/legal-and-tax-updates/malaysia-implementation-of-the-personal-data-protection-amendment-act-2024/
retrieved: 2026-10-22
confidence: medium (law-firm secondary sources; PDP Commissioner guideline PDFs not read directly)
status: verified (dates, penalties, 72h/7d/1,000 via 2+ firm articles) | REAL DATA needed (read Gazette/Guideline PDFs; DPO trigger details)
---
# PDPA 2010 as amended 2024 (Malaysia)

Related: [[e-invoice-myinvois]], [[sst-and-quotation-docs]], [[adr-ilmu-api]], [[adr-mesolitica-whisper]], [[adr-replit-hosting]]

## Effective dates (DFDL)
- 1 Jan 2025: e-service of notices (admin).
- 1 Apr 2025: "data user" becomes "data controller"; biometric data = sensitive; processors directly bound by the Security Principle; max fine RM300,000 -> RM1,000,000, jail 2 -> 3 years; cross-border whitelist removed.
- 1 Jun 2025: mandatory DPO (controllers AND processors), mandatory breach notification, data portability.

## Breach notification (Guideline issued 25 Feb 2025; CMS / DLA Piper / Securiti summaries)
- Notify Commissioner as soon as practicable, no later than 72 hours; late = written explanation + evidence. Firms disagree whether the clock starts at occurrence or awareness.
- Notifiable to Commissioner if more than 1,000 data subjects ("significant scale"); draft said 500.
- Notify data subjects if likely significant harm (financial loss, identity fraud, sensitive data), within 7 days after notifying Commissioner.
- Phased info allowed, within 30 days.
- pdp.gov.my on 2026-10-22 shows "Public Consultation Paper No. 1/2026: AI and Personal Data Protection Framework" (dated 5 Oct 2026). Not yet law; directly relevant to LLM/ASR processing; watch it.

## Implication for LARIS (inference, not legal advice)
- Chats, voice notes, prices, customer names/phones are personal data. LARIS is a processor for the SME (controller); processor now directly liable for the security principle (RM1M exposure).
- Voice notes: plain transcription is not biometric identification, but unconfirmed.
- Sending audio/text to ILMU / RunPod / Meta = third-party and cross-border processing: need notice/consent, vendor DPAs; no whitelist shortcut.
- Minimise: keep transcript + structured quote, delete raw audio after a set period (design choice), encrypt at rest, access logs, 72h breach runbook, named DPO contact.
- Unconfirmed: whether a small pilot must formally appoint/register a DPO (guideline thresholds not read).
