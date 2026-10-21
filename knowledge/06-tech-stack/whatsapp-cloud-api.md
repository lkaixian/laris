---
source_url: https://developers.facebook.com/docs/whatsapp/pricing/
retrieved: 2026-10-22
confidence: high on model/rules (Meta doc); medium on MYR rates (ChatMaxima vendor page, not Meta CSV)
status: verified (model, free tier, 1 Oct 2026 change) | REAL DATA needed (Meta MYR rate CSV)
---
# ADR: WhatsApp Business Cloud API

Related: [[telegram-bot-api]], [[pricing-numbers]], [[pdpa-malaysia]]

- **Choice**: WhatsApp Cloud API (where SME customers already chat). **Alternative**: Telegram bot, free ([[telegram-bot-api]]).
- **Model**: per delivered message since 1 Jul 2025, by category and recipient country. Templates (anytime): Marketing, Utility, Authentication. Service (free-form) only inside the 24h window, which resets when the user messages/calls. Meta Business Agent (AI) $2.00 per 1M tokens.
- **1 Oct 2026 change (Meta doc)**: service messages charged after 1,000 free per phone number per month (no rollover); utility templates inside an open window (free since Jul 2025) become charged. No payment method on file by 30 Sep 2026 -> service messages may stop. Gov/non-profit service free until 31 Dec 2027.
- **Free entry point** (Click-to-WhatsApp ad): window up to 7 days, all categories free (Meta doc). ChatMaxima says 72h; trust Meta.
- **Malaysia (+60)** is its own market; MYR rate card since 1 Apr 2026. Rates (ChatMaxima; USD matches SleekFlow): Marketing RM0.3467 ($0.0860); Utility/Auth/Service RM0.0564 ($0.0140); Auth-international RM0.1685. Tax extra. Utility/auth volume tiers 5-25% off.
- **Template approval**: usually minutes (ML review); human review up to 24-48h (Twilio/Gupshup docs, vendor not Meta). Promotional wording in a utility template gets reclassified to marketing.
- **Cost per quote conversation (derived)**: inbound customer messages free. Bot replies in window = service: free within 1,000/month/number, else RM0.0564 each. Out-of-window follow-up via utility template RM0.0564; if reclassified marketing RM0.3467. Example: 6 service replies + 1 utility follow-up = about RM0.39 beyond free tier, about RM0.056 inside it. 1,000 free service messages is roughly 160 such conversations per number per month.
- Assumed, not confirmed: BSP markup; business-verification and number-registration effort for a hackathon demo.
