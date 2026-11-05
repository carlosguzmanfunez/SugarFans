// Reserve refunds keep PayPal's collection fee on voluntary cancellations
// (migration 20261105000003). Usage: PGHOST=localhost npm run test:reserve-refund-fee-db
import {createDbTest} from './db-harness.mjs';
import {spawn} from 'node:child_process';
const DB='fr_reserve_refund_fee_test',{setup,user,psql,as,raises,check,expect,finish}=createDbTest(DB);
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
// Move a paid booking so it starts in a few hours (less than 24 h away).
const soon=id=>psql(DB,`alter table vip_bookings disable trigger user;update vip_bookings set date=((now() at time zone 'America/Tegucigalpa')+interval '3 hours')::date,time=to_char((now() at time zone 'America/Tegucigalpa')+interval '3 hours','HH24:00') where id='${id}';alter table vip_bookings enable trigger user;`);
const req=id=>psql(DB,`select reason||'/'||amount from reserve_refund_requests where booking_id='${id}'`);
const keep=tx=>psql(DB,`select round(amount*creator_share-creator_refund_loss,2) from transactions where id='${tx}'`);
const money=n=>({currency_code:'USD',value:n.toFixed(2)});
const lit=v=>"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'";
const approve=id=>as(admin,`select reserve_refund_decide((select id from reserve_refund_requests where booking_id='${id}'),'approve','Cancelación revisada por QA')`);
// PayPal confirms a refund on the original capture (fictitious sandbox receipt).
const paypalRefund=(p,amount,feeBack=0)=>{
 const id='RF-'+(++seq),ev=JSON.parse(psql(DB,`set role service_role;select paypal_refund_receive('sandbox','QA',${lit({id:'EV-'+id,event_type:'PAYMENT.CAPTURE.REFUNDED',resource:{id}})})`)).id;
 const payment={id:p.ref,status:'PARTIALLY_REFUNDED',amount:money(100)};
 const proof={id,status:'COMPLETED',amount:money(amount),seller_payable_breakdown:{paypal_fee:money(feeBack)},links:[{rel:'up',href:'https://api-m.sandbox.paypal.com/v2/payments/captures/'+p.ref}]};
 return JSON.parse(psql(DB,`set role service_role;select paypal_refund_apply('${ev}','${p.ref}',${lit(proof)},${lit(payment)})`));
};
const holds=c=>psql(DB,`select count(*) from finance_payout_holds where user_id='${c}'`);
const cases=tx=>psql(DB,`select count(*) from finance_incidents where code='DISPUTE_CASE' and reference='${tx}' and state='open'`);
finish(async()=>{
 setup();
 admin=user('rf-admin@example.invalid','fan');psql(DB,`update profiles set role='admin' where id='${admin}'`);
 for(let i=0;i<8;i++){creators[i]=user('rf-creator-'+i+'@example.invalid','creator');cp[i]=psql(DB,`select creator_profile_id from profiles where id='${creators[i]}'`);}
 console.log('\nDevoluciones de Reserve sin la comisión de PayPal (pago de USD 100, comisión USD 5.70)');
 await check('Cancela 24 h o más antes: devuelve 100% menos la comisión y el creador no cobra',()=>{
  const f=fan(),p=paid(f,cp[0],0,true),r=cancel(f,p.id);
  expect(r.refundAmount===94.3&&r.refundFee===5.7,`resultado ${JSON.stringify(r)}`);
  expect(req(p.id)==='voluntary/94.30',`solicitud ${req(p.id)}`);
  expect(keep(p.tx)==='0.00',`el creador conserva ${keep(p.tx)}`);
 });
 await check('Cancela con menos de 24 h: 50% menos la comisión; lo que queda se reparte como una venta',()=>{
  const f=fan(),p=paid(f,cp[1],0,true);soon(p.id);const r=cancel(f,p.id);
  expect(r.refundPercent===50&&r.refundAmount===44.3,`resultado ${JSON.stringify(r)}`);
  expect(keep(p.tx)==='40.00',`el creador conserva ${keep(p.tx)} (esperado 80% de 50)`);
 });
 await check('Elegir Créditos devuelve el importe completo, sin descontar la comisión',()=>{
  const f=fan(),p=paid(f,cp[2],0,true),r=cancel(f,p.id,'credits');
  expect(r.refundCoins===10000,`Créditos ${r.refundCoins}`);
 });
 await check('Si cancela el creador, el fan recibe el 100% sin descuento',()=>{
  const f=fan(),p=paid(f,cp[3],0,true),r=cancel(creators[3],p.id);
  expect(req(p.id)==='creator_cancelled/100.00',`solicitud ${req(p.id)}`);
 });
 await check('La revocación legal devuelve el 100% sin descuento',()=>{
  const f=fan(),p=paid(f,cp[4],0,true);cancel(f,p.id,'original','withdrawal');
  expect(req(p.id)==='withdrawal/100.00',`solicitud ${req(p.id)}`);
 });
 await check('PayPal devuelve justo lo pedido (94.30): se aplica sin caso de revisión ni bloqueo al creador',()=>{
  const f=fan(),p=paid(f,cp[5],0,true);cancel(f,p.id);approve(p.id);
  const r=paypalRefund(p,94.3);
  expect(r.state==='applied',`resultado ${JSON.stringify(r)}`);
  expect(holds(creators[5])==='0',`bloqueos ${holds(creators[5])}`);
  expect(cases(p.tx)==='0',`casos abiertos ${cases(p.tx)}`);
  expect(psql(DB,`select state from reserve_refund_requests where booking_id='${p.id}'`)==='completed','la solicitud no quedó completada');
  expect(keep(p.tx)==='0.00',`el creador conserva ${keep(p.tx)}`);
 });
 await check('Si PayPal devuelve otro importe, se mantiene la alerta y el bloqueo de seguridad',()=>{
  const f=fan(),p=paid(f,cp[6],0,true);cancel(f,p.id);approve(p.id);
  const r=paypalRefund(p,50);
  expect(r.state==='applied',`resultado ${JSON.stringify(r)}`);
  expect(holds(creators[6])==='1',`bloqueos ${holds(creators[6])}`);
  expect(cases(p.tx)==='1',`casos abiertos ${cases(p.tx)}`);
 });
 await check('Si PayPal devuelve parte de su comisión, se abre revisión para devolvérsela al fan',()=>{
  const f=fan(),p=paid(f,cp[7],0,true);cancel(f,p.id);approve(p.id);
  const r=paypalRefund(p,94.3,1.2);
  expect(r.state==='applied',`resultado ${JSON.stringify(r)}`);
  expect(cases(p.tx)==='1',`casos abiertos ${cases(p.tx)}`);
 });
});
