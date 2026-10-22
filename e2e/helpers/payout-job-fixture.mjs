// Test-only transport. Every fetch is intercepted; no credentials or real network.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {financeFixture,ADMIN} from './finance-fixture.mjs';
export async function payoutJobFixture(){
 const f=await financeFixture({incidentMigration:true}),folder=mkdtempSync(join(tmpdir(),'payout-load-')),oldFetch=fetch;
 const keys={SUPABASE_URL:'https://database.example.invalid',SUPABASE_ANON_KEY:'TEST_PUBLIC',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_TEST',PAYPAL_ENV:'sandbox',PAYPAL_CLIENT_ID:'TEST_SENDER',PAYPAL_CLIENT_SECRET:'TEST_SECRET',RESEND_API_KEY:'TEST_RESEND',CRON_SECRET:'TEST_CRON',PAYOUT_ALERT_EMAIL:'qa@example.invalid',PAYOUT_AUTOMATION_MODE:undefined,PAYOUT_WORK_LIMIT:undefined};
 const prior=Object.fromEntries(Object.keys(keys).map(k=>[k,process.env[k]]));for(const [k,v]of Object.entries(keys)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 const signatures={finance_job_attempt:['p_run','p_operation','p_reference'],finance_provider_enter:['p_run'],finance_provider_gate:['p_run'],finance_provider_pause:['p_run','p_seconds','p_status'],finance_provider_success:['p_run'],finance_job_start:['p_environment','p_execute'],finance_job_review:['p_run'],finance_job_work:['p_run','p_limit'],finance_job_prepare:['p_run','p_item','p_sender'],finance_job_allow_submit:['p_run','p_user','p_payout','p_sender'],finance_job_item_error:['p_run','p_item','p_message'],finance_job_finish:['p_run','p_summary','p_error'],finance_alert_claim:['p_recipient','p_limit'],finance_alert_finish:['p_id','p_token','p_error'],paypal_payout_claim:['p_user','p_id','p_environment','p_sender'],paypal_payout_submission_result:['p_user','p_id','p_token','p_outcome','p_batch','p_error'],paypal_payout_reconcile_begin:['p_id','p_user','p_environment','p_sender','p_event','p_source'],paypal_payout_reconcile_finish:['p_query','p_response']};
 let state;const resetTransport=()=>state={posts:[],accepted:new Map(),emails:[],pending:new Set(),lost:0,rateLimited:0,mailFail:false,blockedNetwork:[],rpcCalls:0,requests:[],oauth:0,virtualNow:null,latencyMs:0,retryAfter:null,queryFailures:0};resetTransport();
 const response=(http,data)=>new Response(http===204?null:JSON.stringify(data),{status:http,headers:{'content-type':'application/json'}});
 globalThis.fetch=async(input,init={})=>{
  const u=new URL(String(input)),b=typeof init.body==='string'&&init.body.startsWith('{')?JSON.parse(init.body):null;
  if(u.origin==='https://database.example.invalid'){
   if(u.pathname==='/auth/v1/user')return response(init.headers.authorization==='Bearer TEST_ADMIN'?200:401,{id:ADMIN});
   const name=u.pathname.split('/').at(-1);if(name==='is_admin')return response(200,init.headers.authorization==='Bearer TEST_ADMIN');if(name==='log_app_error')return response(204);
   if(Object.hasOwn(signatures,name)){
    state.rpcCalls++;try{const data=await f.db.transaction(async tx=>{await tx.exec('set local role service_role');await tx.query("select set_config('request.jwt.claim.sub','',true)");const args=signatures[name].map(k=>b[k]??null);return(await tx.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as v`,args)).rows[0].v;});if(name==='finance_job_start'&&Object.hasOwn(state,'startReply')){const reply=state.startReply;delete state.startReply;return response(200,reply);}if(state.invalidRpc===name){delete state.invalidRpc;return new Response('{',{status:200});}if(name==='finance_job_allow_submit'&&Object.hasOwn(state,'allowReply')){const reply=state.allowReply;delete state.allowReply;return response(200,reply);}return response(200,data);}catch(e){return response(400,{message:e.message});}
   }
  }
  if(u.origin==='https://api-m.sandbox.paypal.com'){
   state.requests.push({at:state.virtualNow??Date.now(),method:init.method??'GET',path:u.pathname});if(state.virtualNow!==null)state.virtualNow+=state.latencyMs;
   if(u.pathname==='/v1/oauth2/token'){state.oauth++;return response(200,{access_token:'TEST_TOKEN',expires_in:3600});}
   if(u.pathname==='/v1/payments/payouts'&&init.method==='POST'){
    assert.equal(b.items.length,1,'Current executor sends one creator per provider request');assert.match(b.items[0].receiver,/@example\.invalid$/);state.posts.push(b);const id=b.sender_batch_header.sender_batch_id;
    if(state.insufficientAt===state.posts.length)return response(422,{name:'INSUFFICIENT_FUNDS'});
    if(state.pendingAt===state.posts.length)state.pending.add(id);
    if(state.deniedAt===state.posts.length)(state.denied??=new Set()).add(id);
    if(state.accepted.has(id))return response(400,{name:'USER_BUSINESS_ERROR',details:[{field:'SENDER_BATCH_ID',issue:'Batch with given sender_batch_id already exists',link:[{href:`https://api.sandbox.paypal.com/v1/payments/payouts/BATCH-${id}`,method:'GET'}]}]});
    if(state.rateLimited>0){state.rateLimited--;const limited=response(429,{name:'RATE_LIMIT_REACHED',message:'TEST temporary rate limit'});if(state.retryAfter)limited.headers.set('retry-after',state.retryAfter);return limited;}
    state.accepted.set(id,b);if(state.lost>0){state.lost--;throw Error('TEST accepted response lost');}return response(201,{batch_header:{payout_batch_id:'BATCH-'+id}});
   }
   const id=u.pathname.match(/^\/v1\/payments\/payouts\/BATCH-(.*)$/)?.[1];if(id){if(state.queryFailures>0){state.queryFailures--;return response(503,{name:'TEST_UNAVAILABLE'});}const payload=state.accepted.get(id);assert.ok(payload);const p=(await f.q('select fee from payouts where id=$1',[id]))[0];return response(200,{batch_header:{payout_batch_id:'BATCH-'+id,sender_batch_header:payload.sender_batch_header},items:[{...(state.denied?.has(id)&&state.deniedReason?{errors:{name:state.deniedReason}}:{}),payout_item_id:'ITEM-'+id,transaction_status:state.denied?.has(id)?'FAILED':state.pending.has(id)?'PENDING':'SUCCESS',payout_item_fee:{currency:'USD',value:String(state.nativeFee??p.fee)},payout_item:payload.items[0]}]});}
  }
  if(u.href==='https://api.resend.com/emails'){state.emails.push({key:init.headers['idempotency-key'],body:b});return state.mailFail?response(503,{message:'TEST mail unavailable'}):response(200,{id:'TEST_MAIL'});}
  state.blockedNetwork.push(u.origin+u.pathname);throw Error('NETWORK_DISABLED');
 };
 try{
  await build({entryPoints:['api/payout-job.ts'],outfile:join(folder,'job.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
  const api=await import(pathToFileURL(join(folder,'job.mjs')).href);
  const run=async({token='TEST_CRON',method='GET',body={}}={})=>{const r=await api[method](new Request('https://app.example.invalid/api/payout-job',{method,headers:{authorization:'Bearer '+token},...(method==='POST'?{body:JSON.stringify(body)}:{})}));return{http:r.status,data:await r.json()};};
  const runVirtual=async(at)=>{await f.clock(at);state.virtualNow=Date.parse(at);const data=await api.runPayoutReview(process.env.PAYOUT_AUTOMATION_MODE==='sandbox',{clock:{now:()=>state.virtualNow,sleep:async ms=>{state.virtualNow+=ms;}}});return{http:data.ok?200:503,data};};
  const seed=async(count)=>{
   assert.ok(Number.isInteger(count)&&count>0&&count<=1000);await f.reset();resetTransport();delete process.env.PAYOUT_AUTOMATION_MODE;
   await f.q("insert into profiles(id,creator_profile_id,name,role,is_verified,suspended) select ('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'qa-'||i,'Creador QA '||i,'creator',true,false from generate_series(1,$1::integer)i",[count]);
   await f.q("insert into auth.users(id,email,email_confirmed_at)select id,'qa-'||creator_profile_id||'@example.invalid',now()from profiles where creator_profile_id like 'qa-%'");
   await f.q("insert into payout_accounts(user_id,paypal_email)select id,'qa-'||creator_profile_id||'@example.invalid'from profiles where creator_profile_id like 'qa-%'");
   await f.q("insert into transactions(id,creator_profile_id,amount,creator_share,status,created_at)select 'sale-'||creator_profile_id,creator_profile_id,125,.8,'paid','2026-10-25T23:59:59.999-06:00'::timestamptz from profiles where creator_profile_id like 'qa-%'");
   await f.q("insert into transactions(id,creator_profile_id,amount,creator_share,status,created_at)values('next-cycle','qa-1',10,.8,'paid','2026-10-26T00:00:00-06:00')");
  };
  const enable=async()=>{process.env.PAYOUT_AUTOMATION_MODE='sandbox';await f.q("update finance_private.automation_settings set execution_enabled=true,provider_test_reference='TEST fictitious provider only',fee_limit=5");await f.q('update finance_private.settings set batch_handoff_enabled=true');};
  const funds=(amount,at)=>f.rpc('finance_funding_record',[randomUUID(),'sandbox',amount,at,'TEST synthetic balance observation']);
  const stats=async()=>({...(await f.q("select count(*)::integer total,count(*)filter(where status='paid')::integer paid,count(*)filter(where status='sending')::integer sending,coalesce(sum(net)filter(where status='paid'),0)::numeric net from payouts"))[0],accepted:state.accepted.size,posts:state.posts.length,emails:state.emails.length});
  return {...f,seed,enable,funds,run,runVirtual,stats,get transport(){return state;},close:async()=>{globalThis.fetch=oldFetch;for(const[k,v]of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await f.db.close();assert.equal(resolve(folder,'..'),resolve(tmpdir()));rmSync(folder,{recursive:true,force:true});}};
 }catch(e){globalThis.fetch=oldFetch;await f.db.close();throw e;}
}
