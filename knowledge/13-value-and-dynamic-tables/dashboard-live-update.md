---
source_urls:
  - https://www.postgresql.org/docs/current/sql-notify.html
retrieved: 2026-10-22
confidence: NOTIFY facts high (official docs fetched today); poll vs SSE comparison is opinion; Replit proxy behaviour with long-lived connections NOT verified
status: proposed
---
# Live dashboard: how new rows appear

Goal: when a quote is parsed or a cost lands, the owner's board updates without refresh. Related: [[dynamic-fields-design]], [[../06-tech-stack/adr-replit-hosting]], [[../07-data-model/state-machines]].

| Option | How | Pros | Cons | Fit |
|---|---|---|---|---|
| Poll | UI fetches `/api/board?after=<cursor>` every 3-5 s | trivial, stateless, survives proxies and restarts | constant small load, up to 5 s lag | Default |
| LISTEN/NOTIFY + SSE | trigger calls `pg_notify`; FastAPI holds a dedicated LISTEN connection and streams `text/event-stream` | instant | per-process listener, reconnect logic, proxy buffering risk (unverified on Replit) | Stretch |
| WebSocket | same, bidirectional | not needed (server to client only) | more code | Skip |

Postgres NOTIFY facts (docs, retrieved 2026-10-22): payload under 8000 bytes (send ids, not rows); delivered only if the transaction commits; identical payloads in one transaction fold into one; delivered to sessions currently listening (the page does not describe what a disconnected listener misses, so re-read the table after reconnect); a listening session with a long transaction blocks queue cleanup. Opinion: do not LISTEN through a transaction-mode pooler; use a dedicated connection.

## Recommendation (opinion)
1. Ship poll. Cursor = `audit_log.id` (existing append-only bigint identity, no new column): `SELECT ... FROM audit_log WHERE tenant_id=$1 AND id > $cursor`; UI refetches affected rows by `entity_id`.
2. New columns appear because the poll response includes the `tenant_fields` version (count or max `created_at`).
3. Stretch: trigger on `audit_log` insert sends `pg_notify('laris_board', tenant_id::text)`; SSE only says "refetch". Client still polls every 30 s so a missed notify costs nothing.

```sql
CREATE FUNCTION notify_board() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_notify('laris_board', NEW.tenant_id::text); RETURN NULL; END $$;
CREATE TRIGGER audit_notify AFTER INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION notify_board();
```
The SSE handler must filter by the authenticated user's tenant. Note: the `audit_log` BEFORE UPDATE/DELETE trigger is unaffected by an extra AFTER INSERT trigger.

Sizing: poll is about an hour; SSE adds roughly half a day with proxy risk (estimate, opinion). A 3-5 s poll looks live enough on a demo screen. See [[summary]].
