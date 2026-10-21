---
type: decision
date: 2026-10-22
status: accepted by owner (WhatsApp, ILMU, hosting); tiering of extras proposed
---
# Owner decisions (answers to scope-review questions)

1. **WhatsApp is required** (part of the problem statement) and is the primary channel. Telegram is a plus: same pipeline behind one channel adapter, fallback if WhatsApp setup stalls. Reverses the scope review's "Telegram only".
2. **Hosting/compute:** Replit (mandatory) + RunPod (mandatory for any GPU work). Orbyte/Alpha Red integration is optional and simulated (deck: roles, approvals, eSign, Connect are faked; we show where we plug in).
3. **STT:** try ILMU `ilmu-asr-v4.2` first; Mesolitica Whisper on RunPod as fallback and sponsor proof. See [[adr-ilmu-api]].
4. **The five extras are kept, in tiers** (proposal, build in this order):
   - Tier A (in the core journey): WhatsApp intake and status tracking; simulated eSign = "Sign & create job" button + audit row.
   - Tier B (cheap, high value): BOM/PO export xlsx+csv from accepted quote lines and the cost book (a few lines of openpyxl; was in the original brief); STL weight pricing as the 3D-printing template plugin (Yb's shop validation uses it).
   - Tier C (only if time): Qwen LoRA fine-tune; few-shot prompting is the default.

Open: verify WhatsApp Meta test number limits, template approval, and read-receipt webhooks before relying on the `read` state ([[whatsapp-cloud-api]]).
