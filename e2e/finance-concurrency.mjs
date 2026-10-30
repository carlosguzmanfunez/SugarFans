// Real PostgreSQL sessions, synthetic data only; no HTTP/PayPal calls.
// npm run test:finance-concurrency -- <postgres bin> [local port]
import assert from 'node:assert/strict';
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { resolve,join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {tmpdir} from 'node:os';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const binArg=process.argv[2]??process.env.FANSRESERVE_PG_BIN;
assert.ok(binArg,'Indica los binarios de un PostgreSQL temporal local');const bin=resolve(binArg);
const port=Number(process.argv[3]??55439);assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535);
const dbName='fr_concurrency_'+randomUUID().replaceAll('-','').slice(0,12);
assert.match(dbName,/^fr_concurrency_[a-f0-9]{12}$/);
const output=resolve(process.env.FANSRESERVE_TEST_OUTPUT??join(tmpdir(),'fr-concurrency-'+Date.now()));mkdirSync(output,{recursive:true});
const ADMIN='00000000-0000-0000-0000-000000000090',CREATOR='00000000-0000-0000-0000-000000000001',OTHER='00000000-0000-0000-0000-000000000002';
const lit=s=>"'"+String(s).replaceAll("'","''")+"'";
const source=n=>readFileSync(join(repo,'supabase/migrations',n),'utf8');
const results=[],races=[];let made=false;
function start(sql,{database=dbName,app='fr_observer',hold=false,auth=ADMIN}={}){
 let stdout='',stderr='',buffer='',readyDone=false,onReady,onReject;
 const ready=new Promise((yes,no)=>{onReady=yes;onReject=no;});ready.catch(()=>{});
 const child=spawn(join(bin,process.platform==='win32'?'psql.exe':'psql'),['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(port),'-U','postgres','-d',database],
 {windowsHide:true,stdio:['pipe','pipe','pipe'],env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG')))});
 const done=new Promise((yes,no)=>{
 child.on('error',no);child.stderr.on('data',b=>stderr+=b.toString());
 child.stdout.on('data',b=>{const chunk=b.toString();stdout+=chunk;buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);if(line==='{"__ready": true}'){readyDone=true;onReady();}}});
 child.on('close',code=>{if(code===0)yes({stdout,stderr});else no(new Error(stderr.trim()||'psql exit '+code));if(!readyDone)onReject(new Error('Session ended before barrier: '+stderr.trim()));});
 });
 done.catch(()=>{});
 const prefix="select set_config('request.jwt.claims',"+lit(JSON.stringify({session_id:auth}))+",false) is not null;set application_name="+lit(app)+";set statement_timeout='12s';set test.clock='2026-10-26T12:00:00Z';select set_config('request.jwt.claim.sub',"+lit(auth)+",false);";
 child.stdin.end(prefix+(hold?'begin;':'')+sql+";select jsonb_build_object('__ready',true);"+(hold?"select pg_sleep(2);commit;":""));
 return {ready,done};
}
const run=async(sql,opts)=>{const r=await start(sql,opts).done;return r.stdout.split(/\r?\n/).map(s=>s.trim()).filter(s=>s.startsWith('{')||s.startsWith('[')).map(s=>JSON.parse(s)).filter(o=>!o.__ready);};
const j=async(sql,opts)=>(await run(sql,opts))[0];
const stats=()=>j("select jsonb_build_object('payouts',(select count(*) from payouts),'batches',(select count(*) from finance_batches),'allocations',(select count(*) from finance_allocations),'available',creator_available_balance("+lit(CREATOR)+"),'reserved',coalesce((select sum(gross) from finance_batch_items where state in ('reserved','review')),0),'invalid_journal',(select count(*) from finance_journal where amount<=0 or debit_account=credit_account))");
const reset=async()=>{await run("truncate finance_allocations,finance_source_revisions,finance_journal,finance_adjustments,finance_sources,finance_batch_items,finance_batches,paypal_payout_reconciliations,paypal_payout_events,paypal_payout_submissions,payouts,transactions,profiles,payout_accounts,account_restrictions;update finance_private.settings set batch_handoff_enabled=false;insert into profiles values("+lit(ADMIN)+",null,'Admin','fan',true,false),("+lit(CREATOR)+",'creator','Mariana','creator',true,false),("+lit(OTHER)+",'other','Diego','creator',true,false);insert into payout_accounts values("+lit(CREATOR)+",'mariana@example.invalid'),("+lit(OTHER)+",'diego@example.invalid');insert into transactions values('sale','creator',200,.8,'paid',false,'2026-10-20T12:00:00Z')");};
const quote=()=>j('select finance_overview()');
const freeze=(key,o)=>"select finance_batch_freeze("+lit(key)+","+lit(o.cutoff)+"::timestamptz,"+lit(o.quote_hash)+")";
const manual=()=>"select paypal_payout_begin("+lit(CREATOR)+",'sandbox','sender-test')";
const adjustment=(key)=>"select finance_creator_adjust("+lit(CREATOR)+",-10,'Corrección virtual de concurrencia',"+lit(key)+",'race-adjust',null)";
async function race(name,a,b){
 const appA='fr_'+randomUUID().slice(0,8)+'_A',appB=appA.slice(0,-1)+'B';
 const x=start(a,{app:appA,hold:true});await x.ready;
 const y=start(b,{app:appB});let witness;
 for(let n=0;n<25;n++){witness=await j("select jsonb_build_object('waiters',coalesce(jsonb_agg(jsonb_build_object('pid',pid,'blocked_by',pg_blocking_pids(pid))), '[]'::jsonb)) from pg_stat_activity where datname=current_database() and application_name="+lit(appB)+" and cardinality(pg_blocking_pids(pid))>0");if(witness.waiters.length)break;await new Promise(r=>setTimeout(r,40));}
 const values=await Promise.allSettled([x.done,y.done]);assert.ok(witness.waiters.length,'No independent blocked session was observed');
 assert.ok(witness.waiters[0].blocked_by.every(p=>p!==witness.waiters[0].pid));
 races.push({name,witness: witness.waiters,results:values.map(v=>({status:v.status,error:v.status==='rejected'?v.reason.message:undefined}))});
 if(values.some(v=>v.status==='rejected'&&/deadlock|40P01|statement timeout|57014/i.test(v.reason.message)))throw new Error('Deadlock or statement timeout');
 return values;
}
const check=async(name,fn)=>{try{await reset();await fn();assert.equal((await stats()).invalid_journal,0);results.push({name,ok:true});console.log('PASS '+name);}catch(e){results.push({name,ok:false,error:e.message});console.error('FAIL '+name+': '+e.message);}};
try {
 await run('create database '+dbName,{database:'postgres'});made=true;
 const fixture=readFileSync(join(repo,'e2e/helpers/finance-fixture.mjs'),'utf8').match(/await db.exec\(`([\s\S]*?)`\);/)[1].replace(/create role [^;]+;/g,'');
 await run("do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end$$;");
 await run(fixture);
 // The shared fixture already defines auth.users and an owner stub. Extend the
 // former and remove only the disposable stub before installing the real owner schema.
 await run("alter table auth.users add column encrypted_password text;alter table auth.users alter column email_confirmed_at set default now();drop table security_private.owner_account;drop schema security_private;create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));create table auth.refresh_tokens(user_id text,session_id uuid references auth.sessions(id));create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;alter table account_restrictions add column suspension_reason text,add column updated_at timestamptz;create table admin_actions(admin_id uuid,admin_name text,user_id uuid,user_name text,action text,reason text,until timestamptz)");
 for(const uid of [ADMIN,CREATOR,OTHER])await run("insert into auth.users(id,email) values("+lit(uid)+","+lit(uid+'@example.invalid')+");insert into auth.sessions values("+lit(uid)+","+lit(uid)+")");

 for(const name of ['20261019194731_earnings_calendar_26_25.sql','20261019215002_disable_simulated_payout_fallback.sql'])await run('begin;'+source(name)+';commit;');
 await run(source('20261003000007_paypal_payouts.sql').match(/create or replace function public\.paypal_payout_mark\([\s\S]*?\$\$;/i)[0]);
 for(const name of ['20261019220609_payout_submission_recovery.sql','20261020015716_payout_event_reconciliation.sql','20261020032222_creator_ledger_batch_reservations.sql','20261020174153_owner_account_controls.sql','20261020174155_retire_shared_demo_identities.sql'])await run('begin;'+source(name)+';commit;');
 await run("insert into security_private.owner_account(user_id,active_view,reason) values("+lit(ADMIN)+",'fan','Propietario sintético para concurrencia')");
 await check('dos congelaciones con la misma clave reservan una sola vez',async()=>{
  const o=await quote(),key=randomUUID(),r=await race('same-key',freeze(key,o),freeze(key,o));assert.equal(r.filter(x=>x.status==='fulfilled').length,2);const s=await stats();assert.equal(s.batches,1);assert.equal(s.allocations,1);assert.equal(Number(s.available),0);
 });
 await check('dos claves distintas no crean dos lotes activos',async()=>{
  const o=await quote(),r=await race('different-key',freeze(randomUUID(),o),freeze(randomUUID(),o));assert.equal(r[0].status,'fulfilled');assert.equal(r[1].status,'rejected');assert.match(r[1].reason.message,/ya tiene un lote/);assert.equal((await stats()).batches,1);
 });
 await check('un retiro manual no consume el saldo reservado por otra conexión',async()=>{
  const o=await quote(),r=await race('freeze-vs-manual',freeze(randomUUID(),o),manual());assert.equal(r[0].status,'fulfilled');assert.equal(r[1].status,'rejected');assert.match(r[1].reason.message,/saldo|al menos|insuficiente|disponible/i);assert.equal((await stats()).payouts,0);assert.equal(Number((await stats()).reserved),160);
 });
 await check('un lote no reutiliza un retiro manual que acaba de confirmar su reserva',async()=>{
  const o=await quote(),r=await race('manual-vs-freeze',manual(),freeze(randomUUID(),o));assert.equal(r[0].status,'fulfilled');assert.equal(r[1].status,'rejected');assert.match(r[1].reason.message,/saldos cambiaron|creadores listos/);const s=await stats();assert.equal(s.payouts,1);assert.equal(s.batches,0);assert.equal(s.allocations,1);
 });
 await check('dos solicitudes manuales conservan un solo retiro',async()=>{
  const r=await race('manual-vs-manual',manual(),manual());assert.equal(r[0].status,'fulfilled');assert.equal(r[1].status,'rejected');assert.match(r[1].reason.message,/retiro en camino/);assert.equal((await stats()).payouts,1);
 });
 await check('una corrección posterior conserva la reserva y marca revisión',async()=>{
  const o=await quote(),r=await race('freeze-vs-correction',freeze(randomUUID(),o),adjustment(randomUUID()));assert.equal(r.filter(x=>x.status==='fulfilled').length,2);
  const s=await stats();assert.equal(Number(s.reserved),160);assert.equal(Number(s.available),-10);assert.equal((await j("select jsonb_build_object('state',state) from finance_batch_items")).state,'review');
 });
 await check('un reembolso en otra conexión invalida la cotización anterior',async()=>{
  const o=await quote(),r=await race('refund-vs-freeze',"update transactions set status='refunded' where id='sale'",freeze(randomUUID(),o));assert.equal(r[0].status,'fulfilled');assert.equal(r[1].status,'rejected');assert.match(r[1].reason.message,/saldos cambiaron|creadores listos/);assert.equal((await stats()).batches,0);assert.equal(Number((await stats()).available),0);
 });
 await check('dos preparaciones concurrentes conservan el mismo retiro y snapshot',async()=>{
  const o=await quote();await run(freeze(randomUUID(),o));await run('update finance_private.settings set batch_handoff_enabled=true');
  const item=(await j("select jsonb_build_object('id',id) from finance_batch_items")).id;
  const sql="select finance_batch_prepare_payout("+lit(item)+",'sandbox','sender-test')";
  const r=await race('handoff-vs-handoff',sql,sql);assert.equal(r.filter(x=>x.status==='fulfilled').length,2);
  assert.equal((await stats()).payouts,1);assert.equal((await j("select jsonb_build_object('n',count(*)) from paypal_payout_submissions")).n,1);assert.equal(Number((await stats()).available),0);
 });
 await check('liberar un lote no puede deshacer un handoff concurrente',async()=>{
  const o=await quote();const b=await j(freeze(randomUUID(),o));await run('update finance_private.settings set batch_handoff_enabled=true');
  const item=(await j("select jsonb_build_object('id',id) from finance_batch_items")).id;
  const r=await race('handoff-vs-cancel',"select finance_batch_prepare_payout("+lit(item)+",'sandbox','sender-test')","select finance_batch_cancel("+lit(b.id)+",'Liberación virtual de concurrencia')");
  assert.equal(r[0].status,'fulfilled');assert.equal(r[1].status,'rejected');assert.match(r[1].reason.message,/envíos preparados/);assert.equal((await stats()).payouts,1);
 });
 await check('dos trabajadores no adquieren el mismo envío incierto',async()=>{
  const p=await j(manual()),sql="select paypal_payout_claim("+lit(CREATOR)+","+lit(p.id)+",'sandbox','sender-test')";
  const r=await race('claim-vs-claim',sql,sql);assert.equal(r.filter(x=>x.status==='fulfilled').length,2);
  const v=await j("select jsonb_build_object('attempts',attempt_count,'leased',lease_token is not null,'status',(select status from payouts where id=payout_id)) from paypal_payout_submissions");
  assert.equal(v.attempts,1);assert.equal(v.leased,true);assert.equal(v.status,'sending');assert.equal(Number((await stats()).available),0);
 });
 await check('un rechazo de un trabajador antiguo no libera una aceptación actual',async()=>{
  const p=await j(manual()),c=await j("select paypal_payout_claim("+lit(CREATOR)+","+lit(p.id)+",'sandbox','sender-test')");
  const accepted="select paypal_payout_submission_result("+lit(CREATOR)+","+lit(p.id)+","+lit(c.token)+",'accepted','BATCH-"+p.id+"',null)";
  const stale="select paypal_payout_submission_result("+lit(CREATOR)+","+lit(p.id)+","+lit(randomUUID())+",'rejected',null,'rechazo atrasado')";
  const r=await race('accepted-vs-stale-rejection',accepted,stale);assert.equal(r.filter(x=>x.status==='fulfilled').length,2);
  const v=await j("select jsonb_build_object('state',state,'batch',batch_id) from paypal_payout_submissions");assert.equal(v.state,'submitted');assert.equal(v.batch,'BATCH-'+p.id);assert.equal(Number((await stats()).available),0);
 });
 await check('dos recepciones del mismo evento conservan una sola evidencia',async()=>{
  const p=await j(manual()),body={id:'WH-concurrent',event_type:'PAYMENT.PAYOUTS-ITEM.SUCCEEDED',resource:{payout_item:{sender_item_id:p.id},payout_batch_id:'BATCH-'+p.id}};
  const sql="select paypal_payout_event_receive('sandbox','sender-test',"+lit(JSON.stringify(body))+"::jsonb)";
  const r=await race('event-vs-event',sql,sql);assert.equal(r.filter(x=>x.status==='fulfilled').length,2);assert.equal((await j("select jsonb_build_object('n',count(*)) from paypal_payout_events")).n,1);assert.equal(Number((await stats()).available),0);
 });
 const sending=async()=>{
  const p=await j(manual()),c=await j("select paypal_payout_claim("+lit(CREATOR)+","+lit(p.id)+",'sandbox','sender-test')");
  await run("select paypal_payout_submission_result("+lit(CREATOR)+","+lit(p.id)+","+lit(c.token)+",'accepted','BATCH-"+p.id+"',null)");return p;
 };
 const queryFor=p=>j("select paypal_payout_reconcile_begin("+lit(p.id)+","+lit(CREATOR)+",'sandbox','sender-test',null,'poll')");
 const finish=(query,p,status)=>"select paypal_payout_reconcile_finish("+lit(query.query)+","+lit(JSON.stringify({http:200,data:{batch_header:{payout_batch_id:'BATCH-'+p.id,sender_batch_header:{sender_batch_id:p.id}},items:[{payout_item_id:'ITEM-'+p.id,transaction_status:status,payout_item:{recipient_type:'EMAIL',receiver:'mariana@example.invalid',amount:{currency:'USD',value:Number(p.net).toFixed(2)},sender_item_id:p.id}}]}}))+"::jsonb)";
 await check('dos confirmaciones de la misma consulta contabilizan una sola entrega',async()=>{
  const p=await sending(),query=await queryFor(p),before=await j("select jsonb_build_object('n',count(*)) from finance_journal");
  const sql=finish(query,p,'SUCCESS'),r=await race('finish-vs-finish',sql,sql);assert.equal(r.filter(x=>x.status==='fulfilled').length,2);
  assert.equal((await j("select jsonb_build_object('status',status) from payouts")).status,'paid');assert.equal((await j("select jsonb_build_object('n',count(*)) from finance_journal")).n,before.n+2);assert.equal(Number((await stats()).available),0);
 });
 await check('una respuesta vieja no revierte una confirmación más reciente',async()=>{
  const p=await sending(),older=await queryFor(p),newer=await queryFor(p);
  const r=await race('newer-vs-older-response',finish(newer,p,'SUCCESS'),finish(older,p,'RETURNED'));assert.equal(r.filter(x=>x.status==='fulfilled').length,2);
  assert.equal((await j("select jsonb_build_object('status',status) from payouts")).status,'paid');const a=await j("select jsonb_build_object('outcome',outcome,'reason',reason) from paypal_payout_reconciliations where id="+lit(older.query));assert.equal(a.outcome,'stale');assert.equal(a.reason,'NEWER_QUERY_STARTED');assert.equal(Number((await stats()).available),0);
 });
 await check('un reembolso concurrente conserva la entrega y registra el déficit',async()=>{
  const p=await sending(),query=await queryFor(p);
  const r=await race('paid-vs-refund',finish(query,p,'SUCCESS'),"update transactions set status='refunded' where id='sale'");assert.equal(r.filter(x=>x.status==='fulfilled').length,2);
  assert.equal((await j("select jsonb_build_object('status',status) from payouts")).status,'paid');assert.equal(Number((await stats()).available),-160);assert.equal((await stats()).payouts,1);
 });
} catch(e){results.push({name:'setup',ok:false,error:e.message});console.error(e.message);}
finally{
 if(made)try{await run('drop database '+dbName,{database:'postgres'});}catch(e){console.error('Cleanup: '+e.message);}
 writeFileSync(join(output,'concurrencia.json'),JSON.stringify({postgres:'17.11',host:'127.0.0.1',port,disposableDatabase:dbName,productionTouched:false,externalCalls:0,ownerControlsInstalled:true,ownerActorBusinessRole:'fan',results,races,sourceLedger:'20261020032222_creator_ledger_batch_reservations.sql'},null,2));
}
console.log(results.filter(r=>r.ok).length+'/'+results.length+' casos con sesiones PostgreSQL independientes');
if(results.some(r=>!r.ok))process.exitCode=1;
