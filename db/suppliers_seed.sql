-- SYNTHETIC DEMO DATA for the Suppliers section. Creates functions only; nothing runs until seed_supplier_demo(tenant) is called
-- (owner button "Load demo suppliers", or SEED_SUPPLIERS=1 at start). Every company is invented; prices are placeholders.
-- It plants the awkward cases on purpose: cheapest below MOQ, cheapest too slow, expired quote, delivery fee flips the order, tier changes
-- the winner, carton vs kg, a contract expiring in 20 days, one starting next month, one expired last month, a market below the contract
-- price, a repeat purchase with no contract, and a blocked supplier.
CREATE OR REPLACE FUNCTION seed_offer(t uuid, s uuid, p uuid, label text, psize numeric, tiers jsonb, moq numeric, lead int, fee numeric,
                                      free_over numeric, sst numeric, valid date, stock numeric, payd int) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO supplier_offers(tenant_id,supplier_id,product_id,pack_label,pack_size,tiers,moq,lead_days,delivery_fee,free_delivery_over,sst_rate,valid_until,stock,payment_days)
  VALUES (t,s,p,label,psize,tiers,moq,lead,fee,free_over,sst,valid,stock,payd)
  ON CONFLICT (tenant_id,supplier_id,product_id) DO UPDATE SET tiers=EXCLUDED.tiers RETURNING id
$$;

CREATE OR REPLACE FUNCTION seed_supplier_demo(t uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; s6 uuid; s7 uuid; s8 uuid;
  oil uuid; chk uuid; pap uuid; box uuid; flo uuid;
  o uuid; c uuid; m int; usr uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM products WHERE tenant_id=t) THEN RETURN; END IF;
  SELECT id INTO usr FROM users WHERE tenant_id=t AND role='owner' ORDER BY id LIMIT 1;
  INSERT INTO supplier_settings(tenant_id) VALUES (t) ON CONFLICT DO NOTHING;

  INSERT INTO products(tenant_id,name,base_uom,category,item_key) VALUES (t,'Cooking oil 17kg','kg','dry goods','cooking_oil_17kg') RETURNING id INTO oil;
  INSERT INTO products(tenant_id,name,base_uom,category,item_key) VALUES (t,'Chicken breast, fresh','kg','poultry','chicken_breast') RETURNING id INTO chk;
  INSERT INTO products(tenant_id,name,base_uom,category,item_key) VALUES (t,'A4 paper 80gsm (ream)','pc','office','a4_paper_ream') RETURNING id INTO pap;
  INSERT INTO products(tenant_id,name,base_uom,category,item_key) VALUES (t,'Takeaway box 750ml','pc','packaging','takeaway_box_750') RETURNING id INTO box;
  INSERT INTO products(tenant_id,name,base_uom,category,item_key) VALUES (t,'Flour 25kg','kg','dry goods','flour_25kg') RETURNING id INTO flo;
  INSERT INTO product_aliases(tenant_id,product_id,lang,alias) VALUES
    (t,oil,'en','cooking oil'),(t,oil,'ms','minyak masak'),(t,oil,'zh','食用油'),(t,oil,'ta','சமையல் எண்ணெய்'),
    (t,chk,'en','chicken breast'),(t,chk,'ms','ayam dada'),(t,chk,'zh','鸡胸肉'),(t,chk,'ta','கோழி மார்பு'),
    (t,pap,'en','a4 paper'),(t,pap,'ms','kertas a4'),(t,pap,'zh','A4纸'),(t,pap,'ta','A4 காகிதம்'),
    (t,box,'en','takeaway box'),(t,box,'ms','kotak bungkus'),(t,flo,'en','flour'),(t,flo,'ms','tepung');
  INSERT INTO product_aliases(tenant_id,product_id,lang,alias,confidence,confirmed) VALUES (t,oil,'ms','minyak sawit 17kg',0.62,false);

  INSERT INTO parties(tenant_id,role,name,contact) VALUES (t,'supplier','SAMPLE Johor Edible Oils Sdn Bhd (synthetic)','+60-000-1000001') RETURNING id INTO s1;
  INSERT INTO parties(tenant_id,role,name,contact) VALUES (t,'supplier','SAMPLE Selangor Fresh Wholesale (synthetic)','+60-000-1000002') RETURNING id INTO s2;
  INSERT INTO parties(tenant_id,role,name,contact) VALUES (t,'supplier','SAMPLE Penang Trading Co (synthetic)','+60-000-1000003') RETURNING id INTO s3;
  INSERT INTO parties(tenant_id,role,name,contact) VALUES (t,'supplier','SAMPLE KL Foodstuff Sdn Bhd (synthetic)','+60-000-1000004') RETURNING id INTO s4;
  INSERT INTO parties(tenant_id,role,name,contact) VALUES (t,'supplier','SAMPLE Perak Mart Supplies (synthetic)','+60-000-1000005') RETURNING id INTO s5;
  INSERT INTO parties(tenant_id,role,name,contact) VALUES (t,'supplier','SAMPLE Melaka Dry Goods (synthetic)','+60-000-1000006') RETURNING id INTO s6;
  INSERT INTO parties(tenant_id,role,name,contact) VALUES (t,'supplier','SAMPLE Kedah Cheap Oil (synthetic)','+60-000-1000007') RETURNING id INTO s7;
  INSERT INTO parties(tenant_id,role,name,contact) VALUES (t,'supplier','SAMPLE Sabah Halal Provisions (synthetic)','+60-000-1000008') RETURNING id INTO s8;

  INSERT INTO supplier_profiles(supplier_id,tenant_id,state,categories,certs,payment_days,standing,on_time_pct,price_stability_pct,response_hours,distance_km,last_order_on) VALUES
    (s1,t,'Johor','{dry goods}','{sst}',14,'normal',88,90,6,320,current_date-40),
    (s2,t,'Selangor','{poultry,dry goods,packaging,office}','{halal,sst,einvoice}',30,'preferred',96,92,2,25,current_date-3),
    (s3,t,'Pulau Pinang','{dry goods,office,packaging}','{sst}',30,'normal',81,85,10,370,current_date-20),
    (s4,t,'Kuala Lumpur','{dry goods}','{halal}',14,'normal',90,80,4,15,current_date-90),
    (s5,t,'Perak','{dry goods,poultry}','{halal,sst}',45,'normal',93,94,3,200,current_date-12),
    (s6,t,'Melaka','{dry goods,office}','{sst,einvoice}',60,'normal',85,88,8,150,current_date-60),
    (s7,t,'Kedah','{dry goods}','{}',0,'blocked',55,40,48,430,NULL),
    (s8,t,'Sabah','{dry goods,poultry}','{halal}',30,'normal',92,91,5,1600,NULL);

  -- Cooking oil 17kg tin (base kg, pack 17). Needed 85 kg = 5 tins.
  PERFORM seed_offer(t,s1,oil,'tin',17,'[{"min_packs":"1","price":"62"}]',170,3,0,NULL,0,current_date+30,NULL,14);     -- cheapest, but MOQ 10 tins
  o := seed_offer(t,s2,oil,'tin',17,'[{"min_packs":"1","price":"66"}]',NULL,2,15,NULL,0,current_date+30,NULL,30);
  PERFORM seed_offer(t,s3,oil,'tin',17,'[{"min_packs":"1","price":"64"}]',NULL,7,0,NULL,0,current_date+30,NULL,30);       -- cheap, but 7 days
  PERFORM seed_offer(t,s4,oil,'tin',17,'[{"min_packs":"1","price":"60"}]',NULL,1,0,NULL,0,current_date-1,NULL,14);       -- expired quote
  PERFORM seed_offer(t,s5,oil,'tin',17,'[{"min_packs":"1","price":"67"},{"min_packs":"10","price":"61"}]',NULL,2,0,NULL,0,current_date+30,NULL,45); -- tier flips winner
  PERFORM seed_offer(t,s6,oil,'tin',17,'[{"min_packs":"1","price":"65"}]',NULL,3,40,NULL,0,current_date+30,NULL,60);      -- delivery fee flips order
  PERFORM seed_offer(t,s7,oil,'tin',17,'[{"min_packs":"1","price":"58"}]',NULL,1,0,NULL,0,current_date+30,NULL,0);       -- blocked supplier
  PERFORM seed_offer(t,s8,oil,'tin',17,'[{"min_packs":"1","price":"68"}]',NULL,4,25,NULL,0,current_date+30,NULL,30);
  -- Chicken breast: carton of 10 kg vs per kg (pack-size mismatch)
  PERFORM seed_offer(t,s2,chk,'carton',10,'[{"min_packs":"1","price":"105"}]',NULL,1,20,NULL,0,current_date+7,200,30);
  PERFORM seed_offer(t,s3,chk,'kg',1,'[{"min_packs":"1","price":"10.8"},{"min_packs":"50","price":"10.2"}]',NULL,2,30,NULL,0,current_date+7,NULL,30);
  PERFORM seed_offer(t,s5,chk,'carton',10,'[{"min_packs":"1","price":"98"}]',100,1,0,NULL,0,current_date+7,500,45);
  PERFORM seed_offer(t,s8,chk,'kg',1,'[{"min_packs":"1","price":"10.5"}]',NULL,3,25,NULL,0,current_date+7,60,30);
  -- A4 paper
  PERFORM seed_offer(t,s2,pap,'ream',1,'[{"min_packs":"1","price":"11.5"}]',NULL,2,10,150,0.06,current_date+20,NULL,30);
  PERFORM seed_offer(t,s6,pap,'carton of 5',5,'[{"min_packs":"1","price":"54"}]',NULL,3,0,NULL,0.06,current_date+20,NULL,60);
  PERFORM seed_offer(t,s3,pap,'ream',1,'[{"min_packs":"1","price":"12.4"}]',NULL,3,0,NULL,0.06,current_date+20,NULL,30);
  -- Takeaway box (pack of 50)
  PERFORM seed_offer(t,s2,box,'pack of 50',50,'[{"min_packs":"1","price":"14"}]',NULL,2,10,200,0,current_date+25,NULL,30);
  PERFORM seed_offer(t,s3,box,'pack of 50',50,'[{"min_packs":"1","price":"13.2"}]',NULL,5,15,NULL,0,current_date+25,NULL,30);
  PERFORM seed_offer(t,s5,box,'pack of 50',50,'[{"min_packs":"1","price":"14.5"},{"min_packs":"20","price":"12.9"}]',NULL,2,0,NULL,0,current_date+25,NULL,45);
  -- Flour
  PERFORM seed_offer(t,s3,flo,'bag',25,'[{"min_packs":"1","price":"52"}]',NULL,3,0,NULL,0,current_date+25,NULL,30);
  PERFORM seed_offer(t,s6,flo,'bag',25,'[{"min_packs":"1","price":"54"}]',NULL,4,0,NULL,0,current_date+25,NULL,60);

  -- 12 months of price per kg for the oil offers
  FOR m IN 0..11 LOOP
    INSERT INTO offer_history(tenant_id,offer_id,month,price_per_base)
    SELECT t, so.id, (date_trunc('month', current_date) - (m || ' months')::interval)::date,
           round(((so.tiers->0->>'price')::numeric / so.pack_size) * (1 + (CASE WHEN m > 6 THEN 0.06 ELSE 0 END) + ((m % 3) - 1) * 0.01), 4)
    FROM supplier_offers so WHERE so.tenant_id=t AND so.product_id=oil AND so.supplier_id IN (s2,s3,s5,s6);
  END LOOP;

  -- Contracts
  INSERT INTO contracts(tenant_id,supplier_id,name,state,start_on,end_on,notice_days,renewal,min_qty,max_qty,value,payment_days,sla_lead_days,price_reviews,created_by,approved_by)
    VALUES (t,s2,'Cooking oil supply 2026','active',current_date-345,current_date+20,30,'manual',1500,3000,12000,30,2,ARRAY[current_date+10],usr,usr) RETURNING id INTO c;
  INSERT INTO contract_items(tenant_id,contract_id,product_id,pack_size,price_per_pack) VALUES (t,c,oil,17,66);
  INSERT INTO contract_events(tenant_id,contract_id,from_state,to_state,actor) VALUES (t,c,NULL,'draft',usr),(t,c,'draft','pending_approval',usr),(t,c,'pending_approval','active',usr);
  INSERT INTO contract_usage(tenant_id,contract_id,product_id,qty,amount,used_on) VALUES
    (t,c,oil,340,1320,current_date-200),(t,c,oil,340,1320,current_date-120),(t,c,oil,255,990,current_date-60),(t,c,oil,255,990,current_date-15);

  INSERT INTO contracts(tenant_id,supplier_id,name,state,start_on,end_on,notice_days,renewal,min_qty,max_qty,value,payment_days,created_by,approved_by)
    VALUES (t,s3,'Flour 12-month supply','active',current_date+30,current_date+395,45,'manual',2500,6000,9000,30,usr,usr) RETURNING id INTO c;
  INSERT INTO contract_items(tenant_id,contract_id,product_id,pack_size,price_per_pack) VALUES (t,c,flo,25,52);
  INSERT INTO contract_events(tenant_id,contract_id,from_state,to_state,actor) VALUES (t,c,NULL,'draft',usr),(t,c,'draft','pending_approval',usr),(t,c,'pending_approval','active',usr);

  INSERT INTO contracts(tenant_id,supplier_id,name,state,start_on,end_on,notice_days,renewal,value,created_by,approved_by)
    VALUES (t,s2,'Chicken breast 2025','expired',current_date-395,current_date-30,30,'manual',9000,usr,usr) RETURNING id INTO c;
  INSERT INTO contract_items(tenant_id,contract_id,product_id,pack_size,price_per_pack) VALUES (t,c,chk,10,100);
  INSERT INTO contract_events(tenant_id,contract_id,from_state,to_state,actor) VALUES (t,c,NULL,'draft',usr),(t,c,'draft','pending_approval',usr),(t,c,'pending_approval','active',usr),(t,c,'active','expired',usr);

  INSERT INTO contracts(tenant_id,supplier_id,name,state,start_on,end_on,notice_days,renewal,price_model,min_qty,max_qty,value,price_reviews,created_by,approved_by)  -- market is cheaper than this
    VALUES (t,s3,'A4 paper 2026','active',current_date-120,current_date+245,30,'manual','fixed',600,1500,6000,ARRAY[current_date+45],usr,usr) RETURNING id INTO c;
  INSERT INTO contract_items(tenant_id,contract_id,product_id,pack_size,price_per_pack) VALUES (t,c,pap,1,12.4);
  INSERT INTO contract_events(tenant_id,contract_id,from_state,to_state,actor) VALUES (t,c,NULL,'draft',usr),(t,c,'draft','pending_approval',usr),(t,c,'pending_approval','active',usr);
  INSERT INTO contract_usage(tenant_id,contract_id,product_id,qty,amount,used_on) VALUES (t,c,pap,120,1488,current_date-60);

  -- Purchases: boxes bought six times from one supplier with no contract (triggers the nudge); a little paper off-contract
  INSERT INTO purchases(tenant_id,product_id,supplier_id,bought_on,qty,amount)
    SELECT t, box, s2, current_date - (n * 14), 2500, 700 FROM generate_series(1,6) n;
  INSERT INTO purchases(tenant_id,product_id,supplier_id,bought_on,qty,amount,off_contract_reason,approved_by)
    VALUES (t,pap,s2,current_date-20,100,1150,'urgent, supplier out of stock',usr);
END $$;
