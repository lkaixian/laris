# LARIS pitch outline: 10 minutes live plus 5 minutes Q&A

Finals: Sun 1 Nov 2026, own laptop with HDMI adapter, slides in .pptx, backup video ready (deck slide 22). Tie-break order: Technical Execution, Problem-Solution Fit, Impact and Feasibility, Innovation, Presentation, Design and UX. The app must really work, so the demo gets the most time. Fill every `[REAL DATA needed]` or cut the line.

## Slide by slide (10 minutes)

| # | Time | Slide | Say | Show |
|---|---|---|---|---|
| 1 | 0:00 to 0:30 | Title | "LARIS: know which supplier price every quote stands on." Team, roles. | Logo (use the supplied files in `web/public/brand/`, no invented mark) |
| 2 | 0:30 to 1:15 | Problem | Supplier prices live in chats and photos. Sent quotes lose margin when costs move. 67% of Malaysian SMEs cite rising costs (The Star, 1 Oct 2026, confidence medium). Our own measured loss: `[REAL DATA needed]`. State openly that the stale-quote loss figure is not yet measured. | One number, one source |
| 3 | 1:15 to 2:00 | User and moment | Owner of a made-to-order shop, quoting at night from WhatsApp. Segment hypotheses, from our research, not data. DOSM: 1,069,831 MSMEs; micro firms dominate. | Persona card (composite, SAMPLE) |
| 4 | 2:00 to 2:45 | Solution and 5-step journey | Both directions, one pipeline: trigger, connected data, decision, human approval, outcome and log. Model reads, rules price, owner approves. | Two-lane diagram from `docs/PRD.md` section 3 |
| 5 | 2:45 to 6:15 | Live demo (3.5 minutes) | Same click path as `docs/demo-script.md`: staff upload, owner accepts, voice note to draft quote with provenance, send, supplier raises acrylic by RM40 a sheet, sent quote flagged "margin down RM400", activity log. | The app, not slides. Backup video queued at 2:45 mark |
| 6 | 6:15 to 7:00 | Must-haves | One line each, with the screen or file that proves it: roles and permissions (staff cannot see margin), accuracy checks in `src/validate.py`, audit log, Orbyte fit, benefit. | Six-row table |
| 7 | 7:00 to 7:45 | Why a model here, and where not | Model: understand voice, photo, text. Rules: price, margin guard, discount cap, stale check. No price from a model, enforced in code and in the schema. | Architecture diagram: channel, ILMU, RunPod fallback, OCR, FastAPI, Postgres |
| 8 | 7:45 to 8:30 | Orbyte fit and reuse | The step before Clients and projects; hands to eSign and Work. Simulated: roles, approvals, eSign, Connect. Reusable cost-book API (contract written, not deployed). Two trade templates as YAML. | Plug-in diagram |
| 9 | 8:30 to 9:15 | Impact, business model, SDG | Minutes saved `[REAL DATA needed]`; margin protected `[REAL DATA needed]`. Usage-based pricing is a hypothesis we are testing; price `[REAL DATA needed]`. Cost floor per use from the vault: voice note about RM0.006 (30 s, ILMU, derived). SDG 8.2, 8.3, 9.3 and what we do not claim. | One benefit slide, one hypothesis slide |
| 10 | 9:15 to 10:00 | Risks, honesty, ask, close | Biggest risks and backups; PDPA plan; what is built and what is planned; next steps (pilot, templates, partner feeds). Close with the one-line promise. | Status table: built, mocked, planned |

Timing rule: if the demo overruns, cut slide 7 to one sentence. Never cut the stale-cost moment.

## Likely questions and honest answers

**1. Is this just a chatbot?**
No. The chat is the input channel. The product is the cost book with provenance, the rules-priced quote, the owner approval, and the stale-cost flag. The model reads input and never sets a price. We lead the demo with the dashboard flag for that reason.

**2. How do you know the problem is real? Where is your data?**
We do not have a measured loss figure yet. The vault has adjacent facts only: 67% of SMEs cite rising costs (medium confidence) and PPI rose 9.2% year on year in June 2026 (DOSM, high confidence). We searched for a Malaysian survey on quote turnaround or stale-cost margin loss and found none. Our measurement plan: time manual versus LARIS quotes with owners including Yb's shop. Results so far: `[REAL DATA needed]`.

**3. How accurate is the extraction?**
`[REAL DATA needed]` on our fixture set. The design limits damage: the model never scores itself, deterministic checks flag lines for review, and the owner confirms item mapping. OCR accuracy on real Malaysian phone photos is untested. Tesseract and PaddleOCR numbers in our notes come from vendor eval sets, not our data.

**4. Does Manglish voice work?**
We chose ILMU speech to text because it is built for Malaysian speech, but its Manglish accuracy and audio endpoint path were not confirmed in our research. The fallback is Mesolitica Malaysian Whisper on RunPod. Measured word error rate: `[REAL DATA needed]`.

**5. Why would an owner switch from the free WhatsApp Business app?**
They may not switch chats; LARIS sits behind the chat. WhatsApp Business has labels, quick replies and catalogs but no cost book and no margin check. Switching cost is behavioural and we have not tested adoption. Whether owners will use Telegram instead: `[REAL DATA needed]`.

**6. What about Bukku, AutoCount, SQL Account, Xero, Zoho?**
Known weaknesses from our gap table: outgoing quotes, PDF sharing and accept tracking are commodity. Bukku already sells OCR capture. Those tools own MYR fit, MyInvois compliance and the accountant relationship; we have none of that. SQL Account, AutoCount and Million were not fully checked and may have purchase-quotation features. Our narrow claim: no checked tool links supplier quote lines to customer quote margin with receipt and date per line. That is "none found on pages checked", not proof of absence.

**7. Could Orbyte or an accounting vendor copy this?**
Yes. We list it as a top threat: platforms bundling quoting, and incumbents adding AI and WhatsApp capture. Our answer is speed on the supplier-to-quote loop and the reusable cost-book API.

**8. Are you copying Orbyte?**
No. We do not build leave, claims, overtime, attendance, hiring or e-sign. Orbyte tracks clients and projects after work is won; LARIS is the step before. Login, roles, approval and eSign are simulated, and we say so. No Orbyte API has been called.

**9. What is real and what is mocked?**
Real in the repo: SQL schema with transitions guard and append-only audit log, pricing and margin guard, extraction validator, ILMU, RunPod, OCR, Telegram and WhatsApp clients (tested with mocked responses), React front end. Mocked or simulated: login and roles, eSign, Orbyte and Connect. Planned or unfinished at time of writing: FastAPI routes beyond `/health`, quote PDF, 48-hour scheduler, BOM export, WhatsApp live webhook. Update this answer from `docs/PRD.md` section 17 before pitching.

**10. How do staff not see margin?**
The API never returns cost or margin to staff, per our contract, and the UI hides it. This is API-level scoping, not database row-level security, and we do not claim otherwise.

**11. Can the model change a price?**
No path exists: price-like keys are rejected in `src/pricing.py`, and the database has no AI value for price source and rejects price keys in model action payloads. Only the owner can override a price, and the override is logged.

**12. What stops a wrong quote going out?**
Owner-only approval enforced by a database constraint (`sent` needs `approved_by`), margin guard against the minimum margin, discount cap needing the owner, and the stale-cost flag. Editing an approved quote is forbidden; a revision is a new document.

**13. What does it cost to run and what would you charge?**
Cost floor per use (vault, derived): voice note about RM0.006 for 30 s; WhatsApp about RM0.056 per quote conversation inside the free allowance, about RM0.39 beyond (vendor rates, medium confidence); Telegram free. Extraction token cost per quote: `[REAL DATA needed]`. Price: a usage-based hypothesis, for example per approved quote; we have not asked owners yet. `[REAL DATA needed]`.

**14. PDPA?**
Hackathon build uses synthetic data only. For real use: we would be a processor for the SME. Collect less, delete raw audio after a set period, role-based access, audit log, breach notification (72 hours to the Commissioner, per the vault's law-firm sources), data protection officer rules effective 1 June 2025. Sending audio to ILMU, RunPod and Meta is third-party and cross-border processing needing vendor agreements; ILMU's residency and no-training terms are unconfirmed. Not legal advice.

**15. Which SDG do you really move?**
8.2 is the nearest: productivity from less retyping and margin protection per job. 8.3 and 9.3 are plausible but unmeasured; we claim no formalization or credit-access outcome.

**16. Why would this work beyond signage and 3D printing?**
Trade templates are config: `made_to_order.yaml` and `fnb_catering.yaml` exist and load without code changes. Whether renovation, tailoring and other trades fit is a hypothesis from our market notes; the share of SMEs that price per job has no published figure.

**17. Why not just a spreadsheet?**
A spreadsheet does not flag a sent quote when a supplier price changes, does not keep the source document and date per cost, and has no role split or audit log. We have not tested spreadsheet users head to head.

**18. What did you validate with real people?**
`[REAL DATA needed]`: number of owners interviewed, manual time observed, willingness to pay. Do not claim interviews that did not happen.

**19. What would you build next with a mentor week?**
Finish live WhatsApp, the 48-hour follow-up, quote PDF, BOM export, the fixture accuracy report, and a pilot with consent.

**20. Which AI tools did you use?**
All listed in `docs/tech-and-tools-declaration.md`, including the development assistant. Anyone on the team can explain any part.

## Q&A discipline

- Answer in two sentences, then offer the file or screen that proves it.
- If a number is not measured, say "not measured yet" and state how we will measure it.
- Never claim a customer, partner, certification, security guarantee or performance figure we do not have.
- Assign question owners before the pitch: tech (stack, accuracy, security), product (journey, Orbyte, model), impact (SDG, business model, PDPA).

## Final-round files due 1 Nov, 7:59:59 AM

Updated PRD, updated Tech and Tools Declaration, final solution report, backup video, GitHub repo, .pptx slides, demo materials.
