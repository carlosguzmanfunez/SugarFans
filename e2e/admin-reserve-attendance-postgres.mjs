import {createDbTest} from './db-harness.mjs';
const DB='fr_admin_reserve_attendance_test';
const {setup,user,psql,as,raises,check,expect,finish}=createDbTest(DB);
finish(async()=>{
 setup();
 const admin=user('attendance-admin@example.invalid','admin'),creator=user('attendance-creator@example.invalid','creator'),fan=user('attendance-fan@example.invalid','fan');
 psql(DB,`update public.profiles set role='admin' where id='${admin}'`);
 const cp=psql(DB,`select creator_profile_id from profiles where id='${creator}'`);
 let counter=0;
 const book=(title,hour,status='confirmed',modality='virtual',zone='UTC',day='2026-11-04')=>{
  const person=user(`attendance-booking-${++counter}@example.invalid`,'fan');
  return psql(DB,`insert into vip_bookings(experience_id,creator_profile_id,title,creator_name,price,fan_id,fan_name,fan_email,date,time,status,duration_minutes,time_zone,details)
 values('custom','${cp}','${title}','Mariana QA',25,'${person}','Fan QA','attendance-fan@example.invalid','${day}','${hour}','${status}',15,'${zone}','{"kind":"custom","modality":"${modality}"}') returning id`);
 };
 const a=book('Platiquemos QA','12:00'),b=book('Clase QA','13:00'),literal=book('Texto 50%_literal','14:00'),future=book('Por comenzar QA','15:00','confirmed','virtual','UTC','2026-11-20');
 book('Solicitud sin confirmar','17:00','pending');
 book('Cancelada sin constancia','18:00','cancelled');
 const inZone=book('Día anterior en hora operativa','02:00','completed','virtual','UTC','2026-11-05');
 const query=(who,from='2026-11-04',to='2026-11-04',search='',offset=0,limit=20)=>JSON.parse(as(who,`select reserve_admin_session_list('${from}','${to}','${search}',${offset},${limit})`));
 const eventCount=()=>psql(DB,'select count(*) from reserve_session_events');
 const txCount=()=>psql(DB,'select count(*) from transactions');
 const beforeEvents=eventCount(),beforeTx=txCount();
 await check('Solo administración enumera reservas; fan, creador y visitante son rechazados',()=>{
  raises(()=>query(fan),/Solo administración/,'fan');raises(()=>query(creator),/Solo administración/,'creador');
  raises(()=>psql(DB,"set role anon;select reserve_admin_session_list('2026-11-04','2026-11-04')"),/permission denied/,'visitante');
  raises(()=>psql(DB,"set role service_role;select reserve_admin_session_list('2026-11-04','2026-11-04')"),/permission denied/,'servicio sin identidad');
  expect(query(admin).items.length===4,'inventario incorrecto');
 });
 await check('La lista entrega identidad, reserva y constancia, sin correos ni mensajes',()=>{
  const row=query(admin).items.find(x=>x.booking_id===a);
  expect(row.creator_name==='Mariana QA'&&row.fan_name==='Fan QA','faltan nombres');
  expect(row.receipt.booking_id===a&&Array.isArray(row.receipt.events),'falta constancia');
  expect(!JSON.stringify(row).includes('@example.invalid')&&!('message' in row),'expuso campos innecesarios');
 });
 await check('Fechas aplicadas a la hora operativa UTC−6 y no al día del servidor',()=>{
  expect(query(admin).items.some(x=>x.booking_id===inZone),'perdió la reserva del día anterior');
  expect(!query(admin,'2026-11-05','2026-11-05').items.some(x=>x.booking_id===inZone),'clasificó por fecha UTC');
 });
 await check('Búsqueda literal por persona, título o referencia, sin convertir % y _ en comodines',()=>{
  expect(query(admin,'2026-11-04','2026-11-04','mariana').items.length===4,'búsqueda por creador');
  expect(query(admin,'2026-11-04','2026-11-04','Fan QA').items.length===4,'búsqueda por fan');
  expect(query(admin,'2026-11-04','2026-11-04','50%_').items[0].booking_id===literal,'comodines interpretados');
  expect(query(admin,'2026-11-04','2026-11-04',b).items[0].booking_id===b,'referencia');
 });
 await check('Paginación estable y consulta vacía diferenciada de error',()=>{
  const first=query(admin,'2026-11-04','2026-11-04','',0,2),second=query(admin,'2026-11-04','2026-11-04','',2,2);
  expect(first.has_more&&!second.has_more,'paginación incorrecta');
  expect(new Set([...first.items,...second.items].map(r=>r.booking_id)).size===4,'duplicó filas entre páginas');
  expect(query(admin,'2026-11-06','2026-11-06').items.length===0,'vacío incorrecto');
  expect(query(admin,'2026-11-20','2026-11-20').items[0].booking_id===future,'perdió próxima');
 });
 await check('Rechaza intervalos, búsquedas y páginas excesivas',()=>{
  for(const [from,to,search,offset,limit]of[['2026-11-05','2026-11-04','',0,20],['2020-01-01','2026-11-04','',0,20],['2026-11-04','2026-11-04','x'.repeat(121),0,20],['2026-11-04','2026-11-04','',-1,20],['2026-11-04','2026-11-04','',0,1000]])
   raises(()=>query(admin,from,to,search,offset,limit),/Revisa las fechas/,'límite');
 });
 await check('Consultar la lista no crea eventos, avisos, transacciones ni modifica asistencia',()=>{
  expect(eventCount()===beforeEvents&&txCount()===beforeTx,'escribió datos');
  expect(psql(DB,"select has_table_privilege('authenticated','public.reserve_session_events','SELECT')")==='f','abrió tablas privadas');
  expect(psql(DB,'select reminders_enabled from reserve_session_settings')==='f','activó avisos');
 });
});
