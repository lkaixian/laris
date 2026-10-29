# LARIS Product Requirements Document

Status as of 2026-10-29 (build log rows up to 146). Team-made synthetic data only. Numbers carry the confidence stated in `knowledge/`. Anything not measured is written as `[REAL DATA needed]` and must be filled by the team before submission.

## 1. Problem

Supplier quotations reach Malaysian micro and small businesses as WhatsApp photos, voice notes and PDFs, and are never tied to the price the owner later gives a customer, so when a supplier raises a price the quotes already sent lose margin and nobody notices: 67% of surveyed Malaysian SMEs cite rising costs as a key pressure (The Star, 1 Oct 2026, Airwallex outlook; confidence medium; this is adjacent evidence, not a measurement of stale-quote loss).

Honest gap: no Malaysian figure exists in our vault for quote turnaround or margin lost to stale cost (`knowledge/03-stats/quotation-response-pain.md`, confidence low). The headline number we want is `[REAL DATA needed]` (RM margin lost per stale quote, from Thursday interviews plus the seed-data leak, never from synthetic data alone).

Supporting facts (each from `knowledge/03-stats/`):
- DOSM counts 1,069,831 MSME establishments (Economic Census 2023 profile, confidence high). Ministerial 2025 figure is about 1.3 million (confidence medium).
- MSMEs are 39.7% of GDP and 48.7% of employment (DOSM 2025).
- PPI local production rose 9.2% year on year in June 2026 (DOSM, confidence high). The page gives no wood, metal, paper or construction breakdown.
- Share of SMEs that price per job: no figure found (`made-to-order-share.md`, confidence low). Do not quote a percentage.

## 2. Users and personas

All personas are composites for the demo. They are not real people and not customers.

| Persona | Who | Needs | Role in LARIS |
|---|---|---|---|
| Owner (SAMPLE Owner) | Runs a made-to-order shop, quotes at night from WhatsApp | One place that shows which supplier price priced which quote, and a warning when a cost moves | `owner`: approves, sees cost and margin |
| Staff (SAMPLE Staff) | Uploads supplier quotes, fixes OCR mistakes, relays enquiries | Fast capture without being trained on pricing | `staff`: uploads and reviews, never sees cost or margin |
| Customer | Sends an enquiry by voice, photo or text, receives a quote PDF | A reply and a clear quote | Outside the app; talks to the chat channel only |
| Supplier | Sends price lists and quotations | Nothing from LARIS in v1 | Source of incoming documents |

Target segment (hypothesis, from `made-to-order-share.md`, to be validated by interviews): renovation and contractors, printing and signage and custom fabrication, catering and events, tailoring and per-job services. Retail and standard F&B are lower priority because they price from a menu.

## 3. The 5-step journey, both directions

One pipeline, one `documents` table with `direction` in or out (`db/schema.sql`, decision in `knowledge/10-decisions/2026-10-22-merge-tawar-untung.md`).

### Direction IN: supplier quotation or receipt to cost book

| Step | What happens | Repo evidence |
|---|---|---|
| 1 Trigger | Staff sends a supplier quote photo, PDF or voice note to the chat bot (Telegram is the live channel; WhatsApp is built but not connected to Meta) | `src/channels/telegram.py`, `src/channels/whatsapp.py` |
| 2 Connected data | OCR reads the image (Tesseract; PaddleOCR is optional and not installed by default), an LLM turns text into lines, lines are matched to the shop's item catalog | `src/ocr.py`, `src/ilmu.py` (`extract_json`), `config/templates/*.yaml` |
| 3 Decision | Deterministic checks, not the model, decide what needs review: arithmetic, subtotal, date sanity, OCR confidence below 0.80, item match score | `src/validate.py` (`validate_extraction`) |
| 4 Human approval | Staff fixes flagged lines; only the owner accepts the supplier price | `db/transitions.sql` (owner-only `reviewed` to `accepted`), `promote_document()` in `db/functions.sql` |
| 5 Outcome and log | `cost_items` rows are created with supplier, source line and effective date; older costs point to the newest via `superseded_by`; every change goes to the append-only `audit_log` | `db/functions.sql`, `db/schema.sql` (`audit_no_mut` trigger) |

### Direction OUT: customer enquiry to priced quote to job

| Step | What happens | Repo evidence |
|---|---|---|
| 1 Trigger | Customer sends a voice note, photo or text. A new supplier price landing in the cost book is a second trigger (stale-cost check). The 48-hour follow-up is a third | `src/channels/*`; `followups` table; `followup_hours: 48` in `config/templates/made_to_order.yaml` |
| 2 Connected data | Cost book, trade template (recipes, rate card, minimum margin), job queue, client history | `config/templates/`, `db/schema.sql` |
| 3 Decision | The model extracts item keys and quantities only. Rules price the quote from cost items plus markup. Margin guard blocks quotes under the minimum margin. Price keys in model output are rejected | `src/pricing.py` (`price_quote`, `margin_guard`, `PriceInjection`), `ai_actions` `no_price_keys` check and `price_src` enum without an AI value in `db/schema.sql` |
| 4 Human approval | Only the owner moves a quote from `draft` to `approved`. Out-line prices come only from the rules engine; staff cannot edit them. `sent` is impossible without `approved_by` (`out_sent_needs_approval` constraint) | `db/schema.sql`, `src/api/routes.py` (`rules_only`) |
| 5 Outcome and log | Quote sent in chat, customer accepts, owner records it, "Sign and create job" creates a job row (eSign is simulated). If a newer supplier price lands, the sent quote is flagged with the RM margin change. All steps are in the audit log | `v_quote_bom` view, `jobs` table, `v_stale_alerts` view |

Quote PDF, XLSX and CSV export, BOM/PO export and the follow-up job (owner approves each chase message) are built; the margin report is at `/api/reports/margin`. The customer can also accept or decline through a link (`#/q/<token>`); this e-signature is simulated and labelled so. Accepting creates a job, which has a due date, assignee and reminders.

## 4. The six must-haves mapped to repo evidence

| # | Must-have | LARIS answer | Evidence in repo | Gap today |
|---|---|---|---|---|
| 1 | One clear SME problem | Quotes priced on a stale supplier cost lose margin unnoticed | Sections 1 and 3; `db/seed_made_to_order.sql` | Headline number `[REAL DATA needed]` |
| 2 | Core automated journey | Supplier quote in, cost book, enquiry in, rules-priced quote out, approval, job, log | `db/*.sql`, `src/pricing.py`, `src/validate.py`, `src/ilmu.py`, `src/ocr.py`, `src/channels/`, `web/src/App.tsx` | Built and tested against PGlite and fakes; not run on Replit's own Postgres. Web has a mock mode (`web/src/mock.ts`) for demos without the backend |
| 3 | Accuracy and easy to learn | See section 7 | `src/validate.py`, `src/pricing.py`, `tests/test_validate.py`, `tests/test_pricing.py` | First-time-user timing `[REAL DATA needed]` |
| 4 | People stay in control | Owner and staff roles, owner-only approval, append-only audit log | `db/transitions.sql`, `db/schema.sql`, `docs/api-contract.md`, `web/src/App.tsx` (staff view hides price and margin) | Roles and permissions enforced in the API; row-level security per business is built but only holds when the app connects as `laris_app`, and was not tried on Replit's Postgres |
| 5 | Orbyte fit and reuse | See section 8 | `docs/api-contract.md`, `config/templates/` | Read-only API keys with `GET /api/v1/recipes` and `POST /api/v1/quote-price` exist; no Orbyte API has been called |
| 6 | Business benefit and SDG | See sections 9 to 11 | `knowledge/08-validation/interview-and-timing.md` | Minutes saved and RM margin protected `[REAL DATA needed]` |

## 5. Roles and permissions

Sign-in is built: username or email with password, hashed session tokens, per-user bearer tokens, email invites, and several businesses on one install. A header-only demo mode (`X-Role: owner|staff`, `X-User`) exists for local demos and closes once any user has a password or `REQUIRE_USER_TOKEN=1` (`docs/api-contract.md`). Owners can also create custom staff-class roles with chosen permissions (`docs/roles.md`).

| Capability | Owner | Staff |
|---|---|---|
| Upload supplier documents, correct OCR lines | yes | yes |
| Accept a supplier price into the cost book (`reviewed` to `accepted`, `promote_document`) | yes | no |
| See supplier cost, cost provenance, margin, stale-cost alerts, cost book | yes | no |
| Approve, send, cancel a customer quote; record customer acceptance; create job | yes | no |
| Override a rules-engine price (`owner_override`) | yes | no (403 per contract) |
| Discount above `max_discount_pct` | yes | no (`OwnerRequired` in `src/pricing.py`) |
| Read the activity log | yes | yes; staff see price edits without the figures |
| Edit or delete audit rows | no one (trigger raises `audit_log is append-only`) | no one |

Staff responses never contain cost, margin, supplier cost or owner-only attributes (`docs/api-contract.md`). The UI shows "Hidden for staff" in price cells and "Cost and margin are visible to the owner role only" (`web/src/App.tsx`). Limits to state honestly: staff cost hiding is done by the API, not the database. Row-level security (`db/rls.sql`) separates businesses from each other, but only when the app connects as `laris_app`; on the owner connection it is bypassed. The app refuses to start on a Replit deployment in that state unless `ALLOW_RLS_BYPASS=1`. Not tried on Replit's Postgres.

## 6. Automatic triggers

A new supplier document, an incoming enquiry, a newer cost item for an item used in an open quote (flag, never auto-reprice), and the 48-hour follow-up. The scheduler (APScheduler, in the app process) runs follow-up reminders, job reminders and the retention purge. It is single-process.

## 7. Accuracy and ease-of-learning plan

Accuracy design (implemented in code, tested with mocks and fixtures):
- The model never sets a price. `price_quote` rejects any price-like key in model output; the schema has no AI price source.
- The model never scores itself. `validate_extraction` flags lines for review on arithmetic mismatch, null quantity or price, quantity not positive, unit-of-measure mismatch, OCR confidence below 0.80, no catalog match, subtotal or grand total mismatch, and impossible dates.
- Item mapping is owner-confirmed, not auto-merged, because a wrong `item_key` silently ruins the margin number (`scope-review.md`, risk 2).
- Margin guard blocks a quote under `min_margin_pct`.

Measurement plan (not yet run). A "speed to quote" figure on owner Home shows the median minutes from quote created to sent, but there is no manual baseline to compare it with:
1. Build a fixture set of synthetic supplier documents with expected JSON. Report line-level extraction accuracy as correct lines over total lines, per document type. Value `[REAL DATA needed]`.
2. Time a first-time user who has had no training: tasks are review one flagged line, approve one quote, find why a quote is flagged. Record minutes and errors in `knowledge/08-validation/interview-and-timing.md`. Value `[REAL DATA needed]`.
3. Manual versus LARIS minutes per quote on the same synthetic enquiry, at Yb's shop and 2 to 3 other owners. Value `[REAL DATA needed]`.

Ease of learning: a guided tour (10 owner steps, 6 staff steps), a Ctrl+K command palette and 17 help articles, in English and Bahasa Melayu (Malay not reviewed by a native speaker; no first-time user has tried any of these). The owner's core action is a single button per step ("Approve quote", "Send quote to customer", "Record customer accepted"; labels in `web/src/api.ts`). Staff have no pricing screens to learn.

## 8. Orbyte fit and reuse

Facts about Orbyte (`knowledge/05-competitors/orbyte.md`, confidence medium): modules are eLeave, eClaim, eOT, Attendance, Directory, Daily Work Status, Monthly Project Focus, Hiring, eSign (Documenso) and Connect; pricing is usage-based per transaction with no published rates; no quotation module was found. The deck says Orbyte has roles, approvals with an audit trail, Clients and projects, eSign and Connect.

How LARIS fits:
- LARIS is the step before Clients and projects. It wins the work, then hands a signed quote and job card to Orbyte's eSign and Work modules instead of copying them. We do not build leave, claims, overtime, attendance, hiring or e-sign.
- Simulated in our demo: roles and login, the approval step with audit row, the eSign hand-off (a "Sign and create job" button that sets status and stamps an audit row), and Connect (we show where an accounting or POS partner would plug in; nothing is called).
- Reusable building block: the receipt-to-cost-book service as its own API that other Orbyte modules could call. Contract in `docs/api-contract.md` (`GET /api/cost-items`, `GET /api/alerts/stale-costs`, document transition endpoints) and the key-based `/api/v1` endpoints (60 requests a minute per key). These are implemented in this app; no Orbyte API has been called or tested.
- Trade templates are configuration, not code: four YAML files exist in `config/templates/` (`made_to_order`, `fnb_catering`, `tailoring`, `aircon_service`), loaded by `src/templates.py` and selectable at signup. The tailoring and aircon files are samples, not validated with those trades.

## 9. Business model (hypothesis to be tested)

Not validated. No user has been asked yet (`interview-and-timing.md`, question 6).

- Hypothesis: charge by usage, like Orbyte does, for example per approved quote, per supplier document read, or per quote sent. The deck lists these units. Price: `[REAL DATA needed]`.
- Structure to test (an example and not a finding): a free allowance of quotes per month, then a small fee per approved quote, sold as an add-on through Orbyte. The app shows usage against a placeholder allowance of 20 approved and sent quotes (`GET /api/usage`, display only, nothing is billed). The real allowance and fee: `[REAL DATA needed]`.
- Cost floor per use, from the vault:
  - Voice note transcription with ILMU `ilmu-asr-v4.2`: RM0.0002 per second, so RM0.006 for a 30 second note (derived; before 8% SST; console.ilmu.ai/pricing, confidence medium-high).
  - Extraction with `ilmu-mini-v3.3`: RM0.20 in and RM1.20 out per 1M tokens. Tokens per quote not measured: `[REAL DATA needed]`.
  - WhatsApp: about RM0.056 per quote conversation inside the 1,000 free service messages per number per month, about RM0.39 beyond (derived; rates from vendor pages, not Meta's rate card; confidence medium).
  - Telegram: RM0 per message.
  - Hosting: Replit Reserved VM prices in the vault are possibly stale (confidence low-medium).
- Test method: ask 2 to 3 owners in interviews whether they would pay per approved quote and how much; record answers anonymised.

## 10. Growth path

1. More trade templates as YAML: four exist today (see section 8). Others from `made-to-order-share.md` (renovation) are untested hypotheses.
2. Partner supplier price feeds through Orbyte Connect or direct, so cost items arrive without photos. Planned, no partner contacted.
3. Other markets: the plan suggests Singapore and Indonesia because of similar WhatsApp habits. No evidence in the vault (confidence low); treat as a hypothesis.
4. Competitive pressure to watch (`gap-table.md`): WhatsApp Business plus a WhatsApp CRM adding quote features, Malaysian accounting tools adding capture, and platforms bundling quoting.

## 11. SDG linkage

Target wording is quoted from `knowledge/03-stats/` (UN sources, confidence high).

- 8.2: "Achieve higher levels of economic productivity through diversification, technological upgrading and innovation, including through a focus on high-value added and labour-intensive sectors." Link: less owner time retyping quotes, and quotes that protect margin per job. Size of effect `[REAL DATA needed]`.
- 8.3: "Promote development-oriented policies that support productive activities, decent job creation, entrepreneurship, creativity and innovation, and encourage the formalization and growth of micro-, small- and medium-sized enterprises, including through access to financial services." Link: a structured, dated record of costs and quotes for micro firms that currently work in chats. We do not claim formalization outcomes.
- 9.3: "Increase the access of small-scale industrial and other enterprises, in particular in developing countries, to financial services, including affordable credit, and their integration into value chains and markets." Link: a documented quote and cost history is the kind of record a supplier or lender could ask for. This link is the weakest and unproven; we do not claim access to credit.

Benefit conversion, once timing exists: minutes saved times RM0.145 per minute (minimum wage RM8.72 per hour from RM1,700 per month, effective 1 Feb 2025, 1 Aug 2025 for firms under 5 staff; the per-minute figure is derived arithmetic and is a floor, not a typical wage).

## 12. Risks and mitigations

| Risk | Mitigation | Source |
|---|---|---|
| Many teams will do quotations | Lead with the supplier-to-customer loop and the stale-cost flag, not the chat | deck slide 12 |
| Looks like a re-skinned chatbot | Lead the demo with the stale-cost alert and per-line cost provenance, not the chat | `scope-review.md` |
| OCR misreads thermal or phone images | Confidence gate and `needs_review` flow; hard image routed to confirm form; no accuracy promise beyond measured fixtures | `adr-ocr-paddle-tesseract.md` |
| Wrong `item_key` mapping | Owner confirms mapping from the template catalog | `scope-review.md` |
| Manglish accuracy unverified | The endpoint path and model names match docs.ilmu.ai (row 118). Accuracy tools exist (`docs/eval-manglish.md`) but have not been run live; Mesolitica Whisper on RunPod is the fallback | `adr-ilmu-api.md` |
| RunPod cold start in a live demo | Warm 10 minutes ahead; recorded run as backup | `scope-review.md` |
| WhatsApp setup, template approval and the 1 Oct 2026 billing change | Telegram is the live channel behind the same adapter; WhatsApp stays "built, not connected" | `whatsapp-cloud-api.md`, `owner-decisions.md` |
| Wow number too small | Seed uses a material-heavy job (acrylic signboards, RM400 margin change) | `db/seed_made_to_order.sql` |
| No measured benefit | Timing session at Yb's shop plus 2 to 3 owners | `interview-and-timing.md` |
| Competitors with existing customers (Bukku, AutoCount, SQL Account, WhatsApp Business app) | State it openly; several incumbents are unverified in our research | `gap-table.md` |

## 13. PDPA

Source: `knowledge/04-regulation/pdpa-malaysia.md` (confidence medium; law-firm secondary sources; not legal advice). Procedures: `docs/privacy-and-breach-runbook.md`.

Now: the app runs on team-made synthetic data only. Yb's shop is used for testing and interviews only; no real customer or company record enters the app.

Built in code (rows 51, 57, 138, 143):
- Consent notice sent on a customer's first chat contact; bot commands `/privacy`, `/mydata` and `/forget`; privacy notice page; owner requests screen.
- Per-person export (`GET /api/parties/{id}/export`) and erase (`POST /api/parties/{id}/erase`); quotes stay as financial records without the name or contact.
- Breach register that cannot be deleted, with a 72 hour Commissioner clock and a 7 day clock for affected people; DPO contact in Settings; health warnings when missing or overdue.
- Retention purge of message text, transcripts and media keys after `RETENTION_DAYS` (default 180); 90 day purge of ask-supplier photos. Raw voice audio is not stored.
- Contact details and NRIC are masked before text goes to ILMU. Audio cannot be masked. Sender ids are hashed in logs.

Not in place:
- The legal wording of the notice has not been reviewed by a lawyer.
- The breach deadlines and the DPO duty come from law-firm summaries and are not verified at pdp.gov.my. Firms disagree on when the clock starts. Whether a small pilot must appoint a DPO is unconfirmed. No DPO is named: [REAL DATA needed].
- Vendor terms: audio and text go to ILMU, RunPod and Meta or Telegram. ILMU data residency and no-training terms are unconfirmed. Replit region is unknown. No vendor agreements exist.
- Encryption at rest is not set up by the app (only stored bot tokens are encrypted).
- LARIS would act as processor for the SME (controller); processors are bound by the Security Principle since 1 April 2025 (maximum fine RM1,000,000 and 3 years, DFDL).
- Watch: PDP Commissioner Public Consultation Paper No. 1/2026 on AI and personal data protection (dated 5 Oct 2026), not yet law.

## 14. Success metrics and measurement method

No values are claimed. Each row says how the team will measure.

| Metric | Method | Value |
|---|---|---|
| Minutes per quote, manual | Stopwatch from enquiry received to quote ready, same synthetic enquiry, owners at Yb's shop plus 2 to 3 others; log in `interview-and-timing.md` | `[REAL DATA needed]` |
| Minutes per quote, LARIS | Same enquiry, same people, from message to owner approval | `[REAL DATA needed]` |
| RM margin protected | Sum of `margin_delta` over quotes flagged stale and then re-quoted or corrected, from `GET /api/alerts/stale-costs`; report only from a pilot with real owner consent, else label as synthetic | `[REAL DATA needed]` |
| Extraction accuracy | Correct lines over total lines on the fixture set | `[REAL DATA needed]` |
| Share of lines sent to review | `needs_review` lines over all lines | `[REAL DATA needed]` |
| First-time-user task time and errors | Untrained user, three tasks, observed | `[REAL DATA needed]` |
| Quotes with no follow-up | Open quotes older than 48 hours without a `followups` row, before and after | `[REAL DATA needed]` |
| Manglish speech and extraction accuracy | `scripts/eval_enquiries.py --live` and `scripts/eval_wer.py` on 60 synthetic enquiries and recorded voice notes; report with the sample size | `[REAL DATA needed]` |
| Willingness to pay | Interview question 6, anonymised | `[REAL DATA needed]` |

## 15. Out of scope

- Real payments, real tax or statutory filings, legal or financial advice. MyInvois e-invoice submission (readiness is a possible later add-on: `knowledge/04-regulation/e-invoice-myinvois.md`).
- Orbyte's own features: leave, claims, overtime, attendance, hiring, real e-sign flow.
- Real customer or company records.
- Qwen LoRA fine-tune (dropped by the owner; few-shot prompting only).
- Real Orbyte login or API integration.
- A legally binding e-signature (the accept link is simulated).
- Not built: STL weight pricing as a plugin, reply-polish with an LLM, multi-currency, unit-of-measure conversion, item aliases table, stock levels, raw-material enquiry matching.

## 16. Open items for the team

- Fill every `[REAL DATA needed]` above, from the timing session at Yb's shop and 2 to 3 other owners, and from the live accuracy run.
- Name a DPO, have the privacy wording reviewed, and confirm the deadlines at pdp.gov.my.
- Test with a phone and laptop what only passed against fakes: Telegram bot connect, one-tap bot creation, reactions, staff linking, licence issuing in several browsers, emails in real mail clients, the accept page on a phone, the tour and palette, the app on Replit's Postgres with the `laris_app` role (`docs/teammate-handoff.md`, section 2).
- Read the GitHub Actions run for row 146 (pytest in four groups).
- Decide whether the optional AI guide is switched on in the demo (default is off).
- After judging: change the public demo password and stop the RunPod pod.

## 17. Implementation status snapshot (from the build log, rows up to 146, 2026-10-29)

Built: PostgreSQL schema with row-level security and guarded transitions; FastAPI routes for documents, quotes, contacts, search, jobs, tracker, catalog photos, supplier asks, settings, roles, users, invites, signup, licence, privacy, accept links, usage and API keys; rules pricing with margin guard and price tiers; extraction validator; ILMU, RunPod vision, OCR, Telegram and WhatsApp clients; quote PDF, XLSX and CSV; APScheduler jobs; React web app with sign-in, help, tour and palette; 686 tests plus schema, database and role checks, run in CI.

In use for the demo: a Replit deployment and a RunPod vLLM pod (proof PDFs in `submission/`).

Not verified or not built: see the limits in `README.md` and sections 5, 8, 13 and 16. Re-check before submitting.
