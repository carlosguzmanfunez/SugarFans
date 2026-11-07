// PayPal dispute dossier + chargeback fee decision (admin only), on a local
// throwaway Postgres with every migration applied.
import {createDbTest} from './db-harness.mjs';
const DB='fr_reserve_dispute_dossier_test';
const {setup,user,psql,as,raises,check,expect,finish}=createDbTest(DB);
finish(async()=>{
 setup();
 const admin=user('dossier-admin@example.invalid','admin'),creator=user('dossier-creator@example.invalid','creator'),fan=user('dossier-fan@example.invalid','fan');
 psql(DB,`update public.profiles set role='admin' where id='${admin}'`);
 const cp=psql(DB,`select creator_profile_id from profiles where id='${creator}'`);
 const booking=psql(DB,`insert into vip_bookings(experience_id,creator_profile_id,title,creator_name,price,fan_id,fan_name,fan_email,date,time,status,duration_minutes,time_zone,details,paid_at)
  values('custom','${cp}','Llamada QA','Mariana QA',25,'${fan}','Fan QA','dossier-fan@example.invalid','2026-11-04','12:00','confirmed',15,'UTC','{"kind":"custom","modality":"virtual"}',now()) returning id`);
 psql(DB,`insert into paypal_orders(id,user_id,kind,params,amount,status,capture_id,fee,completed_at)
  values('5O190127TN364715T','${fan}','booking',jsonb_build_object('bookingId','${booking}'),25,'completed','8AB12345CD678901E',1.65,now())`);
 const dossier=(who,ref)=>JSON.parse(as(who,`select reserve_admin_dispute_dossier('${ref}')`));
 const assign=(who,payer,fee=10,key='11111111-1111-4111-8111-111111111111')=>JSON.parse(as(who,`select reserve_dispute_fee_assign('8AB12345CD678901E',${fee},'${payer}','${key}','prueba')`));
 const beforeTx=psql(DB,'select count(*) from transactions');
 await check('Solo administración prepara el expediente',()=>{
  raises(()=>dossier(fan,booking),/Solo administración/,'fan');raises(()=>dossier(creator,booking),/Solo administración/,'creador');
  raises(()=>psql(DB,`set role anon;select reserve_admin_dispute_dossier('${booking}')`),/permission denied/,'visitante');
 });
 await check('Encuentra la reserva por referencia, pedido o ID de transacción de PayPal',()=>{
  for(const ref of [booking,'5O190127TN364715T','8ab12345cd678901e'])expect(dossier(admin,ref).booking.id===booking,`no encontró ${ref}`);
  raises(()=>dossier(admin,'ZZZZZZZZZZ'),/No encontramos/,'inexistente');
  raises(()=>dossier(admin,'x or 1=1'),/Escribe la referencia/,'referencia inválida');
 });
 await check('Incluye pago, comisión, términos, constancia y solicitudes',()=>{
  const d=dossier(admin,booking);
  expect(d.payments[0].capture_id==='8AB12345CD678901E'&&Number(d.payments[0].fee)===1.65,'falta el pago');
  expect(d.attendance&&d.attendance.booking_id===booking&&Array.isArray(d.attendance.events),'falta la constancia');
  expect(Array.isArray(d.fan.terms_history)&&Array.isArray(d.refund_requests)&&Array.isArray(d.disputes),'faltan secciones');
  expect(psql(DB,'select count(*) from transactions')===beforeTx,'escribió transacciones');
 });
 await check('Solo administración decide quién paga el contracargo',()=>{
  raises(()=>assign(creator,'platform'),/Solo administración/,'creador');raises(()=>assign(fan,'creator'),/Solo administración/,'fan');
  raises(()=>assign(admin,'nadie'),/Indica la comisión/,'pagador inválido');raises(()=>assign(admin,'creator',0),/Indica la comisión/,'importe cero');
 });
 await check('Si paga el creador: ajuste negativo en su saldo y aviso en la campana',()=>{
  const before=Number(psql(DB,`select coalesce(creator_available_balance('${creator}'),0)`));
  const r=assign(admin,'creator');
  expect(r.payer==='creator'&&r.adjustment_id&&r.payment_ref==='8AB12345CD678901E','no registró la decisión');
  expect(Number(psql(DB,`select amount from finance_adjustments where id='${r.adjustment_id}'`))===-10,'ajuste incorrecto');
  expect(psql(DB,`select reference from finance_adjustments where id='${r.adjustment_id}'`)==='CONTRACARGO/8AB12345CD678901E','referencia');
  const after=Number(psql(DB,`select coalesce(creator_available_balance('${creator}'),0)`));
  expect(Math.round((before-after)*100)===1000,`el saldo no bajó 10: ${before} → ${after}`);
  expect(psql(DB,`select count(*) from notifications where user_id='${creator}' and title like 'Descuento por contracargo%'`)==='1','sin aviso');
 });
 await check('La decisión es única: repetir no descuenta dos veces y cambiarla exige reversión',()=>{
  const again=assign(admin,'creator');
  expect(psql(DB,`select count(*) from finance_adjustments where reference like 'CONTRACARGO/%'`)==='1','duplicó el ajuste');
  expect(again.payer==='creator','respuesta');
  raises(()=>assign(admin,'platform',10,'22222222-2222-4222-8222-222222222222'),/Ya se decidió/,'cambio');
  raises(()=>psql(DB,'delete from reserve_dispute_fees'),/inmutable/,'borrado');
 });
 await check('Si paga Fans Reserve: se registra sin tocar el saldo del creador',()=>{
  const b2=psql(DB,`insert into vip_bookings(experience_id,creator_profile_id,title,creator_name,price,fan_id,fan_name,fan_email,date,time,status,duration_minutes,time_zone,details)
   values('custom','${cp}','Llamada 2','Mariana QA',25,'${fan}','Fan QA','x@example.invalid','2026-11-05','12:00','confirmed',15,'UTC','{"kind":"custom","modality":"virtual"}') returning id`);
  const before=psql(DB,`select count(*) from finance_adjustments`);
  const r=JSON.parse(as(admin,`select reserve_dispute_fee_assign('${b2}',10,'platform','33333333-3333-4333-8333-333333333333','')`));
  expect(r.payer==='platform'&&r.adjustment_id===null,'decisión');
  expect(psql(DB,`select count(*) from finance_adjustments`)===before,'tocó el saldo');
  expect(psql(DB,`select count(*) from reserve_dispute_fees`)==='2','no registró');
 });
 await check('Creador ve solo las decisiones de sus reservas; el fan no ve nada',()=>{
  expect(as(creator,'select count(*) from reserve_dispute_fees')==='2','creador');
  expect(as(fan,'select count(*) from reserve_dispute_fees')==='0','fan');
 });
});
