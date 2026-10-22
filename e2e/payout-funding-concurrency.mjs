// Real PostgreSQL sessions, synthetic data only; no HTTP/PayPal calls.
// npm run test:payout-funding-concurrency -- <postgres bin> [local port]
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
const results=[],races=[];let made=false;let testAt='2026-10-26T12:00:00Z';
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
 const prefix="select set_config('request.jwt.claims',"+lit(JSON.stringify({session_id:auth}))+",false) is not null;set application_name="+lit(app)+";set statement_timeout='12s';set test.clock="+lit(testAt)+";select set_config('request.jwt.claim.sub',"+lit(auth)+",false);";
 child.stdin.end(prefix+(hold?'begin;':'')+sql+";select jsonb_build_object('__ready',true);"+(hold?"select pg_sleep(2);commit;":""));
 return {ready,done};
}
const run=async(sql,opts)=>{const r=await start(sql,opts).done;return r.stdout.split(/\r?\n/).map(s=>s.trim()).filter(s=>s.startsWith('{')||s.startsWith('[')).map(s=>JSON.parse(s)).filter(o=>!o.__ready);};
const j=async(sql,opts)=>(await run(sql,opts))[0];
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

try {
 await run('create database '+dbName,{database:'postgres'});made=true;
 const fixture=readFileSync(join(repo,'e2e/helpers/finance-fixture.mjs'),'utf8').match(/await db.exec\(`([\s\S]*?)`\);/)[1].replace(/create role [^;]+;/g,'');
 await run("do $$begin if not exists(select 1 from pg_roles where rolname='anon')then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated')then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role')then create role service_role bypassrls;end if;end$$;");
 await run(fixture);
 for(const name of ['20261019194731_earnings_calendar_26_25.sql','20261019215002_disable_simulated_payout_fallback.sql'])await run('begin;'+source(name)+';commit;');
 await run(source('20261003000007_paypal_payouts.sql').match(/create or replace function public\.paypal_payout_mark\([\s\S]*?\$\$;/i)[0]);
 for(const name of ['20261019220609_payout_submission_recovery.sql','20261020015716_payout_event_reconciliation.sql','20261020032222_creator_ledger_batch_reservations.sql','20261020231703_payout_notification_wording.sql','20261021045607_payout_batch_executor_and_reconciliation.sql','20261021050319_payout_owner_notification_authority.sql','20261021145039_payout_fee_resolution.sql'])await run('begin;'+source(name)+';commit;');
 await run("alter table transactions add column kind text not null default 'tip';alter table transactions add column key text;alter table account_restrictions add column updated_at timestamptz default now();alter table account_restrictions add column suspension_reason text;create table admin_actions(id uuid default gen_random_uuid(),admin_id uuid,admin_name text,user_id uuid,user_name text,action text,reason text,until timestamptz,created_at timestamptz default now())");
 await run(source('20261020174153_owner_account_controls.sql').match(/create or replace function public\.admin_account_action\([\s\S]*?\$\$;/i)[0]);
 await run(source('20261010000002_platform_covers_refunds.sql').match(/create or replace function public\.admin_cover_refund\([\s\S]*?\$\$;/i)[0].replace('id = p_transaction','id = p_transaction::text'));
 for(const name of ['20261021164442_payout_incident_procedures.sql','20261021191647_payout_provider_capacity.sql','20261021200143_payout_work_rotation.sql','20261021203712_payout_group_mirrors.sql','20261022015657_payout_rejected_cases_and_funding_pause.sql'])await run('begin;'+source(name)+';commit;');
 const THIRD='00000000-0000-0000-0000-000000000003';
 await run("insert into profiles values("+lit(ADMIN)+",null,'QA Admin','admin',true,false),("+lit(CREATOR)+",'creator','QA Mariana','creator',true,false),("+lit(OTHER)+",'other','QA Diego','creator',true,false),("+lit(THIRD)+",'third','QA Third','creator',true,false);update finance_private.automation_settings set environment='sandbox',operator_user_id="+lit(ADMIN)+" where id;");
 for(const uid of[ADMIN,CREATOR,OTHER,THIRD])await run("insert into auth.users(id,email,email_confirmed_at)values("+lit(uid)+","+lit(uid+'@example.invalid')+",now())");
 for(const[uid,creator]of[[CREATOR,'creator'],[OTHER,'other'],[THIRD,'third']])await run("insert into payout_accounts values("+lit(uid)+","+lit(creator+'@example.invalid')+");insert into transactions(id,creator_profile_id,amount,creator_share,status,created_at)values("+lit('sale-'+creator)+","+lit(creator)+",200,.8,'paid','2026-10-20T12:00:00Z')");
 const p=await j('select paypal_payout_begin('+lit(CREATOR)+",'sandbox','TEST_SENDER')"),other=await j('select paypal_payout_begin('+lit(OTHER)+",'sandbox','TEST_SENDER')"),third=await j('select paypal_payout_begin('+lit(THIRD)+",'sandbox','TEST_SENDER')");
 const claim=(uid,id)=>'select paypal_payout_claim('+lit(uid)+','+lit(id)+",'sandbox','TEST_SENDER')";
 const a=await j(claim(CREATOR,p.id)),b=await j(claim(OTHER,other.id));
 const reject=(uid,id,token)=>'select paypal_payout_submission_result('+lit(uid)+','+lit(id)+','+lit(token)+",'rejected',null,'INSUFFICIENT_FUNDS')";
 let values=await race('funding-stop-versus-untried-claim',reject(CREATOR,p.id,a.token),claim(THIRD,third.id));assert.ok(values.every(x=>x.status==='fulfilled'));
 let witness=await j("select jsonb_build_object('stops',(select count(*)from finance_private.payer_funding_stops),'third_attempts',(select attempt_count from paypal_payout_submissions where payout_id="+lit(third.id)+"),'first_failed',(select status='failed'from payouts where id="+lit(p.id)+"))");assert.equal(witness.stops,1);assert.equal(witness.third_attempts,0);assert.ok(witness.first_failed);results.push({name:'Una respuesta de fondos bloquea otra conexión antes de consumir el primer intento',ok:true,witness});
 values=await race('duplicate-rejected-response',reject(CREATOR,p.id,a.token),reject(CREATOR,p.id,a.token));assert.ok(values.every(x=>x.status==='fulfilled'));
 assert.equal((await j("select jsonb_build_object('n',count(*))from finance_private.payer_funding_stops")).n,1);results.push({name:'Dos respuestas repetidas no duplican la pausa ni liberan otra vez',ok:true});
 testAt='2026-10-26T12:01:00Z';await run("select finance_funding_record("+lit(randomUUID())+",'sandbox',10000,'2026-10-26T12:01:00Z','QA new balance after payer rejection')");
 const i=await j("select jsonb_build_object('id',id)from finance_incidents where code='PAYER_FUNDS_INSUFFICIENT'"),v=await j('select finance_case_preview('+lit(i.id)+')'),key=randomUUID();
 const close='select finance_case_act('+lit(i.id)+','+lit(key)+','+lit(v.hash)+",'close_review','platform','platform_processing','QA fresh funding evidence','QA payer funds were replenished and verified against all outstanding commitments',null,null)";
 values=await race('same-key-funding-resume',close,close);assert.ok(values.every(x=>x.status==='fulfilled'));
 witness=await j("select jsonb_build_object('decisions',(select count(*)from finance_case_actions),'releases',(select count(*)from finance_private.payer_funding_releases),'active',finance_private.active_funding_stop('sandbox'))");assert.equal(witness.decisions,1);assert.equal(witness.releases,1);assert.equal(witness.active,null);results.push({name:'Dos confirmaciones simultáneas registran una sola reanudación',ok:true,witness});
 values=await race('resume-replay-versus-new-funding-failure',close,reject(OTHER,other.id,b.token));assert.ok(values.every(x=>x.status==='fulfilled'));
 witness=await j("select jsonb_build_object('incidents',(select count(*)from finance_incidents where code='PAYER_FUNDS_INSUFFICIENT'),'episode',(select episode from finance_incidents where code='PAYER_FUNDS_INSUFFICIENT'),'stops',(select count(*)from finance_private.payer_funding_stops),'active',finance_private.active_funding_stop('sandbox'),'third_attempts',(select attempt_count from paypal_payout_submissions where payout_id="+lit(third.id)+"))");assert.equal(witness.incidents,1);assert.equal(witness.episode,2);assert.equal(witness.stops,2);assert.ok(witness.active);assert.equal(witness.third_attempts,0);results.push({name:'Una nueva falta de fondos posterior a la reanudación conserva una nueva pausa común',ok:true,witness});
 writeFileSync(join(output,'CONCURRENCIA.json'),JSON.stringify({nativePayments:0,productionChanges:0,results,races},null,2));console.log(JSON.stringify({passed:results.length,independentLockWitnesses:races.length,nativePayments:0,productionChanges:0}));
}finally{if(made){assert.match(dbName,/^fr_concurrency_[a-f0-9]{12}$/);await run('drop database '+dbName,{database:'postgres'});}}
