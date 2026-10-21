---
type: review
date: 2026-10-22
reviewer: voltagent-qa-sec:security-auditor (read-only, no shell)
status: findings open; see fix status column in docs/BUILD_LOG.md
git_history_key_scan: 0 matches (run by lead after the audit; patterns: sk-, AKIA, bearer, Telegram bot token, Meta EAA)
---
# Security audit (2026-10-22)

Verified in code unless marked inference. Data is synthetic; the public URL still matters.

| ID | Sev | Where | Issue | Fix |
|---|---|---|---|---|
| A1 | High for real use | src/api/deps.py:75-96, routes.py:82,311,331 | No auth, only X-Role/X-User headers; no X-User falls back to the first user of the claimed role across tenants; exports and cost-items open to anyone claiming owner | Real: signed session, role and tenant from the DB user row. Demo: shared bearer token, drop the fallback |
| A2 | Med | routes.py:104-106, pipeline.py:178 | `messages` on a document leaks raw supplier text and prices to staff | Hide message bodies on `in` docs for non-owners |
| A3 | Low | routes.py:97-99, deps.py:40 | Staff see `tax_total` and `attrs`/`attrs_unmapped` values | Add `tax_total` to STAFF_HIDE; drop `attrs_unmapped` for staff |
| A4 | Med | webhooks.py:31-38 | No tenant binding on webhook routing; unknown senders go to the first tenant | Map phone_number_id or bot to a tenant |
| A5 | Med | webhooks.py:109-120 | Anyone messaging the bot burns ILMU credit and creates parties and drafts; no rate limit | Per-sender rate limit, approval before creating a party |
| W1 | Low | whatsapp.py:15,26 | `compare_digest` on str raises TypeError (500 not 403) on non-ASCII | Compare bytes |
| W2 | Low | webhooks.py:24-26 | Replay check not atomic; no unique (channel, external_id) | Unique index and 5 minute window |
| W3 | Low | webhooks.py:98 | Body buffered before HMAC, no size cap | Reject Content-Length over about 1 MB |
| W4 | Med | telegram.py, webhooks.py:77,85 | Bot token in URL path; exception text with URL logged | Log status only, strip `bot<token>` |
| S1 | Low | whatsapp.py:105-106 | Media URL fetched with bearer token, no host allowlist or size cap | Allowlist Meta hosts, stream with cap |
| U1 | Med | routes.py:275-276 | Upload fully spooled before the 10 MB check; mime from client | Content-Length cap, sniff magic bytes |
| U2 | Med | ocr.py:21,38,65 | PDF/image bombs, no tesseract timeout, pypdf 5.1.0 old (moderate confidence) | Cap pixels and pages, timeout, upgrade pypdf |
| P1 | Med | pipeline.py:140-176 | Supplier-side prompt injection can set a low price; only owner accept guards it | Show raw vs extracted diff; confirm price deltas over 20% |
| P2 | Low | pipeline.py:194-225 | Customer-side: AI cannot set prices (verified end to end); huge qty gives 500; attrs values unvalidated | Cap qty, whitelist and length-cap attrs |
| D1 | Med | transitions.sql:32, db.py:19-22 | Guard trusts a GUC; app connects as DB owner | Least-privilege app role, role from verified identity |
| D2 | Low | schema.sql:238-241 | Owner can disable audit trigger | Separate owner and app roles |
| D3 | Low | routes.py | Audit coverage partial (tenant_fields, parties, users) | Add triggers |
| E1 | Low | pipeline.py:42,130 | Upstream error bodies and constraint messages returned to client | Generic messages |
| C2 | Low | .env.example, docs/deploy.md | Missing TELEGRAM_WEBHOOK_SECRET, CORS_ORIGINS, ORG_LOGO_URL; setWebhook lacks secret_token | Update docs |
| F1 | Info | web/src/api.ts:64 | UI sends a fixed X-User UUID; seed users get random UUIDs so the live UI likely gets 401 (inference) | Seed fixed UUIDs |
| DEP1 | Med (uncertain) | requirements.txt, package.json | FastAPI 0.115.6 / Starlette and pypdf pins may carry CVEs; some deps unpinned; pytest in prod requirements | pip-audit, npm audit, pin |
| PDPA1 | Med | pipeline.py:178, schema.sql | No retention, erasure or export path; audit log immutable | Retention job, pseudonymise actors |
| PDPA2 | Med | ilmu.py, webhooks.py | Cross-border to ILMU/RunPod/Meta with no notice record; names and numbers sent as-is | Redact before LLM, notice, vendor list |
| PDPA3 | Low | webhooks.py:74-85 | Chat ids and numbers in logs | Hash identifiers |
| PDPA4 | Info | n/a | No DPO contact or breach runbook | Document before real customers |

## Solid (evidence from the audit)
Parameterised SQL everywhere; tenant_id on every lookup; DB trigger blocks illegal and owner-only transitions; AI never sets prices (code plus DB CHECK); webhook HMAC on raw bytes, fail closed; staff scrubbing on every response; no XSS sinks in web/src; Decimal money.

## Accepted for the hackathon
Header identity (A1/D1) only because data is synthetic: no real phone numbers or supplier prices in the demo DB, and note that `send_quote` messages real channel contacts. A4/A5, U1/U2/DEP1, P1 and PDPA1-4 are known and documented.
