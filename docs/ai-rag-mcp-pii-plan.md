# AI system plan: PII masking, observability, RAG and MCP

Status tracker for the work in stages. Each stage ends with tests, a `docs/BUILD_LOG.md` row, a commit and a read of the CI run.

## Working method

The full suite takes about 8 minutes locally, so it is not run per change. Run the touched test files locally, push, and read the CI run through the public API (see the saved CI feedback). Only a CI failure sends us back to the suite.

## Decisions (owner, 2026-10-30)

- Masking is **reversible**: the model sees `[EMAIL_1]`, the person sees the real value.
- **RAG reads only the signed-in business's own data.** Tenant isolation comes from the existing row level security, not from a filter in app code.
- **Every AI chat follows the caller's role.** Staff never see what an owner-only section holds (`src/perms.py`: `view_costs`, `view_reports`, `view_replies_prices`, `view_audit` and every `NON_ASSIGNABLE` action).
- **MCP client is the business's own choice.** LARIS ships a read-only MCP server over HTTP with a token; any client that speaks MCP can connect.
- Observability lives on the AI tab (`web/src/AiSettings.tsx`), with the chat on the Assistant tab (`web/src/Assistant.tsx`, `GuideChat.tsx`).

## What exists today

- One model door per path: `ilmu.extract_json` (hosted ILMU) and `ai_guide.ask_json` (hosted or the owner's own server). Callers: `pipeline.py` (2), `rfq_reply.py`, `availability.py`, `assistant.py`, `ai_guide.py`.
- The Assistant picks an intent from a closed list and composes the answer from the database under the caller's permissions. It never sets a price.
- Tables: `tenant_ai` (mode, provider), `ai_consent_log` (append-only), `usage_events`, `ai_actions` (price-free). All tenant-scoped with forced RLS.

## Stage 1: PII masking

| Step | Work | Done when |
|---|---|---|
| 1a | `parse_util.Mask`: reversible tokens for email, phone, NRIC and Luhn-valid card numbers. Applied inside `ilmu.extract_json` and the custom-server path of `ask_json`, so no caller can skip it. Call-site `redact()` removed | DONE 2026-10-30. Test: payload holds no seeded PII, reply is unmasked, prices and quote numbers pass |
| 1b | Names: a per-request dictionary from the tenant's own `parties` rows (name and attention), whole-word and case-insensitive, replaced with `[NAME_n]`. No NER library. Addresses are not masked yet | DONE 2026-10-30, CI green. Unit test on ilmu; the call sites pass `contact_names(conn, tenant_id)` |
| 1c | One leak test (`tests/test_pii_leak.py`) that drives the enquiry, supplier document and Assistant routes with a recording transport and fails if any outbound body holds a seeded name, email, phone or card. Bank account numbers in context ("acct", "a/c") still to do | DONE 2026-10-30 for the three routes; availability, RFQ reply and the guide are covered by the mask itself, not by this test |

Limits kept on purpose: the model can drop or change a token in its reply, so an altered token stays as text; masking is regex plus the contacts dictionary, so a name that is not in contacts passes through.

## Stage 2: observability on the AI tab

2a (backend) DONE 2026-10-30: `db/aicalls.sql`, `src/ai_log.py`, `GET /api/ai/activity`, 90-day purge. 2b DONE 2026-10-30: `web/src/AiActivity.tsx` (totals, hidden-value counts, call table with empty, loading and error states) shown on the AI settings page for the owner and under the chat on the Assistant page for everyone; the server decides the scope. Never opened in a browser: the mock-mode view and the table at phone width are unchecked.

Known limit: when a model call fails and the route then raises (supplier document and enquiry return 502), the request rolls back and the row with it. Failures that a route handles itself (Assistant, availability, RFQ reply) are kept.

- Table `ai_calls` (tenant, user, role class, at, kind, provider, model, ms, ok, masked counts per kind, sources used, sources denied). **No prompt or reply text is stored**, only counts and ids, so the log itself holds no PII. Forced RLS like the other AI tables. Purge after 90 days with the existing retention job.
- One recorder wraps both model doors, so every call is logged once.
- `GET /api/ai/activity`: owner sees the whole business; staff see only their own calls. `GET /api/ai/usage` for totals (calls, failures, median latency, values masked, by kind and by day).
- UI on the AI tab: usage totals, a call list with filter by kind and person (owner), empty, loading and error states, keyboard reachable.

## Stage 3: RAG over the tenant's own data

3a DONE 2026-10-30: `src/rag.py` (retrieval engine and source registry) and `GET /api/ai/passages?q=` (what the AI may read for this caller). Sources: quotes, contacts, catalog (open to every role), costs and supplier_docs (need `view_costs`). Tests in `tests/test_rag.py`. No model reads the passages yet.

3b DONE 2026-10-30: a fourth AI mode `rag` with its own consent (disclosure version 2, `tenant_ai.consent_version >= 2` is checked on every use), the Assistant `ask` intent, citations from our data, migration `0003_ai_mode_rag.sql`, and the opt-in radio in AI settings. Owners on `guide` or `guide_data` are unchanged: nothing about their consent moved.

### How 3b meets the PDPA 2010 (Malaysia)

| Principle | What the code does |
|---|---|
| Notice and Choice | Opt-in only. The owner must tick agreement to the version 2 notice, which names what is sent, to whom, that addresses and unlisted names are not hidden, and that the provider may be outside Malaysia. The tick resets when the mode changes. The notice and the time are stored (`ai_consent_log`, `tenant_ai`) and audited. The owner must also update their own privacy notice, and the text says so |
| General | Nothing is sent unless `mode = rag` and version 2 is on record; otherwise `ask` falls back to the local search |
| Disclosure | Only the caller's own business and only the sources their role may see (`src/rag.py`); at most 5 extracts of 300 characters; masked first (`src/parse_util.py` Mask) |
| Cross-border transfer | Disclosed in the notice, with the provider the owner picked; a custom server host is logged |
| Security | RLS plus a tenant filter, the role gate in the registry, no prompt or answer stored (`ai_calls` holds counts) |
| Retention | No text stored; call counts purged after 90 days |
| Data integrity and access | Answers link back to the source record; an erased customer (`erase_party`) is gone from the database, so from retrieval too |

Residual risk to tell owners: masking is regex plus the contact book, so a name that is not a contact and any address still reach the provider. A lawyer should read the version 2 notice before it is shown to real customers' owners.

- A **source registry**: each source (catalog items, quotes, contacts, jobs, supplier notes) declares the permission it needs and a function that builds its text from the same scrubbed view the API returns. A source the caller lacks the permission for is never searched, and the denial is recorded in `ai_calls`.
- Index: Postgres full-text (`tsvector`) first. pgvector only if measured recall is poor and the model host offers embeddings. Retrieval runs on the caller's RLS connection.
- Assistant gets an `ask` intent: retrieve top-k, mask, answer, cite ids. The answer links to records; the model never writes a price or changes data.
- Retrieved text is data, not instructions: it is wrapped and the system prompt says so.
- Tests: staff cannot retrieve a cost or an owner-only row; tenant B cannot retrieve tenant A; a hostile note in a document cannot change the intent.

## Stage 4: MCP server

4 DONE 2026-10-30: `src/api/mcp.py`, migration `0004_mcp_key_role.sql`, key creation with `mcp_role_id` in API access, tests in `tests/test_mcp.py`, usage in `docs/reusable-api.md`. One tool (`search`), not five: `get_quote`, `stale_costs`, `cost_of` and `jobs` were left out because each would need its own role gate and masking review. Thin JSON-RPC route, no `mcp` SDK, so no new dependency. CI result pending.

- Read-only tools mapped onto the registry: `search`, `get_quote`, `stale_costs`, `cost_of`, `jobs`. No write tool; at most a proposal the person confirms in the app, as the Assistant does for `job_move`.
- Auth is the existing API token, bound to one role; the same permission checks run per tool. Output is masked by default. Every call is written to `ai_calls`.
- Transport: streamable HTTP, so any MCP client the business picks can connect. Documented in `docs/reusable-api.md`.
- New dependency decision: the official `mcp` SDK mounted on FastAPI, unless pinning it conflicts with `requirements.txt`; otherwise a thin JSON-RPC route.

## Stage 5: chat UI

- Sources shown under each answer, with an owner-only marker where the caller was denied.
- A line under the box: "N values hidden from the model" from the mask count.
- Per-user chat history is not stored in this plan; add it only if asked, and then with the same RBAC and purge.

## Stage 6: hardening

- PII eval set (Manglish names, addresses, split numbers) with a measured miss rate; report it in `docs/eval-manglish.md`.
- Rate limit per token for MCP, size caps on retrieved text, and a test that retrieval cost stays bounded on a large tenant.
- Revisit `tech-and-tools-declaration.md` and `privacy-and-breach-runbook.md` for the new data flows.
