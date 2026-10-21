// Full scheduled worker + SQL; every provider, mail and database fetch is intercepted.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {payoutJobFixture} from './helpers/payout-job-fixture.mjs';
import {ADMIN,CREATOR} from './helpers/finance-fixture.mjs';
const f=await payoutJobFixture(),out=resolve('../../outputs/lotes-espejo'),results=[];mkdirSync(out,{recursive:true});
const record=(name,data)=>{results.push({name,...data});console.log('OK '+name+' '+JSON.stringify(data));};
const snapshot=async()=>({journal:(await f.q('select count(*)::integer n from finance_journal'))[0].n,payouts:(await f.stats()).total,posts:f.transport.posts.length});
try{
 await f.seed(1000);await f.enable();await f.funds(103000,'2026-10-26T12:00:00Z');process.env.PAYOUT_WORK_LIMIT='50';
 await f.q("update profiles set is_verified=false where creator_profile_id='qa-1'");
 const j=await f.rpc('finance_job_start',['sandbox',true]);await f.rpc('finance_job_work',[j.id,50]);
 const initial=await f.rpc('finance_payout_groups',[null]);assert.equal(initial.groups.length,20);assert.ok(initial.groups.every(g=>g.total===50));
 const members=await f.q('select item_id,group_id,position from finance_private.payout_group_members order by item_id');assert.equal(members.length,1000);assert.equal(new Set(members.map(m=>m.item_id)).size,1000);
 const before=await snapshot();await f.q('select finance_private.group_batch($1)',[initial.batch]);assert.deepEqual(await f.q('select item_id,group_id,position from finance_private.payout_group_members order by item_id'),members);assert.deepEqual(await snapshot(),before);
 await assert.rejects(()=>f.q('update finance_private.payout_group_members set position=position'),/inmutable|historial|immutable/i);
 record('Mil creadores tienen veinte grupos estables de cincuenta; crear su espejo no duplica dinero',{groups:20,members:1000,extraPayouts:0,extraJournalEntries:0});

 const item=(await f.q("select i.* from finance_batch_items i join profiles u on u.id=i.user_id where u.creator_profile_id='qa-2'"))[0];
 const prepared=await f.rpc('finance_job_prepare',[j.id,item.id,'TEST_SENDER']);const claim=await f.rpc('paypal_payout_claim',[item.user_id,prepared.id,'sandbox','TEST_SENDER']);
 await f.rpc('paypal_payout_submission_result',[item.user_id,prepared.id,claim.token,'accepted','BATCH-'+prepared.id,null]);f.transport.accepted.set(prepared.id,claim.payload);f.transport.pending.add(prepared.id);
 await f.q("update profiles set is_verified=false where creator_profile_id='qa-3'");await f.rpc('finance_job_finish',[j.id,{},null]);
 const query=await f.rpc('paypal_payout_reconcile_begin',[prepared.id,null,'sandbox','TEST_SENDER',null,'poll']);assert.equal(query.operation,'query');
 const mismatch=await f.rpc('paypal_payout_reconcile_finish',[query.query,{http:200,data:{batch_header:{payout_batch_id:'CONTRADICTORY-BATCH',sender_batch_header:claim.payload.sender_batch_header},items:[{payout_item_id:'ITEM-'+prepared.id,transaction_status:'SUCCESS',payout_item:claim.payload.items[0]}]}}]);assert.equal(mismatch.outcome,'review');
 const disputed=await f.rpc('finance_payout_group',[initial.groups[0].id]),problem=disputed.members.find(m=>m.payout===prepared.id);assert.equal(problem.status,'review');assert.match(problem.reason,/conciliación humana/);assert.equal((await f.q('select status from payouts where id=$1',[prepared.id]))[0].status,'sending');
 record('Una respuesta contradictoria queda en revisión y conserva el dinero apartado',{status:'review',fundsRetained:true});
 let rounds=0;while(Number((await f.stats()).paid)<997&&rounds<30){const r=await f.runVirtual(new Date(Date.parse('2026-10-26T12:00:00Z')+rounds*300000).toISOString());assert.equal(r.http,200,JSON.stringify(r));rounds++;if(rounds%5===0)console.log('Avance: '+(await f.stats()).paid+'/997 pagos sanos');}
 assert.equal(Number((await f.stats()).paid),997);
 await f.auth(ADMIN);const list=await f.rpc('finance_payout_groups',[initial.batch]),details={};for(const g of list.groups)details[g.id]=await f.rpc('finance_payout_group',[g.id]);
 const first=list.groups[0],mirror=details[first.id].members.filter(r=>r.status==='pending'||r.status==='review');assert.deepEqual([first.paid,first.pending,first.review,first.ready],[47,1,2,0]);assert.equal(mirror.length,3);assert.ok(mirror.every(r=>r.reason&&r.next_step));assert.ok(list.groups.slice(1).every(g=>g.paid===50&&g.pending===0&&g.review===0));
 const serialized=JSON.stringify({list,details});assert.ok(!serialized.includes('@example.invalid'));assert.ok(!serialized.includes('request_body'));assert.equal(new Set(Object.values(details).flatMap(d=>d.members.map(r=>r.item))).size,1000);
 writeFileSync(resolve(out,'fixture.json'),JSON.stringify({list,details},null,2));record('El lote 01 paga 47 y su espejo contiene tres casos; los otros diecinueve grupos pagan sus cincuenta',{healthyPaid:997,firstGroupPaid:47,firstMirror:3,otherGroupsComplete:19,rounds});
 const financialBeforeRead=await snapshot();await f.rpc('finance_payout_groups',[initial.batch]);await f.rpc('finance_payout_group',[first.id]);assert.deepEqual(await snapshot(),financialBeforeRead);
 f.transport.pending.clear();await f.q("update profiles set is_verified=true where creator_profile_id='qa-3'");
 const r=await f.runVirtual(new Date(Date.parse('2026-10-26T12:00:00Z')+(rounds+1)*300000).toISOString());assert.equal(r.http,200);assert.equal(Number((await f.stats()).paid),999);
 const after=await f.rpc('finance_payout_group',[first.id]);assert.equal(after.members.filter(m=>m.status==='paid').length,49);assert.equal(after.members.filter(m=>m.status==='review').length,1);assert.equal(after.members.find(m=>m.payout===prepared.id).status,'paid');assert.deepEqual(after.members.map(m=>m.item),details[first.id].members.map(m=>m.item));assert.equal(f.transport.posts.filter(p=>p.sender_batch_header.sender_batch_id===prepared.id).length,0);
 record('Confirmar o corregir un caso reduce el espejo conservando grupo y retiro original',{firstGroupPaid:49,remainingMirror:1,resentAcceptedPayouts:0});

 await f.auth(CREATOR);for(const name of['finance_payout_groups','finance_payout_group'])await assert.rejects(()=>f.rpc(name,[name.endsWith('groups')?initial.batch:first.id]),/administrador|administrativa|administrativo/i);await f.auth(ADMIN);
 for(const role of['anon','authenticated','service_role']){await f.db.exec('set role '+role);try{for(const table of['payout_groups','payout_group_members'])await assert.rejects(()=>f.q('select * from finance_private.'+table),/permission denied/);}finally{await f.db.exec('reset role');}}
 assert.equal((await f.q("select has_function_privilege('anon','public.finance_payout_groups(uuid)','execute')v"))[0].v,false);
 await assert.rejects(()=>f.rpc('finance_payout_group',['00000000-0000-0000-0000-000000000000']),/Grupo no encontrado/);
 record('Consulta administrativa de solo lectura; membresías privadas e inmutables',{clientTableAccess:false,fanCreatorReportAccess:false,reportFinancialWrites:0});
 assert.deepEqual(f.transport.blockedNetwork,[]);writeFileSync(resolve(out,'RESULTADOS.json'),JSON.stringify({at:new Date().toISOString(),mode:'virtual',nativeProviderCalls:0,productionChanges:0,results},null,2));console.log(results.length+' comprobaciones completas de lotes y espejos satisfactorias.');
}finally{await f.close();}
