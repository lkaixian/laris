---
type: data-model
retrieved: 2026-10-22
updated: 2026-10-22
status: db/schema.sql loads cleanly on Postgres (PGlite); triggers, transitions seed and staff role still to write
confidence: design decision, no external facts
---
# Bidirectional quote schema (Postgres)

Refinement of PLAN.txt: replace `receipts/receipt_lines/quotes/quote_lines` with ONE `documents` + `document_lines` pair. `direction` = `in` (supplier quote/receipt received) or `out` (customer quote sent). Receipts are just `direction=in, kind=receipt`. Related: [[state-machines]], [[synthetic-data-spec]], [[../10-decisions/2026-10-22-scope-review]].

## Rules the schema enforces (not the app)
1. AI never sets prices: `document_lines.unit_price` for `out` lines is written only by role `rules_engine`; the LLM service has no INSERT/UPDATE grant on price columns. LLM output lands in `ai_actions` only.
2. Owner approval: transition `out: draft -> approved` requires `approved_by` user with role `owner` (trigger).
3. Staff cannot see margins: staff connect as DB role `laris_staff` with SELECT only on `*_staff` views (no cost, no margin, no `cost_items`).
4. Append-only audit: `audit_log` has no UPDATE/DELETE grant plus a trigger raising on both.
5. Direction-specific states are validated via `doc_transitions` table + trigger.

## DDL

```sql
-- ENUMS
CREATE TYPE doc_direction AS ENUM ('in','out');
CREATE TYPE doc_kind      AS ENUM ('quotation','receipt','invoice');   -- in: quotation|receipt|invoice ; out: quotation
CREATE TYPE doc_status AS ENUM (
  -- shared / entry
  'received','draft',
  -- in
  'parsed','reviewed','accepted','in_cost_book',
  -- out
  'approved','sent','read','job_created',
  -- shared terminal
  'expired','rejected','cancelled','superseded'
);
CREATE TYPE party_role   AS ENUM ('supplier','customer');
CREATE TYPE user_role    AS ENUM ('owner','staff');
CREATE TYPE channel_t    AS ENUM ('telegram','whatsapp','web','upload');
CREATE TYPE ai_action_t  AS ENUM ('extract_items','parse_receipt_lines','ask_clarification','draft_reply','schedule_followup');
CREATE TYPE price_src    AS ENUM ('cost_item_markup','owner_override','fixed_rate_card'); -- never 'ai'

-- PEOPLE
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  trade_template text NOT NULL,            -- filename key of config/templates/<key>.yaml, validated in app at startup
  currency char(3) NOT NULL DEFAULT 'MYR',
  min_margin_pct numeric(5,2) NOT NULL,    -- margin guard floor (owner-set)
  max_discount_pct numeric(5,2) NOT NULL DEFAULT 5.00
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  name text NOT NULL,
  role user_role NOT NULL,
  channel_handle text                      -- telegram id / wa number
);
CREATE TABLE parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  role party_role NOT NULL,
  name text NOT NULL,
  contact text,
  UNIQUE (tenant_id, role, name)
);

-- THE CORE: one model, two directions
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  direction doc_direction NOT NULL,
  kind doc_kind NOT NULL,
  party_id uuid NOT NULL REFERENCES parties,
  doc_no text,                              -- supplier's number (in) or our QT-2026-0001 (out)
  status doc_status NOT NULL,
  issued_on date,                           -- date on the paper; becomes cost_items.effective_date
  valid_until date,                         -- drives 'expired'
  currency char(3) NOT NULL DEFAULT 'MYR',
  source_channel channel_t,
  source_object_key text,                   -- Replit Object Storage key (photo/pdf/audio)
  parent_id uuid REFERENCES documents,      -- out: revision of; in: re-quote of
  enquiry_id uuid REFERENCES enquiries,     -- out only
  approved_by uuid REFERENCES users,
  approved_at timestamptz,
  sent_at timestamptz, read_at timestamptz, decided_at timestamptz,
  created_by uuid REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kind_by_direction CHECK (direction='in' OR kind='quotation'),
  CONSTRAINT approval_pair CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CONSTRAINT out_sent_needs_approval CHECK (direction='in' OR status NOT IN ('approved','sent','read','job_created') OR approved_by IS NOT NULL),
  CONSTRAINT in_has_issue_date CHECK (direction='out' OR status IN ('received','parsed') OR issued_on IS NOT NULL),
  UNIQUE (tenant_id, direction, party_id, doc_no)
);
CREATE INDEX ON documents (tenant_id, direction, status);
CREATE INDEX ON documents (valid_until) WHERE status IN ('sent','read','accepted');

CREATE TABLE document_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents ON DELETE RESTRICT,
  line_no int NOT NULL,
  description text NOT NULL,
  item_key text,                            -- normalised material/service key, e.g. 'pla_1kg_black'; nullable until reviewed
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  uom text NOT NULL,
  unit_price numeric(14,4) CHECK (unit_price >= 0),    -- in: supplier price. out: rules-engine price
  price_source price_src,                   -- out lines only
  ocr_confidence numeric(4,3),              -- in lines from OCR
  needs_review boolean NOT NULL DEFAULT false,
  UNIQUE (document_id, line_no),
  CONSTRAINT out_price_has_source CHECK (price_source IS NULL OR unit_price IS NOT NULL)
);

-- COST BOOK (fed ONLY by accepted 'in' lines)
CREATE TABLE cost_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  item_key text NOT NULL,
  uom text NOT NULL,
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  supplier_id uuid NOT NULL REFERENCES parties,
  source_line_id uuid NOT NULL UNIQUE REFERENCES document_lines,  -- the proof; UNIQUE = idempotent promote
  effective_date date NOT NULL,                                    -- from documents.issued_on
  valid_until date,
  superseded_by uuid REFERENCES cost_items,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- "current cost" = newest effective_date per (tenant,item_key,uom) not superseded and not past valid_until
CREATE INDEX ON cost_items (tenant_id, item_key, uom, effective_date DESC);

-- OUT line -> which cost item priced it (the explainability link)
CREATE TABLE line_cost_basis (
  out_line_id uuid NOT NULL REFERENCES document_lines,
  cost_item_id uuid NOT NULL REFERENCES cost_items,
  qty_consumed numeric(14,4) NOT NULL CHECK (qty_consumed > 0),   -- BOM qty of this cost item in the sold line
  cost_snapshot numeric(14,4) NOT NULL,                           -- unit_cost frozen at pricing time
  PRIMARY KEY (out_line_id, cost_item_id)
);
-- a labour/overhead rate card entry is also a cost_item (source = owner-entered 'in' doc kind=invoice? NO: see note below)

-- ENQUIRIES / CHAT
CREATE TABLE enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  party_id uuid NOT NULL REFERENCES parties,
  channel channel_t NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','quoted','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id uuid REFERENCES enquiries,
  document_id uuid REFERENCES documents,
  direction doc_direction NOT NULL,       -- reuse enum: in=received, out=sent
  channel channel_t NOT NULL,
  body text, media_key text, transcript text,
  external_id text,                       -- Telegram/WA message id for delivery/read webhooks
  created_at timestamptz NOT NULL DEFAULT now()
);

-- AI OUTPUT (suggestions only)
CREATE TABLE ai_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  action ai_action_t NOT NULL,
  input_ref uuid, payload jsonb NOT NULL,
  model text NOT NULL, confidence numeric(4,3),
  applied_by uuid REFERENCES users,       -- human who accepted it; NULL = unapplied
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_price_keys CHECK (NOT (payload ?| ARRAY['price','unit_price','total','discount']))
);

-- DOWNSTREAM
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  quote_id uuid NOT NULL UNIQUE REFERENCES documents,   -- out, accepted
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents,       -- works for both directions (chase supplier too)
  due_at timestamptz NOT NULL,
  reason text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','drafted','sent','skipped'))
);

-- TRANSITIONS + AUDIT
CREATE TABLE doc_transitions (
  direction doc_direction NOT NULL,
  from_status doc_status NOT NULL,
  to_status doc_status NOT NULL,
  needs_role user_role NOT NULL,
  PRIMARY KEY (direction, from_status, to_status)
);
CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,                    -- user id or 'system:scheduler' / 'system:ai' / 'system:rules'
  entity text NOT NULL, entity_id uuid NOT NULL,
  event text NOT NULL,
  before jsonb, after jsonb
);
CREATE FUNCTION audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit_log is append-only'; END $$;
CREATE TRIGGER audit_no_mut BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_immutable();
CREATE TRIGGER audit_no_trunc BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_immutable();
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC;
```

### Triggers to write (3 only)
- `documents_transition_guard` BEFORE UPDATE OF status: row must exist in `doc_transitions` for (direction, old, new); actor role (from `current_setting('laris.role')`) must satisfy `needs_role`; sets `approved_by/at` check.
- `documents_audit` AFTER INSERT/UPDATE on documents, cost_items, jobs: writes `audit_log`.
- `promote_to_cost_book` is NOT a trigger. Do it in one explicit SQL function `promote_document(doc_id)` called when status goes `accepted -> in_cost_book` (traceable, testable):

```sql
INSERT INTO cost_items (tenant_id,item_key,uom,unit_cost,supplier_id,source_line_id,effective_date,valid_until)
SELECT d.tenant_id,l.item_key,l.uom,l.unit_price,d.party_id,l.id,d.issued_on,d.valid_until
FROM documents d JOIN document_lines l ON l.document_id=d.id
WHERE d.id=$1 AND d.direction='in' AND d.status='accepted'
  AND l.item_key IS NOT NULL AND l.needs_review=false
ON CONFLICT (source_line_id) DO NOTHING;
```
Lines with `needs_review=true` or null `item_key` block promotion of that line only; document-level `reviewed` forces the owner to resolve them.

### Hard points (decide now)
- Labour/machine/overhead: do NOT model as supplier docs. Add `cost_items.supplier_id` nullable is tempting but breaks UNIQUE source_line. Lazy answer: tenant template YAML holds `rate_card` (RM/hour etc.), rules engine writes these into `line_cost_basis` with `cost_item_id` NULL-free via a seeded `parties(role=supplier,name='Owner rate card')` and an owner-entered `in` document `kind=invoice`. One mechanism, no special case. Costs one fake supplier row.
- `item_key` normalisation is the real accuracy problem. Resolve via per-tenant alias table `item_aliases(tenant_id, alias_text, item_key)`, populated when the owner confirms a mapping once. Add only if time allows; otherwise the owner picks from a dropdown on review.
- Multi-currency, tax (SST), UOM conversion: out of scope. Store `currency` but assume MYR; UOM must match exactly or line is `needs_review`.

## Views

```sql
-- Owner explainability: every out line -> cost item -> source supplier line -> source document + date
CREATE VIEW v_quote_bom AS
SELECT q.id AS quote_id, q.doc_no AS quote_no, ql.line_no, ql.description,
       ql.qty, ql.unit_price AS sell_price, ql.qty*ql.unit_price AS line_total,
       ci.item_key, b.qty_consumed, b.cost_snapshot,
       b.qty_consumed*b.cost_snapshot AS line_cost,
       (ql.qty*ql.unit_price) - ql.qty*b.qty_consumed*b.cost_snapshot AS line_margin,
       sp.name AS supplier, sd.doc_no AS source_doc_no, ci.effective_date AS cost_date,
       sd.id AS source_doc_id, sl.id AS source_line_id,
       (ci.unit_cost <> cur.unit_cost) AS cost_is_stale,       -- newer cost exists
       cur.unit_cost AS current_unit_cost
FROM documents q
JOIN document_lines ql ON ql.document_id=q.id
JOIN line_cost_basis b  ON b.out_line_id=ql.id
JOIN cost_items ci      ON ci.id=b.cost_item_id
JOIN document_lines sl  ON sl.id=ci.source_line_id
JOIN documents sd       ON sd.id=sl.document_id
JOIN parties sp         ON sp.id=ci.supplier_id
LEFT JOIN LATERAL (
   SELECT unit_cost FROM cost_items c2
   WHERE c2.tenant_id=ci.tenant_id AND c2.item_key=ci.item_key AND c2.uom=ci.uom AND c2.superseded_by IS NULL
   ORDER BY effective_date DESC LIMIT 1) cur ON true
WHERE q.direction='out';
```
`cost_is_stale` is the headline demo feature: "quote priced on old cost" = the one-sentence problem. Query `WHERE cost_is_stale AND q.status IN ('draft','approved','sent','read')` for the margin-leak alert.

Note `line_margin` above is per BOM row; a sold line with several cost rows needs `GROUP BY ql.id` for the roll-up. Build `v_quote_margin` as that GROUP BY.

```sql
-- Staff view: no costs, no margin, no suppliers
CREATE VIEW v_quote_staff AS
SELECT q.id, q.doc_no, q.status, p.name AS customer, ql.line_no, ql.description, ql.qty, ql.unit_price
FROM documents q JOIN parties p ON p.id=q.party_id JOIN document_lines ql ON ql.document_id=q.id
WHERE q.direction='out';
-- staff upload surface for 'in' docs: INSERT-only via function, no SELECT on cost_items/line_cost_basis
GRANT SELECT ON v_quote_staff TO laris_staff;
```
Caveat: Postgres views run with owner privileges by default, so staff views work as column hiding. Staff must still never get a direct connection string in the browser: all access goes through FastAPI with `SET LOCAL laris.role`. Role enforcement is therefore API + DB belt-and-braces; do not claim RLS you did not turn on.

## Templates are config, not schema
`config/templates/{made_to_order,fnb_catering,service_renovation}.yaml`, each defines: `item_catalog` (item_key, uom, aliases), `pricing_formula` (BOM recipe per product/service, markup %, rate_card), `required_enquiry_fields`, `reply_phrases` (EN/BM), `followup_hours`, `min_margin_pct`. Rules engine reads YAML; Postgres never changes per trade. 3D printing = one of the made_to_order recipes (`stl_grams` is an optional input plugin, not a core concept).

## Mapping from PLAN.txt tables
| PLAN.txt | New |
|---|---|
| receipts, receipt_lines | documents(direction=in), document_lines |
| quotes, quote_lines | documents(direction=out), document_lines |
| cost_items | cost_items (source_line_id replaces source receipt id) |
| (none) | line_cost_basis, ai_actions, doc_transitions, parties, tenants, users |
| enquiries, messages, jobs, followups, audit_log | kept |
