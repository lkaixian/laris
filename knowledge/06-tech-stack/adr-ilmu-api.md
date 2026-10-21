---
source_url: https://console.ilmu.ai/pricing
retrieved: 2026-10-22
confidence: medium-high on models/prices (official site + console); low on API shape
status: verified (models, ASR exists, pricing) | REAL DATA needed (audio endpoint path/format, size limits, Manglish accuracy, rate limits)
---
# ADR: ILMU API (YTL AI Labs) for ASR + LLM

Related: [[adr-mesolitica-whisper]], [[adr-qwen3-vllm-runpod]], [[pdpa-malaysia]], [[pricing-numbers]]

- **Choice**: ILMU `ilmu-asr-v4.2` for voice notes; `ilmu-mini-v3.3` for extraction if good enough. **Alternative**: self-hosted Mesolitica Whisper ([[adr-mesolitica-whisper]]) + Qwen3 ([[adr-qwen3-vllm-runpod]]).
- **Confirmed (ilmu.ai model table)**: model strings `ilmu-v3.1`, `ilmu-nemo-nano`, `ilmu-glm-5.3`, `ilmu-vision-v1.3`, `ilmu-mini-v3.3`, `ilmu-asr-v4.2` (speech-to-text), `ilmu-tts-v2`, `ilmu-embedding-v1`, `web_search`, `bge-m3`, `bge-reranker`. So **yes, ILMU exposes speech-to-text**.
- **Pricing (console.ilmu.ai/pricing, MYR before 8% SST from 1 Jun 2026)**: ASR RM0.0002/second; ilmu-mini-v3.3 RM0.20 in / RM0.02 cached / RM1.20 out per 1M tokens; ilmu-v3.1 RM4.00 / RM0.40 / RM16.00. Only successful requests billed. A 30 s voice note = RM0.006 (derived).
- **Credits**: press reports an ILMU AI Accelerator (with MDEC) giving eligible Malaysian startups/SMEs up to RM5M free API credits; eligibility not verified. Pricing page shows no free PAYG credit (a one-time "Claw Free" plan, amount unstated).
- **Confirmed vs assumed**: `GET https://api.ilmu.ai/v1/models` returns HTTP 401 without a key (endpoint exists, OpenAI-style path plausible). NOT confirmed: whether ASR uses OpenAI-compatible `/audio/transcriptions`, max audio length, Malay/Manglish WER, no-training-on-data terms, data residency (matters for [[pdpa-malaysia]]). No API docs link found on ilmu.ai.
- Action: get a key, test 5 real voice notes before committing; keep Whisper fallback.
