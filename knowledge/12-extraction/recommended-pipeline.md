---
source_url: see [[approaches-compared]] and [[adr-ilmu-api]]
retrieved: 2026-10-22
confidence: medium (design recommendation, nothing here has been run)
status: REAL DATA needed (end-to-end accuracy untested; ILMU vision and JSON-mode unverified)
---
# Recommended extraction pipeline (3-day hackathon)

Why: [[approaches-compared]], [[how-the-ai-finds-values]]. Stack: [[refined-stack]]. Table targets: [[bidirectional-schema]].

## Pipeline (one primary path, two fallbacks)
```
photo/PDF -> PDF text layer? -> yes: use it (skip OCR)
                              -> no : PaddleOCR (latin rec) -> text lines ordered by y,x
-> ilmu-mini-v3.3 : OCR text + schema prompt -> JSON      (PRIMARY)
-> Python validator: parse, arithmetic, dates, flags
-> OK -> write documents + document_lines (status 'parsed', needs_review per line)
-> FAIL after 1 retry -> FALLBACK A: ilmu-vision-v1.3 with the image (if it accepts images)
-> FAIL -> FALLBACK B: Qwen2.5-VL-7B (Apache-2.0) on RunPod via vLLM  (also covers the sponsor RunPod checkbox)
-> still FAIL -> owner keys lines manually; document stays 'received'
```
Ponytail: build primary + validator first; add A only if the benchmark below fails; B only if A is unavailable. Layout analysis (PP-StructureV3) is a later upgrade if OCR text row order proves bad on tables.

Cheap shortcut worth testing first (inference): PDFs exported from accounting software already carry text; skipping OCR removes the main error source.

## Prompt sketch
System: "Extract a supplier quotation into JSON matching the schema. Use only text in the document. Unknown = null. Do not compute or infer prices. Keep line order. Numbers as plain numerals. Languages may be BM, English, Chinese."
Glossary: Butiran=description; Kuantiti/Qty/数量=quantity; Unit/UOM=uom; Harga seunit/Unit Price/单价=unit_price; Jumlah/Amount/金额=amount.
User: OCR text, then 1-2 synthetic few-shot pairs earlier in the prompt.

## Schema sketch (maps to document tables)
```json
{
  "supplier_name": "string|null",
  "doc_no": "string|null",            // documents.doc_no
  "issued_on": "YYYY-MM-DD|null",     // documents.issued_on
  "valid_until": "YYYY-MM-DD|null",   // documents.valid_until
  "currency": "MYR|...|null",         // documents.currency
  "lines": [{
    "line_no": 1,                     // document_lines.line_no
    "description": "string",          // description (verbatim)
    "qty": 0.0,                       // qty
    "uom": "string|null",             // uom
    "unit_price": 0.0,                // unit_price
    "amount": 0.0                     // validation only, not stored
  }],
  "totals": {"subtotal": null, "sst": null, "grand_total": null}  // validation only
}
```
Mapping notes: `direction='in'`, `kind` quotation/receipt/invoice set by the app from the upload (or a `doc_kind` field the model guesses, flagged for review); `party_id` resolved by matching `supplier_name` to `parties` (owner confirms new supplier); `item_key` left null until the owner maps it; `ocr_confidence` and `needs_review` from the validator, not the LLM. Do not let the model emit `price`/`total` keys inside `ai_actions.payload`: the schema's `no_price_keys` CHECK forbids them, so store the raw extraction in a different column/table or rename keys (e.g. `supplier_quoted_amount`). Decide this before coding. Also `qty > 0` CHECK: a null/zero qty line must be inserted only after review.

Constrained decoding: if ILMU exposes JSON mode or schema output, use it (unverified). Otherwise prompt + Pydantic parse + one retry with the error message. On RunPod vLLM, use its structured-output option (parameter name depends on version).

## Tiny test plan (synthetic only)
1. Generate 10 documents with a script (reportlab or HTML to PDF/PNG): 3 layouts (bordered table, borderless table, BM-only), one with SST and discount, one with a wrapped long description, one two-page table, one in Chinese+English. Ground truth JSON saved alongside.
2. Degrade copies: rotate 3 degrees, add blur/noise, JPEG at low quality, a thermal-style narrow monochrome receipt. No real customer data.
3. Run pipeline; score: header fields exact match; line count match; per-line qty/unit_price/description-normalised match; validator flags raised on deliberately corrupted digits (inject 3 wrong digits and check each is flagged).
4. Record per-document latency and token cost from ILMU responses.
5. Pass bar (suggestion, not a benchmark): header fields right on at least 8/10 clean docs, every injected digit error flagged, and no document silently wrong. Anything else goes to the fallback, then the owner.
6. Run the 3 real-looking cases the owner can legally share (own supplier quotes) as a final check, since synthetic layouts flatter the result.

## Do first (Day 1, 1-2 hours)
Get ILMU key; test `ilmu-mini-v3.3` JSON output on pasted OCR text; check whether `ilmu-vision-v1.3` accepts an image and returns JSON; read response token usage to confirm cost.

## Unverified / risks
ILMU JSON-mode and vision input; ILMU data-retention terms; Malay accuracy of PaddleOCR latin model on photos ([[adr-ocr-paddle-tesseract]]); RunPod 7B VLM GPU size and cold start; whether `no_price_keys` conflicts with storing extracted prices (see above).
