import {createDbTest} from './db-harness.mjs';
import {spawn} from 'node:child_process';
const DB='fr_reserve_controls_test',{setup,user,psql,as,raises,check,expect,finish}=createDbTest(DB);
let seq=0,cp=[],creators=[],admin;
const fan=()=>user('fan-'+(++seq)+'@example.invalid','fan');
const booking=(f,creator,status='accepted',kind='experience',time='12:00',days=20)=>psql(DB,`insert into vip_bookings(experience_id,creator_profile_id,title,creator_name,price,fan_id,fan_name,fan_email,date,time,status,details,time_zone)
 values('custom','${creator}','Prueba Reserve','QA',100,'${f}','Fan','qa@example.invalid',current_date+${days},'${time}','${status}','{"kind":"${kind}"}','America/Tegucigalpa') returning id`);
const age=(id,interval)=>psql(DB,`alter table vip_bookings disable trigger aa_reserve_fan_lifecycle;update vip_bookings set payment_due_at=now()+interval '${interval}' where id='${id}';alter table vip_bookings enable trigger aa_reserve_fan_lifecycle;`);
const access=f=>JSON.parse(as(f,'select reserve_access()'));
const expire=f=>psql(DB,`select reserve_expire_payments('${f}')`);
const cancel=(f,id,choice='original',reason='voluntary')=>JSON.parse(as(f,`select reserve_cancel_v2('${id}','${choice}','${reason}')`));
const paid=(f,creator,index=0,verified=false)=>{
 const id=booking(f,creator,'accepted','experience','12:00',40+seq);
 const method=psql(DB,`insert into payment_methods(user_id,kind,label) values('${f}','paypal','PayPal QA') returning id`);
 const order='ORDER-RESERVE-'+(++seq),ref='CAP-RESERVE-'+seq;
 psql(DB,`insert into paypal_orders(id,user_id,kind,params,amount) values('${order}','${f}','booking',jsonb_build_object('bookingId','${id}'),100)`);
 let receipt='';
 if(verified)receipt=psql(DB,`insert into finance_private.collection_receipts(environment,sender,kind,reference,gross,fee,order_id,payment_kind,payer_id,creator_profile_id,proof)
 values('sandbox','QA','capture','${ref}',100,5.70,'${order}','booking','${f}','${creator}','{"fixture":"synthetic trusted receipt"}') returning id`);
 psql(DB,`select set_config('request.jwt.claim.sub','${f}',false) \\g NUL
 select set_config('fansreserve.collection_receipt','${receipt}',false) \\g NUL
 select set_config('fansreserve.paypal_ref','${ref}',false) \\g NUL
 select vip_pay_booking('${id}','${method}')`);
 return {id,order,ref,tx:psql(DB,`select id from transactions where key='vip:${id}'`)};
};
finish(async()=>{
 setup();
 for(let i=0;i<5;i++){creators[i]=user('rc-creator-'+i+'@example.invalid','creator');cp[i]=psql(DB,`select creator_profile_id from profiles where id='${creators[i]}'`);}
 admin=user('rc-admin@example.invalid','admin');
 psql(DB,`update profiles set role='admin' where id='${admin}'`);
 await check('Una reserva por creador y tres reservas con creadores diferentes',()=>{
  const f=fan();booking(f,cp[0]);
  raises(()=>booking(f,cp[0],'accepted','experience','14:00'),/una reserva activa/,'duplicada');
  booking(f,cp[1]);booking(f,cp[2]);
  raises(()=>booking(f,cp[3]),/hasta tres reservas/,'cuarta');
  expect(access(f).reservations===3,'conteo de reservas');
 });
 await check('Una propuesta por creador y hasta tres propuestas; no ocupan la agenda',()=>{
  const f=fan();booking(f,cp[0],'pending','custom','02:00');
  raises(()=>booking(f,cp[0],'pending','custom','03:00'),/una propuesta activa/,'propuesta duplicada');
  booking(f,cp[1],'pending','custom','02:00');booking(f,cp[2],'pending','custom','02:00');
  raises(()=>booking(f,cp[3],'pending','custom','02:00'),/hasta tres propuestas/,'cuarta propuesta');
  expect(psql(DB,`select count(*) from reserve_taken_slots('${cp[0]}') where time='02:00'`)==='0','propuesta bloqueó agenda');
 });
 await check('Reserva y propuesta son cupos independientes por creador',()=>{
  const f=fan();booking(f,cp[3],'accepted','experience','16:00');booking(f,cp[3],'pending','custom','17:00');
  expect(access(f).reservations===1&&access(f).proposals===1,'mezcló cupos');
 });
 await check('Publicada vence en 15 minutos; propuesta aceptada permite 2 horas',()=>{
  const f=fan(),a=booking(f,cp[4],'accepted','experience','12:00'),b=booking(f,cp[1],'pending','custom','16:00');
  expect(psql(DB,`select payment_due_at between now()+interval '14 minutes' and now()+interval '16 minutes' from vip_bookings where id='${a}'`)==='t','no aplicó 15 min');
  as(creators[1],`select vip_update_booking('${b}','accepted')`);
  expect(psql(DB,`select payment_due_at between now()+interval '119 minutes' and now()+interval '121 minutes' from vip_bookings where id='${b}'`)==='t','no aplicó 2 horas');
 });
 await check('Tres impagos bloquean exactamente 72 horas desde el último vencimiento',()=>{
  const f=fan(),ids=[booking(f,cp[0],'accepted','experience','18:00'),booking(f,cp[1],'accepted','experience','18:00'),booking(f,cp[2],'accepted','experience','18:00')];
  ids.forEach((id,i)=>age(id,`-${3-i} minutes`));expire(f);expire(f);
  const a=access(f);expect(a.unpaid===3&&!!a.blockedUntil,'no suspendió o duplicó incidencias');
  expect(psql(DB,`select blocked_until=(select max(occurred_at)+interval '72 hours' from reserve_policy_incidents where fan_id='${f}') from reserve_access_blocks where fan_id='${f}'`)==='t','hora de desbloqueo incorrecta');
  raises(()=>booking(f,cp[3],'pending','custom','18:00'),/suspendido/,'nuevo apartado suspendido');
 });
 await check('Tres cancelaciones voluntarias bloquean; cancelar sigue permitido',()=>{
  const f=fan();
  for(let i=0;i<3;i++){const id=booking(f,cp[3],'accepted','experience','18:00');cancel(f,id);}
  expect(access(f).cancelled===3&&!!access(f).blockedUntil,'no suspendió por cancelaciones');
 });
 await check('La revocación legal no genera penalización ni obliga a recibir Créditos',()=>{
  const f=fan(),p=paid(f,cp[4],0,true);const r=cancel(f,p.id,'original','withdrawal');
  expect(r.refundState==='pending'&&r.refundCoins===0,'acreditó Créditos');
  expect(access(f).cancelled===0,'penalizó derecho legal');
  expect(psql(DB,`select reason||'/'||state||'/'||amount from reserve_refund_requests where booking_id='${p.id}'`)==='withdrawal/pending/100.00','solicitud legal incorrecta');
 });
 await check('El creador cancela: 100% al fan sin emisión paralela de Créditos',()=>{
  const f=fan(),p=paid(f,cp[0],0,true),r=cancel(creators[0],p.id);
  expect(r.refundPercent===100&&r.refundCoins===0,'importe incorrecto');
  expect(psql(DB,`select count(*) from credit_grants where booking_id='${p.id}'`)==='0','doble resarcimiento');
  expect(access(f).cancelled===0,'penalizó al fan');
 });
 await check('Comisión comprobada por incumplimiento: cargo separado único y corrección si PayPal devuelve parte',()=>{
  const f=fan(),p=paid(f,cp[1],0,true);cancel(creators[1],p.id);
  const request=psql(DB,`select id from reserve_refund_requests where booking_id='${p.id}'`);
  expect(psql(DB,`select count(*) from finance_adjustments where reference like 'reserve-failure/${request}/%'`)==='0','cobró antes de comprobar la devolución');
  psql(DB,`update transactions set refunded_amount=100,refunded_gateway_fee=0 where id='${p.tx}'`);
  expect(psql(DB,`select sum(amount) from finance_adjustments where reference like 'reserve-failure/${request}/%'`)==='-5.70','no recuperó USD 5.70');
  psql(DB,`update transactions set refunded_amount=100 where id='${p.tx}'`);
  expect(psql(DB,`select count(*) from finance_adjustments where reference like 'reserve-failure/${request}/%'`)==='1','duplicó cargo');
  psql(DB,`update transactions set refunded_gateway_fee=1 where id='${p.tx}'`);
  expect(psql(DB,`select sum(amount) from finance_adjustments where reference like 'reserve-failure/${request}/%'`)==='-4.70','no devolvió al creador costo acreditado por PayPal');
  psql(DB,`update transactions set refunded_gateway_fee=5.70 where id='${p.tx}'`);
  expect(Number(psql(DB,`select sum(amount) from finance_adjustments where reference like 'reserve-failure/${request}/%'`))===0,'retuvo un costo que PayPal devolvió');
 });
 await check('Un costo estimado no se descuenta como si fuera comprobado',()=>{
  const f=fan(),p=paid(f,cp[2]);cancel(creators[2],p.id);
  psql(DB,`update transactions set refunded_amount=100 where id='${p.tx}'`);
  const r=psql(DB,`select id from reserve_refund_requests where booking_id='${p.id}'`);
  expect(psql(DB,`select count(*) from finance_adjustments where reference like 'reserve-failure/${r}/%'`)==='0','cobró estimación');
 });
 await check('Un cobro incierto conserva el horario y no genera impago',()=>{
  const f=fan(),id=booking(f,cp[3],'accepted','experience','22:00'),o='ORDER-UNCERTAIN-'+(++seq);
  psql(DB,`insert into paypal_orders(id,user_id,kind,params,amount) values('${o}','${f}','booking',jsonb_build_object('bookingId','${id}'),100);set role service_role;select reserve_capture_begin('${o}','${f}')`);
  age(id,'-5 minutes');expire(f);
  expect(psql(DB,`select status||'/'||payment_checking::text from vip_bookings where id='${id}'`)==='accepted/true','liberó fondos inciertos');
  expect(access(f).unpaid===0,'penalizó pago incierto');
 });
 await check('Después del vencimiento no se inicia un cobro nuevo',()=>{
  const f=fan(),id=booking(f,cp[4],'accepted','experience','22:00'),o='ORDER-EXPIRED-'+(++seq);age(id,'-1 minute');
  psql(DB,`insert into paypal_orders(id,user_id,kind,params,amount) values('${o}','${f}','booking',jsonb_build_object('bookingId','${id}'),100)`);
  raises(()=>psql(DB,`set role service_role;select reserve_capture_begin('${o}','${f}')`),/plazo para pagar/,'captura tardía');
 });
 await check('La devolución se reclama una sola vez incluso si se pierde la respuesta',()=>{
  const f=fan(),p=paid(f,cp[4],0,true);cancel(creators[4],p.id);
  const id=psql(DB,`select id from reserve_refund_requests where booking_id='${p.id}'`);
  const a=JSON.parse(as(admin,`select reserve_refund_claim('${id}')`)),b=JSON.parse(as(admin,`select reserve_refund_claim('${id}')`));
  expect(a.send===true&&b.send===false,'se enviarían dos devoluciones');
 });
 await check('Fans no pueden quitar bloqueos, aprobar devoluciones ni manipular comprobantes',()=>{
  const f=fan();
  raises(()=>as(f,`insert into reserve_access_blocks(fan_id,blocked_until,reason) values('${f}',now(),'unpaid')`),/permission denied/,'bloqueo manipulable');
  raises(()=>as(f,`select reserve_refund_decide(gen_random_uuid(),'approve','Una decisión de prueba')`),/admin|administr|permis|equipo|propietario/i,'aprobación ajena');
  expect(psql(DB,"select has_function_privilege('authenticated','public.reserve_capture_begin(text,uuid)','execute')")==='f','captura pública');
  expect(psql(DB,"select has_function_privilege('authenticated','finance_private.reserve_recover_failure_fee(uuid)','execute')")==='f','ajuste público');
 });
 await check('Una cancelación pagada se clasifica antes de sancionar; la revisión legal queda excluida',()=>{
  const f=fan(),p=paid(f,cp[0],0,true);cancel(f,p.id);
  expect(access(f).cancelled===0,'penalizó antes de revisar derechos');
  const id=psql(DB,`select id from reserve_refund_requests where booking_id='${p.id}'`);
  as(admin,`select reserve_refund_decide('${id}','legal','Corresponde el derecho de revocación; devolver el total sin sancionar')`);
  expect(access(f).cancelled===0,'penalizó devolución legal');
  expect(psql(DB,`select reason||'/'||amount from reserve_refund_requests where id='${id}'`)==='withdrawal/100.00','no conservó devolución legal completa');
 });
 await check('El bloqueo no impide pagar o cancelar reservas existentes',()=>{
  const f=fan(),a=booking(f,cp[0],'accepted','experience','02:00',80),b=booking(f,cp[1],'accepted','experience','02:00',80);
  for(let i=0;i<3;i++){const id=booking(f,cp[2],'accepted','experience','02:00',80);cancel(f,id);}
  expect(!!access(f).blockedUntil,'no generó bloqueo');
  const method=psql(DB,`insert into payment_methods(user_id,kind,label) values('${f}','paypal','PayPal QA') returning id`);
  psql(DB,`do $$begin perform set_config('request.jwt.claim.sub','${f}',true);perform set_config('fansreserve.paypal_ref','CAP-EXISTING-QA',true);perform vip_pay_booking('${a}','${method}');end$$;`);
  expect(psql(DB,`select status from vip_bookings where id='${a}'`)==='confirmed','impidió pagar reserva existente');
  cancel(f,b);
  expect(psql(DB,`select status from vip_bookings where id='${b}'`)==='cancelled','impidió cancelar');
 });
 await check('Dos conexiones no pueden exceder simultáneamente el máximo de tres reservas',async()=>{
  const f=fan();booking(f,cp[0],'accepted','experience','06:00',85);booking(f,cp[1],'accepted','experience','06:00',85);
  const insert=c=>new Promise(resolve=>{const child=spawn('psql',['-X','-q','-At','-v','ON_ERROR_STOP=1','-d',DB],{windowsHide:true,stdio:'pipe'});let error='';child.stderr.on('data',x=>error+=x);child.on('close',code=>resolve({code,error}));child.stdin.end(`begin;insert into vip_bookings(experience_id,creator_profile_id,title,creator_name,price,fan_id,fan_name,fan_email,date,time,status,details,time_zone) values('custom','${c}','Carrera de cupos','QA',25,'${f}','Fan','qa@example.invalid',current_date+85,'06:00','accepted','{"kind":"custom"}','America/Tegucigalpa');select pg_sleep(0.2);commit;`);});
  const attempts=await Promise.all([insert(cp[2]),insert(cp[3])]);
  expect(attempts.filter(x=>x.code===0).length===1,JSON.stringify(attempts));
  expect(access(f).reservations===3,'permitió cuatro reservas');
 });
 await check('Una propuesta pendiente no impide reservar, pero aceptarla después detecta el conflicto',()=>{
  const first=fan(),second=fan(),a=booking(first,cp[3],'pending','custom','09:00',88);
  booking(second,cp[3],'accepted','experience','09:00',88);
  raises(()=>as(creators[3],`select vip_update_booking('${a}','accepted')`),/ya no está disponible/,'aceptación superpuesta');
  expect(psql(DB,`select status from vip_bookings where id='${a}'`)==='pending','alteró la propuesta rechazada');
 });
 await check('Aceptar solicitudes de un evento no supera sus plazas aunque las pendientes no las ocupen',()=>{
  const details=`jsonb_build_object('format','event','eventDate',to_char(current_date+30,'YYYY-MM-DD'),'eventTime','20:00','modality','virtual','locationTypes',jsonb_build_array('online'),'maxParticipants',2,'approval','manual','minNoticeHours',24,'requirements',jsonb_build_object('verifiedFans',false,'subscribersOnly',false),'cancellationPolicy','moderate')`;
  const event=as(creators[4],`insert into vip_experiences(creator_profile_id,creator_name,title,type,price,duration_minutes,time_zone,details) values('${cp[4]}','QA','Evento QA','qa-session',25,30,'America/Tegucigalpa',${details}) returning id`);
  const ids=[fan(),fan(),fan()].map(f=>as(f,`select reserve_book_event_in_zone('${event}','QA','America/Tegucigalpa')`));
  as(creators[4],`select vip_update_booking('${ids[0]}','accepted')`);as(creators[4],`select vip_update_booking('${ids[1]}','accepted')`);
  raises(()=>as(creators[4],`select vip_update_booking('${ids[2]}','accepted')`),/No quedan plazas/,'evento sobrevendido');
 });
});
