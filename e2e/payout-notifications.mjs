// Real migration and message formatter; disposable database, no provider/email calls.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { financeFixture, CREATOR, OTHER, NOTIFICATION_MIGRATION } from './helpers/finance-fixture.mjs';

const temp=mkdtempSync(join(tmpdir(),'payout-notifications-'));
let f,passed=0;
const check=async(name,fn)=>{await fn();passed++;console.log('OK '+name);};
const oldSubject='Recibiste tu retiro de Fans Reserve';
const oldMessage='Tus ganancias en Fans Reserve ya están en tu cuenta PayPal.';
const newSubject='Tu retiro de Fans Reserve';
const newMessage='Consulta el estado de tu retiro en Ingresos de Fans Reserve y en tu cuenta PayPal. Un retiro en proceso todavía no confirma la entrega del dinero.';
try {
  f=await financeFixture({notificationMigration:false});const {db,q,rpc}=f;
  const begin=()=>rpc('paypal_payout_begin',[CREATOR,'sandbox','TEST_ONLY_CLIENT']);
  const snapshot=async id=>(await q('select request_body from paypal_payout_submissions where payout_id=$1',[id]))[0].request_body;
  const book=async()=>({
    payouts:await q('select * from payouts order by id'),
    snapshots:await q('select * from paypal_payout_submissions order by payout_id'),
    journal:await q('select * from finance_journal order by sequence'),
    allocations:await q('select * from finance_allocations order by id'),
    balances:await q('select id,creator_available_balance(id) as available from profiles order by id'),
    settings:await q('select * from finance_private.settings'),
  });
  const definitions=()=>q("select oid::regprocedure::text as signature,prosrc,prosecdef,proconfig,proacl from pg_proc where oid in ('paypal_payout_begin(uuid,text,text)'::regprocedure,'finance_batch_prepare_payout(uuid,text,text)'::regprocedure) order by oid::regprocedure::text");
  let originalManual,originalBatch,item,priorBook,priorDefinitions;
  await check('Conserva los snapshots históricos y todos los importes al aplicar la migración',async()=>{
    await f.reset();await f.sale();originalManual=await begin();
    await f.sale('other-sale','other',100);
    const preview=await rpc('finance_overview');
    const batch=await rpc('finance_batch_freeze',[randomUUID(),preview.cutoff,preview.quote_hash]);
    item=(await rpc('finance_batch_detail',[batch.id])).items.find(i=>i.user_id===OTHER);
    assert.ok(item);await q('update finance_private.settings set batch_handoff_enabled=true');
    originalBatch=await rpc('finance_batch_prepare_payout',[item.id,'sandbox','TEST_ONLY_CLIENT']);
    await q('update finance_private.settings set batch_handoff_enabled=false');
    assert.equal((await snapshot(originalManual.id)).sender_batch_header.email_message,oldMessage);
    assert.equal((await snapshot(originalBatch.id)).sender_batch_header.email_subject,oldSubject);
    priorBook=await book();priorDefinitions=await definitions();
    await db.exec(readFileSync(resolve('supabase/migrations',NOTIFICATION_MIGRATION),'utf8'));
    assert.deepEqual(await book(),priorBook);
  });
  await check('La migración solo cambia los dos textos de las funciones y conserva seguridad y ACL',async()=>{
    const expected=priorDefinitions.map(d=>({...d,prosrc:d.prosrc.replace(oldSubject,newSubject).replace(oldMessage,newMessage)}));
    assert.deepEqual(await definitions(),expected);
    for(const role of ['anon','authenticated','service_role'])for(const fn of ['paypal_payout_begin(uuid,text,text)','finance_batch_prepare_payout(uuid,text,text)']){
      const row=(await q("select has_function_privilege($1,$2,'EXECUTE') as allowed",[role,fn]))[0];assert.equal(row.allowed,role==='service_role');
    }
  });
  await check('Recuperar un retiro anterior devuelve exactamente su payload original',async()=>{
    const claim=await rpc('paypal_payout_claim',[CREATOR,originalManual.id,'sandbox','TEST_ONLY_CLIENT']);
    assert.equal(claim.operation,'submit');assert.deepEqual(claim.payload,priorBook.snapshots.find(s=>s.payout_id===originalManual.id).request_body);
    assert.equal((await snapshot(originalManual.id)).sender_batch_header.email_message,oldMessage);
  });
  await check('Preparar otra vez un ítem histórico no cambia su snapshot ni crea otro retiro',async()=>{
    assert.deepEqual(await rpc('finance_batch_prepare_payout',[item.id,'sandbox','TEST_ONLY_CLIENT']),originalBatch);
    assert.equal((await q('select * from payouts')).length,2);
    assert.deepEqual(await snapshot(originalBatch.id),priorBook.snapshots.find(s=>s.payout_id===originalBatch.id).request_body);
  });
  await check('Un retiro manual nuevo tiene correo neutral y sigue reservado, sin declararse pagado',async()=>{
    await f.reset();await f.sale();const p=await begin(),body=await snapshot(p.id);
    assert.equal(body.sender_batch_header.email_subject,newSubject);assert.equal(body.sender_batch_header.email_message,newMessage);
    assert.equal(body.sender_batch_header.sender_batch_id,p.id);assert.equal(body.items[0].sender_item_id,p.id);
    assert.equal(body.items[0].amount.value,'156.80');assert.equal(body.items[0].receiver,'mariana@example.invalid');
    assert.equal((await q('select status from payouts where id=$1',[p.id]))[0].status,'sending');
    assert.equal(Number((await q('select creator_available_balance($1) as amount',[CREATOR]))[0].amount),0);
    assert.equal((await q("select * from finance_journal where kind='payout_confirmed'")).length,0);
  });
  await check('El correo de un lote nuevo es neutral y la ejecución continúa apagada por defecto',async()=>{
    await f.reset();await f.sale();const preview=await rpc('finance_overview');
    const batch=await rpc('finance_batch_freeze',[randomUUID(),preview.cutoff,preview.quote_hash]);
    const i=(await rpc('finance_batch_detail',[batch.id])).items[0];
    await assert.rejects(()=>rpc('finance_batch_prepare_payout',[i.id,'sandbox','TEST_ONLY_CLIENT']),/deshabilitada/);
    assert.equal((await q('select * from payouts')).length,0);
    // Only this disposable fixture enables preparation; no HTTP is possible here.
    await q('update finance_private.settings set batch_handoff_enabled=true');
    const p=await rpc('finance_batch_prepare_payout',[i.id,'sandbox','TEST_ONLY_CLIENT']);
    const body=await snapshot(p.id);assert.equal(body.sender_batch_header.email_subject,newSubject);assert.equal(body.sender_batch_header.email_message,newMessage);
    assert.equal((await q('select status from payouts where id=$1',[p.id]))[0].status,'sending');
    await q('update finance_private.settings set batch_handoff_enabled=false');
  });
  await build({entryPoints:['src/lib/payoutMessages.ts'],outfile:join(temp,'messages.mjs'),bundle:true,format:'esm',platform:'node',logLevel:'silent'});
  const {payoutRequestMessage,sendingPayoutNote}=await import(pathToFileURL(join(temp,'messages.mjs')).href);
  await check('Solo un estado paid explícito permite anunciar la entrega',async()=>{
    assert.match(payoutRequestMessage('paid',49),/confirmó la entrega de \$49\.00/);
    for(const state of ['sending',undefined]){
      const message=payoutRequestMessage(state,49);assert.doesNotMatch(message,/confirmó la entrega|ya están|Retiro pagado/);assert.match(message,/saldo sigue apartado/);
    }
  });
  await check('Pendiente, sin reclamar, retenido e incierto no prometen entrega ni liberación anticipada',async()=>{
    for(const state of ['PENDING','NEW','PROCESSING','UNCLAIMED','ONHOLD','BLOCKED','SUBMISSION_UNCERTAIN','RECOVERY_PENDING','MANUAL_REVIEW','SUCCESS','UNKNOWN',undefined])
      assert.doesNotMatch(sendingPayoutNote(state),/confirmó la entrega|ya están|volvió a tu saldo|30 días/);
    assert.match(sendingPayoutNote('UNCLAIMED'),/cuando PayPal confirme la devolución/);
    assert.match(sendingPayoutNote('PENDING'),/entrega todavía no está confirmada/);
    assert.match(sendingPayoutNote('ONHOLD'),/en revisión/);
  });
  console.log(`\n${passed} comprobaciones de mensajes y migración satisfactorias; sin red, correos ni producción.`);
} catch(error){console.error(error);process.exitCode=1;}
finally{if(f)await f.db.close();rmSync(temp,{recursive:true,force:true});}
