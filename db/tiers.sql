-- Supplier price tiers and minimum order quantity. Applied by the owner on every start (idempotent), after the base files,
-- so both fresh and already-bootstrapped databases get it. One tier = one line (same item_key, different min_qty);
-- an MOQ is a line whose min_qty > 1. A tier line quoted with no qty is stored with qty = min_qty (no constraint change).
ALTER TABLE document_lines ADD COLUMN IF NOT EXISTS min_qty numeric(14,3) NOT NULL DEFAULT 1 CHECK (min_qty > 0);
ALTER TABLE document_lines ADD COLUMN IF NOT EXISTS supplier_sku text;
ALTER TABLE document_lines ADD COLUMN IF NOT EXISTS review_reason text;   -- why a line needs review, when the system knows (e.g. below MOQ)
ALTER TABLE cost_items ADD COLUMN IF NOT EXISTS min_qty numeric(14,3) NOT NULL DEFAULT 1 CHECK (min_qty > 0);

-- Same as functions.sql, but the cost item carries min_qty and a newer cost supersedes only the same (item_key, uom, min_qty).
CREATE OR REPLACE FUNCTION promote_document(doc_id uuid) RETURNS int LANGUAGE plpgsql AS $$
DECLARE d documents; n int; bad int;
BEGIN
  SELECT * INTO d FROM documents WHERE id=doc_id AND direction='in';
  IF NOT FOUND THEN RAISE EXCEPTION 'no inbound document %', doc_id; END IF;
  IF d.status = 'in_cost_book' THEN RETURN 0; END IF;     -- idempotent
  IF d.status <> 'accepted' THEN RAISE EXCEPTION 'document % is %, must be accepted', doc_id, d.status; END IF;

  SELECT count(*) INTO bad FROM document_lines
   WHERE document_id=doc_id AND NOT is_header
     AND (needs_review OR item_key IS NULL OR qty IS NULL OR unit_price IS NULL);
  IF bad > 0 THEN RAISE EXCEPTION '% line(s) need review or have no item_key/qty/price; resolve before promotion', bad; END IF;

  INSERT INTO cost_items(tenant_id,item_key,uom,unit_cost,min_qty,supplier_id,source_line_id,effective_date,valid_until)
  SELECT d.tenant_id,l.item_key,l.uom,l.unit_price,l.min_qty,d.party_id,l.id,d.issued_on,d.valid_until
  FROM document_lines l WHERE l.document_id=doc_id AND NOT l.is_header
  ON CONFLICT (source_line_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- every older, still-open cost item of the same tenant/item/uom/min_qty points at the newest one
  UPDATE cost_items c SET superseded_by = w.id
  FROM (SELECT DISTINCT ON (item_key,uom,min_qty) id,item_key,uom,min_qty FROM cost_items
         WHERE tenant_id=d.tenant_id
         ORDER BY item_key,uom,min_qty,effective_date DESC,created_at DESC,id) w
  WHERE c.tenant_id=d.tenant_id AND c.item_key=w.item_key AND c.uom=w.uom AND c.min_qty=w.min_qty
    AND c.id<>w.id AND c.superseded_by IS NULL
    AND c.item_key IN (SELECT item_key FROM document_lines WHERE document_id=doc_id);

  UPDATE documents SET status='in_cost_book' WHERE id=doc_id;
  RETURN n;
END $$;
