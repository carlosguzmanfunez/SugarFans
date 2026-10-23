import assert from 'node:assert/strict';
import {payoutJobFixture} from './helpers/payout-job-fixture.mjs';
const f=await payoutJobFixture();let passed=0;
try{
 await f.seed(50);
 for(const token of['','incorrect','TEST_ADMIN']){assert.equal((await f.runScheduledReview(token)).http,401);passed++;}
 assert.equal(f.transport.rpcCalls,0);assert.equal(f.transport.posts.length,0);
 for(const token of['','incorrect','TEST_FAN']){const result=await f.run({token,method:'POST',body:{action:'schedule-status'}});assert.equal(result.http,token==='TEST_FAN'?403:401);passed++;}
 assert.equal(f.transport.rpcCalls,0);
 const status=await f.run({token:'TEST_ADMIN',method:'POST',body:{action:'schedule-status'}});
 assert.equal(status.http,200);assert.equal(status.data.mode,'review-only');assert.equal(status.data.caseLimit,50);assert.equal(f.transport.rpcCalls,0);assert.equal((await f.q('select id from finance_job_runs')).length,0);assert.equal(f.transport.emails.length,0);passed++;
 await f.enable();await f.funds(10000,'2026-10-26T12:00:00Z');
 const reviewed=await f.runScheduledReview();assert.equal(reviewed.http,200);assert.equal(reviewed.data.work_limit,50);assert.equal(reviewed.data.trigger,'scheduled-review');assert.equal(f.transport.posts.length,0);assert.equal((await f.stats()).total,0);
 const [run]=await f.q('select execute_requested,summary from finance_job_runs');assert.equal(run.execute_requested,false);assert.equal(run.summary.trigger,'scheduled-review');assert.equal(run.summary.schedule_profile,status.data.profile);passed++;
 const manual=await f.run({token:'TEST_ADMIN',method:'POST',body:{execute:true,action:'review'}});assert.equal(manual.http,200);assert.equal(manual.data.trigger,'manual-review');assert.equal(manual.data.work_limit,50);assert.equal(f.transport.posts.length,0);passed++;
 await f.seed(2);await f.enable();await f.funds(1000,'2026-10-26T12:00:00Z');f.transport.pendingAt=1;
 await f.runVirtual('2026-10-26T12:00:00Z');assert.equal(f.transport.posts.length,2);
 const before=await f.q('select id,status,amount,fee,net from payouts order by id'),beforeReservations=await f.q('select payout_id,budget from finance_execution_reservations order by payout_id');
 const reconcile=await f.runScheduledReview();assert.equal(reconcile.http,200);assert.equal(f.transport.posts.length,2);
 assert.deepEqual(await f.q('select id,status,amount,fee,net from payouts order by id'),before);assert.deepEqual(await f.q('select payout_id,budget from finance_execution_reservations order by payout_id'),beforeReservations);passed++;
 await f.seed(1);await f.enable();await f.funds(1000,'2026-10-26T12:00:00Z');f.transport.lost=1;
 await f.runVirtual('2026-10-26T12:00:00Z');assert.equal(f.transport.posts.length,1);
 const unknown=await f.q('select id,status,amount,fee,net,paypal_batch_id from payouts'),reserved=await f.q('select payout_id,budget from finance_execution_reservations');assert.equal(unknown[0].status,'sending');assert.equal(unknown[0].paypal_batch_id,null);
 assert.equal((await f.runScheduledReview()).http,200);assert.equal(f.transport.posts.length,1);assert.deepEqual(await f.q('select id,status,amount,fee,net,paypal_batch_id from payouts'),unknown);assert.deepEqual(await f.q('select payout_id,budget from finance_execution_reservations'),reserved);passed++;
 assert.deepEqual(f.transport.blockedNetwork,[]);
 console.log(`OK ${passed} controles: horario privado para administrador; cron autenticado; 50 casos de revisión sin nuevos envíos aunque las puertas de dinero estén abiertas; consultas pendientes conservan importes y reservas. Todo el transporte es ficticio.`);
}finally{await f.close();}
