---
source_url: https://docs.runpod.io/serverless/endpoints/endpoint-configurations
retrieved: 2026-10-22
confidence: medium
status: verified (license, GPU rates, FlashBoot, vLLM structured outputs) | REAL DATA needed (Qwen3 cold-start seconds, Malay JSON accuracy, flex vs active price)
---
# ADR: Qwen3-1.7B/4B on vLLM, RunPod Serverless, constrained JSON

Related: [[adr-ilmu-api]], [[adr-mesolitica-whisper]], [[pricing-numbers]]

- **Choice**: Qwen3-1.7B (or 4B) via RunPod vLLM worker for extracting quote fields into JSON. **Alternative**: ILMU `ilmu-mini-v3.3` at RM0.20/RM1.20 per 1M tokens ([[adr-ilmu-api]]), no GPU or cold start. At LARIS volumes the API is likely cheaper and simpler.
- **Model**: Qwen/Qwen3-1.7B is apache-2.0, about 2.03B params BF16 (HF API; 4.2M downloads). 4B not fetched (assumed same license, UNCONFIRMED).
- **vLLM constrained JSON**: supported via xgrammar/guidance backends. `guided_json` was removed in vLLM v0.12.0; use `structured_outputs: {json: <schema>}`. Check the RunPod worker's bundled vLLM version.
- **RunPod serverless per-second GPU rates (docs)**: 16GB A4000 $0.00016; 24GB L4/A5000/3090 $0.00019; 4090 PRO $0.00031; 48GB A40 $0.00034, L40S $0.00053 (pricing page hourly: L4 $0.69, A4000 $0.58, 4090 $1.10, A40 $1.22, L40S $1.75). A 1.7B BF16 model (~4GB) fits 16GB; suggested 16GB or L4 (my sizing, not benchmarked). Docs list one rate; flex-vs-active split not found.
- **Cold start**: billed, mostly model load into GPU. Baked-in model image gives "seconds" cold start (RunPod); FlashBoot on by default. Actual seconds: not measured. Idle timeout default 5 s.
- vLLM worker is OpenAI-compatible; up to 3 GPU types in priority order.
