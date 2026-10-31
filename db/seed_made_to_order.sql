-- SYNTHETIC DATA ONLY. Apply after functions.sql. All prices are invented placeholders (demo_price_shock knob = acrylic +40%).
-- Scenario: acrylic quote A-001 (RM100/sheet) in the cost book -> QT-0001 sent on it. The newer RM140 quote (tests/fixtures/docs/06b_*)
-- is NOT seeded: upload it live to make QT-0001 stale. Fixed user ids: owner ...00a1, staff ...00b1.
DO $$
DECLARE t uuid; own uuid; stf uuid; sa uuid; sb uuid; sc uuid; cust uuid;
        a1 uuid; q uuid; ql uuid; ci_ac uuid; ci_vi uuid;
BEGIN
  INSERT INTO tenants(name,trade_template,min_margin_pct,ssm_no)
    VALUES ('SAMPLE Signage Works (synthetic)','made_to_order',20,'SYNTHETIC-000') RETURNING id INTO t;
  INSERT INTO users(id,tenant_id,name,role) VALUES ('00000000-0000-0000-0000-0000000000a1',t,'SAMPLE Owner','owner') RETURNING id INTO own;
  INSERT INTO users(id,tenant_id,name,role) VALUES ('00000000-0000-0000-0000-0000000000b1',t,'SAMPLE Staff','staff') RETURNING id INTO stf;
  INSERT INTO parties(tenant_id,role,name,contact) VALUES (t,'supplier','SAMPLE Supplier A Acrylic Sdn Bhd','+60-000-0000001') RETURNING id INTO sa;
  INSERT INTO parties(tenant_id,role,name,contact) VALUES (t,'supplier','SAMPLE Supplier B Filament Sdn Bhd','+60-000-0000002') RETURNING id INTO sb;
  INSERT INTO parties(tenant_id,role,name,contact) VALUES (t,'supplier','SAMPLE Supplier C Packaging Sdn Bhd','+60-000-0000003') RETURNING id INTO sc;
  INSERT INTO parties(tenant_id,role,name,contact) VALUES (t,'customer','SAMPLE Customer Cafe (synthetic)','+60-000-0000009') RETURNING id INTO cust;

  -- Supplier quote A1 (D-45): staff uploads, owner accepts + promotes
  PERFORM set_config('laris.role','staff',false); PERFORM set_config('laris.actor',stf::text,false);
  INSERT INTO documents(tenant_id,direction,kind,party_id,doc_no,status,issued_on,valid_until,created_by)
    VALUES (t,'in','quotation',sa,'SAMPLE-A-001','received',(now() at time zone 'Asia/Kuala_Lumpur')::date-45,(now() at time zone 'Asia/Kuala_Lumpur')::date+15,stf) RETURNING id INTO a1;
  INSERT INTO document_lines(document_id,line_no,description,item_key,qty,uom,unit_price) VALUES
    (a1,1,'SAMPLE acrylic 3mm sheet','acrylic_3mm_sheet',1,'sheet',100.00),
    (a1,2,'SAMPLE vinyl roll','vinyl_roll',1,'m',8.00);
  UPDATE documents SET status='parsed' WHERE id=a1;
  UPDATE documents SET status='reviewed' WHERE id=a1;
  PERFORM set_config('laris.role','owner',false); PERFORM set_config('laris.actor',own::text,false);
  UPDATE documents SET status='accepted' WHERE id=a1;
  PERFORM promote_document(a1);

  -- OUT quote: 40 signboards @ RM60, each uses 0.25 sheet acrylic + 0.5 m vinyl (RM29) + RM8.50 machine/labour = RM37.50 cost -> RM1,500 of RM2,400
  SELECT id INTO ci_ac FROM cost_items WHERE item_key='acrylic_3mm_sheet' AND superseded_by IS NULL;
  SELECT id INTO ci_vi FROM cost_items WHERE item_key='vinyl_roll';
  INSERT INTO documents(tenant_id,direction,kind,party_id,doc_no,status,valid_until,created_by)
    VALUES (t,'out','quotation',cust,'SAMPLE-QT-0001','draft',(now() at time zone 'Asia/Kuala_Lumpur')::date+30,own) RETURNING id INTO q;
  INSERT INTO document_lines(document_id,line_no,description,item_key,qty,uom,unit_price,price_source,other_cost_per_unit)
    VALUES (q,1,'SAMPLE acrylic signboard 60x30','signboard_60x30',40,'pcs',60.00,'cost_item_markup',8.50) RETURNING id INTO ql;
  INSERT INTO line_cost_basis(out_line_id,cost_item_id,qty_consumed,cost_snapshot) VALUES
    (ql,ci_ac,0.25,100.00),(ql,ci_vi,0.5,8.00);
  UPDATE documents SET status='approved',approved_by=own,approved_at=now() WHERE id=q;
  UPDATE documents SET status='sent',sent_at=now() WHERE id=q;

  PERFORM set_config('laris.role','',false); PERFORM set_config('laris.actor','',false);
END $$;
