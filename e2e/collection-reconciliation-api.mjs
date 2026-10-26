// Real API handler and SQL, simulated PayPal; every outside request is blocked.
import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{build}from'esbuild';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{pathToFileURL}from'node:url';import{createDbTest}from'./db-harness.mjs';
assert.ok(['127.0.0.1','localhost'].includes(process.env.PGHOST));const DB='fr_collection_cost_api_test',h=createDbTest(DB),{setup,user,psql,as,check,finish}=h;
const lit=v=>v==null?'null':"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'",call=(n,args)=>'select public.'+n+'('+args.map(lit).join(',')+')';
const temp=mkdtempSync(join(tmpdir(),'fr-cost-api-')),realFetch=globalThis.fetch,provider=new Map(),requests=[];let admin,fan,creator,cp,POST;
const money=value=>({value:value.toFixed(2),currency_code:'USD'});
const native=(ref,order,fee=3)=>({resource:{id:ref,status:'COMPLETED',amount:money(100),seller_receivable_breakdown:{gross_amount:money(100),paypal_fee:money(fee),net_amount:money(100-fee)},private_provider_data:'DO_NOT_EXPORT'},order:{id:order,purchase_units:[{payments:{captures:[{id:ref,status:'COMPLETED',amount:money(100),seller_receivable_breakdown:{paypal_fee:money(fee)}}]}}]}});
function fixture(kind='coins'){
 const id=randomUUID(),ref='API-COST-'+randomUUID(),order='API-ORDER-'+randomUUID(),pack=psql(DB,'select id from coin_packs limit 1');
 psql(DB,`insert into paypal_orders(id,user_id,kind,params,amount,status,capture_id)values(${lit(order)},${lit(fan)},${lit(kind==='coins'?'coins':'tip')},${lit(kind==='coins'?{packId:pack}:{creatorProfileId:cp})},100,'completed',${lit(ref)})`);
 if(kind==='coins')psql(DB,`insert into coin_purchases(id,user_id,pack_id,coins,price,method_label,paypal_ref)values(${lit(id)},${lit(fan)},${lit(pack)},10000,100,'QA',${lit(ref)})`);
 else psql(DB,`insert into transactions(id,key,payer_id,payer_name,creator_profile_id,creator_name,kind,amount,method_label,status,paypal_ref)values(${lit(id)},${lit('api:'+id)},${lit(fan)},'Fan',${lit(cp)},'Creador','tip',100,'QA','paid',${lit(ref)});update transactions set gateway_fee=5.7,creator_share=.7544 where id=${lit(id)}`);
 const proof=native(ref,order);provider.set('/v2/payments/captures/'+ref,proof.resource);provider.set('/v2/checkout/orders/'+order,proof.order);return{kind,id,ref,order,proof};
}
const request=(s,token='QA_ADMIN',key=randomUUID())=>POST(new Request('https://local.invalid/api/payout-job',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action:'collection-cost',kind:s.kind,source:s.id,key})}));
process.on('exit',()=>{globalThis.fetch=realFetch;rmSync(temp,{recursive:true,force:true});});
finish(async()=>{
 setup();admin=user('api-cost-admin@example.invalid','fan');fan=user('api-cost-fan@example.invalid','fan');creator=user('api-cost-creator@example.invalid','creator');psql(DB,'update profiles set role=\'admin\'where id='+lit(admin));cp=psql(DB,'select creator_profile_id from profiles where id='+lit(creator));
 Object.assign(process.env,{SUPABASE_URL:'https://cost-db.invalid',SUPABASE_ANON_KEY:'qa-public-key',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_qa_cost_only',PAYPAL_ENV:'sandbox',PAYPAL_CLIENT_ID:'QA_COST_APP',PAYPAL_CLIENT_SECRET:'QA_FAKE_SECRET',RESEND_API_KEY:''});
 globalThis.fetch=async(input,init={})=>{
  const u=new URL(typeof input==='string'?input:input.url),method=init.method??'GET',headers=new Headers(init.headers),body=init.body?JSON.parse(String(init.body).startsWith('{')?String(init.body):'{}'):{};
  if(u.origin==='https://cost-db.invalid'){
   const actor=headers.get('authorization')==='Bearer QA_ADMIN'?admin:headers.get('authorization')==='Bearer QA_FAN'?fan:null;
   if(u.pathname==='/auth/v1/user')return Response.json(actor?{id:actor}:{error:'No session'},{status:actor?200:401});
   if(u.pathname.startsWith('/rest/v1/rpc/')){const name=u.pathname.split('/').at(-1);try{
    if(name==='is_admin')return Response.json(actor===admin);
    const args=Object.values(body),sql=call(name,args),result=headers.get('apikey')==='sb_secret_qa_cost_only'?psql(DB,'set role service_role;'+sql):as(actor,sql);
    return Response.json(JSON.parse(result));
   }catch(error){return Response.json({message:error.message},{status:400});}}
  }
  if(u.origin==='https://api-m.sandbox.paypal.com'){
   requests.push({path:u.pathname,method});
   if(u.pathname==='/v1/oauth2/token'){assert.equal(method,'POST');return Response.json({access_token:'QA_TOKEN',expires_in:60});}
   assert.equal(method,'GET','Cost lookup must never execute a monetary provider POST');const value=provider.get(u.pathname+u.search)??provider.get(u.pathname);return Response.json(value??{error:'Missing simulated resource'},{status:value?200:404});
  }
  throw Error('Outside request blocked: '+u.origin+u.pathname);
 };
 const file=join(temp,'api.mjs');await build({entryPoints:[resolve('api/payout-job.ts')],outfile:file,bundle:true,platform:'node',format:'esm',logLevel:'silent'});({POST}=await import(pathToFileURL(file).href));
 await check('An authenticated administrator can query a Créditos receipt through the actual API and database',async()=>{const s=fixture(),before=psql(DB,'select coin_balance('+lit(fan)+')'),r=await request(s),data=await r.json();assert.equal(r.status,200);assert.equal(data.issue,null);assert.ok(data.receipt);assert.equal(psql(DB,'select coin_balance('+lit(fan)+')'),before);assert.ok(!JSON.stringify(data).includes('DO_NOT_EXPORT'));});
 await check('A fan or expired session is rejected before any provider request',async()=>{const s=fixture(),count=requests.length;assert.equal((await request(s,'QA_FAN')).status,403);assert.equal((await request(s,'EXPIRED')).status,401);assert.equal(requests.length,count);});
 await check('Invalid targets and unknown original references cannot be used to query arbitrary PayPal resources',async()=>{const s=fixture(),count=requests.length;assert.equal((await request({...s,id:'../../OTHER'})).status,503);const r=await request({kind:'sale',id:randomUUID()});assert.match((await r.json()).issue,/No encontramos/);assert.equal(requests.length,count);});
 await check('A historical cash query keeps the original earning and only stores its cost evidence',async()=>{const s=fixture('sale'),before=psql(DB,'select row_to_json(t)from transactions t where id='+lit(s.id));assert.equal((await request(s)).status,200);assert.equal(psql(DB,'select row_to_json(t)from transactions t where id='+lit(s.id)),before);assert.equal(psql(DB,'select count(*)from finance_adjustments'),'0');});
 await check('Repeated cost requests preserve their reference without generating purchases or credits',async()=>{const s=fixture(),key=randomUUID(),first=await(await request(s,'QA_ADMIN',key)).json(),again=await(await request(s,'QA_ADMIN',key)).json();assert.deepEqual(again,first);assert.equal(psql(DB,'select count(*)from finance_private.collection_cost_queries where request_key='+lit(key)),'1');});
 await check('Provider failure leaves the original purchase untouched and is recoverable',async()=>{const s=fixture(),before=psql(DB,'select row_to_json(c)from coin_purchases c where id='+lit(s.id));provider.delete('/v2/payments/captures/'+s.ref);assert.equal((await request(s)).status,503);assert.equal(psql(DB,'select row_to_json(c)from coin_purchases c where id='+lit(s.id)),before);provider.set('/v2/payments/captures/'+s.ref,s.proof.resource);assert.equal((await(await request(s)).json()).issue,null);});
 await check('Subscription fees can be confirmed from the authenticated transaction history when the sale omits its fee',async()=>{
  const id=randomUUID(),ref='SALE-API-HISTORY',sub='I-API-COST',at=new Date().toISOString();psql(DB,'set role service_role;'+call('paypal_subscription_register',[sub,fan,cp,100,null]));
  psql(DB,`insert into transactions(id,key,payer_id,payer_name,creator_profile_id,creator_name,kind,amount,method_label,status,paypal_ref)values(${lit(id)},${lit('paypal-sub:'+sub+':'+ref)},${lit(fan)},'Fan',${lit(cp)},'Creador','subscription',100,'QA','paid',${lit(ref)})`);
  provider.set('/v1/payments/sale/'+ref,{id:ref,state:'completed',amount:{total:'100.00',currency:'USD'},create_time:at});provider.set('/v1/billing/subscriptions/'+sub,{id:sub,custom_id:fan+':'+cp});
  provider.set('/v1/billing/subscriptions/'+sub+'/transactions',{transactions:[{id:ref,status:'COMPLETED',amount_with_breakdown:{gross_amount:money(100),fee_amount:money(3),net_amount:money(97)}}]});
  const r=await request({kind:'sale',id});assert.equal(r.status,200);assert.equal((await r.json()).issue,null);assert.equal(psql(DB,'select fee from finance_private.collection_receipts where reference='+lit(ref)),'3.00');
 });
 await check('No cost query calls checkout, refunds, subscription cancellation, Payouts or the income executor',()=>{assert.equal(requests.filter(r=>r.method!=='GET'&&r.path!=='/v1/oauth2/token').length,0);assert.equal(psql(DB,'select count(*)from payouts'),'0');assert.equal(psql(DB,'select count(*)from finance_private.income_events'),'0');assert.equal(psql(DB,'select count(*)from finance_adjustments'),'0');assert.equal(psql(DB,'select execution_enabled from finance_private.automation_settings'),'f');assert.equal(psql(DB,'select batch_handoff_enabled from finance_private.settings'),'f');});
});
