// Run: npm i @electric-sql/pglite && node tests/db_check.mjs
import {PGlite} from '@electric-sql/pglite';import fs from 'fs';
const db=new PGlite(),rd=f=>fs.readFileSync(new URL('../db/'+f,import.meta.url),'utf8');
for(const f of ['schema.sql','transitions.sql','functions.sql','seed_made_to_order.sql'])await db.exec(rd(f));
const q=async(s,p)=>(await db.query(s,p)).rows;
let bad=0;const ok=(c,n)=>{console.log(c?'ok  ':'FAIL',n);if(!c)bad++};
const throws=async(n,s,p)=>{try{await db.query(s,p);ok(false,n)}catch(e){ok(true,n+' -> '+e.message.slice(0,60))}};
const role=(r)=>db.query("select set_config('laris.role',$1,false)",[r]);
const T=(await q("select id from tenants"))[0].id,own=(await q("select id from users where role='owner'"))[0].id;
const sup=(await q("select id from parties where role='supplier' limit 1"))[0].id;
const cust=(await q("select id from parties where role='customer'"))[0].id;
const doc=async(dir,st,extra='null')=>(await q(`insert into documents(tenant_id,direction,kind,party_id,status,issued_on,approved_by,approved_at)
  values($1,$2,'quotation',$3,$4,current_date,${extra},${extra=='null'?'null':'now()'}) returning id`,[T,dir,dir=='in'?sup:cust,st]))[0].id;

// transitions
let d=await doc('in','received');await role('staff');
await throws('illegal in received->accepted',"update documents set status='accepted' where id=$1",[d]);
await db.query("update documents set status='parsed' where id=$1",[d]);ok(true,'staff received->parsed');
await db.query("update documents set status='reviewed' where id=$1",[d]);
await throws('staff cannot accept (in)',"update documents set status='accepted' where id=$1",[d]);
let o=await doc('out','draft');
await throws('staff cannot approve',"update documents set status='approved',approved_by=$2,approved_at=now() where id=$1",[o,own]);
await role('owner');
await throws('out approve without approved_by',"update documents set status='approved' where id=$1",[o]);
await throws('out draft->sent illegal',"update documents set status='sent' where id=$1",[o]);
await throws('out insert sent without approved_by',"insert into documents(tenant_id,direction,kind,party_id,status) values($1,'out','quotation',$2,'sent')",[T,cust]);
await db.query("update documents set status='approved',approved_by=$2,approved_at=now() where id=$1",[o,own]);
await db.query("update documents set status='sent' where id=$1",[o]);
await db.query("update documents set status='accepted' where id=$1",[o]);ok(true,'owner approve->sent->accepted (read skipped)');

// audit
const a=(await q("select count(*)::int c from audit_log where entity='documents' and event like 'status%'"))[0].c;ok(a>10,'audit rows from transitions: '+a);
const act=(await q("select count(*)::int c from audit_log where actor=$1",[own]))[0].c;ok(act>0,'audit actor = owner id');
await throws('audit update',"update audit_log set event='x'");
await throws('audit delete',"delete from audit_log");

// promote: idempotent
const ci0=(await q("select count(*)::int c from cost_items"))[0].c;
const a1=(await q("select id from documents where doc_no='SAMPLE-A-001'"))[0].id;
ok((await q("select promote_document($1) n",[a1]))[0].n===0,'promote repeat returns 0');
ok((await q("select count(*)::int c from cost_items"))[0].c===ci0,'promote idempotent ('+ci0+' cost_items)');
// promote: null qty blocked
const p=await doc('in','received');await db.query("insert into document_lines(document_id,line_no,description,item_key,qty,uom,unit_price,needs_review) values($1,1,'x','pla_1kg',null,'kg',9,true)",[p]);
await db.query("update documents set status='parsed' where id=$1",[p]);await db.query("update documents set status='reviewed' where id=$1",[p]);await db.query("update documents set status='accepted' where id=$1",[p]);
await throws('null-qty line blocks promotion',"select promote_document($1)",[p]);
ok((await q("select status from documents where id=$1",[p]))[0].status==='accepted','doc stays accepted');
const p2=await doc('in','accepted');await db.query("insert into document_lines(document_id,line_no,description,item_key,qty,uom,unit_price) values($1,1,'x',null,1,'kg',9)",[p2]);
await throws('null item_key blocks promotion',"select promote_document($1)",[p2]);

// seed: stale quote + delta
const s=await q("select cost_is_stale,cost_snapshot::float cs,current_unit_cost::float cur,item_key,qty::float qty,qty_consumed::float qc from v_quote_bom order by item_key");
console.table(s);
const ac=s.find(r=>r.item_key==='acrylic_3mm_sheet'),vi=s.find(r=>r.item_key==='vinyl_roll');
ok(ac.cost_is_stale===true&&vi.cost_is_stale===false,'acrylic row stale, vinyl not');
const delta=ac.qty*ac.qc*(ac.cur-ac.cs);ok(delta===400,'margin delta RM'+delta);
ok((await q("select count(*)::int c from cost_items where superseded_by is not null"))[0].c===1,'old acrylic superseded');
ok((await q("select count(*)::int c from parties where name like 'SAMPLE%'"))[0].c===4,'synthetic names');
console.log(bad?'FAILED '+bad:'ALL GREEN');process.exit(bad?1:0);
