// Real Supabase adapter + retirement migration, disposable PostgreSQL, no network.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';

const dir=mkdtempSync(join(tmpdir(),'fans-payout-safety-'));
const db=new PGlite();
const oldFetch=globalThis.fetch;
let passed=0, rpcCalls=0, requests=0;
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const check=async(name,fn)=>{await fn();passed++;console.log(`OK ${name}`);};
const migration=readFileSync(resolve('supabase/migrations/20261019215002_disable_simulated_payout_fallback.sql'),'utf8');
try {
  await build({entryPoints:['src/lib/backend/supabasePlatform.ts'],outfile:join(dir,'adapter.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
  const {createSupabasePlatform}=await import(pathToFileURL(join(dir,'adapter.mjs')).href);
  let session={data:{session:{access_token:'test-only-token'}}}, sessionThrows=false;
  const platform=createSupabasePlatform({
    auth:{getSession:async()=>{if(sessionThrows)throw new Error('test session failure');return session;}},
    rpc:async()=>{rpcCalls++;throw new Error('Unexpected fallback RPC');},
  });
  const response=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
  const serve=fn=>{globalThis.fetch=async(url,init)=>{
    requests++;assert.equal(url,'/api/paypal');assert.equal(init.method,'POST');
    assert.deepEqual(JSON.parse(init.body),{action:'payout'});
    return fn();
  };};
  const invalid=[
    ['HTTP 404',()=>response(404,{error:'Servicio no disponible'})],
    ['HTTP 503',()=>response(503,{error:'PayPal no configurado'})],
    ['HTTP 502',()=>response(502,{error:'Envío no confirmado'})],
    ['HTTP 500 HTML',()=>new Response('<html>error</html>',{status:500})],
    ['HTTP 204',()=>new Response(null,{status:204})],
    ['desconexión',()=>{throw new TypeError('test offline');}],
    ['éxito vacío',()=>response(200,{})],
    ['JSON inválido',()=>new Response('{', {status:200})],
    ['estado ausente',()=>response(200,{ok:true,net:156.8})],
    ['confirmación ausente',()=>response(200,{status:'paid',net:156.8})],
    ['estado desconocido',()=>response(200,{ok:true,status:'failed',net:156.8})],
    ['importe cero',()=>response(200,{ok:true,status:'paid',net:0})],
    ['importe negativo',()=>response(200,{ok:true,status:'paid',net:-1})],
    ['importe textual',()=>response(200,{ok:true,status:'paid',net:'156.80'})],
    ['importe nulo',()=>response(200,{ok:true,status:'paid',net:null})],
    ['respuesta contradictoria',()=>response(200,{ok:true,status:'paid',net:156.8,error:'No confirmado'})],
  ];
  for(const [name,fn] of invalid) await check(`${name}: sin éxito ficticio ni RPC alternativo`,async()=>{
    serve(fn);const r=await platform.requestPayout();assert.equal(r.ok,false);assert.equal(typeof r.error,'string');assert.equal(r.status,undefined);assert.equal(rpcCalls,0);
  });
  for(const status of ['paid','sending']) await check(`Respuesta válida ${status}: conserva el estado confirmado por el servidor`,async()=>{
    serve(()=>response(200,{ok:true,status,net:156.8,fee:3.2}));
    assert.deepEqual(await platform.requestPayout(),{ok:true,status,amount:156.8});assert.equal(rpcCalls,0);
  });
  await check('Sin sesión no se solicita un pago ni se llama un RPC',async()=>{
    session={data:{session:null}};const before=requests;assert.equal((await platform.requestPayout()).ok,false);assert.equal(requests,before);assert.equal(rpcCalls,0);
  });
  await check('Un error al recuperar la sesión no inicia el retiro',async()=>{
    sessionThrows=true;const before=requests;assert.equal((await platform.requestPayout()).ok,false);assert.equal(requests,before);assert.equal(rpcCalls,0);
  });
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create table public.payouts(id int primary key,amount numeric,status text);
    insert into public.payouts values(1,100,'paid'),(2,75,'sending'),(3,50,'failed');
    create table public.transactions(id int primary key,amount numeric,status text);
    insert into public.transactions values(1,200,'paid');
    create function public.request_payout() returns numeric language plpgsql security definer as $$begin insert into public.payouts values(4,160,'paid');return 160;end;$$;
    grant execute on function public.request_payout() to anon,authenticated,service_role;
  `);
  const history=await q('select * from payouts order by id');
  const sales=await q('select * from transactions order by id');
  await check('La migración retira el RPC sin reescribir datos históricos',async()=>{
    await db.exec(migration);assert.deepEqual(await q('select * from payouts order by id'),history);assert.deepEqual(await q('select * from transactions order by id'),sales);
    assert.equal((await q("select prosecdef from pg_proc where oid='public.request_payout()'::regprocedure"))[0].prosecdef,false);
  });
  for(const role of ['anon','authenticated','service_role']) await check(`El rol ${role} no puede ejecutar el RPC retirado`,async()=>{
    assert.equal((await q("select has_function_privilege($1,'public.request_payout()','execute') as allowed",[role]))[0].allowed,false);
    await db.exec(`set role ${role}`);
    try {await assert.rejects(()=>q('select request_payout()'),/permission denied/);}finally{await db.exec('reset role');}
    assert.deepEqual(await q('select * from payouts order by id'),history);
  });
  await check('Incluso el propietario recibe un rechazo sin insertar un pago',async()=>{
    await assert.rejects(()=>q('select request_payout()'),error=>error.code==='55000' && /deshabilitado/.test(error.message));
    assert.deepEqual(await q('select * from payouts order by id'),history);
  });
  await check('Un permiso concedido accidentalmente tampoco restaura pagos ficticios',async()=>{
    await db.exec('grant execute on function request_payout() to authenticated;set role authenticated');
    try {await assert.rejects(()=>q('select request_payout()'),/deshabilitado/);}finally{await db.exec('reset role');}
    await db.exec(migration);
    assert.equal((await q("select has_function_privilege('authenticated','public.request_payout()','execute') as allowed"))[0].allowed,false);
    assert.deepEqual(await q('select * from payouts order by id'),history);
    assert.deepEqual(await q('select * from transactions order by id'),sales);
  });
  console.log(`\n${passed} comprobaciones satisfactorias; cero solicitudes reales y cero fallbacks.`);
} finally {
  globalThis.fetch=oldFetch;await db.close();assert.equal(resolve(dir,'..'),resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});
}
