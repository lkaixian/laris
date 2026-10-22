---
type: decision
date: 2026-10-22
status: done in code; real auth and RLS still deferred
sources: [[security-audit]], [[fix-list]]
---
# Security hardening pass

Closes security-audit A1 (demo), A2, A3, W1, W3, W4, W2, S1, U1, U2, DEP1 (pypdf), PDPA3 and adds hash checks.

- **Bearer token:** `APP_TOKEN` set means every `/api` call needs `Authorization: Bearer`; compared as bytes in constant time. Reads need `X-User`; only `/api/me` may bootstrap without it.
- **Hash checks:** WhatsApp `X-Hub-Signature-256` HMAC over raw bytes (bytes compare, so non-ASCII input is a 403 not a 500); Telegram secret header; SHA-256 of every supplier document stored in `extraction.source_sha256`, an identical source is a 409 whoever forwards it; unique `(channel, external_id)` on messages stops provider replays.
- **Staff scrub:** no supplier chat text, `tax_total` or `attrs_unmapped`.
- **Inputs:** 1 MB webhook cap, 10 MB upload cap before the body is read, magic-byte sniff (PDF, JPEG, PNG, WebP), 25 MP image cap, 30 page PDF cap, 30 s Tesseract timeout, Meta-only media hosts, Telegram token never in error text, hashed ids in logs.
- **Channels:** `scripts/setup_channels.py`; WhatsApp falls back to an approved template (error 131047) when the 24h window is closed.

Still open: real login and Postgres RLS, least-privilege DB role, retention and erasure, redaction before the LLM, prompt-injection price-delta confirm (P1).
