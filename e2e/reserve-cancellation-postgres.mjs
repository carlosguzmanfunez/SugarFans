// Reserve cancellation rule on a real local PostgreSQL with every migration:
// refunds in Créditos, the creator's share, tickets, date changes and paying
// with Créditos. No provider calls, credentials or production data.
import {createDbTest} from './db-harness.mjs';
const DB='fr_reserve_cancel_test';
const {setup,user,psql,as,raises,check,expect,finish}=createDbTest(DB);
finish(async()=>{
 setup();
 const creator=user('rc-creator@example.invalid','creator');
 const fan=user('rc-fan@example.invalid','fan');
 const other=user('rc-other@example.invalid','fan');
 const cp=psql(DB,`select creator_profile_id from profiles where id='${creator}'`);
 const method=psql(DB,`insert into payment_methods(user_id,kind,label) values('${fan}','card','Visa QA') returning id`);
 let slot=0;
 // A booking that starts `hours` from now, in Honduras time like the creator's clock.
 const booking=(hours,status='accepted',details='{"kind":"custom"}',price=20)=>{
  slot++;
  const at=`(now()+interval '${hours} hours'+interval '${slot} minutes') at time zone 'America/Tegucigalpa'`;
  return psql(DB,`insert into vip_bookings(experience_id,creator_profile_id,title,creator_name,price,fan_id,fan_name,fan_email,date,time,status,details,time_zone)
   values('custom','${cp}','QA cancelación','Creadora QA',${price},'${fan}','Fan QA','rc-fan@example.invalid',(${at})::date,to_char(${at},'HH24:MI'),'${status}','${details}','America/Tegucigalpa') returning id`);
 };
 // Paid like the PayPal path does (server-side, as the fan).
 const pay=id=>psql(DB,`select set_config('request.jwt.claim.sub','${fan}',false) \\g /dev/null
  select vip_pay_booking('${id}','${method}')`);
 const wallet=uid=>Number(psql(DB,`select coin_balance('${uid}')`));
 const tx=id=>psql(DB,`select amount||'/'||creator_share||'/'||creator_refund_loss||'/'||status from transactions where key='vip:${id}'`).split('/');
 const earned=id=>Number(psql(DB,`select round(amount*creator_share-creator_refund_loss,2) from transactions where key='vip:${id}'`));
 const status=id=>psql(DB,`select status from vip_bookings where id='${id}'`);
 const cancel=(uid,id)=>JSON.parse(as(uid,`select reserve_cancel('${id}')`));

 await check('Antes de pagar: el fan cancela sin costo y no recibe créditos',()=>{
  const id=booking(72);const r=cancel(fan,id);
  expect(!r.paid&&r.refundCoins===0,'movió dinero');expect(status(id)==='cancelled','no canceló');expect(wallet(fan)===0,'dio créditos');
 });
 await check('Con más de 24 h: 100% en créditos y el creador no gana nada',()=>{
  const id=booking(72);pay(id);const before=earned(id);expect(before>0,'la venta no acreditó al creador');
  const r=cancel(fan,id);
  expect(r.refundPercent===100&&r.refundCoins===2000,'reembolso '+JSON.stringify(r));
  expect(wallet(fan)===2000,'billetera '+wallet(fan));expect(earned(id)===0,'el creador conserva '+earned(id));
  expect(tx(id)[3]==='paid','la venta original cambió de estado');
 });
 await check('Con menos de 24 h: 50% en créditos y el creador conserva la mitad',()=>{
  const id=booking(5);pay(id);const full=earned(id);const r=cancel(fan,id);
  expect(r.refundPercent===50&&r.refundCoins===1000,'reembolso '+JSON.stringify(r));
  expect(wallet(fan)===3000,'billetera '+wallet(fan));
  expect(Math.abs(earned(id)-full/2)<=0.01,`el creador debía conservar ${full/2} y conserva ${earned(id)}`);
 });
 await check('El saldo del creador baja con la cancelación (libro y saldo disponibles)',()=>{
  const book=()=>Number(psql(DB,`select coalesce(sum(amount),0) from finance_sources where creator_profile_id='${cp}'`));
  const id=booking(96);pay(id);const before=book();
  cancel(fan,id);const after=book();
  expect(after<before,`saldo antes ${before}, después ${after}`);
 });
 await check('Si cancela el creador: 100% al fan, aunque falten menos de 24 h, y cuenta en su historial',()=>{
  const id=booking(3);pay(id);const w=wallet(fan);const r=cancel(creator,id);
  expect(r.by==='creator'&&r.refundPercent===100,'regla del creador '+JSON.stringify(r));
  expect(wallet(fan)===w+2000,'no devolvió 100%');expect(earned(id)===0,'el creador conserva ganancia');
  expect(psql(DB,`select details->'cancellation'->>'by' from vip_bookings where id='${id}'`)==='creator','no quedó registrado');
  expect(psql(DB,`select count(*) from notifications where user_id='${fan}' and title like '%canceló tu reserva'`)==='1','sin aviso al fan');
 });
 await check('Nadie cancela una experiencia que ya empezó ni una ya cancelada; un extraño no la ve',()=>{
  const id=booking(-1,'confirmed');
  raises(()=>cancel(fan,id),/ya empezó/,'ya empezó');
  const done=booking(48);pay(done);cancel(fan,done);
  raises(()=>cancel(fan,done),/ya no se puede cancelar/,'doble cancelación');
  raises(()=>cancel(other,booking(48)),/no encontrada/,'extraño');
 });
 await check('Una venta con devolución o disputa en curso no se cancela automáticamente',()=>{
  const id=booking(48);pay(id);psql(DB,`update transactions set status='disputed' where key='vip:${id}'`);
  raises(()=>cancel(fan,id),/devolución o disputa/,'disputa');
 });
 await check('Pagar otra Reserve con los créditos devueltos acredita al creador como una venta',()=>{
  const w=wallet(fan);const id=booking(48,'accepted','{"kind":"custom"}',25);
  as(fan,`select reserve_pay_with_credits('${id}')`);
  expect(status(id)==='confirmed','no confirmó');expect(wallet(fan)===w-2500,'no descontó créditos');
  expect(earned(id)>0&&tx(id)[3]==='paid','el creador no recibió la venta');
  expect(psql(DB,`select method_label from transactions where key='vip:${id}'`)==='Créditos','método');
  // Cancelling it again gives the Créditos back by the same rule.
  cancel(fan,id);expect(wallet(fan)===w,'no volvió el 100%');
 });
 await check('Sin créditos suficientes no se paga ni se toca la reserva',()=>{
  const id=booking(48,'accepted','{"kind":"custom"}',500);
  raises(()=>as(fan,`select reserve_pay_with_credits('${id}')`),/suficientes créditos/,'saldo');
  expect(status(id)==='accepted','cambió la reserva');
  raises(()=>as(other,`select reserve_pay_with_credits('${id}')`),/no encontrada/,'otro fan');
 });
 await check('Los créditos devueltos también sirven para regalos',()=>{
  const gift=psql(DB,`select id from gift_catalog where coins<=${wallet(fan)} order by coins desc limit 1`);
  const w=wallet(fan);const coins=Number(psql(DB,`select coins from gift_catalog where id='${gift}'`));
  as(fan,`select send_gift('${cp}','Creadora QA','${gift}',null,'',null)`);
  expect(wallet(fan)===w-coins,'el regalo no descontó');
 });
 await check('Ticket de Meta: vuelve si se cancela con tiempo y se pierde con menos de 24 h',()=>{
  const ticket=()=>psql(DB,`insert into experience_tickets(fan_id,creator_profile_id,experience_id,experience_title,amount,bonus)
   values('${fan}','${cp}','custom','QA',20,'thank-you') returning id`);
  const early=ticket(),a=booking(72,'pending',`{"kind":"custom","ticketId":"${early}"}`);
  psql(DB,`update experience_tickets set booking_id='${a}' where id='${early}'`);psql(DB,`update vip_bookings set status='confirmed' where id='${a}'`);
  const w=wallet(fan);cancel(fan,a);
  expect(psql(DB,`select status from experience_tickets where id='${early}'`)==='active','el ticket no volvió');expect(wallet(fan)===w,'dio créditos por un ticket');
  const late=ticket(),b=booking(4,'pending',`{"kind":"custom","ticketId":"${late}"}`);
  psql(DB,`update experience_tickets set booking_id='${b}' where id='${late}'`);psql(DB,`update vip_bookings set status='confirmed' where id='${b}'`);
  cancel(fan,b);expect(psql(DB,`select status from experience_tickets where id='${late}'`)==='used','el ticket volvió con menos de 24 h');
 });
 await check('Cambio de fecha: uno gratis, con 24 h, y el creador acepta o rechaza',()=>{
  const id=booking(72);pay(id);
  const day=psql(DB,`select to_char(current_date+10,'YYYY-MM-DD')`);
  raises(()=>as(fan,`select reserve_request_reschedule('${id}',current_date,'00:00','')`),/24 horas/,'fecha demasiado cerca');
  as(fan,`select reserve_request_reschedule('${id}','${day}','15:00','Me surgió un viaje')`);
  raises(()=>as(fan,`select reserve_request_reschedule('${id}','${day}','16:00','')`),/espera la respuesta/,'doble pedido');
  expect(status(id)==='confirmed','la reserva dejó de estar confirmada mientras espera');
  as(creator,`select reserve_respond_reschedule('${id}',false)`);
  expect(psql(DB,`select details ? 'reschedule' from vip_bookings where id='${id}'`)==='f','no se limpió el pedido');
  as(fan,`select reserve_request_reschedule('${id}','${day}','15:00','')`);
  raises(()=>as(other,`select reserve_respond_reschedule('${id}',true)`),/no encontrada/,'un fan respondió');
  as(creator,`select reserve_respond_reschedule('${id}',true)`);
  expect(psql(DB,`select to_char(date,'YYYY-MM-DD')||' '||time from vip_bookings where id='${id}'`)===`${day} 15:00`,'no movió la fecha');
  raises(()=>as(fan,`select reserve_request_reschedule('${id}','${day}','18:00','')`),/Ya usaste/,'segundo cambio');
  const late=booking(10);pay(late);
  raises(()=>as(fan,`select reserve_request_reschedule('${late}','${day}','11:00','')`),/24 horas de anticipación/,'menos de 24 h');
 });
 await check('Un creador que cancela reservas pagadas pierde la marca de fiable',()=>{
  expect(psql(DB,`select reward_reliable('${cp}',now())`)==='f','sigue fiable tras cancelar');
 });
 await check('Fans y visitantes solo leen sus propios créditos devueltos; nadie los escribe',()=>{
  expect(as(fan,'select count(*) from credit_grants')!=='0','el fan no ve sus créditos devueltos');
  expect(as(other,'select count(*) from credit_grants')==='0','otro fan ve créditos ajenos');
  raises(()=>as(fan,`insert into credit_grants(user_id,coins,reason) values('${fan}',999999,'reserve_cancel')`),/permission denied|row-level security/,'escritura directa');
  for(const fn of ['reserve_cancel(uuid)','reserve_pay_with_credits(uuid)'])
   expect(psql(DB,`select has_function_privilege('anon','public.${fn}','execute')`)==='f','anon ejecuta '+fn);
 });
});
