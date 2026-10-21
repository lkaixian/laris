-- ENUMS
CREATE TYPE doc_direction AS ENUM ('in','out');
CREATE TYPE doc_kind      AS ENUM ('quotation','receipt','invoice','estimate','proforma');   -- in: quotation|receipt|invoice ; out: quotation
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
CREATE TYPE field_type   AS ENUM ('text','number','integer','date','select','boolean');
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
  max_discount_pct numeric(5,2) NOT NULL DEFAULT 5.00,
  drift_alert_pct numeric(5,2) NOT NULL DEFAULT 5.00,   -- cost move that raises a stale-cost alert
  ssm_no text, address text, bank_details text,         -- issuer identity for the quote PDF
  sst_registered boolean NOT NULL DEFAULT false,        -- SST shown only if registered
  sst_no text
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
  ssm_no text, sst_no text, address text, attention text,
  UNIQUE (tenant_id, role, name)
);

CREATE TABLE enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  party_id uuid NOT NULL REFERENCES parties,
  channel channel_t NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','quoted','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
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
  customer_ref text,                        -- customer PO / reference
  deposit_pct numeric(5,2) CHECK (deposit_pct BETWEEN 0 AND 100),
  payment_terms text, lead_time_days int CHECK (lead_time_days >= 0),
  terms_text text,                          -- warranty, inclusions, exclusions
  tax_inclusive boolean,                    -- in docs: do stated prices include SST? NULL = unknown
  tax_total numeric(14,4),
  stated_total numeric(14,4),               -- total printed on an 'in' paper, for OCR cross-check
  decision_reason text,                     -- why accepted/rejected/lost
  extraction jsonb,                         -- raw LLM/OCR output incl. prices; ai_actions stays price-free
  source_channel channel_t,
  source_object_key text,                   -- Replit Object Storage key (photo/pdf/audio)
  parent_id uuid REFERENCES documents,      -- out: revision of; in: re-quote of
  enquiry_id uuid REFERENCES enquiries,     -- out only
  approved_by uuid REFERENCES users,
  approved_at timestamptz,
  sent_at timestamptz, read_at timestamptz, decided_at timestamptz,
  created_by uuid REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kind_by_direction CHECK (direction='in' OR kind IN ('quotation','estimate','proforma')),
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
  qty numeric(14,3) CHECK (qty > 0),        -- NULL allowed only while needs_review
  uom text NOT NULL,
  unit_price numeric(14,4) CHECK (unit_price >= 0),    -- in: supplier price. out: rules-engine price
  price_source price_src,                   -- out lines only
  ocr_confidence numeric(4,3),              -- in lines from OCR
  needs_review boolean NOT NULL DEFAULT false,
  discount_pct numeric(5,2) CHECK (discount_pct BETWEEN 0 AND 100),
  tax_rate numeric(5,2),
  section text, is_header boolean NOT NULL DEFAULT false, is_provisional boolean NOT NULL DEFAULT false,
  price_override_reason text,
  other_cost_per_unit numeric(14,4) NOT NULL DEFAULT 0,   -- out lines: labour + machine hours cost per unit (not in line_cost_basis)
  attrs jsonb NOT NULL DEFAULT '{}',          -- approved trade fields (see tenant_fields)
  attrs_unmapped jsonb NOT NULL DEFAULT '{}', -- fields seen but not approved yet
  UNIQUE (document_id, line_no),
  CONSTRAINT qty_null_needs_review CHECK (qty IS NOT NULL OR needs_review OR is_header),
  CONSTRAINT attrs_are_objects CHECK (jsonb_typeof(attrs)='object' AND jsonb_typeof(attrs_unmapped)='object'),
  CONSTRAINT out_price_has_source CHECK (price_source IS NULL OR unit_price IS NOT NULL)
);

CREATE INDEX document_lines_attrs_gin ON document_lines USING GIN (attrs jsonb_path_ops);

-- DYNAMIC FIELDS: owner-approved registry; the AI can only propose, never alter
CREATE TABLE tenant_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,40}$'),
  label text NOT NULL,
  type field_type NOT NULL,
  unit text,
  options jsonb,
  applies_to doc_direction[] NOT NULL DEFAULT '{in,out}',
  show_in_grid boolean NOT NULL DEFAULT true,
  owner_only boolean NOT NULL DEFAULT false,   -- hidden from staff views
  sort_order int NOT NULL DEFAULT 100,
  approved_by uuid REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);
CREATE TABLE field_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  key text NOT NULL,
  sample_values jsonb NOT NULL,
  source_line_id uuid REFERENCES document_lines,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','ignored')),
  decided_by uuid REFERENCES users,
  decided_at timestamptz,
  UNIQUE (tenant_id, key)
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

-- Long-form view of line attributes for the grid and BI-style queries
CREATE VIEW v_line_attrs AS
SELECT l.id AS line_id, l.document_id, a.key, a.value
FROM document_lines l, LATERAL jsonb_each_text(l.attrs) a;
