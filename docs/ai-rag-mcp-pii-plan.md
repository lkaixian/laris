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
| 1b | Names: a per-request dictionary from the tenant's own `parties` rows (name and attention), whole-word and case-insensitive, replaced with `[NAME_n]`. No NER library. Addresses are not masked yet | DONE 2026-10-30, CI result pending. Unit test on ilmu; the call sites pass `contact_names(conn, tenant_id)` |
| 1c | One leak test that drives every call site (enquiry, supplier document, RFQ reply, availability, assistant, guide) with a mocked transport and fails if any outbound body holds a seeded value. Add bank account numbers in context ("acct", "a/c") | Test fails if a new call site skips the mask |

Limits kept on purpose: the model can drop or change a token in its reply, so an altered token stays as text; masking is regex plus the contacts dictionary, so a name that is not in contacts passes through.

## Stage 2: observability on the AI tab

- Table `ai_calls` (tenant, user, role class, at, kind, provider, model, ms, ok, masked counts per kind, sources used, sources denied). **No prompt or reply text is stored**, only counts and ids, so the log itself holds no PII. Forced RLS like the other AI tables. Purge after 90 days with the existing retention job.
- One recorder wraps both model doors, so every call is logged once.
- `GET /api/ai/activity`: owner sees the whole business; staff see only their own calls. `GET /api/ai/usage` for totals (calls, failures, median latency, values masked, by kind and by day).
- UI on the AI tab: usage totals, a call list with filter by kind and person (owner), empty, loading and error states, keyboard reachable.

## Stage 3: RAG over the tenant's own data

- A **source registry**: each source (catalog items, quotes, contacts, jobs, supplier notes) declares the permission it needs and a function that builds its text from the same scrubbed view the API returns. A source the caller lacks the permission for is never searched, and the denial is recorded in `ai_calls`.
- Index: Postgres full-text (`tsvector`) first. pgvector only if measured recall is poor and the model host offers embeddings. Retrieval runs on the caller's RLS connection.
- Assistant gets an `ask` intent: retrieve top-k, mask, answer, cite ids. The answer links to records; the model never writes a price or changes data.
- Retrieved text is data, not instructions: it is wrapped and the system prompt says so.
- Tests: staff cannot retrieve a cost or an owner-only row; tenant B cannot retrieve tenant A; a hostile note in a document cannot change the intent.

## Stage 4: MCP server

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
