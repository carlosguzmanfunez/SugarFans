// Full schema, real local SQL, simulated provider proofs; no external calls.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';import {spawn} from 'node:child_process';
import {createDbTest} from './db-harness.mjs';
assert.ok(['127.0.0.1','localhost'].includes(process.env.PGHOST),'Local PostgreSQL only');
const DB='fr_refund_exceptions_test',h=createDbTest(DB),{psql,as,raises,setup,user,check,finish}=h;
const lit=v=>v==null?'null':"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'";
const sql=(fn,args)=>`select public.${fn}(${args.map(lit).join(',')})`;
const sr=(fn,args)=>JSON.parse(psql(DB,'set role service_role;'+sql(fn,args)));
const admin=(fn,args)=>JSON.parse(as(owner,sql(fn,args)));
const concurrent=statement=>new Promise((yes,no)=>{let out='',err='';const p=spawn('psql',['-X','-q','-At','-v','ON_ERROR_STOP=1','-d',DB],{windowsHide:true,stdio:['pipe','pipe','pipe']});p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',no);p.on('close',c=>c===0?yes(out.trim()):no(Error(err)));p.stdin.end(`set statement_timeout='12s';set role authenticated;set request.jwt.claim.sub=${lit(owner)};`+statement);});
const money=v=>({value:Number(v).toFixed(2),currency_code:'USD'});let owner,creator,fan,cp,seq=0;
const sale=(extra={})=>{const id=randomUUID(),ref='CAP-X-'+(++seq);psql(DB,`insert into transactions(id,key,payer_id,payer_name,creator_profile_id,creator_name,kind,amount,method_label,status,paypal_ref) values(${lit(id)},${lit('tip:'+id)},${lit(fan)},'Fan',${lit(cp)},'Creador','tip',100,'PayPal','paid',${lit(ref)});update transactions set gateway_fee=5,creator_share=.76,service_fee=0,tax_amount=0 where id=${lit(id)};`);if(extra.sql)psql(DB,extra.sql.replaceAll(':id',lit(id)));return {id,ref};};
const refund=(ref,amount,{gross=100,fee=0,id='RF-X-'+(++seq),event='EV-X-'+seq,payment={}}={})=>{
 const body={id:event,event_type:'PAYMENT.CAPTURE.REFUNDED',resource:{id}};
 const proof={id,status:'COMPLETED',amount:money(amount),seller_payable_breakdown:{paypal_fee:money(fee)},links:[{rel:'up',href:'https://api-m.sandbox.paypal.com/v2/payments/captures/'+ref}]};
 const original={id:ref,status:amount===gross?'REFUNDED':'PARTIALLY_REFUNDED',amount:money(gross),...payment};
 const e=sr('paypal_refund_receive',['sandbox','CLIENT-X',body]);const applied=sr('paypal_refund_apply',[e.id,ref,proof,original]);
 const incident=psql(DB,`select id from finance_incidents where code='REFUND_REVIEW' and reference=${lit(e.id)}`);
 return {e,incident,proof,original,body,applied,ref};
};
const preview=(r,service=0,tax=0)=>admin('finance_refund_preview',[r.incident,service,tax]);
const decision=(r,p,key=randomUUID(),service=0,tax=0)=>[r.incident,key,p.hash,service,tax,'QA: comprobantes y contrato','Conciliación supervisada según comprobantes originales.'];
const resolve=(r,p,key,service=0,tax=0)=>admin('finance_refund_resolve',decision(r,p,key,service,tax));
const n=statement=>Number(psql(DB,statement));
finish(async()=>{
 setup();owner=user('exceptions-admin@example.invalid','fan');psql(DB,`update profiles set role='admin' where id=${lit(owner)}`);creator=user('exceptions-creator@example.invalid','creator');fan=user('exceptions-fan@example.invalid','fan');cp=psql(DB,'select creator_profile_id from profiles where id='+lit(creator));
 await check('Special service/tax allocation uses original shares and preserves all sale amounts',()=>{
  const s=sale({sql:'update transactions set gateway_fee=3,service_fee=5,tax_amount=15,creator_share=.77 where id=:id'}),before=psql(DB,"select concat_ws('/',amount,gateway_fee,creator_share,created_at) from transactions where id="+lit(s.id));
  const r=refund(s.ref,20);assert.equal(r.applied.state,'review');let p=preview(r,1,3);assert.equal(p.issue,null);assert.equal(p.items[0].loss,16);
  const key=randomUUID(),args=decision(r,p,key,1,3),a=admin('finance_refund_resolve',args),b=admin('finance_refund_resolve',args);assert.equal(a.id,b.id);
  assert.equal(n('select creator_refund_loss from transactions where id='+lit(s.id)),16);assert.equal(psql(DB,"select concat_ws('/',amount,gateway_fee,creator_share,created_at) from transactions where id="+lit(s.id)),before);
  raises(()=>admin('finance_refund_resolve',decision(r,p,key,0,3)),/reutilizada/,'changed decision key');
  assert.ok(n("select count(*) from finance_payout_holds where user_id="+lit(creator))>0);assert.equal(psql(DB,"select state from finance_incidents where code='DISPUTE_CASE' and reference="+lit(s.id)),'open');
 });
 await check('Invalid component allocations, stale previews and non-admins cannot alter money',()=>{
  const s=sale({sql:'update transactions set service_fee=5,tax_amount=15,creator_share=.75 where id=:id'}),r=refund(s.ref,20);
  assert.match(preview(r,6,0).issue,/supera/);const p=preview(r,1,3);psql(DB,'update transactions set platform_covers=true where id='+lit(s.id));
  raises(()=>resolve(r,p),/cambió/,'stale preview');raises(()=>JSON.parse(as(fan,sql('finance_refund_preview',[r.incident,0,0]))),/admin|Administr|permiso/i,'fan denied');assert.equal(n('select refunded_amount from transactions where id='+lit(s.id)),0);
 });
 await check('Discount refunds use the amount actually paid, not the undiscounted list price',()=>{
  const s=sale(),booking=randomUUID();psql(DB,`insert into vip_bookings(id,experience_id,creator_profile_id,title,creator_name,price,fan_id,fan_name,fan_email,date,time,status,details) values(${lit(booking)},'QA',${lit(cp)},'QA','Creador',90,${lit(fan)},'Fan','fan@example.invalid',current_date+60,'10:00','accepted','{"listPrice":100}');update transactions set kind='vip',key=${lit('vip:'+booking)},amount=90,gateway_fee=3,creator_share=.7511 where id=${lit(s.id)}`);
  const r=refund(s.ref,18,{gross:90}),p=preview(r);assert.equal(p.issue,null);assert.ok(Math.abs(p.items[0].loss-18*90*.7511/87)<.00000001);resolve(r,p);assert.equal(n('select amount from transactions where id='+lit(s.id)),90);
 });
 await check('Missing historical fees remain blocked unless the original provider query proves them',()=>{
  const s=sale({sql:'update transactions set gateway_fee=null where id=:id'}),r=refund(s.ref,20);assert.match(preview(r).issue,/base original/);
  const s2=sale({sql:'update transactions set gateway_fee=null,creator_share=.776 where id=:id'}),r2=refund(s2.ref,20,{payment:{seller_receivable_breakdown:{paypal_fee:money(3)}}});const p=preview(r2);assert.equal(p.issue,null);assert.equal(p.items[0].loss,16);resolve(r2,p);assert.equal(psql(DB,'select gateway_fee is null from transactions where id='+lit(s2.id)),'t');
 });
 let creditFan,creditRef,purchase,gifts;
 await check('Partially refunded Créditos use the wallet first, then only the necessary part of the newest gift',()=>{
  creditFan=user('credit-refund-fan@example.invalid','fan');creditRef='CAP-CREDITS';
  purchase=psql(DB,`insert into coin_purchases(user_id,pack_id,coins,price,method_label,paypal_ref) values(${lit(creditFan)},(select id from coin_packs limit 1),10000,100,'PayPal',${lit(creditRef)}) returning id`);
  gifts=[40,50].map((amount,j)=>psql(DB,`insert into transactions(key,payer_id,payer_name,creator_profile_id,creator_name,kind,amount,creator_share,method_label,status,created_at) values(${lit('gift:qa'+j)},${lit(creditFan)},'Fan',${lit(cp)},'Creador','gift',${amount},.6,'Créditos','paid',now()+interval '${j} seconds') returning id`));
  const r=refund(creditRef,20),p=preview(r);assert.equal(p.issue,null);assert.equal(p.wallet_before,1000);assert.equal(p.wallet_after,0);assert.equal(p.removed_coins,2000);assert.equal(p.items.length,1);assert.equal(p.items[0].transaction,gifts[1]);assert.equal(p.items[0].coins,1000);assert.equal(p.items[0].loss,6);resolve(r,p);assert.equal(n('select coin_balance('+lit(creditFan)+')'),0);assert.equal(n('select creator_refund_loss from transactions where id='+lit(gifts[0])),0);
 });
 await check('Duplicate signed notices and independent concurrent confirmations do not double-deduct',async()=>{
  const r=refund(creditRef,30),p=preview(r),key=randomUUID();assert.equal(p.total_refund,50);assert.equal(p.items[0].loss,24);
  const args=decision(r,p,key);const results=await Promise.all([concurrent(sql('finance_refund_resolve',args)),concurrent(sql('finance_refund_resolve',args))]);assert.equal(JSON.parse(results[0]).id,JSON.parse(results[1]).id);
  const duplicate=sr('paypal_refund_receive',['sandbox','CLIENT-X',{...r.body,id:'EV-DUPLICATE'}]);assert.equal(sr('paypal_refund_apply',[duplicate.id,creditRef,r.proof,r.original]).state,'applied');assert.equal(n('select refunded_coins from coin_purchases where id='+lit(purchase)),5000);assert.equal(n('select coin_balance('+lit(creditFan)+')'),0);
 });
 await check('A later full Créditos refund completes the same accounting without repeating earlier losses',()=>{
  const r=refund(creditRef,50,{payment:{status:'REFUNDED'}}),p=preview(r);assert.equal(p.issue,null);assert.equal(p.full,true);resolve(r,p);
  assert.equal(n('select refunded_coins from coin_purchases where id='+lit(purchase)),10000);assert.equal(psql(DB,'select status from coin_purchases where id='+lit(purchase)),'refunded');assert.equal(n('select sum(creator_refund_loss) from transactions where payer_id='+lit(creditFan)),54);assert.equal(n('select coin_balance('+lit(creditFan)+')'),0);
  assert.equal(psql(DB,'select bool_and(status=\'refunded\') from transactions where payer_id='+lit(creditFan)),'t');
  raises(()=>psql(DB,'update coin_purchases set price=200 where id='+lit(purchase)),/Conservar/,'purchase basis immutable');
 });
 await check('Full contract refund after a partial one includes original service/tax and cancels once',()=>{
  const ref=psql(DB,"select payment_ref from finance_private.refund_exceptions where kind='contract' order by created_at limit 1"),r=refund(ref,80,{payment:{status:'REFUNDED'}});
  // Full refunds use the established ordinary writer; no second supervised debit.
  assert.equal(r.applied.state,'applied');assert.equal(n('select creator_refund_loss from transactions where paypal_ref='+lit(ref)),77);
 });
 await check('Altered duplicate events cannot be approved through the exception form',()=>{
  const s=sale({sql:'update transactions set tax_amount=15,creator_share=.64 where id=:id'}),r=refund(s.ref,20);sr('paypal_refund_receive',['sandbox','CLIENT-X',{...r.body,resource:{id:'DIFFERENT'}}]);assert.match(preview(r).issue,/incongruencia/);
 });
 await check('A total refund arriving before supervised review does not strand the earlier partial notice',()=>{
  const s=sale({sql:'update transactions set service_fee=5,tax_amount=15,creator_share=.75 where id=:id'}),r=refund(s.ref,20);
  assert.equal(refund(s.ref,80,{payment:{status:'REFUNDED'}}).applied.state,'applied');
  const p=preview(r,5,15);assert.equal(p.issue,null);resolve(r,p,undefined,5,15);
  assert.equal(psql(DB,'select state from finance_private.refund_events where id='+lit(r.e.id)),'applied');assert.equal(n('select creator_refund_loss from transactions where id='+lit(s.id)),75);
 });
 await check('Two different concurrent decisions allow one adjustment; the stale operator must reload',async()=>{
  const s=sale({sql:'update transactions set service_fee=5,creator_share=.72 where id=:id'}),r=refund(s.ref,20),p=preview(r);
  const results=await Promise.allSettled([concurrent(sql('finance_refund_resolve',decision(r,p))),concurrent(sql('finance_refund_resolve',decision(r,p)))]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(n("select count(*) from finance_case_actions where action='refund_resolution' and incident_id="+lit(r.incident)),1);
 });
 await check('Historical exceptions can request proof again, but cannot force-approve an inconsistent event',()=>{
  const s=sale({sql:'update transactions set tax_amount=10,creator_share=.68 where id=:id'}),body={id:'EV-HISTORICAL',event_type:'PAYMENT.CAPTURE.REFUNDED',resource:{id:'RF-HISTORICAL'}},e=sr('paypal_refund_receive',['sandbox','CLIENT-X',body]);
  psql(DB,`select finance_private.refund_attention(${lit(e.id)},${lit(s.ref)},'La devolución parcial requiere revisar el contrato, descuento o historial especial')`);
  const incident=psql(DB,"select id from finance_incidents where code='REFUND_REVIEW' and reference="+lit(e.id));assert.equal(admin('finance_refund_preview',[incident,0,0]).can_recheck,true);
  const args=[incident,randomUUID(),'QA: evidencia histórica','Solicitar el comprobante original sin repetir la devolución.'];as(owner,sql('finance_refund_recheck',args));as(owner,sql('finance_refund_recheck',args));assert.equal(psql(DB,'select state from finance_private.refund_events where id='+lit(e.id)),'pending');
  const bad=refund(s.ref,10);sr('paypal_refund_receive',['sandbox','CLIENT-X',{...bad.body,resource:{id:'ALTERED'}}]);raises(()=>as(owner,sql('finance_refund_recheck',[bad.incident,randomUUID(),'QA: evidencia histórica','No debe permitir cambiar un aviso con contenido distinto.'])),/no admite/,'collision cannot requeue');
 });
 await check('Another open wallet dispute prevents a supervised refund from using an unstable balance',()=>{
  const who=user('other-dispute-fan@example.invalid','fan');psql(DB,`insert into coin_purchases(user_id,pack_id,coins,price,method_label,paypal_ref,status) values(${lit(who)},(select id from coin_packs limit 1),10000,100,'PayPal','CAP-WALLET-NEW','paid'),(${lit(who)},(select id from coin_packs limit 1),10000,100,'PayPal','CAP-WALLET-DISPUTED','disputed')`);
  const r=refund('CAP-WALLET-NEW',20);assert.match(preview(r).issue,/otra disputa/);assert.equal(n("select refunded_amount from coin_purchases where paypal_ref='CAP-WALLET-NEW'"),0);
 });
 await check('Two partial Créditos receipts recovered after a full provider refund can reconcile together',()=>{
  const who=user('late-credits@example.invalid','fan');psql(DB,`insert into coin_purchases(user_id,pack_id,coins,price,method_label,paypal_ref) values(${lit(who)},(select id from coin_packs limit 1),10000,100,'PayPal','CAP-LATE-CREDITS')`);
  const first=refund('CAP-LATE-CREDITS',50,{payment:{status:'REFUNDED'}});assert.match(preview(first).issue,/faltan comprobantes/);
  const second=refund('CAP-LATE-CREDITS',50,{payment:{status:'REFUNDED'}}),p=preview(first);assert.equal(p.issue,null);assert.equal(p.full,true);assert.equal(p.total_refund,100);resolve(first,p);
  assert.equal(n('select coin_balance('+lit(who)+')'),0);assert.equal(psql(DB,'select state from finance_private.refund_events where id='+lit(second.e.id)),'applied');
  assert.equal(n("select count(*) from finance_private.refund_receipts where payment_ref='CAP-LATE-CREDITS'"),2);
 });
 await check('Immutable evidence, least privilege, balanced creator books and real-money gates remain intact',()=>{
  for(const role of ['anon','authenticated','service_role'])assert.equal(psql(DB,`select has_table_privilege(${lit(role)},'finance_private.refund_exceptions','SELECT')`),'f');
  raises(()=>psql(DB,"update finance_private.refund_exceptions set amount=1"),/inmutable|immutable|Conservar/i,'evidence immutable');
  assert.equal(psql(DB,'select execution_enabled from finance_private.automation_settings'),'f');assert.equal(psql(DB,'select batch_handoff_enabled from finance_private.settings'),'f');
  assert.equal(n('select count(*) from paypal_payout_submissions'),0);assert.equal(psql(DB,'select coalesce(sum(amount) filter(where debit_account is not null),0)=coalesce(sum(amount) filter(where credit_account is not null),0) from finance_journal'),'t');
 });
});
