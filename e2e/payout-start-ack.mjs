import assert from 'node:assert/strict';
import {payoutJobFixture} from './helpers/payout-job-fixture.mjs';
const f=await payoutJobFixture();let passed=0;
try{
 for(const reply of[null,{},[],{operation:'run'},{operation:'run',id:'unknown'},{operation:'unexpected'},'truncated']){
  await f.seed(1);await f.enable();await f.funds(1000,'2026-10-26T12:00:00Z');if(reply==='truncated')f.transport.invalidRpc='finance_job_start';else f.transport.startReply=reply;
  const first=await f.run();assert.equal(first.http,503);assert.equal(first.data.operation,'unconfirmed');assert.equal(f.transport.posts.length,0);assert.equal(f.transport.requests.length,0);
  const rows=await f.q('select id,state from finance_job_runs');assert.equal(rows.length,1);assert.equal(rows[0].state,'running');
  const next=await f.run();assert.equal(next.data.operation,'busy');assert.equal(f.transport.posts.length,0);
  const resumed=await f.runVirtual('2026-10-26T12:04:00Z');assert.equal(resumed.http,200);assert.equal((await f.stats()).paid,1);assert.equal(f.transport.posts.length,1);assert.equal((await f.q('select state from finance_job_runs where id=$1',[rows[0].id]))[0].state,'expired');assert.equal((await f.q("select count(*)::int n from finance_journal where kind='payout_confirmed'"))[0].n,1);passed++;
 }
 for(const invalid of['truncated',{},[],1,'true',null,false]){
  await f.seed(1);await f.enable();await f.funds(1000,'2026-10-26T12:00:00Z');
  if(invalid==='truncated')f.transport.invalidRpc='finance_job_allow_submit';else f.transport.allowReply=invalid;
  const result=await f.runVirtual('2026-10-26T12:00:00Z');assert.equal(result.http,200);assert.equal(f.transport.posts.length,0);assert.equal((await f.stats()).paid,0);assert.equal((await f.stats()).sending,1);assert.equal((await f.q('select count(*)::int n from finance_execution_reservations'))[0].n,1);
  const resumed=await f.runVirtual('2026-10-26T12:05:00Z');assert.equal(resumed.http,200);assert.equal((await f.stats()).paid,1);assert.equal(f.transport.posts.length,1);passed++;
 }
 assert.deepEqual(f.transport.blockedNetwork,[]);console.log(`OK ${passed} respuestas incompletas: inicio sin referencia devuelve 503 y conserva la concesión; autorización incompleta conserva fondos y no envía. Recuperación con un único retiro y confirmación contable.`);
}finally{await f.close();}
