# Price API (reusable building block)

Other Orbyte modules can call price-from-items: send recipe keys and quantities, get selling prices back. It uses the same rules engine
and the same tenant cost book as the dashboard. It is read-only (it never creates a quote) and AI is never involved (`ai_used` is always false).

## Auth

The owner creates a key in Settings (`POST /api/settings/api-keys {"name": "ERP"}`). The full key (`lar_...`) is shown once; only its SHA-256 is stored.
Send it as `X-API-Key: <key>` or `Authorization: Bearer <key>`. A key belongs to one business and prices only from that business's cost book.
Revoke with `DELETE /api/settings/api-keys/{id}`. Limit: 60 requests a minute per key.

## Endpoints

```
curl -H "X-API-Key: $KEY" https://HOST/api/v1/recipes
[{"recipe_key":"signboard_60x30","description":"Acrylic signboard 60x30 cm (papan tanda akrilik)","uom":"pcs"},
 {"recipe_key":"design_service","description":"Design work (per hour)","uom":"hour","fixed_rate":true}]

curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" https://HOST/api/v1/quote-price \
  -d '{"items":[{"recipe_key":"signboard_60x30","qty":2}],"customer":"Ah Meng"}'
{"lines":[{"recipe_key":"signboard_60x30","description":"...","qty":"2","uom":"pcs","unit_price":"60.00","line_total":"120.00"}],
 "total":"120.00","below_margin_floor":false,"needs_review":[],"ai_used":false,"currency":"RM"}
```

`items`: 1 to 50 entries, `qty` greater than 0 and at most 1,000,000. Money is a string rounded to the cent, like the dashboard.
`needs_review` lists recipe keys that could not be priced (no current supplier cost on file); they are left out of `lines` and `total`.

## Errors

| Status | code | Meaning |
|---|---|---|
| 401 | bad_key | missing, unknown or revoked key (same answer for all) |
| 413 | too_large | body over 16 KB |
| 422 | unknown_recipe | `error.unknown` lists the keys; other 422s are bad quantities or too many items |
| 429 | slow_down | over 60 requests a minute for this key |

## Deliberately not exposed

Costs, margins, supplier names and cost item ids. `below_margin_floor` is only a yes/no.

## Usage

`GET /api/usage` (owner) shows this month's approved quotes, sent quotes and API price calls against a free allowance (`USAGE_FREE_QUOTES`, default 20).
It is for planning; LARIS does not bill anything yet.

Interactive docs for every route are at `/docs` (FastAPI).

## MCP server for an AI tool

`POST /api/mcp` is a read-only Model Context Protocol server (JSON-RPC over HTTP; `initialize`, `ping`, `tools/list`, `tools/call`). Add `https://<your host>/api/mcp` as a remote MCP server in the AI tool you choose and send an MCP key as `Authorization: Bearer lar_...`.

- **Key:** the owner creates it in API access with "This key is for an AI tool" ticked and picks a staff role. The key acts as that role: it can search only the sources the role may read (costs and supplier prices need `view_costs`). It can never act as the owner.
- **Consent:** it works only while the owner has agreed to "Guide plus my data, read by the AI" in AI settings (disclosure version 2). Turning that mode off stops every MCP key at once (403 `ai_consent_required`).
- **Tool:** `search(query)`: short passages from quotes, contacts and catalog, with a link path. Names from the contact book, emails, phone, ID and card numbers are replaced by placeholders that the tool cannot reverse; addresses are not hidden.
- **Not exposed:** any write, any owner-only section, other businesses' data. Each call is counted on the AI activity table (kind MCP) without its text. 60 requests a minute per key.
