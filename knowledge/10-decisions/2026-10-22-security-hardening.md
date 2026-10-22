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

Second pass: supplier price jumps over 20% flagged for review (P1), contact details and NRIC redacted before ILMU calls, owner erasure endpoint for customers, `ai_actions` rows for every model call, audit trigger on `tenant_fields` (parties and users stay out of the append-only log on purpose), FastAPI 0.159.1 with a clean `pip-audit`.

Third pass: per-user API tokens stored as SHA-256 (identity from the DB row, `REQUIRE_USER_TOKEN=1` turns header demo mode off), WhatsApp messages routed by business number per tenant, retention job (`RETENTION_DAYS`), least-privilege `laris_app` role (`db/roles.sql`, checked by `tests/roles_check.mjs`).

Still open: Postgres row-level security per tenant (the API scopes by tenant_id, the database does not enforce it), per-tenant outbound WhatsApp tokens and numbers, trying `db/roles.sql` on Replit's Postgres, a DPO contact and breach runbook, login UI and token rotation policy.
