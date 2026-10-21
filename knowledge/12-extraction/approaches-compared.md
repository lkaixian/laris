---
source_url:
  - https://arxiv.org/pdf/2308.07777
  - https://arxiv.org/pdf/2401.02823
  - https://arxiv.org/pdf/2304.12484
  - https://arxiv.org/pdf/2507.05595
  - https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct
  - https://arxiv.org/pdf/2509.18189
  - https://docs.vllm.ai/en/v0.10.2/features/structured_outputs.html
retrieved: 2026-10-22
confidence: medium for the cited figures (search snippets and a model card, not the original tables); low for everything marked inference
status: verified (figures quoted below, each with its caveat) | REAL DATA needed (every accuracy number on Malaysian BM/EN/ZH quotes, thermal receipts, phone photos)
---
# Extraction approaches compared

Question: how does a system know WHERE to look on a quote/receipt and what a value means? Mechanics: [[how-the-ai-finds-values]]. Pick: [[recommended-pipeline]]. Stack context: [[refined-stack]], [[adr-ocr-paddle-tesseract]], [[adr-ilmu-api]].

Benchmark caveat: FUNSD (forms), CORD and SROIE (receipts), DocVQA (question answering) are public English-dominant sets. None is a Malaysian quotation. Treat every figure as "the model can do this on clean benchmark data", not as LARIS accuracy.

## 1. Classic OCR + regex / templates
- **Where**: OCR gives words plus boxes; a template or regex says "the number right of 'Total' is the total" or "region x,y,w,h is the date". Position is hard-coded per supplier layout.
- **Tables**: row clustering by y-coordinate and column cuts by x. Breaks on merged cells, missing borders, wrapped descriptions, multi-page continuations (inference from how rule-based code works).
- **Cost/licence**: free, CPU only; Tesseract and PaddleOCR are open source ([[adr-ocr-paddle-tesseract]]).
- **Verdict**: fine for ONE known supplier, fails the "unknown layout" requirement. Use only as the validator layer (regex for dates, currency, SST).

## 2. OCR + layout analysis (PaddleOCR PP-StructureV3, Docling, Unstructured; cloud Document AI for reference)
- **Where**: a layout detector labels page regions (title, text, table, header, footer); a table-structure model recovers rows/columns/cells; output is Markdown/HTML/JSON with reading order. PP-StructureV3 pipeline: preprocessing, OCR (PP-OCRv5), layout analysis (PP-DocLayout-plus), item recognition (tables, formulas), post-processing. Source: PaddleOCR 3.0 report (arXiv 2507.05595).
- **Evidence**: the report evaluates on OmniDocBench and claims models under 100M parameters rival billion-parameter VLMs. I could not read the table breakdown, so no table-accuracy figure is quoted. A search snippet showed one score of 0.091 under "1-EditDist"; metric direction unclear, not used.
- **Tables**: dedicated table-structure recognition handles borderless tables better than rules (inference; test on real quotes). Multi-page tables still need your own stitching.
- **Handwriting/thermal/photos**: depends on the recognizer; not verified. Malay needs the Latin recognizer ([[adr-ocr-paddle-tesseract]]).
- **Cost/GPU**: small models, CPU feasible, GPU faster. Licence: PaddleOCR is Apache-2.0 (from memory, unverified this session). Docling and Unstructured licences not checked.
- **Cloud Document AI (Azure / Google / AWS)**: reference only, not used. Prices, data residency and Malaysian-language support not checked. Sending documents abroad matters for [[pdpa-malaysia]].
- **Role in LARIS**: gives an OCR + layout text/Markdown the LLM reads. It does not by itself say what a column means.

## 3. Layout-aware transformers (LayoutLMv3, Donut, Pix2Struct)
- **Where**: LayoutLMv3 takes OCR tokens + their bounding boxes + image patches and tags each token (e.g. TOTAL, DATE). Position is learned, not coded. Donut is OCR-free: image in, structured text out. Both need fine-tuning on labelled data of your document type.
- **Evidence (secondary sources, setups differ)**:
  - FUNSD F1: LayoutLMv3 base 91.19, large 92.10 as quoted in a GraphLayoutLM paper (arXiv 2308.07777); another study on official splits got 88.81; one reproduction got about 82.
  - CORD F1: base 96.53, large 97.49 (same GraphLayoutLM paper); DocGraphLM (LayoutLMv3-base variant) 96.93 (arXiv 2401.02823); a reproduction got about 95.5.
  - SROIE: no clean LayoutLMv3 figure found; one study reports LayoutLMv2 at 96.14 F1 and notes the SROIE evaluation protocol is inconsistent between papers.
  - Speed on an RTX 6000, CORD (DocParser paper, arXiv 2304.12484): Donut 0.44 s/image; LayoutLMv3 0.039 s/image excluding OCR time.
  - Donut's own CORD F1 and the original LayoutLMv3 tables: NOT read (PDF fetch returned binary). Open items.
- **Tables**: weak for line items. These models do entity tagging; you must group tagged tokens into rows yourself (inference). CORD has line-item entities, FUNSD does not.
- **Cost of use**: needs a labelled Malaysian dataset and fine-tuning; no such data exists in the repo. LayoutLMv3 licence: CC BY-NC-SA 4.0 for the weights as I recall; UNVERIFIED and potentially non-commercial. Check before use.
- **Verdict for 3 days**: skip. No labelled data, no time to fine-tune, licence risk.

## 4. Vision-language models, direct image to JSON
- **Where**: the model sees the whole page and is prompted for a JSON schema; localisation is implicit in attention (it "reads" the page). No template.
- **Open models**: Qwen2.5-VL-7B-Instruct, Apache-2.0 per its model card. Card figures: DocVQA test 95.7, OCRBench 864. Qwen's card says it supports structured output for invoices/forms/tables but gives no invoice-specific benchmark. Independent reproduction (Qianfan-VL paper, arXiv 2509.18189): 7B 94.91 DocVQA_VAL / 883 OCRBench, 72B 95.75 / 874. Qwen3-VL: not researched.
- **Closed models** (GPT / Claude / Gemini vision): strong in practice, but no benchmark figures gathered here, and they send documents to a foreign vendor ([[pdpa-malaysia]]).
- **ILMU `ilmu-vision-v1.3`**: exists ([[adr-ilmu-api]]); input format, price, quality all unread. Test first.
- **Tables/photos/handwriting**: VLMs handle skewed phone photos and mixed scripts better than classic OCR in general (inference, not verified for BM/ZH). Failure mode: silently invents or skips lines on long tables; no per-field confidence. Long multi-page tables need page-by-page calls with stitching.
- **Cost/GPU**: a 7B VLM needs roughly one 24 GB GPU class (inference from size, check on RunPod); API VLMs cost per image token. Slower than OCR + small LLM (inference).
- **Verdict**: best accuracy-per-effort for unknown layouts. Use as fallback or second opinion.

## 5. Text LLM over OCR text with schema-constrained JSON
- **Where**: OCR (+ layout Markdown) provides text with line order; the LLM decides which line is a header field vs item row from words ("Qty", "Unit Price", "Jumlah", "数量") and arithmetic. Structure is forced by JSON schema.
- **Constrained decoding**: vLLM supports JSON-schema constrained output (xgrammar or guidance backends in v0.9-v0.10 docs; older versions had outlines and lm-format-enforcer). Parameter names change between versions, so check the installed version. A 2025 paper reported vLLM v1 raised errors on unsupported schemas in `xgrammar:no_fallback` mode; may be outdated. Hosted API (ILMU): whether `response_format` / JSON mode / function calling is supported is UNVERIFIED ([[adr-ilmu-api]]).
- **Tables**: depends on OCR row order; layout analysis (approach 2) improves this.
- **Handwriting/thermal**: bounded by OCR quality; LLM can repair typos but cannot recover unread digits (do not let it guess numbers: verify by arithmetic, see [[how-the-ai-finds-values]]).
- **Cost**: `ilmu-mini-v3.3` RM0.20 in / RM1.20 out per 1M tokens ([[adr-ilmu-api]]); a quote page is a few thousand tokens (inference), so well under a sen per document at those prices (derived, token count assumed).
- **Verdict**: cheapest and simplest. Primary path.

## Summary table
| Approach | Needs training data | Unknown layouts | Line-item tables | GPU | Main risk |
|---|---|---|---|---|---|
| Regex/templates | no | no | weak | no | one supplier only |
| OCR + layout | no | partly | good (inference) | optional | no semantics |
| LayoutLMv3/Donut | yes | after fine-tune | weak | yes | no data, licence |
| VLM direct | no | yes | medium | 7B: yes; API: no | silent hallucination |
| OCR text + LLM JSON | no | yes | depends on OCR | no (API) | OCR errors |

## Unverified
Donut/LayoutLMv3 original-paper numbers; PP-StructureV3 table metrics; licences of PaddleOCR, Docling, Unstructured, LayoutLMv3; Qwen3-VL; ILMU vision and JSON-mode support; all Malaysian-document accuracy.
