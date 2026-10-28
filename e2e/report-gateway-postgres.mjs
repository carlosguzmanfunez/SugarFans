import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createDbTest} from './db-harness.mjs';
const DB='fr_report_gateway_test';
const {setup,user,psql,as,raises,check,finish}=createDbTest(DB);
const lit=v=>v===null?'null':"'"+String(v).replaceAll("'","''")+"'";
const ip=n=>createHash('sha256').update('synthetic-ip-'+n).digest('hex');
const sql=(actor,key,mail,request=randomUUID(),description='Mensaje válido de soporte QA')=>`select report_submit_checked(${lit(actor)},${lit(key)},${lit(request)},'support',null,'Ayuda','Consulta',${lit(description)},${lit(mail)})`;
const send=(actor,key,mail,request,description)=>psql(DB,'set role service_role;'+sql(actor,key,mail,request,description));
const count=where=>Number(psql(DB,'select count(*) from reports '+(where??'')));
const clock=at=>psql(DB,`create or replace function pg_catalog.now() returns timestamptz language sql stable as $$select '${at}'::timestamptz$$`);
const independent=statement=>new Promise((yes,no)=>{let out='',err='';const p=spawn('psql',['-X','-q','-At','-v','ON_ERROR_STOP=1','-d',DB],{windowsHide:true,stdio:['pipe','pipe','pipe']});p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',no);p.on('close',c=>c?no(Error(err)):yes(out.trim()));p.stdin.end("set statement_timeout='15s';set role service_role;"+statement);});
finish(async()=>{
 setup();clock('2026-10-27T12:00:00Z');const fan=user('gateway-fan@example.invalid','fan'),other=user('gateway-other@example.invalid','fan');
 await check('Only the trusted server can submit; the old direct RPC cannot bypass the IP gate',()=>{
  for(const role of ['anon','authenticated']){
   assert.equal(psql(DB,`select has_function_privilege('${role}','public.report_submit_checked(uuid,text,uuid,text,text,text,text,text,text)','execute')`),'f');
   assert.equal(psql(DB,`select has_function_privilege('${role}','public.submit_report(text,text,text,text,text,text)','execute')`),'f');
  }
  assert.equal(psql(DB,"select has_function_privilege('service_role','public.report_submit_checked(uuid,text,uuid,text,text,text,text,text,text)','execute')"),'t');
 });
 await check('Anonymous support remains possible through the service, with a validated contact address',()=>{
  const id=send(null,ip(1),'guest@example.invalid');assert.equal(psql(DB,`select reporter_id is null and contact_email='guest@example.invalid' from reports where id=${lit(id)}`),'t');
  raises(()=>send(null,ip(2),'bad-address'),/email/i,'invalid contact');
  raises(()=>send(null,ip(2),'guest2@example.invalid',undefined,'x'.repeat(4001)),/4000/,'oversized report');
 });
 await check('Verified actor attribution cannot be replaced with a different contact name',()=>{
  const id=send(fan,ip(3),'invented@example.invalid');assert.equal(psql(DB,`select reporter_id::text||'/'||contact_email from reports where id=${lit(id)}`),fan+'/gateway-fan@example.invalid');
  raises(()=>send(randomUUID(),ip(3),'invented@example.invalid'),/Cuenta no disponible/,'missing actor');
 });
 await check('Retrying the same request stores one report and consumes one rate slot',()=>{
  const key=randomUUID(),before=count(),a=send(null,ip(4),'retry@example.invalid',key),b=send(null,ip(4),'retry@example.invalid',key);
  assert.equal(a,b);assert.equal(count(),before+1);assert.equal(psql(DB,`select sum(requests) from security_private.report_rate_windows where ip_key=${lit(ip(4))}`),'2');
  raises(()=>send(other,ip(4),'retry@example.invalid',key),/otra solicitud/,'changed actor');
  raises(()=>send(null,ip(4),'retry@example.invalid',key,'Contenido diferente de prueba'),/otra solicitud/,'changed body');
 });
 await check('Changing guest email cannot evade the five-per-minute IP limit; other IPs keep working',()=>{
  for(let n=0;n<5;n++)send(null,ip(5),`minute-${n}@example.invalid`);
  raises(()=>send(null,ip(5),'minute-blocked@example.invalid'),/muchos reportes/,'sixth IP request');
  send(null,ip(6),'different-ip@example.invalid');
 });
 await check('Changing email over several minutes cannot evade the twenty-per-hour IP limit',()=>{
  for(let minute=0;minute<4;minute++){clock(`2026-10-27T12:0${minute}:00Z`);for(let n=0;n<5;n++)send(null,ip(7),`hour-${minute}-${n}@example.invalid`);}
  clock('2026-10-27T12:04:00Z');raises(()=>send(null,ip(7),'hour-blocked@example.invalid'),/muchos reportes/,'21st IP request');
  clock('2026-10-27T13:00:00Z');send(null,ip(7),'next-hour@example.invalid');
 });
 await check('The original five guest and ten account reports per hour limits still apply across IPs',()=>{
  for(let n=0;n<5;n++)send(null,ip('g'+n),'same-contact@example.invalid');
  raises(()=>send(null,ip('g6'),'same-contact@example.invalid'),/muchos reportes/,'sixth contact report');
  for(let n=0;n<9;n++)send(fan,ip('fan'+n),null); // one previous fan report was at 12:00, outside this hour
  send(fan,ip('fan9'),null);raises(()=>send(fan,ip('fan10'),null),/muchos reportes/,'eleventh account report');
 });
 await check('Independent simultaneous retries preserve a single report and receipt',async()=>{
  const key=randomUUID(),before=count(),query=sql(null,ip(8),'concurrent@example.invalid',key);
  const r=await Promise.all([independent(query),independent(query)]);assert.equal(r[0],r[1]);assert.equal(count(),before+1);
 });
 await check('Six independent submissions on the same IP accept five and reject one',async()=>{
  const before=count(),r=await Promise.allSettled(Array.from({length:6},(_,n)=>independent(sql(null,ip(9),`parallel-${n}@example.invalid`))));
  assert.equal(r.filter(x=>x.status==='fulfilled').length,5);assert.equal(count(),before+5);
 });
 await check('Raw IP storage, private table reads and payment side effects are unavailable',()=>{
  assert.equal(psql(DB,"select count(*) from information_schema.columns where table_schema='security_private' and table_name='report_rate_windows' and column_name in('ip','ip_address','raw_ip')"),'0');
  for(const role of ['anon','authenticated','service_role'])assert.equal(psql(DB,`select has_table_privilege('${role}','security_private.report_rate_windows','select')`),'f');
  assert.equal(psql(DB,'select count(*) from payouts'),'0');assert.equal(psql(DB,'select count(*) from finance_journal'),'0');
  assert.equal(psql(DB,'select execution_enabled or(select batch_handoff_enabled from finance_private.settings)from finance_private.automation_settings'),'f');
 });
});
