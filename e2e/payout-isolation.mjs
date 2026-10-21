// API + SQL with synthetic creators only. The fixture intercepts every fetch.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {payoutJobFixture} from './helpers/payout-job-fixture.mjs';
const f=await payoutJobFixture(),results=[];
const record=(name,data)=>{results.push({name,...data});console.log('OK '+name+' '+JSON.stringify(data));};
async function tick(minute){const r=await f.runVirtual(new Date(Date.parse('2026-10-26T12:00:00Z')+minute*60000).toISOString());assert.equal(r.http,200,JSON.stringify(r));return r.data;}
async function seed(){await f.seed(12);await f.enable();await f.funds(1236,'2026-10-26T12:00:00Z');process.env.PAYOUT_WORK_LIMIT='5';}
try{
 await seed();await f.q("update profiles set is_verified=false where creator_profile_id='qa-1'");
 for(const minute of[0,5,10])await tick(minute);
 assert.equal(Number((await f.stats()).paid),11);assert.equal((await f.q("select count(*)::integer n from payouts p join profiles u on u.id=p.user_id where creator_profile_id='qa-1'"))[0].n,0);
 record('Un creador sin verificar se aparta y los otros once cobran',{paid:11,blockedCreators:1});

 for(const pendingCount of[1,5]){
  await seed();const j=await f.rpc('finance_job_start',['sandbox',true]),items=await f.rpc('finance_job_work',[j.id,pendingCount]),snapshots=[];
  for(const item of items){
   const prepared=await f.rpc('finance_job_prepare',[j.id,item.item,'TEST_SENDER']);
   const claim=await f.rpc('paypal_payout_claim',[item.user_id,prepared.id,'sandbox','TEST_SENDER']);
   assert.equal(claim.operation,'submit');
   await f.rpc('paypal_payout_submission_result',[item.user_id,prepared.id,claim.token,'accepted','BATCH-'+prepared.id,null]);
   f.transport.accepted.set(prepared.id,claim.payload);f.transport.pending.add(prepared.id);snapshots.push({id:prepared.id,payload:claim.payload});
  }
  await f.rpc('finance_job_finish',[j.id,{},null]);
  await tick(0);
  if(pendingCount===1)assert.equal(Number((await f.stats()).paid),4,'Un pendiente no debe cortar los otros cuatro casos de la misma ronda');
  for(const minute of[5,10,15])await tick(minute);
  assert.equal(Number((await f.stats()).paid),12-pendingCount);assert.equal((await f.stats()).sending,pendingCount);assert.equal(f.transport.posts.length,12-pendingCount);
  assert.equal((await f.q("select count(*)::integer n from finance_journal where kind='payout_confirmed'"))[0].n,12-pendingCount);
  for(const snapshot of snapshots){const saved=(await f.q('select request_body from paypal_payout_submissions where payout_id=$1',[snapshot.id]))[0];assert.deepEqual(saved.request_body,snapshot.payload);}
  f.transport.pending.clear();await tick(20);assert.equal(Number((await f.stats()).paid),12);assert.equal(f.transport.posts.length,12-pendingCount);
  record(pendingCount+' pagos aceptados pero pendientes conservan fondos y dejan avanzar al resto',{pendingCount,healthyPaid:12-pendingCount,finalPaid:12,newPostsForPending:0});
 }

 await seed();const j=await f.rpc('finance_job_start',['sandbox',true]),first=await f.rpc('finance_job_work',[j.id,5]);assert.equal(first.length,5);
 for(const item of first)await f.q('update profiles set is_verified=false where id=$1',[item.user_id]);
 await f.rpc('finance_job_finish',[j.id,{},null]);
 for(const minute of[0,5,10,15])await tick(minute);
 const healthy=Number((await f.stats()).paid);assert.equal(healthy,7,'Los primeros cinco casos fallidos no deben ocupar todas las rondas y dejar siete sanos sin pagar');
 const reserved=(await f.q("select count(*)::integer n from finance_batch_items i where state='reserved' and not exists(select 1 from payouts p where p.finance_batch_item_id=i.id)"))[0].n;assert.equal(reserved,5);
 for(const item of first)await f.q('update profiles set is_verified=true where id=$1',[item.user_id]);
 await tick(20);assert.equal(Number((await f.stats()).paid),12);assert.equal(f.transport.accepted.size,12);
 record('Cinco fallos después del cierre no impiden pagar siete sanos; se recuperan al corregirlos',{healthyPaid:7,reservedForReview:5,finalPaid:12,duplicates:0});

 for(const role of['anon','authenticated','service_role']){
  await f.db.exec('set role '+role);try{await assert.rejects(()=>f.q('select * from finance_private.work_attempts'),/permission denied/);if(role!=='service_role')await assert.rejects(()=>f.rpc('finance_job_attempt',['00000000-0000-0000-0000-000000000001','prepare','00000000-0000-0000-0000-000000000002']),/permission denied/);}finally{await f.db.exec('reset role');}
 }
 record('El historial de turnos no puede ser leído ni manipulado desde cuentas normales',{directTableAccess:false,clientFunctionAccess:false});

 assert.deepEqual(f.transport.blockedNetwork,[]);const dir=resolve('../../outputs/aislamiento-pagos');mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'RESULTADOS.json'),JSON.stringify({at:new Date().toISOString(),mode:'virtual',nativeProviderCalls:0,productionChanges:0,results},null,2));console.log(results.length+' escenarios de aislamiento satisfactorios.');
}finally{await f.close();}
