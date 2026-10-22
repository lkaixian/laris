// Run: node tests/roles_check.mjs  (db/roles.sql: the app role cannot weaken audit or guards)
import {PGlite} from '@electric-sql/pglite';import fs from 'fs';
const db=new PGlite(),rd=f=>fs.readFileSync(new URL('../db/'+f,import.meta.url),'utf8');
for(const f of ['schema.sql','transitions.sql','functions.sql','views.sql','seed_made_to_order.sql','roles.sql'])await db.exec(rd(f));
let bad=0;const ok=(c,n)=>{console.log(c?'ok  ':'FAIL',n);if(!c)bad++};
const refuses=async(n,s)=>{try{await db.exec(s);ok(false,n)}catch(e){ok(true,n+' -> '+e.message.slice(0,70))}};
await db.exec("set role laris_app");
ok((await db.query("select count(*)::int c from documents")).rows[0].c>0,'app role can read and write normal tables');
await db.exec("update cost_items set unit_cost = unit_cost");
await refuses('cannot disable the audit trigger',"alter table documents disable trigger documents_audit");
await refuses('cannot delete audit rows',"delete from audit_log");
await refuses('cannot update audit rows',"update audit_log set event='x'");
await refuses('cannot truncate audit',"truncate audit_log");
await refuses('cannot drop the guard trigger',"drop trigger documents_transition_guard on documents");
await refuses('cannot alter a table',"alter table documents add column x int");
console.log(bad?'FAILED':'ALL GREEN');process.exit(bad?1:0);
