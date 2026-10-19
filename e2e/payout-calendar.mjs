// Actual migration and TS rules on disposable PostgreSQL; no network or payments.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { build } from 'esbuild';
const dir=mkdtempSync(join(tmpdir(),'fans-calendar-')), bundle=join(dir,'rules.mjs');
await build({stdin:{contents:"export * from './src/lib/platformRules'; export * from './src/lib/payoutCalendar'; export * from './src/lib/adminLedger'; export { createLocalPlatform } from './src/lib/backend/localPlatform';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:bundle,logLevel:'silent'});
const r=await import(pathToFileURL(bundle)), db=new PGlite();
let passed=0;
const check=async(name,fn)=>{await fn(); passed++; console.log(`OK ${name}`);};
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const clock=at=>q("select set_config('test.clock',$1,false)",[at]);
const rejects=(sql,match,args=[])=>assert.rejects(()=>q(sql,args),match);
const migration=readFileSync(resolve('supabase/migrations/20261019194731_earnings_calendar_26_25.sql'),'utf8');
const user='00000000-0000-0000-0000-000000000001', legacy='2026-10-01T00:00:00.000Z';
const fixtures=[
 ['legacy','2026-09-30T23:59:59Z',100,.8,'paid',false],
 ['oct1','2026-10-01T00:00:00Z',50,.8,'paid',false],
 ['last','2026-10-26T05:59:59.999Z',100,.8,'paid',false],
 ['new','2026-10-26T06:00:00Z',200,.8,'paid',false],
 ['dispute','2026-09-10T00:00:00Z',30,.8,'disputed',false],
 ['cover','2026-09-11T00:00:00Z',40,.8,'refunded',true],
 ['gift','2026-09-12T00:00:00Z',20,.6,'paid',false],
 ['bonus','2026-09-13T00:00:00Z',10,1,'paid',false],
];
const sales=fixtures.map(([id,createdAt,amount,share,status,platformCovers])=>({id,createdAt:new Date(createdAt).toISOString(),amount,share,status,platformCovers,creatorProfileId:'creator',kind:id==='gift'?'gift':id==='bonus'?'referral':'tip'}));
const paid=[{userId:user,amount:20,status:'paid'},{userId:user,amount:15,status:'failed'}];
const balance=async()=>Number((await q('select public.creator_available_balance($1) as v',[user]))[0].v);
try {
 await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  -- Deterministic clock only in this throwaway database; not part of the migration.
  create or replace function pg_catalog.now() returns timestamptz language sql stable as $$select current_setting('test.clock')::timestamptz$$;
  create table profiles(id uuid primary key,creator_profile_id text,name text,role text,is_verified boolean,suspended boolean default false);
  create table account_restrictions(user_id uuid primary key,payouts_frozen boolean);
  create table payout_accounts(user_id uuid primary key,paypal_email text);
  create table transactions(id text primary key,creator_profile_id text,amount numeric,creator_share numeric,status text,platform_covers boolean,created_at timestamptz);
  create table payouts(id uuid primary key default gen_random_uuid(),user_id uuid,creator_name text,amount numeric,fee numeric,net numeric,account_label text,available_before numeric,status text,paid_at timestamptz,requested_at timestamptz default now(),scheduled_for date);
  create function is_suspended(p_user uuid) returns boolean language sql stable as $$select suspended from public.profiles where id=p_user$$;
  create function payout_min(p_user uuid) returns numeric language sql stable as $$select 50::numeric$$;
  create function payout_fee_for(p_user uuid,p_amount numeric) returns numeric language sql immutable as $$select least(round(p_amount*.02,2),20)$$;
  create function payout_label(p_email text) returns text language sql immutable as $$select 'PayPal prueba'::text$$;
  insert into profiles values('${user}','creator','Test','creator',true,false);
  insert into payout_accounts values('${user}','creator@example.invalid');
 `);
 await clock('2026-10-19T12:00:00Z'); await db.exec(migration);
 for(const [id,at,amount,share,status,cover] of fixtures) await q("insert into transactions values($1,'creator',$2,$3,$4,$5,$6)",[id,amount,share,status,cover,at]);
 await q("insert into payouts(user_id,amount,status) values($1,20,'paid'),($1,15,'failed')",[user]);
 await q("select set_config('request.jwt.claim.sub',$1,false)",[user]);
 for(const [at,start,open] of [
  ['2026-10-26T05:59:59.999Z','2026-09-26T06:00:00.000Z',false],
  ['2026-10-26T06:00:00Z','2026-10-26T06:00:00.000Z',true],
  ['2026-11-02T05:59:59.999Z','2026-10-26T06:00:00.000Z',true],
  ['2026-11-02T06:00:00Z','2026-10-26T06:00:00.000Z',false],
  ['2027-01-01T12:00:00Z','2026-12-26T06:00:00.000Z',true],
  ['2027-02-26T06:00:00Z','2027-02-26T06:00:00.000Z',true],
  ['2028-02-29T18:00:00Z','2028-02-26T06:00:00.000Z',true],
 ]) await check(`Frontera ${at}`,async()=>{
  for(const tz of ['UTC','America/Tegucigalpa','Asia/Tokyo']) {
   await q("select set_config('TimeZone',$1,false)",[tz]);
   const row=(await q('select earnings_cycle_start($1::timestamptz) as s,payout_window_open($1::timestamptz) as o',[at]))[0];
   assert.equal(new Date(row.s).toISOString(),start); assert.equal(row.o,open);
  }
  assert.equal(r.earningsCycle(new Date(at)).start,start); assert.equal(r.payoutWindow(new Date(at)).open,open);
 });
 await check('Ventanas de febrero, bisiesto y fin de año',async()=>{
  for(const at of ['2027-02-26T12:00:00Z','2028-02-29T12:00:00Z','2026-12-26T12:00:00Z']) {
   const w=r.payoutWindow(new Date(at)); assert.equal(r.hondurasParts(new Date(w.end)).day,2); assert.equal(r.hondurasParts(new Date(w.lastDay)).day,1);
  }
  assert.equal(r.nextCreditDate(new Date('2026-10-25T12:00:00Z')),'2026-10-26T06:00:00.000Z');
  assert.equal(r.nextCreditDate(new Date('2026-10-26T06:00:00Z')),'2026-11-26T06:00:00.000Z');
 });
 await check('Fecha y CSV independientes de la zona del dispositivo',async()=>{
  for(const tz of ['UTC','America/Tegucigalpa','Asia/Tokyo']) {
   const p=spawnSync(process.execPath,['--input-type=module','-e',`import * as r from ${JSON.stringify(pathToFileURL(bundle).href)}; console.log(JSON.stringify([r.hondurasDateKey(new Date('2026-10-19T03:00:00Z')),r.hondurasTimestamp('2026-10-19T03:00:00Z'),r.formatPayoutDate('2026-11-01T06:00:00Z')]));`],{env:{...process.env,TZ:tz},encoding:'utf8'});
   assert.equal(p.status,0,p.stderr); const v=JSON.parse(p.stdout);
   assert.equal(v[0],'2026-10-18'); assert.equal(v[1],'2026-10-18T21:00:00.000-06:00'); assert.match(v[2],/^1 nov/);
  }
 });
 await check('Migración repetible, sin reescribir pagos ni mover el corte anterior',async()=>{
  const before=await q('select id,status,amount from payouts order by id');
  await clock('2026-11-30T12:00:00Z'); await db.exec(migration);
  assert.equal(new Date((await q('select legacy_cutoff from payout_calendar_settings'))[0].legacy_cutoff).toISOString(),legacy);
  assert.deepEqual(await q('select id,status,amount from payouts order by id'),before);
  assert.equal((await q('select count(*)::int as n from transactions'))[0].n,fixtures.length);
 });
 await check('Saldo cliente, administrador y servidor coinciden; transición conserva acreditados',async()=>{
  for(const at of ['2026-10-19T12:00:00Z','2026-10-26T05:59:59.999Z','2026-10-26T06:00:00Z','2026-11-01T18:00:00Z']) {
   await clock(at); const client=r.computeEarnings(sales,paid,new Date(at),legacy);
   assert.equal(await balance(),client.available); assert.equal(r.owedToCreators(sales,paid,new Date(at),legacy).available,client.available);
  }
  await clock('2026-10-19T12:00:00Z'); assert.equal(await balance(),114);
  await clock('2026-10-26T06:00:00Z'); assert.equal(await balance(),234);
  assert.equal(r.computeEarnings(sales,paid,new Date('2026-10-26T06:00:00Z'),legacy).pending,160);
 });
 await check('RLS y privilegios: lectura de política, sin escritura ni ejecución interna',async()=>{
  await db.exec('set role authenticated'); assert.ok((await q('select payout_calendar_policy() as p'))[0].p.legacy_cutoff);
  await rejects('update payout_calendar_settings set legacy_cutoff=now()',/permission denied/);
  await rejects(`select creator_available_balance('${user}')`,/permission denied/);
  await rejects('select payout_window_open(now())',/permission denied/);
  await db.exec('reset role; set role anon');
  await rejects('select payout_calendar_policy()',/permission denied/);
  await rejects('select * from payout_calendar_settings',/permission denied/);
  await db.exec('reset role');
 });
 await check('Ambas entradas de pago rechazan el 25 y el 2 sin insertar',async()=>{
  for(const at of ['2026-10-26T05:59:59.999Z','2026-11-02T06:00:00Z']) {
   await clock(at); const n=(await q('select count(*) as n from payouts'))[0].n;
   await rejects('select paypal_payout_start($1)',/del 26 al 1/,[user]); await rejects('select request_payout()',/del 26 al 1/);
   assert.equal((await q('select count(*) as n from payouts'))[0].n,n);
  }
 });
 await check('Reserva única, fecha de Honduras y restitución tras fallo',async()=>{
  await clock('2026-11-02T05:59:59.999Z'); const p=(await q('select paypal_payout_start($1) as p',[user]))[0].p;
  assert.equal(Number(p.amount),234); assert.equal(await balance(),0);
  assert.equal((await q('select scheduled_for::text as d from payouts where id=$1',[p.id]))[0].d,'2026-11-01');
  await rejects('select paypal_payout_start($1)',/retiro en camino/,[user]);
  await q("update payouts set status='failed' where id=$1",[p.id]); assert.equal(await balance(),234);
 });
 await check('Se conservan KYC, suspensión, bloqueo, destinatario y mínimo',async()=>{
  await clock('2026-10-26T12:00:00Z');
  for(const [setup,undo,match] of [
   ['update profiles set is_verified=false','update profiles set is_verified=true',/Verifica/],
   ['update profiles set suspended=true','update profiles set suspended=false',/en revisión/],
   [`insert into account_restrictions values('${user}',true)`,'delete from account_restrictions',/en revisión/],
   ['update payout_accounts set paypal_email=null',"update payout_accounts set paypal_email='creator@example.invalid'",/Añade/],
  ]) {await db.exec(setup); await rejects('select paypal_payout_start($1)',match,[user]); await db.exec(undo);}
  await q("update transactions set status='disputed',platform_covers=false where creator_profile_id='creator'");
  assert.equal(await balance(),-20); await rejects('select paypal_payout_start($1)',/al menos/,[user]);
 });
 await check('Fallback existente también usa la ventana y fecha local sin duplicar saldo',async()=>{
  await q("update transactions set status='paid' where id='legacy'");
  await clock('2026-11-02T05:59:59.999Z');
  const amount=Number((await q('select request_payout() as amount'))[0].amount);
  assert.equal(amount,60); assert.equal(await balance(),0);
  assert.equal((await q("select scheduled_for::text as d from payouts where amount=60 and status='paid'"))[0].d,'2026-11-01');
  await rejects('select request_payout()',/al menos/);
 });
 await check('Libro distingue mes y ciclo; CSV lleva UTC−6 explícito',async()=>{
  const at=new Date('2026-10-19T03:00:00Z');
  assert.deepEqual(r.periodRange('today',at),['2026-10-18T06:00:00.000Z',null]);
  assert.deepEqual(r.periodRange('month',at),['2026-10-01T06:00:00.000Z',null]);
  assert.deepEqual(r.periodRange('cycle',at),['2026-09-26T06:00:00.000Z','2026-10-26T06:00:00.000Z']);
  const csv=r.ledgerCsv([{at:'2026-10-19T03:00:00Z',type:'Test',who:'Test',amount:1,fee:0,creator:.8,platform:.2,status:'paid'}]);
  assert.match(csv,/Fecha Honduras/); assert.match(csv,/2026-10-18T21:00:00.000-06:00/);
 });
 await check('Leer el calendario demo no vuelve a escribir ni provoca ciclos entre pestañas',async()=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage'); const values=new Map(); let writes=0;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>{writes++;values.set(key,value);}}});
  try {
   const platform=r.createLocalPlatform({});
   const a=await platform.payoutCalendar(), n=writes;
   assert.ok(a.legacyCutoff);
   assert.deepEqual(await platform.payoutCalendar(),a); assert.deepEqual(await platform.payoutCalendar(),a);
   assert.equal(writes,n);
  } finally {if(old) Object.defineProperty(globalThis,'localStorage',old); else delete globalThis.localStorage;}
 });
 console.log(`\n${passed} comprobaciones satisfactorias; sin producción.`);
} finally {await db.close(); rmSync(dir,{recursive:true,force:true});}
