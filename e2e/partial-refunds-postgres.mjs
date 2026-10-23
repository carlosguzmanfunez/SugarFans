// Disposable local database, every repository migration, independent connections.
import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
import {createDbTest} from './db-harness.mjs';
assert.ok(['127.0.0.1','localhost'].includes(process.env.PGHOST),'Only a local test database is allowed');
const DB='fr_partial_refunds_test';const {setup,user,psql,check,finish}=createDbTest(DB);
const literal=s=>"'"+String(s).replaceAll("'","''")+"'";
const sr=sql=>psql(DB,'set role service_role;'+sql);
const jsonCall=(name,args)=>`select public.${name}(${args.map(x=>literal(typeof x==='object'?JSON.stringify(x):x)).join(',')})`;
const native=(sql)=>new Promise((yes,no)=>{let out='',err='';const p=spawn('psql',['-X','-q','-At','-v','ON_ERROR_STOP=1','-d',DB],{windowsHide:true,stdio:['pipe','pipe','pipe']});p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',no);p.on('close',code=>code===0?yes(out):no(Error(err)));p.stdin.end('set statement_timeout=\'10s\';set role service_role;'+sql);});
finish(async()=>{
 setup();const creator=user('refund-creator@example.invalid','creator'),fan=user('refund-fan@example.invalid','fan');
 const cp=psql(DB,`select creator_profile_id from public.profiles where id=${literal(creator)}`);
 sr(`select paypal_register('refund-order',${literal(fan)},'tip',${literal(JSON.stringify({creatorProfileId:cp,amount:100}))},100);update paypal_orders set fee=5 where id='refund-order';select paypal_fulfill('refund-order',${literal(fan)},'CAP-NATIVE',100);`);
 psql(DB,"update transactions set created_at='2026-09-20T12:00:00Z' where paypal_ref='CAP-NATIVE'");
 const proof={id:'RF-NATIVE',status:'COMPLETED',amount:{value:'20.00',currency_code:'USD'},seller_payable_breakdown:{paypal_fee:{value:'0.00',currency_code:'USD'}},links:[{rel:'up',href:'https://api-m.sandbox.paypal.com/v2/payments/captures/CAP-NATIVE'}]};
 const payment={id:'CAP-NATIVE',status:'PARTIALLY_REFUNDED',amount:{value:'100.00',currency_code:'USD'}};
 let ids=[];
 await check('Every migration installs together on real PostgreSQL',async()=>{assert.equal(Number(psql(DB,`select creator_available_balance(${literal(creator)})`)),75.44);assert.equal(psql(DB,'select execution_enabled from finance_private.automation_settings'),'f');});
 await check('Two signed notifications for one refund are durably stored',async()=>{ids=[1,2].map(i=>JSON.parse(sr(jsonCall('paypal_refund_receive',['sandbox','QA_CLIENT',{id:'EV-NATIVE-'+i,event_type:'PAYMENT.CAPTURE.REFUNDED',resource:{id:'RF-NATIVE'}}]))).id);assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1]);});
 await check('Independent simultaneous connections apply the same refund only once',async()=>{await Promise.all(ids.map(id=>native(jsonCall('paypal_refund_apply',[id,'CAP-NATIVE',proof,payment]))));assert.equal(Number(psql(DB,`select creator_available_balance(${literal(creator)})`)),59.44);assert.equal(psql(DB,"select count(*) from finance_private.refund_receipts where payment_ref='CAP-NATIVE'"),'1');assert.equal(psql(DB,"select count(*) from finance_private.refund_events where state='applied'"),'2');});
 await check('Original sale basis and journal remain auditable after concurrent retries',async()=>{assert.equal(psql(DB,"select amount||'/'||gateway_fee||'/'||creator_share||'/'||refunded_amount from transactions where paypal_ref='CAP-NATIVE'"),'100.00/5.70/0.7544/20.00');assert.equal(psql(DB,'select coalesce(sum(amount) filter(where debit_account is not null),0)=coalesce(sum(amount) filter(where credit_account is not null),0) from finance_journal'),'t');assert.equal(psql(DB,'select batch_handoff_enabled from finance_private.settings'),'f');});
 await check('Evidence tables have RLS and reject direct access by app roles',async()=>{assert.equal(psql(DB,"select bool_and(relrowsecurity) from pg_class where oid in ('finance_private.refund_events'::regclass,'finance_private.refund_receipts'::regclass)"),'t');for(const role of ['anon','authenticated','service_role'])assert.equal(psql(DB,`select has_table_privilege(${literal(role)},'finance_private.refund_receipts','SELECT')`),'f');});
});
