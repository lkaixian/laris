---
source_url:
  - https://arxiv.org/pdf/2304.14936
  - https://docs.vllm.ai/en/v0.10.2/features/structured_outputs.html
retrieved: 2026-10-22
confidence: medium for mechanics (general engineering knowledge, not benchmarked); thresholds are inference
status: REAL DATA needed (thresholds must be tuned on real or realistic quotes) | mechanics verified only as design
---
# How the AI finds values on a quote

Compare engines in [[approaches-compared]]; build plan in [[recommended-pipeline]]. Target tables: `documents`, `document_lines` in [[bidirectional-schema]].

## 1. Header fields vs table
- **Header** (supplier name, doc_no, issued_on, valid_until, currency, totals): a handful of single values, found by label proximity ("Quotation No", "Date", "Valid until/Sah sehingga") and by position (top of page). An LLM reading text does this from the words; a layout model from region labels (title/header/table).
- **Table**: repeating rows. Find the header row (words like Description/Qty/UOM/Unit Price/Amount, or BM: Butiran/Kuantiti/Harga/Jumlah), then every row below until a totals block. Layout analysis marks the table region; the LLM maps columns by header words, not column order.
- **Footer**: subtotal, SST, rounding, grand total. These are totals, not lines: keep them in a separate object so they cannot become fake items.

## 2. Mapping to a fixed schema
Constrain output to the target (see schema sketch in [[recommended-pipeline]]). Rules:
- Free text stays verbatim (`description`); `item_key` is NOT guessed at extraction, it comes from the owner alias step ([[bidirectional-schema]] hard points).
- Numbers returned as plain numerals, no currency symbols; the app parses. Missing = `null`, never 0 and never an invented value.
- `uom` copied as written; if missing, null and `needs_review=true` (schema says UOM must match exactly).
- Schema enforcement options: JSON schema + constrained decoding (vLLM, version-dependent), or JSON mode/function calling on a hosted API (ILMU support unverified), or plain prompt + parse + retry with Pydantic validation (works anywhere).

## 3. Validation by arithmetic
Deterministic code, not the LLM, runs these after extraction:
1. Per line: qty x unit_price = amount, within 0.01 (or 1 sen rounding). Mismatch: flag the line.
2. Sum of line amounts (minus discount) = subtotal.
3. Subtotal + SST = grand total. SST rate: check the current rate for the item class (the repo notes 8% from 1 Jun 2026 for ILMU prices; do not hard-code a rate for quotes without confirming, see regulation notes).
4. Dates parse; valid_until >= issued_on; currency in known set.
5. Which number is wrong? If a line fails but the totals reconcile, suspect a misread digit in that line; if all lines are consistent but the total differs, suspect a missing line (multi-page, dropped row).
Why this matters: OCR digit errors (5/6, 0/8, dropped decimal point) are the main silent failure, and arithmetic catches most of them (reasoning; real catch rate not measured).

## 4. Confidence and human review
- OCR engines give per-word confidence; LLMs give none reliably. Do not trust the LLM's self-reported confidence (inference: self-scores are poorly calibrated).
- Practical score per line = min(OCR confidence of the words it came from, arithmetic check pass/fail). Write the OCR part to `document_lines.ocr_confidence`; set `needs_review=true` when below threshold or arithmetic fails.
- Starting thresholds (inference, tune on data): OCR word conf < 0.80 on a number, any arithmetic mismatch, null qty/price, or total mismatch => review. Whole document goes to `reviewed` status only after owner clears flags (schema already blocks cost-book promotion for flagged lines).
- The owner always confirms before `accepted` (schema rule: AI output never becomes price without a human).

## 5. Unknown layouts without templates
No per-supplier config: the LLM/VLM infers columns from header words in BM/EN/ZH. Aids: a short glossary in the prompt (Butiran=description, Kuantiti/Qty=quantity, Harga seunit=unit price, Jumlah=amount, 数量, 单价, 金额), instruction to keep rows in reading order, and the arithmetic check as the safety net. Public benchmarks have known weaknesses (information redundancy and biases, arXiv 2304.14936), another reason not to read benchmark scores as proof for new layouts.

## 6. Self-consistency and retry
- Retry once on invalid JSON or failed schema, feeding the validation error back.
- If arithmetic fails: re-extract only the failing rows with the row image/crop or with the VLM fallback; accept the answer where arithmetic passes.
- Two-engine agreement: run text-LLM and VLM; fields where both agree are high confidence, disagreements go to review. Doubles cost; use only on failures (design choice, not benchmarked).

## 7. Few-shot examples
Put 1-2 synthetic examples (input OCR text -> JSON) in the prompt: one with SST and discount, one BM-only. Cheap, steadies column mapping and null handling. Use synthetic data only (PDPA, [[pdpa-malaysia]]). Effect size unmeasured.

## Unverified
All thresholds; SST rule for quotes; ILMU JSON-mode support; actual arithmetic catch rate.
