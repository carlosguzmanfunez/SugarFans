// Opt-in real Supabase QA authentication and least-privilege acceptance.
// QA keys and the three synthetic accounts must be injected by a secret loader.
// Makes no PayPal, email-provider or production request. Persists test error logs.
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
const QA='https://pcxblbctafwmijfcwgdd.supabase.co';
assert.equal(process.env.FANSRESERVE_QA_URL,QA,'Explicit QA URL required');
assert.equal(process.env.FANSRESERVE_QA_AUTH_TEST,'1','Explicit opt-in required');
const pub=process.env.FANSRESERVE_QA_PUBLISHABLE_KEY;
const legacy=process.env.FANSRESERVE_QA_SERVICE_JWT;
const secret=process.env.FANSRESERVE_QA_SECRET_KEY;
assert.ok(pub?.startsWith('sb_publishable_'));
assert.ok(secret?.startsWith('sb_secret_'));
assert.ok(legacy?.startsWith('eyJ'));
assert.equal(JSON.parse(Buffer.from(legacy.split('.')[1],'base64url')).ref,'pcxblbctafwmijfcwgdd');
const accounts=JSON.parse(process.env.FANSRESERVE_QA_ACCOUNTS_JSON??'null');
assert.ok(Array.isArray(accounts)&&accounts.length===3);
for(const role of ['fan','creator','admin']){
 const u=accounts.find(a=>a.role===role);
 assert.ok(u?.email?.startsWith('qa113-')&&u.email.endsWith('@example.invalid')&&u.password&&u.id,'Dedicated synthetic accounts required');
}
const nativeFetch=globalThis.fetch.bind(globalThis);
const qaFetch=(input,init)=>{
 const url=new URL(typeof input==='string'?input:input.url??String(input));
 assert.equal(url.origin,QA,'Requests may only reach the QA project');
 return nativeFetch(input,{...init,redirect:'error',signal:AbortSignal.timeout(20000)});
};
const client=key=>createClient(QA,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:qaFetch}});
const service=client(legacy);
let passed=0;
const check=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
for(const [format,key] of [['legacy',legacy],['secret',secret],['visitor',pub]]){
 for(const source of ['api','email'])await check(`${format}: clasificación ${source}`,async()=>{
  const message=`QA113 ${format} ${source} ${randomUUID()}`;
  const logged=await client(key).rpc('log_app_error',{p_source:source,p_message:message});assert.equal(logged.error,null);
  const row=await service.from('app_errors').select('source').eq('message',message).single();assert.equal(row.error,null);
  assert.equal(row.data.source,format==='visitor'?'web':source);
 });
}
for(const u of accounts)await check(`Sesión real y permisos de ${u.role}`,async()=>{
 const c=client(pub);
 try{
  const signed=await c.auth.signInWithPassword({email:u.email,password:u.password});assert.equal(signed.error,null);
  const verified=await c.auth.getUser();assert.equal(verified.error,null);assert.equal(verified.data.user.id,u.id);
  const profile=await c.from('profiles').select('role').eq('id',u.id).single();assert.equal(profile.error,null);assert.equal(profile.data.role,u.role);
  const finance=await c.rpc('finance_collection_context',{p_kind:'sale',p_id:'00000000-0000-4000-8000-000000000999'});
  assert.equal(Boolean(finance.error),u.role!=='admin');
  const payout=await c.rpc('paypal_payout_begin',{p_user:u.id,p_environment:'sandbox',p_sender:'QA113'});assert.ok(payout.error);
  const message=`QA113 ${u.role} spoof ${randomUUID()}`;
  assert.equal((await c.rpc('log_app_error',{p_source:'api',p_message:message})).error,null);
  const row=await service.from('app_errors').select('source').eq('message',message).single();assert.equal(row.error,null);assert.equal(row.data.source,'web');
 }finally{await c.auth.signOut();}
});
await check('El visitante no consulta reservas ni importes del ranking privado',async()=>{
 const c=client(pub),rows=await c.from('vip_bookings').select('id').limit(1);assert.equal(rows.error,null);assert.equal(rows.data.length,0);
 const rank=await c.rpc('top_fans',{p_creator_profile_id:accounts.find(a=>a.role==='creator').id});assert.ok(rank.error);
});
console.log(`${passed}/${passed} QA checks; no PayPal or production requests`);
