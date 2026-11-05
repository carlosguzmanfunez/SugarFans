// Real PostgreSQL triggers in PGlite + the browser-only payment adapter.
// No PayPal calls, credentials, browser permission prompts or outbound push.
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const scratch = mkdtempSync(join(tmpdir(), 'fansreserve-subscription-notice-'));
const originalStorage = globalThis.localStorage;
const values = new Map(); let storageFails = false;
globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => { if (storageFails) throw Error('Storage full'); values.set(k,v); } };
const pg = new PGlite();
let checks = 0;
const check = async (name, fn) => { await fn(); checks++; console.log('OK ' + name); };
const fan = '11111111-1111-4111-8111-111111111111', owner = '22222222-2222-4222-8222-222222222222', stranger = '33333333-3333-4333-8333-333333333333';
const count = async table => Number((await pg.query(`select count(*) as n from ${table}`)).rows[0].n);
const notices = async () => (await pg.query('select * from public.notifications order by user_id')).rows;
const clear = async () => pg.exec('delete from public.notifications; delete from public.push_probe');
const add = async (kind, status = 'paid', amount = 9.99) => (await pg.query("insert into public.transactions(kind,status,amount,payer_id,payer_name,creator_profile_id,creator_name) values($1,$2,$3,$4,'Ana','creator-test','Mariana') returning id", [kind,status,amount,fan])).rows[0].id;
try {
  const original = readFileSync('supabase/migrations/20261003000001_live_alerts.sql','utf8');
  const inbox = original.slice(original.indexOf('create table if not exists public.notifications'), original.indexOf('-- New notifications reach'));
  await pg.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.profiles(id uuid primary key, name text, creator_profile_id text, role text);
    create table public.transactions(id uuid primary key default gen_random_uuid(),kind text,status text,amount numeric,payer_id uuid,payer_name text,creator_profile_id text,creator_name text);
    create table public.subscriptions(fan_id uuid,creator_id text,since timestamptz default now(),cancel_at timestamptz,paypal_subscription_id text,primary key(fan_id,creator_id));
    ${inbox}
    create table public.push_probe(notification_id uuid);
    create function public.push_probe() returns trigger language plpgsql as $$ begin insert into public.push_probe values(new.id);return new;end; $$;
    create trigger push_notification after insert on public.notifications for each row execute function public.push_probe();
    grant usage on schema public,auth to authenticated;
    grant select,delete on public.notifications to authenticated;
    insert into public.profiles values('${fan}','Ana',null,'fan'),('${owner}','Mariana','creator-test','creator'),('${stranger}','Otra persona',null,'fan');
    insert into public.subscriptions(fan_id,creator_id,paypal_subscription_id) values('${fan}','creator-test','I-TEST');`);
  const historical = await add('subscription');
  const oldBooks = (await pg.query('select * from public.transactions')).rows;
  await pg.exec(readFileSync('supabase/migrations/20261105165117_subscription_notifications.sql','utf8'));
  await check('Instalar no avisa de ventas antiguas ni cambia cuentas o acceso', async () => {
    assert.equal(await count('public.notifications'),0);
    assert.deepEqual((await pg.query('select * from public.transactions')).rows,oldBooks);
    assert.equal(await count('public.subscriptions'),1);
  });
  await check('La aprobación sin cobro y el cobro fallido no generan un aviso de pago', async () => {
    await pg.exec(`update public.subscriptions set paypal_subscription_id='I-APPROVED' where fan_id='${fan}'`);
    await add('subscription','failed'); await add('tip'); await add('subscription','paid',0);
    assert.equal(await count('public.notifications'),0);
  });
  let initial;
  await check('El pago confirmado avisa al fan y al dueño del perfil, con destinos correctos', async () => {
    initial=await add('subscription'); const rows=await notices(); assert.equal(rows.length,2);
    assert.equal(rows[0].title,'Suscripción confirmada'); assert.match(rows[0].body,/USD 9.99/); assert.equal(rows[0].link,'/profile#mis-suscripciones');
    assert.equal(rows[1].title,'Nueva suscripción'); assert.equal(rows[1].link,'/creator/dashboard?tab=subscribers');
    assert.ok(!rows.some(n=>n.user_id===stranger)); assert.equal(await count('public.push_probe'),2);
  });
  await check('Repetir el pago o su estado no duplica y no reaparece tras borrarlo', async () => {
    await clear(); await pg.query("update public.transactions set status='paid' where id=$1",[initial]);
    await pg.query("update public.transactions set status='disputed' where id=$1",[initial]);
    await pg.query("update public.transactions set status='paid' where id=$1",[initial]);
    await pg.query("update public.transactions set status='paid' where id=$1",[historical]);
    assert.equal(await count('public.notifications'),0);
  });
  await check('Un pago pendiente avisa una vez cuando finalmente queda confirmado', async () => {
    const id=await add('subscription','pending'); assert.equal(await count('public.notifications'),0);
    await pg.query("update public.transactions set status='paid' where id=$1",[id]); assert.equal(await count('public.notifications'),2); await clear();
  });
  await check('La renovación tiene su propio aviso de pago confirmado', async () => {
    await add('renewal'); assert.equal((await notices())[0].title,'Suscripción renovada'); assert.equal((await notices())[1].title,'Renovación de suscripción'); await clear();
  });
  await check('Cancelar la renovación explica hasta cuándo sigue el acceso', async () => {
    await pg.exec(`update public.subscriptions set cancel_at=now()+interval '20 days' where fan_id='${fan}'`);
    const rows=await notices(); assert.equal(rows.length,2); assert.equal(rows[0].title,'Renovación cancelada'); assert.match(rows[0].body,/El acceso se conserva hasta el/); assert.match(rows[0].body,/UTC−6/); await clear();
    await pg.exec('update public.subscriptions set cancel_at=cancel_at'); assert.equal(await count('public.notifications'),0);
  });
  await check('Reactivar y cancelar otra vez sí son cambios nuevos', async () => {
    await pg.exec('update public.subscriptions set cancel_at=null'); assert.equal((await notices())[0].title,'Renovación reactivada'); await clear();
    await pg.exec("update public.subscriptions set cancel_at=now()+interval '20 days'"); assert.equal((await notices())[0].title,'Renovación cancelada'); await clear();
  });
  await check('Un fin inmediato se distingue de cancelar la próxima renovación', async () => {
    await pg.exec("update public.subscriptions set cancel_at=now()-interval '1 minute'"); assert.equal((await notices())[0].title,'Suscripción finalizada'); await clear();
    await pg.exec('update public.subscriptions set cancel_at=null'); assert.equal(await count('public.notifications'),0);
  });
  await check('No cambia el importe ni el estado de ventas al crear avisos', async () => {
    assert.deepEqual((await pg.query('select * from public.transactions where id=$1',[historical])).rows,oldBooks);
    const profileSource=readFileSync('src/pages/Profile.tsx','utf8'); assert.match(profileSource,/id="mis-suscripciones"/);
  });
  await check('Las personas no pueden invocar ni leer el registro privado de envíos', async () => {
    const privileges=(await pg.query(`select has_schema_privilege('authenticated','notification_private','USAGE') as schema,
      has_table_privilege('authenticated','notification_private.subscription_events','SELECT') as table,
      has_function_privilege('authenticated','notification_private.subscription_notice(text,uuid,text,text,text,text,text,text)','EXECUTE') as func`)).rows[0];
    assert.deepEqual(privileges,{schema:false,table:false,func:false});
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[fan]); await pg.exec('set role authenticated');
    await assert.rejects(pg.exec("insert into public.notifications(user_id,kind,title) values('"+fan+"','subscription_payment','Falso')")); await pg.exec('reset role');
  });
  const modules={};
  for(const [name,source] of Object.entries({platform:'src/lib/backend/localPlatform.ts',inbox:'src/lib/backend/localLive.ts',changes:'src/lib/backend/localSubscriptionNotifications.ts',storage:'src/lib/storage.ts'})) {
    const outfile=join(scratch,name+'.mjs'); await build({entryPoints:[source],outfile,bundle:true,platform:'node',format:'esm',define:{'import.meta.env':'{}'},logLevel:'silent'}); modules[name]=await import(pathToFileURL(outfile).href);
  }
  const {createLocalPlatform}=modules.platform;
  const accounts=[{id:'fan',name:'Ana',role:'fan',subscriptions:[]},{id:'owner',name:'Mariana',role:'creator',creatorProfileId:'creator-test',subscriptions:[]}];
  const platform=createLocalPlatform({listAccounts:()=>accounts,withInviteBonuses:x=>x,notify:()=>{},creatorPrice:()=>9.99});
  const localInbox=modules.inbox.createLocalLive({followers:()=>[],subscribers:()=>[],currentUserId:()=> 'fan',onChange:()=>()=>{},notify:()=>{}});
  const tx={key:'local-paid',payerId:'fan',payerName:'Ana',creatorProfileId:'creator-test',creatorName:'Mariana',kind:'subscription',amount:9.99,status:'paid',methodLabel:'Prueba',createdAt:new Date().toISOString()};
  await check('El adaptador local avisa únicamente después de guardar un pago',async()=>{
    const r=platform.ledger.addTransaction(tx); assert.equal(r.ok,true); assert.equal((await localInbox.notifications({id:'fan'}))[0].title,'Suscripción confirmada'); assert.equal((await localInbox.notifications({id:'owner'}))[0].title,'Nueva suscripción');
    const row=(await localInbox.notifications({id:'fan'}))[0]; await localInbox.dismissNotification({id:'fan'},row.id); platform.ledger.setRefundLoss(r.id,0); assert.equal((await localInbox.notifications({id:'fan'})).length,0);
  });
  await check('Una falla al guardar no inventa un aviso de cobro confirmado',async()=>{
    const before=await localInbox.notifications({id:'owner'}); storageFails=true; assert.equal(platform.ledger.addTransaction({...tx,key:'failed-save'}).ok,false); storageFails=false; assert.deepEqual(await localInbox.notifications({id:'owner'}),before);
  });
  await check('Cancelar sin cambio no repite; finalizar y reactivar tienen textos distintos',async()=>{
    const change=modules.changes.localSubscriptionChangeNotice;
    const future=new Date(Date.now()+86400000).toISOString(); change('fan','Ana','creator-test','Mariana','owner',undefined,future);
    assert.equal((await localInbox.notifications({id:'fan'}))[0].title,'Renovación cancelada'); const before=await localInbox.notifications({id:'fan'});
    change('fan','Ana','creator-test','Mariana','owner',future,future); assert.deepEqual(await localInbox.notifications({id:'fan'}),before);
    change('fan','Ana','creator-test','Mariana','owner',future,undefined); assert.equal((await localInbox.notifications({id:'fan'}))[0].title,'Renovación reactivada');
    change('fan','Ana','creator-test','Mariana','owner',undefined,new Date(Date.now()-1000).toISOString()); assert.equal((await localInbox.notifications({id:'fan'}))[0].title,'Suscripción finalizada');
  });
  console.log(`${checks} comprobaciones aprobadas. Sin servicios externos.`);
} finally {
  storageFails=false; globalThis.localStorage=originalStorage; await pg.close();
  if(dirname(resolve(scratch))===resolve(tmpdir()) && scratch.includes('fansreserve-subscription-notice-')) rmSync(scratch,{recursive:true,force:true});
}
