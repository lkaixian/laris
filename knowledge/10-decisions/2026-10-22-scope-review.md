---
type: decision
retrieved: 2026-10-22
updated: 2026-10-22
status: proposed review, awaiting owner decision
---
# Scope review: bidirectional LARIS (written 2026-10-22)

Build ends Sat 24 Oct night, deadline Sun 25 Oct 07:59. That is ~2.5 working days from today, not 5. Treat everything below as that budget. Related: [[../07-data-model/bidirectional-schema]], [[../07-data-model/state-machines]], [[../07-data-model/synthetic-data-spec]].

## Verdict on the refinement
Keep it, but as ONE table pair plus ONE link table, not as two parallel product surfaces. Bidirectional is the good idea: it makes the cost book provable ("this price came from this supplier line on this date") and gives the stale-cost alert, which is the whole pitch. Risk: judges see "quotation tracker" and expect a CRM. The pitch is margin protection; the tracker is plumbing.

The danger is not the schema. It is that "bidirectional + 3 trades + 2 channels + OCR + STT + LLM + approval + eSign + job + follow-up + exports" is ~6 products. Hackathon rule is one clear journey.

## The one journey (5 steps, pick this and nothing else)
1. Trigger: supplier quote photo arrives in Telegram (staff uploads), then later a customer enquiry arrives (voice note or text). Two triggers is fine only because they are the same pipeline (document in).
2. Data: OCR+parse -> lines -> owner-confirmed `cost_items`; enquiry -> extracted items (LLM, no prices).
3. Decision: rules engine prices quote from cost_items; margin guard; stale-cost check.
4. Human approval: owner taps approve (staff cannot see margin).
5. Outcome + log: quote PDF sent in chat, status -> sent/read/accepted -> job card; audit log shown; weekly-style alert "supplier raised price, 2 open quotes lose RM X".

## Cut list (do not build; mention on a "next" slide)
| Cut | Why |
|---|---|
| WhatsApp (keep Telegram only) | Meta template approval + billing change from 1 Oct 2026 + test-number friction. Telegram has no window or approvals. Mention WA as roadmap. Declare it honestly; do not fake it. |
| Purchase orders / POM export | Already flagged extra in PLAN.txt. Keep BOM xlsx only (one openpyxl function). |
| Second STT engine | Pick one. ILMU if transcription endpoint verified TODAY; else Mesolitica on RunPod. Do not build both. Whichever is live must be a real call (sponsor proof). |
| Tesseract + PaddleOCR two-stage | Highest-risk component. Cut to ONE engine on the demo path. Recommendation: PaddleOCR (detector+recognizer) if it installs in Replit in under 30 min, else Tesseract on clean synthetic images. Keep the confidence -> `needs_review` flow; that is the safety story. |
| Qwen LoRA fine-tune | No. Few-shot with JSON schema constraint only. |
| LLM `draft_reply` polish and ILMU rewording | Use templated replies from YAML. Cut `draft_reply`. Keep `extract_items`, `parse_receipt_lines`, `ask_clarification`; `schedule_followup` is a plain APScheduler job, no LLM. |
| 3 trade templates fully | Build 1 end-to-end (made-to-order, because the stale-cost story is strongest). Second template (F&B) = YAML + seed only, no code change, shown for 30 seconds to prove "config not code". Third = file exists, one slide. |
| STL/trimesh | Cut from core. Optional plugin only if made-to-order seed needs grams; use `grams_per_unit` typed value. It is a 3D-printing feature and contradicts "general SME". |
| Simulated eSign | Cut to a "Sign & create job" button that sets status and stamps audit row. Do not build a signing flow. |
| Customer-side `read` state | Telegram has no read receipts for bots. Drop `read` from the Telegram demo; keep enum for WA later. |
| Multiple in-states (expired, superseded) in the in-direction | Ship `received -> reviewed -> in_cost_book` only. |
| `item_aliases`, multi-currency, SST, UOM conversion | Not now. |
| Weekly margin report | Replace with the stale-cost alert shown on the dashboard. Scheduler does 48h follow-up only. |
| Object Storage abstraction | Store files on Replit disk/Object Storage with one helper, no interface. |
| Business-model/growth slides beyond one slide each | Needed for scoring but are slides, not code. |

## What is risky (ordered)
1. OCR quality on thermal/phone receipts. Mitigation: synthetic fixtures with expected JSON; confidence gate; the demo uses a clean + one hard image, hard one deliberately routed to the "please confirm" short form. Never promise accuracy beyond measured fixtures.
2. `item_key` mapping (receipt text -> cost-book item). This silently ruins the margin number. Mitigation: owner picks from the template catalog dropdown on review; no auto-merge.
3. Replit Reserved VM: Postgres, webhooks, APScheduler, WeasyPrint system libs (pango/cairo) on Nix can be painful. Test WeasyPrint on Replit in the first hour; fallback is HTML->print CSS or reportlab. Telegram polling (no public webhook) removes one failure mode.
4. RunPod cold start for Qwen/Whisper during the live demo (minutes). Mitigation: warm it 10 min before; pre-recorded successful run as backup; log latency. The LLM call is JSON-only and could be replaced by a deterministic regex parse for the typed-text path (keep model for voice/photo path).
5. ILMU transcription endpoint may not exist for your key (PLAN.txt says verify). Verify first; this decides STT.
6. Staff-cannot-see-margin: only credible if all reads go through role-scoped API. Do not claim database RLS unless enabled. Two screens in the demo is enough.
7. Benefit numbers: nothing measured yet. Thursday timing session is required, and now it is Thursday 22 Oct: schedule it today. Without it feature 6 stays weak. No estimated numbers in the pitch (vault rule).
8. Wow number: choose a material-heavy job so the RM figure is visible (PLAN.txt: RM3.83 is too small).
9. "Re-skinned chatbot" perception. Lead the demo with the dashboard stale-cost alert and `v_quote_bom`, not the chat.

## Minimum demo (must work; everything else is bonus)
Single Telegram bot + one React page (4 sections can be 2 screens) + FastAPI + Postgres. Order of build:
1. (Hour 0-4) Schema + transitions + audit trigger + seed script for made-to-order. Verify `v_quote_bom` with SQL only.
2. (4-10) Supplier doc intake: image -> OCR -> lines -> review screen -> accept -> cost_items. Hard-coded fallback fixture if OCR fails.
3. (10-16) Enquiry intake (text first, voice second) -> LLM extract_items -> rules pricing -> draft quote + margin guard.
4. (16-22) Owner approve -> PDF -> send in Telegram -> accept -> job + audit log view.
5. (22-30) Stale-cost alert + staff view without margins + F&B YAML swap demo.
6. Remaining: README, Tech & Tools Declaration, demo video, timing numbers, buffer. Freeze features by Sat 18:00.

Demo script (3 minutes): staff sends supplier quote photo -> owner accepts -> cost book updated with source line/date -> customer voice note -> draft quote with "priced from supplier line X dated D" -> owner approves -> sent -> NEW supplier quote with higher price arrives -> open quote flagged "margin down RM X" -> audit log. One RunPod call visible in the log.

## Decisions requested from owner
- Telegram only for the hackathon? (recommended: yes)
- OCR engine: one only, which? (recommended: PaddleOCR, fallback Tesseract)
- STT: ILMU vs Mesolitica, decided after endpoint check today.
- Build made-to-order fully, F&B as config swap only? (recommended: yes)
- Accept dropping eSign, PO, WA, LoRA, STL from the build?

## Things not verified in this review
Replit capabilities, ILMU endpoint, WhatsApp pricing/template facts, and Telegram read-receipt behaviour are taken from PLAN.txt or from memory and are unchecked; confirm before relying. Status: unverified until tested.
