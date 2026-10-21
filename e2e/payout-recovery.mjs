// Actual API + SQL migrations on disposable PostgreSQL. Every fetch is mocked.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { build } from 'esbuild';
import { payoutEventCases } from './payout-event-cases.mjs';

const dir=mkdtempSync(join(tmpdir(),'fans-payout-recovery-')),db=new PGlite(),oldFetch=globalThis.fetch;
const withLedger=process.env.TEST_FINANCE_LEDGER==='1';
const user='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002';
const sender='TEST_ONLY_CLIENT',q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const source=name=>readFileSync(resolve('supabase/migrations',name),'utf8');
const calendar=source('20261019194731_earnings_calendar_26_25.sql');
const migration=source('20261019220609_payout_submission_recovery.sql');
const markSql=source('20261003000007_paypal_payouts.sql').match(/create or replace function public\.paypal_payout_mark\([\s\S]*?\$\$;/i)[0];
const clock=at=>q("select set_config('test.clock',$1,false)",[at]);
const advance=async(ms=180000)=>{const at=(await q("select current_setting('test.clock') as at"))[0].at;await clock(new Date(Date.parse(at)+ms).toISOString());};
const balance=async()=>Number((await q('select creator_available_balance($1) as n',[user]))[0].n);
const rows=()=>q('select * from payouts order by requested_at,id');
const current=async()=>{const r=await rows();assert.equal(r.length,1);return r[0];};
const submission=async()=>{const r=await q('select * from paypal_payout_submissions');assert.equal(r.length,1);return r[0];};
const begin=async()=> (await q('select paypal_payout_begin($1,$2,$3) as v',[user,'sandbox',sender]))[0].v;
const claim=async(id,who=user,mode='sandbox',client=sender)=>(await q('select paypal_payout_claim($1,$2,$3,$4) as v',[who,id,mode,client]))[0].v;
const finish=async(id,token,outcome,batch=null)=>(await q('select paypal_payout_submission_result($1,$2,$3,$4,$5,$6) as v',[user,id,token,outcome,batch,'TEST_RESULT']))[0].v;
const response=(status,data)=>status===204?new Response(null,{status}):new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
// Error shape observed in Sandbox. Native QA also confirmed the api.* alias
// in nested links returned to requests sent to api-m.*. IDs remain test values.
const duplicateV1Fixture=JSON.parse(readFileSync(resolve('e2e/fixtures/paypal-duplicate-batch-v1.json'),'utf8'));
const duplicateV1=id=>{
  const error=structuredClone(duplicateV1Fixture);
  error.details[0].link[0].href=`https://api.sandbox.paypal.com/v1/payments/payouts/BATCH-${id}`;
  return error;
};
let state,passed=0;
const reset=async()=>{
  process.env.PAYPAL_ENV='sandbox';
  const financeTables=withLedger?'finance_allocations,finance_source_revisions,finance_journal,finance_adjustments,finance_sources,finance_batch_items,finance_batches,':'';
  await db.exec(`reset role;truncate ${financeTables}paypal_payout_reconciliations,paypal_payout_events,paypal_payout_submissions,payouts,transactions,profiles,payout_accounts,account_restrictions`);
  await clock('2026-10-26T12:00:00Z');
  await q("insert into profiles values($1,'creator','Creator','creator',true,false)",[user]);
  await q("insert into payout_accounts values($1,'original@example.invalid')",[user]);
  await q("insert into transactions values('sale','creator',200,.8,'paid',false,'2026-10-20T12:00:00Z')");
  state={mode:'success',accepted:new Map(),posts:[],gets:[],saveFailures:0,lostSaveAck:false,getFailure:false,status:'SUCCESS',mutate:null,badLink:false,badHeader:false,unexpected:[]};
};
const check=async(name,fn)=>{await reset();await fn();assert.deepEqual(state.unexpected,[]);passed++;console.log(`OK ${name}`);};
globalThis.fetch=async()=>{throw new Error('NETWORK_DISABLED');};
Object.assign(process.env,{SUPABASE_URL:'https://database.example.invalid',SUPABASE_ANON_KEY:'TEST_ONLY_PUBLIC',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_test_only',PAYPAL_ENV:'sandbox',PAYPAL_CLIENT_ID:sender,PAYPAL_CLIENT_SECRET:'TEST_ONLY_NOT_A_SECRET',PAYPAL_WEBHOOK_ID:'WH_TEST_ONLY'});
delete process.env.RESEND_API_KEY;
try {
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create or replace function pg_catalog.now() returns timestamptz language sql stable as $$select current_setting('test.clock')::timestamptz$$;
    create table profiles(id uuid primary key,creator_profile_id text,name text,role text,is_verified boolean,suspended boolean);
    create table payout_accounts(user_id uuid primary key,paypal_email text);
    create table account_restrictions(user_id uuid primary key,payouts_frozen boolean);
    create table transactions(id text primary key,creator_profile_id text,amount numeric,creator_share numeric,status text,platform_covers boolean,created_at timestamptz);
    create table payouts(id uuid primary key default gen_random_uuid(),user_id uuid,creator_name text,amount numeric,fee numeric,net numeric,account_label text,available_before numeric,status text,paid_at timestamptz,requested_at timestamptz default now(),scheduled_for date,paypal_batch_id text,paypal_item_id text,error text);
    create function is_suspended(p_user uuid) returns boolean language sql stable as $$select suspended from public.profiles where id=p_user$$;
    create function payout_min(p_user uuid) returns numeric language sql stable as $$select 50::numeric$$;
    create function payout_fee_for(p_user uuid,p_amount numeric) returns numeric language sql immutable as $$select least(round(p_amount*.02,2),20)$$;
    create function payout_label(p_email text) returns text language sql immutable as $$select 'TEST ONLY'::text$$;
  `);
  await clock('2026-10-19T12:00:00Z');await db.exec(calendar);await db.exec(source('20261019215002_disable_simulated_payout_fallback.sql'));await db.exec(markSql);await db.exec(migration);
  await db.exec(source('20261020015716_payout_event_reconciliation.sql'));
  if(withLedger){
    await db.exec("create function is_admin() returns boolean language sql stable security definer set search_path='' as $$select coalesce((select role='admin' from public.profiles where id=auth.uid()),false)$$");
    await db.exec(source('20261020032222_creator_ledger_batch_reservations.sql'));
  }
  const notificationSql=source('20261020231703_payout_notification_wording.sql');
  await db.exec(withLedger ? notificationSql : notificationSql.match(/create or replace function public\.paypal_payout_begin\([\s\S]*?\$\$;/i)[0]);
  await build({entryPoints:['api/paypal.ts'],outfile:join(dir,'paypal.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
  const api=await import(pathToFileURL(join(dir,'paypal.mjs')).href);
  globalThis.fetch=async(url,init={})=>{
    const u=new URL(String(url)),body=typeof init.body==='string'&&init.body.startsWith('{')?JSON.parse(init.body):null;
    if(u.origin==='https://database.example.invalid') {
      if(u.pathname==='/auth/v1/user')return response(200,{id:user});
      if(u.pathname==='/rest/v1/payouts')return response(200,(await rows()).filter(p=>p.user_id===user&&p.status==='sending'));
      const name=u.pathname.split('/').at(-1);
      if(name==='log_app_error')return response(204);
      try {
        const signatures={
          paypal_payout_event_receive:['p_environment','p_sender','p_event'],
          paypal_payout_reconcile_begin:['p_id','p_user','p_environment','p_sender','p_event','p_source'],
          paypal_payout_reconcile_finish:['p_query','p_response'],
          paypal_payout_event_pending:['p_user'],
        };
        if(signatures[name]) {
          state.rpcCalls??=[];state.rpcCalls.push(name);
          if(state.failRpc===name){state.failRpc=null;return response(503,{message:'TEST journal unavailable'});}
          const args=signatures[name].map(k=>body[k]);
          const result=(await q(`select ${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as v`,args))[0].v;
          if(state.loseAckRpc===name){state.loseAckRpc=null;return response(503,{message:'TEST journal committed, acknowledgment lost'});}
          return response(200,result);
        }
        if(name==='paypal_payout_begin')return response(200,(await q('select paypal_payout_begin($1,$2,$3) as v',[body.p_user,body.p_environment,body.p_sender]))[0].v);
        if(name==='paypal_payout_claim')return response(200,(await q('select paypal_payout_claim($1,$2,$3,$4) as v',[body.p_user,body.p_id,body.p_environment,body.p_sender]))[0].v);
        if(name==='paypal_payout_submission_result') {
          if(state.saveFailures){state.saveFailures--;return response(503,{message:'TEST database write unavailable'});}
          const saved=(await q('select paypal_payout_submission_result($1,$2,$3,$4,$5,$6) as v',[body.p_user,body.p_id,body.p_token,body.p_outcome,body.p_batch,body.p_error]))[0].v;
          if(state.lostSaveAck){state.lostSaveAck=false;return response(503,{message:'TEST database committed but response lost'});}
          return response(200,saved);
        }
        if(name==='paypal_payout_mark'){await q('select paypal_payout_mark($1,$2,$3,$4,$5)',[body.p_id,body.p_status,body.p_batch_id,body.p_item_id,body.p_error]);return response(204);}
      }catch(error){return response(400,{message:error.message});}
    }
    if(u.origin===(process.env.PAYPAL_ENV==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com')) {
      if(u.pathname==='/v1/oauth2/token')return response(200,{access_token:'TEST_ONLY_TOKEN'});
      if(u.pathname==='/v1/notifications/verify-webhook-signature')return response(200,{verification_status:state.badSignature?'FAILURE':'SUCCESS'});
      if(u.pathname.endsWith('/cancel')) {
        state.cancelCalls=(state.cancelCalls??0)+1;
        if(state.status==='UNCLAIMED')state.status='RETURNED';
        if(state.cancelLost)throw new TypeError('TEST cancellation acknowledgment lost');
        return response(200,{transaction_status:state.status});
      }
      if(u.pathname==='/v1/payments/payouts'&&init.method==='POST') {
        assert.ok(init.signal instanceof AbortSignal,'Payout request needs a bounded network timeout');
        state.posts.push(body);const id=body.sender_batch_header.sender_batch_id;
        if(state.mode==='rejected')return response(422,{name:'INSUFFICIENT_FUNDS'});
        if(state.mode==='before-acceptance')throw new TypeError('TEST network before acceptance');
        if(state.accepted.has(id)) {
          if(state.mode==='lost-all')throw new TypeError('TEST lost duplicate response');
          if(state.duplicateResponse)return response(400,state.duplicateResponse(id));
          return response(400,{name:'VALIDATION_ERROR',details:[{issue:'DUPLICATE_BATCH_ID'}],links:[{rel:'original',href:`${state.badLink?'https://foreign.example.invalid':'https://api-m.sandbox.paypal.com'}/v1/payments/payouts/BATCH-${id}`,method:'GET'}]});
        }
        state.accepted.set(id,body);
        if(state.mode==='disconnected'||state.mode==='lost-all')throw new TypeError('TEST response lost AFTER acceptance');
        if(state.mode==='503')return response(503,{name:'SERVICE_UNAVAILABLE'});
        if(state.mode==='without-id')return response(201,{});
        if(state.mode==='malformed-json')return new Response('{',{status:201});
        return response(201,{batch_header:{payout_batch_id:`BATCH-${id}`,batch_status:'PENDING'}});
      }
      const match=u.pathname.match(/^\/v1\/payments\/payouts\/BATCH-(.*)$/);
      if(match) {
        state.gets.push(u.href);if(state.getFailure)throw new TypeError('TEST batch GET unavailable');
        const payload=state.accepted.get(match[1]);if(!payload)return response(404,{});
        const batch={batch_header:{payout_batch_id:`BATCH-${match[1]}`,sender_batch_header:{sender_batch_id:state.badHeader?'another-reference':match[1]}},
          items:[{payout_item_id:`ITEM-${match[1]}`,transaction_status:state.status,payout_item:structuredClone(payload.items[0])}]};
        if(state.mutate)state.mutate(batch);
        if(state.afterGet){const fn=state.afterGet;state.afterGet=null;await fn();}
        return response(200,batch);
      }
    }
    state.unexpected.push(u.href);throw new Error(`NETWORK_DISABLED ${u.origin}`);
  };
  const post=async(action='payout',extra={})=>{const r=await api.POST(new Request('https://app.example.invalid/api/paypal',{method:'POST',headers:{authorization:'Bearer TEST_ONLY_USER','content-type':'application/json'},body:JSON.stringify({action,...extra})}));return {http:r.status,body:await r.json()};};

  await check('Un envío confirmado paga una vez y persiste la referencia antes de consultar',async()=>{
    const r=await post();assert.equal(r.body.status,'paid');assert.equal((await current()).status,'paid');assert.equal((await submission()).batch_id,(await current()).paypal_batch_id);assert.equal(state.accepted.size,1);assert.equal(await balance(),0);
  });
  await check('El duplicado v1 observado recupera la respuesta perdida sin webhook ni segundo retiro',async()=>{
    state.mode='disconnected';state.duplicateResponse=duplicateV1;
    const first=await post();assert.equal(first.body.status,'sending');assert.equal(await balance(),0);
    const original=structuredClone(state.posts[0]);await advance();state.mode='success';
    const recovered=await post('payout-check');assert.equal(recovered.body.items[0].status,'paid');
    assert.equal((await current()).status,'paid');assert.equal((await rows()).length,1);
    assert.equal((await submission()).batch_id,(await current()).paypal_batch_id);
    assert.equal(state.accepted.size,1);assert.equal(state.posts.length,2);assert.deepEqual(state.posts[1],original);
    assert.equal(await balance(),0);assert.equal(Number((await q('select count(*) as n from paypal_payout_events'))[0].n),0);
    if(withLedger){
      const journal=await q('select kind,amount from finance_journal order by sequence');
      assert.equal(journal.filter(j=>j.kind==='payout_reserved').length,1);assert.equal(journal.filter(j=>j.kind==='payout_confirmed').length,1);
      assert.equal(journal.filter(j=>j.kind==='payout_released').length,0);
      await post('payout-check');assert.deepEqual(await q('select kind,amount from finance_journal order by sequence'),journal);
    }
    assert.equal(state.posts.length,2);
  });
  await check('El duplicado v1 recupera un lote pendiente sin liberar fondos y luego confirma por GET',async()=>{
    state.mode='disconnected';state.status='UNCLAIMED';state.duplicateResponse=duplicateV1;await post();
    await advance();state.mode='success';await post('payout-check');
    assert.equal((await current()).status,'sending');assert.ok((await current()).paypal_batch_id);assert.equal(await balance(),0);
    state.status='SUCCESS';await post('payout-check');assert.equal((await current()).status,'paid');assert.equal(state.posts.length,2);assert.equal(state.accepted.size,1);
  });
  for(const [mode,origin] of [
    ['sandbox','https://api-m.sandbox.paypal.com'],['sandbox','https://api.sandbox.paypal.com'],
    ['live','https://api-m.paypal.com'],['live','https://api.paypal.com'],
  ])await check(`Duplicado ${mode}: reconoce ${origin} y consulta solo el origen configurado`,async()=>{
    process.env.PAYPAL_ENV=mode;state.mode='disconnected';state.duplicateResponse=id=>{const e=duplicateV1(id);e.details[0].link[0].href=`${origin}/v1/payments/payouts/BATCH-${id}`;return e;};
    await post();await advance();state.mode='success';await post('payout-check');
    assert.equal((await current()).status,'paid');assert.equal(state.accepted.size,1);assert.equal(state.posts.length,2);
    const canonical=mode==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';
    assert.ok(state.gets.length>0);assert.ok(state.gets.every(h=>new URL(h).origin===canonical));
  });
  await check('El código DUPLICATE_BATCH_ID también permite enlaces anidados y detalles nulos',async()=>{
    state.mode='disconnected';state.duplicateResponse=id=>{const e=duplicateV1(id);e.name='VALIDATION_ERROR';e.details[0].issue='DUPLICATE_BATCH_ID';e.details.unshift(null);return e;};
    await post();await advance();state.mode='success';await post('payout-check');assert.equal((await current()).status,'paid');assert.equal(state.accepted.size,1);
  });
  await check('Enlaces al mismo lote no duplican la recuperación y sus parámetros no se reenvían',async()=>{
    state.mode='disconnected';state.duplicateResponse=id=>{const e=duplicateV1(id);e.links=[{...e.details[0].link[0],href:e.details[0].link[0].href+'?ignored=1#ignored'}];return e;};
    await post();await advance();state.mode='success';await post('payout-check');assert.equal((await current()).status,'paid');
    assert.ok(state.gets.length>0);assert.ok(state.gets.every(h=>!h.includes('?')&&!h.includes('#')));assert.equal(state.accepted.size,1);
  });
  for(const [name,href] of [
    ['dominio ajeno',id=>`https://foreign.example.invalid/v1/payments/payouts/BATCH-${id}`],
    ['entorno Live',id=>`https://api-m.paypal.com/v1/payments/payouts/BATCH-${id}`],
    ['alias de Live',id=>`https://api.paypal.com/v1/payments/payouts/BATCH-${id}`],
    ['alias por HTTP',id=>`http://api.sandbox.paypal.com/v1/payments/payouts/BATCH-${id}`],
    ['alias con credenciales',id=>`https://user:password@api.sandbox.paypal.com/v1/payments/payouts/BATCH-${id}`],
    ['subdominio engañoso',id=>`https://api.sandbox.paypal.com.attacker.invalid/v1/payments/payouts/BATCH-${id}`],
    ['puerto ajeno',id=>`https://api.sandbox.paypal.com:444/v1/payments/payouts/BATCH-${id}`],
    ['HTTP sin TLS',id=>`http://api-m.sandbox.paypal.com/v1/payments/payouts/BATCH-${id}`],
    ['credenciales en URL',id=>`https://user:password@api-m.sandbox.paypal.com/v1/payments/payouts/BATCH-${id}`],
    ['otra ruta',id=>`https://api-m.sandbox.paypal.com/v1/payments/payouts-item/BATCH-${id}`],
    ['ruta de cancelación',id=>`https://api-m.sandbox.paypal.com/v1/payments/payouts/BATCH-${id}/cancel`],
    ['ruta relativa',id=>`/v1/payments/payouts/BATCH-${id}`],
    ['identificador codificado',()=>`https://api-m.sandbox.paypal.com/v1/payments/payouts/OTHER%2FBATCH`],
    ['URL ausente',()=>null],
  ])await check(`El duplicado v1 rechaza ${name} y conserva toda la reserva`,async()=>{
    state.mode='disconnected';state.duplicateResponse=id=>{const e=duplicateV1(id);e.details[0].link[0].href=href(id);return e;};
    await post();await advance();state.mode='success';await post('payout-check');
    assert.equal(state.gets.length,0);assert.equal((await current()).paypal_batch_id,null);assert.equal((await current()).status,'sending');assert.equal(await balance(),0);assert.equal(state.accepted.size,1);
  });
  await check('Un duplicado Live no acepta enlaces Sandbox de ninguno de sus hosts',async()=>{
    process.env.PAYPAL_ENV='live';state.mode='disconnected';state.duplicateResponse=id=>{const e=duplicateV1(id);e.links=[{href:`https://api-m.sandbox.paypal.com/v1/payments/payouts/BATCH-${id}`,method:'GET'}];return e;};
    await post();await advance();state.mode='success';await post('payout-check');
    assert.equal(state.gets.length,0);assert.equal((await current()).status,'sending');assert.equal(await balance(),0);assert.equal(state.accepted.size,1);
  });
  for(const [name,mutate] of [
    ['error genérico',e=>{e.details[0].issue='Receiver is not confirmed';}],
    ['campo ajeno',e=>{e.details[0].field='RECEIVER';}],
    ['nombre de error ajeno',e=>{e.name='ANOTHER_ERROR';}],
    ['método de escritura',e=>{e.details[0].link[0].method='POST';}],
    ['lista de enlaces malformada',e=>{e.details[0].link={href:'INVALID'};}],
    ['detalles malformados',e=>{e.details={issue:'DUPLICATE_BATCH_ID'};}],
  ])await check(`El duplicado v1 no interpreta ${name} como prueba de lote`,async()=>{
    state.mode='disconnected';state.duplicateResponse=id=>{const e=duplicateV1(id);mutate(e);return e;};
    await post();await advance();state.mode='success';const r=await post('payout-check');
    assert.equal(r.http,200);assert.equal(state.gets.length,0);assert.equal((await current()).status,'sending');assert.equal(await balance(),0);assert.equal(state.accepted.size,1);
  });
  await check('Dos referencias de lote contradictorias requieren conservar el envío incierto',async()=>{
    state.mode='disconnected';state.duplicateResponse=id=>{const e=duplicateV1(id);e.links=[{...e.details[0].link[0],href:'https://api-m.sandbox.paypal.com/v1/payments/payouts/ANOTHER_BATCH'}];return e;};
    await post();await advance();state.mode='success';await post('payout-check');assert.equal(state.gets.length,0);assert.equal((await current()).status,'sending');assert.equal(await balance(),0);
  });
  await check('Un enlace de otro detalle no se mezcla con el detalle duplicado v1',async()=>{
    state.mode='disconnected';state.duplicateResponse=id=>{const e=duplicateV1(id);e.details.unshift({field:'RECEIVER',issue:'OTHER',link:[{href:'https://api-m.sandbox.paypal.com/v1/payments/payouts/ANOTHER_BATCH'}]});return e;};
    await post();await advance();state.mode='success';await post('payout-check');assert.equal((await current()).status,'paid');assert.equal(state.accepted.size,1);
  });
  await check('El lote recuperado por duplicado v1 debe pertenecer a la referencia original',async()=>{
    state.mode='disconnected';state.duplicateResponse=duplicateV1;await post();await advance();state.mode='success';state.badHeader=true;await post('payout-check');
    assert.equal((await current()).paypal_batch_id,null);assert.equal((await current()).status,'sending');assert.equal(await balance(),0);
  });
  for(const [name,mutate] of [
    ['importe',b=>{b.items[0].payout_item.amount.value='1.00';}],
    ['moneda',b=>{b.items[0].payout_item.amount.currency='EUR';}],
    ['destinatario',b=>{b.items[0].payout_item.receiver='other@example.invalid';}],
    ['referencia de ítem',b=>{b.items[0].payout_item.sender_item_id='other-reference';}],
  ])await check(`La recuperación v1 conserva fondos si el ítem tiene ${name} incorrecto`,async()=>{
    state.mode='disconnected';state.duplicateResponse=duplicateV1;await post();await advance();state.mode='success';state.mutate=mutate;await post('payout-check');
    assert.equal((await current()).status,'sending');assert.equal(await balance(),0);assert.equal(state.accepted.size,1);assert.equal(state.posts.length,2);
  });
  await check('Si falla el snapshot se revierte también la reserva inicial',async()=>{
    await db.exec("create function fail_test_snapshot() returns trigger language plpgsql as $$begin raise exception 'TEST snapshot unavailable';end;$$;create trigger fail_test_snapshot before insert on paypal_payout_submissions for each row execute function fail_test_snapshot()");
    try {await assert.rejects(begin,/TEST snapshot unavailable/);assert.equal((await rows()).length,0);assert.equal(await balance(),160);}
    finally {await db.exec('drop trigger fail_test_snapshot on paypal_payout_submissions;drop function fail_test_snapshot()');}
  });
  for(const mode of ['503','without-id','disconnected','malformed-json'])await check(`${mode}: mantiene la reserva y recupera el mismo envío sin duplicarlo`,async()=>{
    state.mode=mode;const first=await post();assert.equal(first.http,200);assert.equal(first.body.status,'sending');assert.equal(await balance(),0);assert.equal((await post()).http,400);
    const original=structuredClone(state.posts[0]);state.mode='success';await advance();const recovered=await post('payout-check');
    assert.equal(recovered.body.items[0].status,'paid');assert.equal((await current()).status,'paid');assert.equal(state.accepted.size,1);assert.equal(state.posts.length,2);assert.deepEqual(state.posts[1],original);assert.equal(await balance(),0);
  });
  await check('Una desconexión antes de la aceptación reintenta con la misma referencia',async()=>{
    state.mode='before-acceptance';await post();assert.equal(state.accepted.size,0);assert.equal(await balance(),0);state.mode='success';await advance();await post('payout-check');assert.equal(state.accepted.size,1);assert.deepEqual(state.posts[0],state.posts[1]);assert.equal((await current()).status,'paid');
  });
  await check('Cambios de destinatario y nuevos ingresos no alteran el payload original',async()=>{
    state.mode='503';await post();const original=structuredClone(state.posts[0]);await q("update payout_accounts set paypal_email='changed@example.invalid'");
    await q("insert into transactions values('late','creator',100,.8,'paid',false,'2026-10-25T12:00:00Z')");state.mode='success';await advance();await post('payout-check');
    assert.deepEqual(state.posts[1],original);assert.equal(state.posts[1].items[0].receiver,'original@example.invalid');assert.equal(state.posts[1].items[0].amount.value,'156.80');assert.equal(await balance(),80);
  });
  for(const [name,sql] of [
    ['identidad pendiente','update profiles set is_verified=false'],
    ['cuenta suspendida','update profiles set suspended=true'],
    ['retiros congelados',`insert into account_restrictions values('${user}',true)`],
    ['saldo negativo',"update transactions set status='disputed'"],
  ])await check(`La recuperación no reenvía mientras existe ${name}`,async()=>{
    state.mode='503';await post();await db.exec(sql);await advance();const r=await post('payout-check');
    assert.equal(r.body.items[0].paypalStatus,'MANUAL_REVIEW');assert.equal(state.posts.length,1);assert.equal((await current()).status,'sending');
  });
  await check('Un retiro conocido sigue conciliándose aunque la cuenta quede congelada',async()=>{
    state.status='PENDING';await post();await q('insert into account_restrictions values($1,true)',[user]);state.status='SUCCESS';await post('payout-check');assert.equal((await current()).status,'paid');assert.equal(state.posts.length,1);
  });
  await check('El rechazo explícito del primer intento libera el saldo',async()=>{
    state.mode='rejected';assert.equal((await post()).http,502);assert.equal((await current()).status,'failed');assert.equal(await balance(),160);assert.equal(state.accepted.size,0);
  });
  await check('Un rechazo posterior no libera un envío anterior incierto',async()=>{
    state.mode='503';await post();await advance();state.mode='rejected';await post('payout-check');assert.equal((await current()).status,'sending');assert.equal(await balance(),0);
    state.mode='success';await advance();await post('payout-check');assert.equal((await current()).status,'paid');assert.equal(state.accepted.size,1);
  });
  await check('Una consulta fallida conserva el lote y la recuperación usa GET sin reenviar',async()=>{
    state.getFailure=true;await post();assert.ok((await current()).paypal_batch_id);assert.equal((await current()).status,'sending');state.getFailure=false;await post('payout-check');assert.equal(state.posts.length,1);assert.equal((await current()).status,'paid');
  });
  await check('Una caída al guardar la aceptación se recupera con la misma clave',async()=>{
    state.saveFailures=1;assert.equal((await post()).http,502);assert.equal(await balance(),0);assert.equal((await current()).paypal_batch_id,null);
    await advance();await post('payout-check');assert.equal((await current()).status,'paid');assert.equal(state.accepted.size,1);assert.deepEqual(state.posts[0],state.posts[1]);
  });
  await check('Perder la respuesta de una escritura ya confirmada no provoca otro POST',async()=>{
    state.lostSaveAck=true;assert.equal((await post()).http,502);assert.ok((await current()).paypal_batch_id);assert.equal(await balance(),0);
    await post('payout-check');assert.equal((await current()).status,'paid');assert.equal(state.posts.length,1);assert.equal(state.accepted.size,1);
  });
  await check('Una operación con lease vigente impide un segundo envío',async()=>{
    const p=await begin(),c=await claim(p.id);assert.equal(c.operation,'submit');assert.equal((await claim(p.id)).operation,'wait');
    await post('payout-check');assert.equal(state.posts.length,0);await advance();await post('payout-check');assert.equal(state.posts.length,1);assert.equal(state.accepted.size,1);
  });
  await check('La respuesta tardía de un lease anterior no puede liberar ni reemplazar el retiro',async()=>{
    const p=await begin(),first=await claim(p.id);await advance();const second=await claim(p.id);assert.notEqual(first.token,second.token);
    assert.equal((await finish(p.id,first.token,'rejected')).applied,false);assert.equal((await finish(p.id,first.token,'accepted','FOREIGN-BATCH')).applied,false);assert.equal((await current()).status,'sending');assert.equal(await balance(),0);assert.equal((await submission()).lease_token,second.token);
  });
  await check('Tras cinco intentos inciertos exige revisión sin liberar el saldo',async()=>{
    state.mode='lost-all';await post();for(let i=0;i<5;i++){await advance();await post('payout-check');}
    assert.equal(state.posts.length,5);assert.equal(state.accepted.size,1);assert.equal((await submission()).state,'manual_review');assert.equal(await balance(),0);
  });
  await check('El límite conservador de 29 días impide reenviar una referencia antigua',async()=>{
    state.mode='503';await post();await advance(29*86400000);const r=await post('payout-check');assert.equal(r.body.items[0].paypalStatus,'MANUAL_REVIEW');assert.equal(state.posts.length,1);assert.equal(await balance(),0);
  });
  await check('Un lote ya conocido se puede consultar después de 30 días sin reenviarlo',async()=>{
    state.status='PENDING';await post();await advance(31*86400000);state.status='SUCCESS';await post('payout-check');assert.equal((await current()).status,'paid');assert.equal(state.posts.length,1);
  });
  for(const [mode,client] of [['live',sender],['sandbox','ANOTHER_CLIENT']])await check(`Cambio de emisor ${mode}/${client}: conserva reserva y no reenvía`,async()=>{
    const p=await begin();assert.equal((await claim(p.id,user,mode,client)).operation,'review');assert.equal(state.posts.length,0);assert.equal(await balance(),0);
  });
  await check('Un retiro histórico sin snapshot ni lote no utiliza el destinatario actual',async()=>{
    await q('select paypal_payout_start($1)',[user]);const r=await post('payout-check');assert.equal(r.body.items[0].paypalStatus,'MANUAL_REVIEW');assert.equal(state.posts.length,0);assert.equal(await balance(),0);
  });
  await check('Un retiro histórico con lote pero sin snapshot requiere revisión sin nuevo POST',async()=>{
    await post();const p=await current();await q("update payouts set status='sending' where id=$1",[p.id]);await q('delete from paypal_payout_submissions');const n=state.posts.length;
    const r=await post('payout-check');assert.equal(state.posts.length,n);assert.equal((await current()).status,'sending');assert.equal(r.body.items[0].paypalStatus,'MANUAL_REVIEW');
  });
  await check('Un enlace duplicado a otro dominio no se sigue ni libera fondos',async()=>{
    state.mode='503';await post();state.mode='success';state.badLink=true;await advance();await post('payout-check');assert.equal(state.gets.length,0);assert.equal((await current()).status,'sending');assert.equal(await balance(),0);
  });
  await check('Un lote de otra referencia no puede confirmar este retiro',async()=>{
    state.mode='503';await post();state.mode='success';state.badHeader=true;await advance();await post('payout-check');assert.equal((await current()).paypal_batch_id,null);assert.equal((await current()).status,'sending');assert.equal(await balance(),0);
  });
  for(const [name,mutate] of [
    ['importe',b=>{b.items[0].payout_item.amount.value='1.00';}],
    ['moneda',b=>{b.items[0].payout_item.amount.currency='EUR';}],
    ['destinatario',b=>{b.items[0].payout_item.receiver='other@example.invalid';}],
    ['destinatario ausente',b=>{b.items[0].payout_item.receiver=null;}],
    ['referencia',b=>{b.items[0].payout_item.sender_item_id='other-reference';}],
  ])await check(`No confirma un ítem con ${name} incorrecto`,async()=>{
    state.mutate=mutate;await post();assert.equal((await current()).status,'sending');assert.equal(await balance(),0);assert.equal(state.accepted.size,1);
  });
  await check('Busca el ítem por referencia y no por su posición en la respuesta',async()=>{
    state.mutate=b=>{b.items.unshift({...structuredClone(b.items[0]),payout_item:{sender_item_id:'another-reference'}});};await post();assert.equal((await current()).status,'paid');
  });
  for(const hold of ['ONHOLD','BLOCKED'])await check(`${hold}: no libera saldo y luego puede confirmarse`,async()=>{
    state.status=hold;await post();assert.equal((await current()).status,'sending');assert.equal(await balance(),0);state.status='SUCCESS';await post('payout-check');assert.equal((await current()).status,'paid');assert.equal(state.posts.length,1);
  });
  await check('Un lote sin detalles de ítem no se declara pagado ni se reenvía',async()=>{
    state.mutate=b=>{b.items=[];};await post();await post('payout-check');assert.equal((await current()).status,'sending');assert.equal(state.posts.length,1);assert.equal(await balance(),0);
  });
  await check('No permite recuperar un retiro atribuido a otro usuario',async()=>{
    const p=await begin();await assert.rejects(()=>claim(p.id,other),/Retiro no encontrado/);assert.equal((await submission()).attempt_count,0);
  });
  await check('RLS y permisos cierran snapshots y RPCs a los clientes',async()=>{
    const p=await begin();assert.equal((await q("select relrowsecurity from pg_class where oid='paypal_payout_submissions'::regclass"))[0].relrowsecurity,true);
    for(const role of ['anon','authenticated']){
      await db.exec(`set role ${role}`);
      try {
        await assert.rejects(()=>q('select * from paypal_payout_submissions'),/permission denied/);
        await assert.rejects(()=>q("update paypal_payout_submissions set request_body='{}'::jsonb"),/permission denied/);
        await assert.rejects(()=>claim(p.id),/permission denied/);
        await assert.rejects(()=>begin(),/permission denied/);
        await assert.rejects(()=>finish(p.id,'00000000-0000-0000-0000-000000000099','rejected'),/permission denied/);
      }finally{await db.exec('reset role');}
    }
    await db.exec('set role service_role');
    try {await assert.rejects(()=>q('select * from paypal_payout_submissions'),/permission denied/);await assert.rejects(()=>q("update paypal_payout_submissions set net=1"),/permission denied/);assert.equal((await claim(p.id)).operation,'submit');}finally{await db.exec('reset role');}
  });
  await payoutEventCases({db,q,user,sender,check,post,api,current,balance,begin,claim,finish,state:()=>state,advance});
  console.log(`\n${passed} comprobaciones satisfactorias; proveedor simulado, sin producción.`);
} finally {globalThis.fetch=oldFetch;await db.close();assert.equal(resolve(dir,'..'),resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});}
