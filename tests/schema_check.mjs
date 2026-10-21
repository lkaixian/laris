// Run: npm i @electric-sql/pglite && node tests/schema_check.mjs (real Postgres in WASM; no server needed)
import {PGlite} from '@electric-sql/pglite';import fs from 'fs';
const db=new PGlite();await db.exec(fs.readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8'));console.log('SCHEMA OK');
const t=(await db.query("insert into tenants(name,trade_template,min_margin_pct) values('t','made_to_order',20) returning id")).rows[0].id;
const p=(await db.query("insert into parties(tenant_id,role,name) values($1,'supplier','S') returning id",[t])).rows[0].id;
const d=(await db.query("insert into documents(tenant_id,direction,kind,party_id,status) values($1,'in','quotation',$2,'received') returning id",[t,p])).rows[0].id;
const ins=(q,pr)=>db.query("insert into document_lines(document_id,line_no,description,qty,uom,needs_review,attrs) values($1,$2,'x',$3,'pc',$4,$5)",pr);
await ins(0,[d,1,null,true,'{"finishing":"raw"}']);console.log('null qty + review: ok');
for(const [n,a] of [['null qty no review',[d,2,null,false,'{}']],['attrs not object',[d,3,1,false,'[]']]]){try{await ins(0,a);console.log('FAIL accepted',n)}catch(e){console.log('rejected:',n)}}
console.log((await db.query("select key,value from v_line_attrs")).rows);
try{await db.query("insert into tenant_fields(tenant_id,key,label,type) values($1,'Bad Key','x','text')",[t]);console.log('FAIL')}catch(e){console.log('rejected: bad key')}
