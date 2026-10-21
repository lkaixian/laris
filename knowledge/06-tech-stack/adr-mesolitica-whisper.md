---
source_url: https://huggingface.co/api/models?author=mesolitica&search=whisper
retrieved: 2026-10-22
confidence: medium
status: verified (model names, languages, base model) | REAL DATA needed (license; HF API and cards show none)
---
# ADR: Mesolitica Malaysian Whisper (fallback ASR)

Related: [[adr-ilmu-api]], [[adr-qwen3-vllm-runpod]], [[pdpa-malaysia]]

- **Choice**: fallback / self-host ASR. **Alternative**: ILMU ASR ([[adr-ilmu-api]]), simpler, no GPU.
- **HF models (mesolitica)**: `malaysian-whisper-tiny`, `-base`, `-small-v2`, `-small-v3`, `-medium`, `-medium-v2`, `-large-v2`, `malaysian-distil-whisper-large-v3`, and `Malaysian-whisper-large-v3-turbo-v3` (most downloaded: 30,636; base openai/whisper-large-v3-turbo; languages ms, en, zh, ta; last modified 2025-06-04). small-v3 is about 0.2B params, ms + en incl. Manglish; load via transformers, chunk audio to 30 s.
- **License**: NOT confirmed. HF API metadata and model-card text show no license tag. Base Whisper is MIT, but the fine-tune's license is unstated; their related dataset Malaysian-Emilia-annotated is cc-by-nc-4.0 (do not assume it applies). Ask Mesolitica or check repo files before commercial use.
- No WER figure found on the cards. Cost: self-hosting on RunPod ([[adr-qwen3-vllm-runpod]] GPU rates), unmeasured.
