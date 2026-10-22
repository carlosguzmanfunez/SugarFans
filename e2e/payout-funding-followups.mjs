// Entire worker -> RPC -> PostgreSQL flow. Network and emails are intercepted.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {payoutJobFixture} from './helpers/payout-job-fixture.mjs';
import {ADMIN,CREATOR} from './helpers/finance-fixture.mjs';
const f=await payoutJobFixture(),results=[],out=resolve('../../outputs/seguimiento-pagos-3-puntos');mkdirSync(out,{recursive:true});
const count=async(t,where='true')=>Number((await f.q('select count(*) n from '+t+' where '+where))[0].n);
const start=async(n=5)=>{await f.seed(n);await f.enable();await f.funds(100000,'2026-10-26T12:00:00Z');process.env.PAYOUT_WORK_LIMIT='50';};
const incident=async(code)=>(await f.q('select id from finance_incidents where code=$1',[code]))[0].id;
const preview=id=>f.rpc('finance_case_preview',[id]);
const decision=(v,key=randomUUID(),party='platform',category='platform_processing')=>f.rpc('finance_case_act',[v.incident,key,v.hash,'close_review',party,category,'QA comprobación documental de la incidencia','QA revisión del resultado y de los fondos sin alterar el historial original',null,null]);
const check=async(name,run)=>{await run();results.push({name,passed:true});console.log('OK '+name);};
try{
 await check('Falta de fondos detiene los nuevos envíos de la misma ronda y conserva los aceptados',async()=>{
  await start();f.transport.pendingAt=1;f.transport.insufficientAt=2;
  const r=await f.runVirtual('2026-10-26T12:00:00Z');assert.equal(r.http,200);assert.equal(r.data.blocked,'PAYER_FUNDS_INSUFFICIENT');assert.equal(f.transport.posts.length,2);
  assert.equal(await count('payouts',"status='sending'"),1);assert.equal(await count('payouts',"status='failed'"),1);
  assert.equal(await count('finance_private.payer_funding_stops'),1);
  assert.equal(await count('finance_incidents',"code='PAYER_FUNDS_INSUFFICIENT' and state='open'"),1);
  assert.equal(await count('finance_incidents',"code='PAYOUT_REJECTED'"),1);
 });
 await check('Una ronda posterior concilia lo aceptado y no crea más retiros mientras persiste la pausa',async()=>{
  f.transport.pending.clear();const r=await f.runVirtual('2026-10-26T12:05:00Z');assert.equal(r.http,200);assert.equal(f.transport.posts.length,2);
  assert.equal(await count('payouts',"status='paid'"),1);assert.equal(await count('payouts'),2);
  assert.equal(await count('finance_alert_queue',"incident_id in(select id from finance_incidents where code='PAYER_FUNDS_INSUFFICIENT')"),1);
 });
 await check('El espejo enlaza el rechazo con un expediente que muestra su motivo',async()=>{
  const batch=(await f.q('select id from finance_batches'))[0].id,g=await f.rpc('finance_payout_groups',[batch]),d=await f.rpc('finance_payout_group',[g.groups[0].id]);
  const rejected=d.members.find(x=>x.status==='review');assert.ok(rejected.case_id);assert.match(rejected.reason,/insuficiente/);
  const v=await preview(rejected.case_id);assert.equal(v.source.reason,'INSUFFICIENT_FUNDS');assert.ok(v.source.definitive);
 });
 await check('Fondos antiguos, insuficientes o no comprobados no habilitan la reanudación',async()=>{
  const id=await incident('PAYER_FUNDS_INSUFFICIENT');let v=await preview(id);assert.ok(v.source.blockers.includes('FRESH_FUNDING_REQUIRED'));assert.ok(!v.actions.includes('close_review'));
  await assert.rejects(()=>decision(v),/no está permitida/);
  await f.clock('2026-10-26T12:06:00Z');await f.funds(1,'2026-10-26T12:06:00Z');v=await preview(id);
  assert.ok(v.source.blockers.includes('FUNDING_COVERAGE_REQUIRED'));assert.ok(!v.actions.includes('close_review'));
  await assert.rejects(()=>f.rpc('finance_funding_record',[randomUUID(),'sandbox',100000,'2026-10-25T00:00:00Z','QA evidencia vencida']),/24 horas/);
 });
 await check('La reanudación exige una decisión actual de Fans Reserve; el acuse perdido no duplica la liberación',async()=>{
  await f.clock('2026-10-26T12:07:00Z');await f.funds(100000,'2026-10-26T12:07:00Z');const id=await incident('PAYER_FUNDS_INSUFFICIENT'),stale=await preview(id);
  await f.clock('2026-10-26T12:08:00Z');await f.funds(99999,'2026-10-26T12:08:00Z');await assert.rejects(()=>decision(stale),/cambió/);
  const v=await preview(id);assert.ok(v.actions.includes('close_review'));await assert.rejects(()=>decision(v,randomUUID(),'creator','human_input'),/corresponden a Fans Reserve/);
  await f.auth(CREATOR);await assert.rejects(()=>decision(v),/administrador|administrativa|administrativo/);await f.auth(ADMIN);
  const key=randomUUID(),a=await decision(v,key),b=await decision(v,key);assert.equal(a.id,b.id);assert.equal(a.result.funding_stop_released,true);assert.equal(await count('finance_private.payer_funding_releases'),1);
  await f.q('update finance_private.automation_settings set execution_enabled=false');assert.equal((await f.rpc('finance_operations')).blocked,'EXECUTOR_DISABLED');
  await f.q('update finance_private.automation_settings set execution_enabled=true');
  const r=await f.runVirtual('2026-10-26T12:10:00Z');assert.equal(r.http,200);assert.equal(await count('payouts',"status='paid'"),4);assert.equal(f.transport.posts.length,5);
  assert.equal(await count('payouts',"status='failed'"),1); // Original failed payout is never silently retried.
 });
 await check('Cerrar un rechazo conserva su estado, sus libros y sus intentos; no reabre por revisiones repetidas',async()=>{
  const id=await incident('PAYOUT_REJECTED'),v=await preview(id),before=await f.q('select to_jsonb(p) p from payouts p order by id'),journal=await count('finance_journal');
  await decision(v,randomUUID(),'undetermined','unresolved');await f.runVirtual('2026-10-26T12:15:00Z');
  assert.equal((await f.q('select state,episode from finance_incidents where id=$1',[id]))[0].state,'resolved');
  assert.deepEqual(await f.q('select to_jsonb(p) p from payouts p order by id'),before);assert.equal(await count('finance_journal'),journal);
 });
 await check('Un rechazo individual sin causa de fondos deja avanzar a los creadores sanos',async()=>{
  await start();f.transport.deniedAt=2;const r=await f.runVirtual('2026-10-26T12:00:00Z');assert.equal(r.http,200);assert.equal(f.transport.posts.length,5);
  assert.equal(await count('payouts',"status='paid'"),4);assert.equal(await count('payouts',"status='failed'"),1);assert.equal(await count('finance_private.payer_funding_stops'),0);
  const v=await preview(await incident('PAYOUT_REJECTED'));assert.equal(v.source.reason,'FAILED');assert.match((await f.q("select detail from finance_incidents where code='PAYOUT_REJECTED'"))[0].detail,/por determinar/);
 });
 await check('Un rechazo conciliado con causa explícita de fondos también pausa la ronda',async()=>{
  await start();f.transport.deniedAt=1;f.transport.deniedReason='INSUFFICIENT_FUNDS';
  const r=await f.runVirtual('2026-10-26T12:00:00Z');assert.equal(r.data.blocked,'PAYER_FUNDS_INSUFFICIENT');assert.equal(f.transport.posts.length,1);
  assert.equal(await count('finance_private.payer_funding_stops'),1);assert.equal(await count('finance_incidents',"code='PAYER_FUNDS_INSUFFICIENT'"),1);
  const id=await incident('PAYER_FUNDS_INSUFFICIENT');await f.clock('2026-10-26T12:01:00Z');await f.funds(100000,'2026-10-26T12:01:00Z');await decision(await preview(id));
  const proof=(await f.q("select id,response from paypal_payout_reconciliations where outcome='applied' order by sequence desc limit 1"))[0];
  await f.rpc('paypal_payout_reconcile_finish',[proof.id,{http:200,data:{items:[]}}]);
  assert.equal((await f.q('select finance_private.active_funding_stop(\'sandbox\') id'))[0].id,null);
  assert.equal((await f.q('select episode,state from finance_incidents where id=$1',[id]))[0].state,'resolved');
  await assert.rejects(()=>f.q('delete from finance_private.payer_funding_releases'),/inmutable/);
 });
 await check('Un intento anterior incierto conserva sus fondos aunque el siguiente informe falta de saldo',async()=>{
  await start(2);const job=await f.rpc('finance_job_start',['sandbox',true]),work=await f.rpc('finance_job_work',[job.id,2]);
  const p=await f.rpc('finance_job_prepare',[job.id,work[0].item,'TEST_SENDER']);let c=await f.rpc('paypal_payout_claim',[work[0].user_id,p.id,'sandbox','TEST_SENDER']);
  await f.rpc('paypal_payout_submission_result',[work[0].user_id,p.id,c.token,'uncertain',null,'QA accepted response lost']);
  await f.rpc('finance_job_finish',[job.id,{},null]);
  const before=(await f.q('select request_body from paypal_payout_submissions where payout_id=$1',[p.id]))[0].request_body;
  await f.clock('2026-10-26T12:03:00Z');c=await f.rpc('paypal_payout_claim',[work[0].user_id,p.id,'sandbox','TEST_SENDER']);
  const saved=await f.rpc('paypal_payout_submission_result',[work[0].user_id,p.id,c.token,'rejected',null,'INSUFFICIENT_FUNDS']);assert.equal(saved.status,'sending');
  const after=(await f.q('select request_body,state,attempt_count from paypal_payout_submissions where payout_id=$1',[p.id]))[0];assert.deepEqual(after.request_body,before);assert.equal(after.attempt_count,2);assert.equal(after.state,'uncertain');
  assert.equal(await count('finance_incidents',"code='PAYOUT_REJECTED'"),0);assert.equal(await count('finance_private.payer_funding_stops'),1);
  c=await f.rpc('paypal_payout_claim',[work[0].user_id,p.id,'sandbox','TEST_SENDER']);assert.equal(c.operation,'wait');
  assert.equal(Number((await f.q('select attempt_count n from paypal_payout_submissions where payout_id=$1',[p.id]))[0].n),2);
 });
 await check('Un acuse de base de datos perdido después de guardar la falta de fondos tampoco inicia otro envío',async()=>{
  await start();f.transport.insufficientAt=1;f.transport.invalidRpc='paypal_payout_submission_result';
  await f.runVirtual('2026-10-26T12:00:00Z');assert.equal(f.transport.posts.length,1);assert.equal(await count('finance_private.payer_funding_stops'),1);
  await f.runVirtual('2026-10-26T12:05:00Z');assert.equal(f.transport.posts.length,1);
 });
 await check('La pausa no consume intentos de envíos preparados ni permite crear retiros manuales',async()=>{
  await start(3);const a=await f.rpc('paypal_payout_begin',[CREATOR,'sandbox','TEST_SENDER']).catch(()=>null);
  // Seeded QA creators are separate from the base creator; prepare one under the regular worker contract.
  assert.equal(a,null);const job=await f.rpc('finance_job_start',['sandbox',true]);await f.rpc('finance_job_review',[job.id]);
  const work=await f.rpc('finance_job_work',[job.id,3]);const p=await f.rpc('finance_job_prepare',[job.id,work[0].item,'TEST_SENDER']);
  const c=await f.rpc('paypal_payout_claim',[work[0].user_id,p.id,'sandbox','TEST_SENDER']);
  await f.rpc('paypal_payout_submission_result',[work[0].user_id,p.id,c.token,'rejected',null,'INSUFFICIENT_FUNDS']);
  await assert.rejects(()=>f.rpc('paypal_payout_begin',[work[1].user_id,'sandbox','TEST_SENDER']),/Faltan fondos/);
  assert.equal(await count('payouts'),1);await f.rpc('finance_job_finish',[job.id,{},null]);
  for(const role of['anon','authenticated','service_role']){await f.db.exec('set role '+role);try{await assert.rejects(()=>f.q('select * from finance_private.payer_funding_stops'),/permission denied/);await assert.rejects(()=>f.q("select finance_private.active_funding_stop('sandbox')"),/permission denied/);}finally{await f.db.exec('reset role');}}
  await assert.rejects(()=>f.q('delete from finance_private.payer_funding_stops'),/inmutable/);
 });
 await check('La adopción de rechazos históricos crea expedientes y avisos una sola vez sin cambiar pagos',async()=>{
  await start(16);
  for(let n=1;n<=16;n++){f.transport.deniedAt=n;process.env.PAYOUT_WORK_LIMIT='1';await f.runVirtual(new Date(Date.parse('2026-10-26T12:00:00Z')+n*60000).toISOString());}
  assert.equal(await count('payouts',"status='failed'"),16);
  const prior=await f.q('select to_jsonb(p) p,to_jsonb(s) s from payouts p join paypal_payout_submissions s on s.payout_id=p.id order by p.id');
  await f.q("delete from finance_alert_queue where incident_id in(select id from finance_incidents where code='PAYOUT_REJECTED')");await f.q("delete from finance_incidents where code='PAYOUT_REJECTED'");
  const migration=readFileSync('supabase/migrations/20261022015657_payout_rejected_cases_and_funding_pause.sql','utf8');
  const adoption=migration.match(/do \$\$declare p record;begin[\s\S]*?end\$\$;/)[0];await f.db.exec(adoption);await f.db.exec(adoption);
  assert.equal(await count('finance_incidents',"code='PAYOUT_REJECTED'"),16);assert.equal(await count('finance_alert_queue',"incident_id in(select id from finance_incidents where code='PAYOUT_REJECTED')"),16);
  assert.equal(await count('finance_private.payer_funding_stops'),0);assert.deepEqual(await f.q('select to_jsonb(p) p,to_jsonb(s) s from payouts p join paypal_payout_submissions s on s.payout_id=p.id order by p.id'),prior);
 });
 await check('Cincuenta costos reales de 0,98 devuelven 0,02 por creador, un dólar total, sin cambiar originales ni el 20%',async()=>{
  await start(50);await f.q("update transactions set amount=62.5 where id like 'sale-%'");f.transport.nativeFee=.98;
  await f.runVirtual('2026-10-26T12:00:00Z');assert.equal(await count('payouts',"status='paid'"),50);
  const prior=await f.q('select to_jsonb(p) p,to_jsonb(s) s from payouts p join paypal_payout_submissions s on s.payout_id=p.id order by p.id');
  const payouts=await f.q('select id,paypal_item_id from payouts order by id'),rows=payouts.map(p=>({source:'paypal',external_id:'QA-FEE-'+p.id,kind:'fee',reference:p.paypal_item_id,amount:.98,currency:'USD',occurred_at:'2026-10-26T12:00:00Z'}));
  await f.auth(ADMIN);await f.rpc('finance_statement_import',[randomUUID(),'sandbox',true,rows]);
  await f.q("update finance_private.fee_policy set enabled=true,contract_reference='QA: Creator Agreement 6.4.3, actual payout cost'");
  const lines=await f.q('select id from finance_statement_lines order by id');for(const line of lines){const v=await f.rpc('finance_fee_preview',[line.id]);assert.equal(v.issue,null);assert.equal(Number(v.creator_delta),.02);const args=[line.id,randomUUID(),v.hash,'QA provider evidence TEST: fee 0.98 per payout','QA devuelve el exceso cobrado sobre el costo real del retiro según el contrato vigente'];const a=await f.rpc('finance_fee_resolve',args),b=await f.rpc('finance_fee_resolve',args);assert.equal(a.id,b.id);}
  assert.equal(await count('finance_fee_resolutions'),50);assert.equal(Number((await f.q('select sum(amount) v from finance_adjustments'))[0].v),1);
  assert.deepEqual(await f.q('select to_jsonb(p) p,to_jsonb(s) s from payouts p join paypal_payout_submissions s on s.payout_id=p.id order by p.id'),prior);
  assert.equal(Number((await f.q("select sum(amount*(1-creator_share)) v from transactions where id like 'sale-%'"))[0].v),625);
  for(const p of (await f.q('select user_id from payouts limit 3'))){await f.auth(p.user_id);const b=await f.rpc('finance_creator_balance');assert.equal(Number(b.pending),.02);assert.equal(Number(b.available),0);}
  await f.clock('2026-11-26T12:00:00Z');const b=await f.rpc('finance_creator_balance');assert.equal(Number(b.pending),0);assert.equal(Number(b.available),.02);await f.auth(ADMIN);
  assert.equal((await f.q("select count(*) n from finance_statement_lines where amount=.98"))[0].n,50);
 });
 assert.deepEqual(f.transport.blockedNetwork,[]);writeFileSync(resolve(out,'RESULTADOS.json'),JSON.stringify({at:new Date().toISOString(),environment:'virtual',nativePayments:0,realEmails:0,productionChanges:0,results},null,2));
 console.log(results.length+' pruebas integrales satisfactorias.');
}finally{await f.close();}
