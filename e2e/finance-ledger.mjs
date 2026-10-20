import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { financeFixture,ADMIN,CREATOR,OTHER } from './helpers/finance-fixture.mjs';

let f,passed=0;
try {
 f=await financeFixture();const {db,q,clock,auth,reset,sale,rpc}=f;
 const balance=async(user=CREATOR)=>Number((await q('select creator_available_balance($1) as n',[user]))[0].n);
 const overview=()=>rpc('finance_overview');
 const freeze=async(key=randomUUID(),quote)=>{const o=quote??await overview();return rpc('finance_batch_freeze',[key,o.cutoff,o.quote_hash]);};
 const batch=async(id)=>(await rpc('finance_batch_detail',[id]));
 const begin=()=>rpc('paypal_payout_begin',[CREATOR,'sandbox','TEST_CLIENT']);
 const journal=()=>q('select * from finance_journal order by sequence');
 const assertBooks=async()=>{
   const totals=(await q("select coalesce(sum(case when credit_account='creator_payable' then amount when debit_account='creator_payable' then -amount else 0 end),0) as payable from finance_journal where creator_profile_id='creator'"))[0];
   const pending=Number((await q("select coalesce(sum(amount),0) as n from finance_sources where creator_profile_id='creator' and eligible_at>=payout_credit_cutoff(now())"))[0].n);
   assert.equal(Number(totals.payable)-pending,await balance());
   const trial=(await overview()).trial_balance;assert.equal(trial.reduce((s,x)=>s+Number(x.debit),0).toFixed(2),trial.reduce((s,x)=>s+Number(x.credit),0).toFixed(2));
 };
 const check=async(name,fn)=>{await reset();await fn();await assertBooks();passed++;console.log('OK '+name);};
 await check('Registra ganancias con dos lados de igual importe sin reconocer dinero en banco',async()=>{
   await sale();assert.equal(await balance(),160);const j=await journal();assert.equal(j.length,1);assert.equal(Number(j[0].amount),160);assert.equal(j[0].debit_account,'operating_clearing');
 });
 await check('Respeta centavos acumulados, fracciones de comisión y el corte UTC−6',async()=>{
   await sale('a','creator',.05,.85,'2026-10-26T05:59:59.999Z');await sale('b','creator',.05,.85,'2026-10-26T05:59:59.999Z');await sale('c','creator',.05,.85,'2026-10-26T06:00:00Z');
   assert.equal(await balance(),.09);assert.equal(Number((await q("select sum(amount) as n from finance_sources where creator_profile_id='creator'"))[0].n),.13);
   await clock('2026-11-26T06:00:00Z');assert.equal(await balance(),.13);
 });
 await check('Una operación repetida sin cambios no vuelve a contabilizar',async()=>{
   await sale();const n=(await journal()).length;await q("update transactions set status=status");assert.equal((await journal()).length,n);
 });
 await check('Aparta un lote por cierre y cada centavo tiene una ganancia de origen',async()=>{
   await sale();await sale('diego','other',100);const b=await freeze();const detail=await batch(b.id);assert.equal(detail.items.length,2);assert.equal(await balance(),0);
   const item=detail.items.find(x=>x.user_id===CREATOR);assert.equal(Number(item.gross),160);assert.equal(item.allocations.reduce((s,a)=>s+Number(a.amount),0),160);assert.equal(item.allocations[0].source,'sale');
 });
 await check('No duplica la reserva al repetir la misma referencia',async()=>{
   await sale();const key=randomUUID(),o=await overview(),b=await freeze(key,o);assert.equal((await freeze(key,o)).id,b.id);assert.equal((await q('select * from finance_allocations')).length,1);
 });
 await check('Rechaza un segundo lote activo del mismo cierre',async()=>{
   await sale();await freeze();await assert.rejects(freeze,/ya tiene un lote/);assert.equal(await balance(),0);
 });
 await check('No congela un saldo distinto del que revisó el administrador',async()=>{
   await sale();const o=await overview();await sale('more','creator',100);await assert.rejects(()=>freeze(randomUUID(),o),/saldos cambiaron/);assert.equal((await q('select * from finance_batches')).length,0);
 });
 await check('El dinero nuevo después del 26 queda para el siguiente ciclo',async()=>{
   await sale();const b=await freeze();await sale('next','creator',300,.8,'2026-10-26T06:00:00Z');assert.equal(await balance(),0);const item=(await batch(b.id)).items[0];assert.equal(Number(item.gross),160);
   assert.equal(Number((await overview()).creators.find(x=>x.user_id===CREATOR).next_cycle),240);
 });
 await check('Un retiro manual no puede usar el dinero apartado',async()=>{
   await sale();await freeze();await assert.rejects(begin,/al menos/);assert.equal((await q('select * from payouts')).length,0);
 });
 await check('Un retiro manual previo no se asigna otra vez al lote',async()=>{
   await sale();await begin();await sale('other','other',100);const b=await freeze();const item=(await batch(b.id)).items.find(x=>x.user_id===CREATOR);assert.equal(item,undefined);assert.equal(await balance(),0);
 });
 await check('La ventana del 26 al 1 impide congelar el día 25 y el día 2',async()=>{
   await sale();for(const at of ['2026-10-25T20:00:00Z','2026-11-02T06:00:00Z']) {await clock(at);await assert.rejects(freeze,/26 al 1/);}
 });
 await check('KYC, mínimo, destinatario y disputas quedan explicados sin apartar dinero',async()=>{
   await sale();await sale('other','other',100);await q('update profiles set is_verified=false where id=$1',[CREATOR]);const b=await freeze();const i=(await batch(b.id)).items.find(x=>x.user_id===CREATOR);assert.equal(i.state,'held');assert.equal(i.reason,'IDENTITY_REQUIRED');assert.equal(await balance(),160);
 });
 await check('Liberar un lote sin envíos conserva el historial y permite otra versión',async()=>{
   await sale();const b=await freeze();await rpc('finance_batch_cancel',[b.id,'Corrección de la lista de creadores']);assert.equal(await balance(),160);await rpc('finance_batch_cancel',[b.id,'Repetición de liberación']);
   const next=await freeze();assert.equal((await batch(next.id)).version,2);assert.notEqual(next.id,b.id);assert.equal((await q('select * from finance_allocations')).length,2);
 });
 await check('Un reembolso tras congelar el lote exige revisión sin liberar la reserva',async()=>{
   await sale();const b=await freeze();await q("update transactions set status='refunded'");const item=(await batch(b.id)).items[0];assert.equal(item.state,'review');assert.equal(await balance(),-160);
   await rpc('finance_batch_cancel',[b.id,'Reembolso confirmado antes de preparar envíos']);assert.equal(await balance(),0);
 });
 await check('Una disputa cubierta por la plataforma conserva la ganancia, sin duplicarla',async()=>{
   await sale();await q("update transactions set status='disputed',platform_covers=true");assert.equal(await balance(),160);await q("update transactions set platform_covers=false");assert.equal(await balance(),0);await q("update transactions set status='paid'");assert.equal(await balance(),160);
 });
 await check('Correcciones positivas pasan al siguiente corte y la reversión conserva su fecha',async()=>{
   await sale();const a=await rpc('finance_creator_adjust',[CREATOR,10,'Bonificación de una incidencia aprobada',randomUUID(),'CASE-1',null]);assert.equal(await balance(),160);
   await rpc('finance_creator_adjust',[CREATOR,-10,'Reversión de bonificación equivocada',randomUUID(),'CASE-1-REV',a.id]);assert.equal(await balance(),160);await clock('2026-11-26T12:00:00Z');assert.equal(await balance(),160);
 });
 await check('Una corrección negativa reduce saldo enseguida y su reversión lo restaura',async()=>{
   await sale();const key=randomUUID(),args=[CREATOR,-10,'Corrección respaldada por caso contable',key,'CASE-2',null],a=await rpc('finance_creator_adjust',args);await rpc('finance_creator_adjust',args);assert.equal(await balance(),150);
   await assert.rejects(()=>rpc('finance_creator_adjust',[CREATOR,-11,args[2],key,'CASE-2',null]),/reutilizada/);
   await rpc('finance_creator_adjust',[CREATOR,10,'Anulación de descuento por error comprobado',randomUUID(),'CASE-2-REV',a.id]);assert.equal(await balance(),160);
 });
 await check('La ejecución de lotes está deshabilitada incluso para el servidor',async()=>{
   await sale();const b=await freeze(),i=(await batch(b.id)).items[0];await db.exec('set role service_role');
   try {await assert.rejects(()=>rpc('finance_batch_prepare_payout',[i.id,'sandbox','TEST_CLIENT']),/deshabilitada/);}finally{await db.exec('reset role');}
   assert.equal((await q('select * from payouts')).length,0);
 });
 await check('Handoff virtual usa el importe y destinatario congelados sin descontar dos veces',async()=>{
   await sale();const b=await freeze(),i=(await batch(b.id)).items[0];await q('update finance_private.settings set batch_handoff_enabled=true');
   const p=await rpc('finance_batch_prepare_payout',[i.id,'sandbox','TEST_CLIENT']);assert.equal(Number(p.net),156.8);assert.equal(await balance(),0);assert.equal((await rpc('finance_batch_prepare_payout',[i.id,'sandbox','TEST_CLIENT'])).id,p.id);
   const s=(await q('select * from paypal_payout_submissions'))[0];assert.equal(s.request_body.items[0].receiver,'mariana@example.invalid');assert.equal((await q('select * from finance_allocations')).length,1);
   await assert.rejects(()=>rpc('finance_batch_cancel',[b.id,'No liberar fondos de un envío ya preparado']),/ya tiene envíos/);
   await q("update payouts set status='paid' where id=$1",[p.id]);assert.equal(await balance(),0);await q("update payouts set status='failed' where id=$1",[p.id]);assert.equal(await balance(),160);
   await q("update payouts set status='paid' where id=$1",[p.id]);assert.equal(await balance(),0);
 });
 await check('Un destinatario cambiado impide preparar el lote',async()=>{
   await sale();const b=await freeze(),i=(await batch(b.id)).items[0];await q('update finance_private.settings set batch_handoff_enabled=true');await q("update payout_accounts set paypal_email='changed@example.invalid' where user_id=$1",[CREATOR]);
   await assert.rejects(()=>rpc('finance_batch_prepare_payout',[i.id,'sandbox','TEST_CLIENT']),/revisión/);assert.equal((await q('select * from payouts')).length,0);
 });
 await check('Los asientos, asignaciones y las cifras congeladas rechazan edición y borrado',async()=>{
   await sale();await freeze();for(const sql of ["update finance_journal set amount=1","delete from finance_journal","delete from finance_allocations","update finance_batch_items set gross=gross+1","update finance_batches set cutoff=now()"])
     await assert.rejects(()=>q(sql),/inmutable|historial/);
 });
 await check('Un fallo al asignar revierte lote y asientos en la misma transacción',async()=>{
   await sale();const n=(await journal()).length;await db.exec("create function finance_test_fail() returns trigger language plpgsql as $$begin raise exception 'TEST allocator unavailable';end;$$;create trigger finance_test_fail before insert on finance_allocations for each row execute function finance_test_fail()");
   try {await assert.rejects(freeze,/TEST allocator/);assert.equal((await q('select * from finance_batches')).length,0);assert.equal((await journal()).length,n);assert.equal(await balance(),160);}
   finally{await db.exec('drop trigger finance_test_fail on finance_allocations;drop function finance_test_fail()');}
 });
 await check('Exporta el diario del mes sin confundir UTC con la fecha de Honduras',async()=>{
   await sale();const rows=await rpc('finance_journal_export',['2026-10-01']);assert.equal(rows.length,1);assert.equal(rows[0].currency,'USD');assert.equal((await rpc('finance_journal_export',['2026-11-01'])).length,0);
 });
 await check('Solo el administrador opera lotes; cada creador consulta únicamente su saldo',async()=>{
   await sale();await db.exec('set role authenticated');await auth(CREATOR);
   try {
     await assert.rejects(overview,/administradores/);await assert.rejects(()=>q('select * from finance_journal'),/permission denied/);
     for(const [fn,args] of [['finance_batch_detail',[randomUUID()]],['finance_batch_cancel',[randomUUID(),'Motivo documentado']],['finance_batch_freeze',[randomUUID(),'2026-10-26T06:00:00Z','hash']],['finance_creator_adjust',[CREATOR,10,'Motivo documentado',randomUUID(),'AUTH-TEST',null]],['finance_journal_export',['2026-10-01']]])
       await assert.rejects(()=>rpc(fn,args),/administradores/);
     await assert.rejects(()=>rpc('finance_batch_prepare_payout',[randomUUID(),'sandbox','TEST_CLIENT']),/permission denied/);
     const own=await rpc('finance_creator_balance');assert.equal(Number(own.available),160);await auth(OTHER);assert.equal(Number((await rpc('finance_creator_balance')).available),0);
   }
   finally {await db.exec('reset role');await auth(ADMIN);}
   for(const role of ['anon','authenticated','service_role']) for(const t of ['finance_accounts','finance_sources','finance_source_revisions','finance_allocations','finance_journal','finance_batches','finance_batch_items','finance_adjustments','finance_private.settings']) {
     const x=(await q("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') as access,relrowsecurity as rls from pg_class where oid=$2::regclass",[role,t]))[0];assert.equal(x.access,false);assert.equal(x.rls,true);
   }
   for(const role of ['anon','authenticated','service_role'])assert.equal((await q("select has_schema_privilege($1,'finance_private','USAGE') as access",[role]))[0].access,false);
 });
 await check('La reserva original y un retiro manual posterior utilizan ganancias distintas',async()=>{
   await sale();const b=await freeze();await sale('late-credit','creator',100,.8,'2026-10-24T10:00:00Z');assert.equal(await balance(),80);
   const p=await begin();assert.equal(Number((await q('select amount from payouts where id=$1',[p.id]))[0].amount),80);assert.equal(await balance(),0);
   const assignments=await q('select s.reference,a.payout_id,a.batch_item_id,a.amount from finance_allocations a join finance_sources s on s.id=a.source_id');
   assert.equal(assignments.find(x=>x.payout_id)?.reference,'late-credit');assert.equal(assignments.find(x=>x.batch_item_id)?.reference,'sale');
   assert.equal(Number((await batch(b.id)).items[0].gross),160);
 });
 await check('Un reembolso redistribuye centavos sin alterar el redondeo global del saldo',async()=>{
   for(const id of ['a','b','c'])await sale(id,'creator',.05,.85);assert.equal(await balance(),.13);await q("update transactions set status='refunded' where id='a'");assert.equal(await balance(),.09);
   await q("update transactions set status='paid' where id='a'");assert.equal(await balance(),.13);assert.ok((await q('select * from finance_source_revisions')).length>3);
 });
 await check('Cancelar no cambia el importe histórico del lote ni aparta a quienes estaban retenidos',async()=>{
   await sale();await sale('other','other',100);await q('update profiles set is_verified=false where id=$1',[OTHER]);const b=await freeze();const before=(await overview()).batches.find(x=>x.id===b.id).gross;
   await rpc('finance_batch_cancel',[b.id,'Cancelar lote sin modificar el total original']);assert.equal((await overview()).batches.find(x=>x.id===b.id).gross,before);assert.equal(Number(before),160);
 });
 await check('Un ítem con cambios tras el cierre no puede pasar al envío virtual',async()=>{
   await sale();const b=await freeze();await q("update transactions set status='disputed'");await q('update finance_private.settings set batch_handoff_enabled=true');
   const item=(await batch(b.id)).items[0];await assert.rejects(()=>rpc('finance_batch_prepare_payout',[item.id,'sandbox','TEST_CLIENT']),/no disponible/);assert.equal((await q('select * from payouts')).length,0);
 });
 await check('La referencia única evita repetir una corrección con una clave nueva',async()=>{
   await sale();await rpc('finance_creator_adjust',[CREATOR,-5,'Descuento documentado para un caso único',randomUUID(),'UNIQUE-CASE',null]);
   await assert.rejects(()=>rpc('finance_creator_adjust',[CREATOR,-5,'Descuento documentado para un caso único',randomUUID(),'UNIQUE-CASE',null]),/unique|duplicate/);assert.equal(await balance(),155);
 });
 await check('La exportación toma el mes de Honduras incluso en la medianoche UTC',async()=>{
   await clock('2026-11-01T05:59:59Z');await sale();assert.equal((await rpc('finance_journal_export',['2026-10-01'])).length,1);assert.equal((await rpc('finance_journal_export',['2026-11-01'])).length,0);
   await clock('2026-11-01T06:00:00Z');await sale('later','creator',10);assert.equal((await rpc('finance_journal_export',['2026-11-01'])).length,1);
 });
 const imported=await financeFixture({beforeMigration:async({q})=>{
   await q("insert into profiles values($1,'creator','Apertura','creator',true,false)",[CREATOR]);await q("insert into transactions values('opening','creator',.15,.85,'paid',false,'2026-09-20T12:00:00Z')");
 }});
 try{assert.equal(Number((await imported.q('select creator_available_balance($1) as n',[CREATOR]))[0].n),.13);assert.equal((await imported.q('select * from transactions'))[0].status,'paid');assert.equal((await imported.q('select * from finance_journal')).length,1);passed++;console.log('OK Apertura usa una instantánea actual sin reescribir las transacciones originales');}finally{await imported.db.close();}
 await assert.rejects(()=>financeFixture({beforeMigration:async({q})=>{
   await q("insert into profiles values($1,'creator','Histórico','creator',true,false)",[CREATOR]);await q("insert into payouts(user_id,amount,net,fee,status) values($1,100,98,2,'paid')",[CREATOR]);
 }}),/Conciliar los retiros históricos/);passed++;console.log('OK La migración rechaza retiros históricos sin asignación en vez de inventar su apertura');
 console.log(`\n${passed} comprobaciones del ledger y lotes satisfactorias; sin producción ni red.`);
} catch(error) {console.error(error.message);if(error.where)console.error(error.where);process.exitCode=1;}
finally {if(f)await f.db.close();}
