---
source_url: https://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.html
retrieved: 2026-10-22
confidence: medium
status: verified (Malay listed in PaddleOCR latin model; tessdata msa file exists) | REAL DATA needed (accuracy on real Malaysian invoices/quotes, model sizes)
---
# ADR: OCR for supplier quote photos/PDFs

Related: [[adr-qwen3-vllm-runpod]], [[adr-ilmu-api]]

- **Choice**: PaddleOCR PP-OCRv5 `latin_PP-OCRv5_mobile_rec` (official doc lists Malay among its languages; official accuracy 84.7% on its eval set, +46.8% over previous gen). Default multilingual recognizer is Chinese/English/Japanese, so Malay needs the Latin model explicitly. **Alternative**: Tesseract with `msa`.
- **Tesseract**: `msa.traineddata` exists in github.com/tesseract-ocr/tessdata (main; fetched, 7.9 MB). Accuracy on receipts/quotes not tested.
- **Not confirmed**: size of the latin mobile recognizer (only a generic PP-OCRv5_mobile_rec row of 16 MB seen on a third-party page); real-world accuracy on tables, handwriting, phone photos. Alternative worth testing: ILMU `ilmu-vision-v1.3` ([[adr-ilmu-api]]), price not read.
- Both free/open source; cost = compute only.
