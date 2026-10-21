---
type: stack-summary
updated: 2026-10-22
status: proposed (owner sign-off pending)
---
# Refined stack (after verification)

Changes from PLAN.txt, driven by research. Evidence lives in the linked ADRs.

| Layer | PLAN.txt | Refined | Why |
|---|---|---|---|
| STT | ILMU "if exposed" | **ILMU `ilmu-asr-v4.2`** (RM0.0002/s, about RM0.006 per 30 s note); Mesolitica Whisper on RunPod as fallback and sponsor proof | ILMU exposes STT: [[adr-ilmu-api]]. Mesolitica license unconfirmed: [[adr-mesolitica-whisper]] |
| Extraction LLM | Qwen3-4B on RunPod | **Try `ilmu-mini-v3.3` first** (RM0.20 in / RM1.20 out per 1M tokens, no cold start); Qwen3 on RunPod only if benchmark fails | [[adr-qwen3-vllm-runpod]]. Keep one RunPod call live for the sponsor checkbox |
| OCR | PaddleOCR + Tesseract | Keep PaddleOCR mobile det + Tesseract `msa`; accuracy on real quotes untested | [[adr-ocr-paddle-tesseract]]. Ponytail: test one engine first |
| Channel | Telegram + WhatsApp | **Telegram first**; WhatsApp only if time. Telegram has no read receipts | [[telegram-bot-api]], [[whatsapp-cloud-api]] |
| Data | Postgres, many tables | `documents` + `document_lines` with `direction`, `line_cost_basis`, `cost_items` | [[bidirectional-schema]] |
| Hosting | Replit Reserved VM | same; confirm current price in console | [[adr-replit-hosting]] |
| Price trend | PriceCatcher | optional; grocery coverage only, weak for B2B quotes | [[adr-pricecatcher]] |

## Cost per use (verified or sourced, see [[pricing-numbers]])
- Voice note STT: about RM0.006 per 30 s.
- WhatsApp quote conversation: about RM0.06 inside the 1,000 free service messages a month, about RM0.39 beyond. Promotional wording can reclassify a utility template as marketing (RM0.3467). Source quality: vendor pages, not Meta's rate card.

## Regulation consequences
- e-Invoice threshold moved to RM3M from 1 Sep 2026 (secondary sources): optional upsell, not a compliance driver. [[e-invoice-myinvois]]
- PDPA: voice notes sent to ILMU/RunPod/Meta are third-party and cross-border processing; need vendor agreements for real use; synthetic data only for the hackathon. [[pdpa-malaysia]]

## To verify before building
ILMU audio endpoint path and Manglish accuracy; Mesolitica license; ilmu-mini JSON extraction quality; Replit price.
