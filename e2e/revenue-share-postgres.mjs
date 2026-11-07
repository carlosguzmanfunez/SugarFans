// Actual PostgreSQL and all migrations; no network, production or provider money.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {createDbTest} from './db-harness.mjs';
const migration='20261107044223_creator_revenue_70_30.sql';
const exactCentsMigration='20261107063221_income_exact_cents_in_books.sql';
const DB='fr_revenue_share',h=createDbTest(DB),{setup,user,psql,as,raises,check,finish}=h;
const q=v=>"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'";
const get=sql=>JSON.parse(psql(DB,sql));
const newPolicy='revenue-70-30-v1';let creator,fan,legacy,legacyBefore,bookBefore,bookingOld;
const sale=(amount=100,extra={})=>{
 const row={id:randomUUID(),key:'test:'+randomUUID(),payer_id:fan,payer_name:'Fan',creator_profile_id:creator,creator_name:'Creador',kind:'tip',amount,method_label:'QA',status:'paid',...extra};
 psql(DB,`insert into transactions(${Object.keys(row).join(',')})values(${Object.values(row).map(v=>v===null?'null':q(v)).join(',')})`);return row.id;
};
const tx=id=>get(`select json_build_object('gain',round(amount*creator_share,2),'initial',creator_initial_amount,'policy',allocation_policy_version,'fee',gateway_fee,'share',creator_share,'amount',amount) from transactions where id=${q(id)}`);
const basis=id=>psql(DB,`select jsonb_build_object('amount',amount,'share',creator_share,'fee',gateway_fee,'status',status,'created',created_at) from transactions where id=${q(id)}`);
let bookSeq=0;
const booking=()=>psql(DB,`insert into vip_bookings(experience_id,creator_profile_id,title,creator_name,price,fan_id,fan_name,fan_email,date,time,status) values('custom',${q(creator)},'QA','Creador',100,${q(user(randomUUID()+'@test.local','fan'))},'Fan','f@test.local',current_date+${40+bookSeq++},'10:00','accepted') returning id`);
finish(async()=>{
 setup({transformMigration:(name,sql)=>[migration,exactCentsMigration].includes(name)?'':sql});
 creator=user('share-creator@test.local','creator');fan=user('share-fan@test.local','fan');
 legacy=sale();bookingOld=booking();legacyBefore=basis(legacy);
 bookBefore=psql(DB,`select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from finance_journal e`);
 psql(DB,'begin;'+readFileSync(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8')+';commit;');
 psql(DB,'begin;'+readFileSync(new URL('../supabase/migrations/'+exactCentsMigration,import.meta.url),'utf8')+';commit;');
 await check('Migration preserves old sale, ledger entries and balances without a money rewrite',()=>{
  assert.deepEqual(JSON.parse(basis(legacy)),JSON.parse(legacyBefore));assert.equal(tx(legacy).gain,75.44);assert.equal(tx(legacy).initial,null);
  assert.equal(psql(DB,`select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from finance_journal e`),bookBefore);
 });
 await check('One USD100 payment: 5.70 cost + 66.01 creator + 28.29 platform',()=>{
  const t=tx(sale());assert.equal(t.gain,66.01);assert.equal(t.initial,66.01);assert.equal(t.fee,5.7);assert.equal(t.policy,newPolicy);assert.equal(Math.round((100-t.fee-t.gain)*100),2829);
 });
 await check('Four USD25 payments round individually: 65.40 creator, 28.00 platform, 6.60 fee',()=>{
  const c=user('four-payments@test.local','creator'),ids=Array.from({length:4},()=>sale(25,{creator_profile_id:c}));
  const totals=get(`select json_build_object('gain',sum(creator_initial_amount),'fee',sum(gateway_fee),'platform',sum(amount-gateway_fee-creator_initial_amount)) from transactions where id in(${ids.map(q)})`);
  assert.deepEqual(totals,{gain:65.4,fee:6.6,platform:28});
  const b=JSON.parse(as(c,'select public.finance_creator_balance()'));assert.equal(Number(b.total_earned),65.4);
 });
 await check('A legacy half-cent cannot take a cent from a new payment or rewrite the older book entry',()=>{
  const c=user('legacy-half-cent@test.local','creator');
  const old=sale(10,{creator_profile_id:c,created_at:'2026-01-10T12:00:00Z'});
  psql(DB,`update transactions set creator_share=.8005 where id=${q(old)}`);
  const before=psql(DB,`select amount||'/'||revision from finance_sources where kind='transaction' and reference=${q(old)}`);
  assert.equal(Number(before.split('/')[0]),8.01);
  const fresh=sale(9.99,{creator_profile_id:c});assert.equal(tx(fresh).initial,6.41);
  assert.equal(Number(psql(DB,`select amount from finance_sources where kind='transaction' and reference=${q(fresh)}`)),6.41);
  assert.equal(psql(DB,`select amount||'/'||revision from finance_sources where kind='transaction' and reference=${q(old)}`),before);
  const b=JSON.parse(as(c,'select public.finance_creator_balance()'));assert.equal(Number(b.total_earned),14.42);
 });
 await check('Accepted Reserve offer from before the switch keeps its 80% and old rounding',()=>{
  const t=tx(sale(100,{key:'vip:'+bookingOld,kind:'vip'}));assert.equal(t.gain,75.44);assert.equal(t.policy,'revenue-80-20-v1');
 });
 await check('New Reserve freezes its policy and ignores a client attempt to alter it',()=>{
  const b=booking();assert.equal(psql(DB,`select income_policy_version from vip_bookings where id=${q(b)}`),newPolicy);
  raises(()=>psql(DB,`update vip_bookings set income_policy_version='revenue-80-20-v1' where id=${q(b)}`),/Conservar el reparto/,'cambio de oferta');
  assert.equal(tx(sale(100,{key:'vip:'+b,kind:'vip'})).gain,66.01);
 });
 await check('Future referral dates confer no benefit; valid link fan receives 75%',()=>{
  psql(DB,`insert into referrals(fan_id,creator_profile_id,joined_at)values(${q(fan)},${q(creator)},now()+interval '1 day')`);
  assert.equal(tx(sale()).gain,66.01);psql(DB,`update referrals set joined_at=now()-interval '1 day' where fan_id=${q(fan)}`);
  assert.equal(tx(sale()).gain,70.73);psql(DB,`delete from referrals where fan_id=${q(fan)}`);
 });
 await check('Gifts stay 60/40; inviter awards are 100% of their recorded bonus',()=>{
  assert.equal(tx(sale(10,{kind:'gift'})).gain,6);assert.equal(tx(sale(10,{kind:'referral'})).gain,10);
 });
 await check('Link fan plus inviter never exceeds 80% of net, including the rounding cent',()=>{
  const seller=user('cap-seller@test.local','creator'),inviter=user('cap-inviter@test.local','creator');
  psql(DB,`insert into creator_invites(creator_id,creator_profile_id,referrer_profile_id) values(${q(seller)},${q(seller)},${q(inviter)})`);
  sale(100,{creator_profile_id:seller});
  psql(DB,`insert into referrals(fan_id,creator_profile_id,joined_at)values(${q(fan)},${q(seller)},now()-interval '1 day')`);
  const id=sale(100,{creator_profile_id:seller}),t=tx(id),bonus=Number(psql(DB,`select amount from transactions where key=${q('bonus:'+id)}`));
  assert.equal(t.gain,70.73);assert.equal(bonus,4.71);assert.equal(Math.round((t.gain+bonus)*100),7544);
  psql(DB,`delete from referrals where fan_id=${q(fan)}`);
 });
 await check('Stored allocation cannot be forged, repriced or changed by updating the sale',()=>{
  const id=sale(100,{creator_share:.99,creator_initial_amount:99,allocation_policy_version:'revenue-80-20-v1'});assert.equal(tx(id).gain,66.01);
  for(const update of ['creator_share=.8','creator_initial_amount=80',"allocation_policy_version='revenue-80-20-v1'",'amount=101'])raises(()=>psql(DB,`update transactions set ${update} where id=${q(id)}`),/Conservar|original/,'cambiar reparto');
  psql(DB,`update transactions set status='disputed' where id=${q(id)}`);assert.equal(tx(id).initial,66.01);
 });
 await check('Service-fault coverage and refunds retain the saved 70% amount, never a new split',()=>{
  const id=sale();psql(DB,`update transactions set status='refunded',platform_covers=true where id=${q(id)}`);
  assert.equal(tx(id).gain,66.01);psql(DB,`update transactions set status='paid',platform_covers=false where id=${q(id)}`);assert.equal(tx(id).gain,66.01);
 });
 await check('Later actual costs credit or recover the full difference while preserving the original 30% commission',()=>{
  const admin=user('share-cost-admin@test.local','fan');psql(DB,`update profiles set role='admin' where id=${q(admin)}`);
  for(const [fee,delta,expected]of [[3,2.7,68.71],[8,-2.3,63.71]]){
   const c=user(randomUUID()+'@test.local','creator'),ref='QA-CAP-'+randomUUID(),order='QA-ORDER-'+randomUUID();
   psql(DB,`insert into paypal_orders(id,user_id,kind,params,amount,status,capture_id) values(${q(order)},${q(fan)},'tip',${q({creatorProfileId:c})},100,'completed',${q(ref)})`);
   const id=sale(100,{creator_profile_id:c,paypal_ref:ref});assert.equal(tx(id).gain,66.01);
   const context=JSON.parse(as(admin,`select finance_collection_context('sale',${q(id)})`));
   const money=n=>({currency_code:'USD',value:n.toFixed(2)}),resource={id:ref,status:'COMPLETED',amount:money(100),seller_receivable_breakdown:{gross_amount:money(100),paypal_fee:money(fee),net_amount:money(100-fee)}};
   const proof={resource,order:{id:order,purchase_units:[{payments:{captures:[resource]}}]}};
   const stored=get(`set role service_role; select paypal_collection_cost_store('sale',${q(id)},${q(randomUUID())},${q(context.hash)},'sandbox','QA_SHARE',${q(proof)});reset role`);assert.equal(stored.issue,null);
   const preview=JSON.parse(as(admin,`select finance_collection_preview('sale',${q(id)})`));assert.equal(preview.creator_delta,delta);
   as(admin,`select finance_collection_resolve('sale',${q(id)},${q(randomUUID())},${q(preview.hash)},'QA comprobante privado','Diferencia comprobada entre costo estimado y costo real de este pago.')`);
   assert.equal(tx(id).initial,66.01);assert.equal(Math.round((tx(id).initial+delta)*100),Math.round(expected*100));
   assert.equal(Math.round((100-fee-tx(id).initial-delta)*100),2829);
  }
 });
 await check('Private activation and helper functions are inaccessible to signed-in users',()=>{
  raises(()=>as(fan,'select * from finance_private.revenue_policy_activation'),/permission denied/,'activation');
  raises(()=>as(fan,"select finance_private.income_policy(now())"),/permission denied/,'policy');
 });
 await check('Approved provider provision remains 15%, and real payout controls remain disabled',()=>{
  assert.equal(Number(psql(DB,'select fund_pct from infra_settings limit 1')),15);
  const s=get('select json_build_object(\'execute\',execution_enabled,\'handoff\',(select batch_handoff_enabled from finance_private.settings)) from finance_private.automation_settings');assert.deepEqual(s,{execute:false,handoff:false});
 });
 await check('Frontend and PostgreSQL agree on payment sizes, rates and every allocated cent',async()=>{
  const path=join(mkdtempSync(join(tmpdir(),'share-compare-')),'allocation.mjs');await build({entryPoints:[resolve('src/lib/incomeAllocation.ts')],outfile:path,bundle:true,format:'esm',platform:'node',logLevel:'silent'});
  const {allocateCreatorIncome}=await import(pathToFileURL(path));
  for(const amount of [.3,.99,4.99,9.99,25,100,249.99,5000]){
   const c=user(randomUUID()+'@test.local','creator'),r=tx(sale(amount,{creator_profile_id:c}));const js=allocateCreatorIncome({amount,fee:r.fee,rate:.7});assert.equal(r.gain,js.creatorAmount);
  }
 });
});
