// Real local PostgreSQL, committed transactions and complete migrations.
// No provider calls, credentials or production data.
import {createDbTest} from './db-harness.mjs';
const DB='fr_reserve_time_zones_test';
const {setup,user,psql,as,raises,check,expect,finish}=createDbTest(DB);
finish(async()=>{
 setup();
 const creator=user('tz-creator@example.invalid','creator');
 const fan=user('tz-fan@example.invalid','fan');
 const cp=psql(DB,`select creator_profile_id from profiles where id='${creator}'`);
 const availability=zone=>as(creator,`insert into vip_availability(creator_profile_id,time_zone)
  values('${cp}',${zone===null?'null':"'"+zone+"'"}) on conflict(creator_profile_id) do update set time_zone=excluded.time_zone`);
 const custom=(day,zone='null')=>psql(DB,`insert into vip_bookings
  (experience_id,creator_profile_id,title,creator_name,price,fan_id,fan_name,fan_email,date,time,status,details,time_zone)
  values('custom','${cp}','QA timezone','QA',20,'${fan}','Fan','tz-fan@example.invalid',current_date+${day},'18:00','pending','{"kind":"custom"}',${zone}) returning id`);
 const saved=id=>psql(DB,`select time_zone from vip_bookings where id='${id}'`);
 await check('Valida Honduras y Madrid, conserva ausencia de zona y rechaza una zona inventada',()=>{
  expect(psql(DB,"select valid_time_zone('America/Tegucigalpa') and valid_time_zone('Europe/Madrid') and valid_time_zone(null) and not valid_time_zone('Marte/Olympus')")==='t','validación incorrecta');
 });
 await check('Reserva 1:1 guarda la zona del horario del creador al confirmar la transacción',()=>{
  availability('America/Tegucigalpa');const id=custom(40);expect(saved(id)==='America/Tegucigalpa','no copió la zona');
  expect(psql(DB,`select ((date+time::time) at time zone time_zone) = ((date+time::time+interval '6 hours') at time zone 'UTC') from vip_bookings where id='${id}'`)==='t','instante UTC incorrecto');
 });
 await check('Un cambio posterior de disponibilidad no mueve la reserva ya creada',()=>{
  const id=custom(41);availability('Europe/Madrid');expect(saved(id)==='America/Tegucigalpa','la reserva histórica cambió');
  expect(saved(custom(42))==='Europe/Madrid','la nueva reserva no usó el nuevo horario');
 });
 await check('Un evento conserva su propia zona aunque la disponibilidad use otra',()=>{
  const details=`jsonb_build_object('modality','virtual','locationTypes',jsonb_build_array('online'),'format','event',
   'eventDate',to_char(current_date+5,'YYYY-MM-DD'),'eventTime','20:00','includes','[]'::jsonb,'excludes','[]'::jsonb,
   'requirements',jsonb_build_object('verifiedFans',false,'subscribersOnly',false),'minNoticeHours',24,
   'maxParticipants',3,'approval','automatic','cancellationPolicy','moderate')`;
  const event=as(creator,`insert into vip_experiences(creator_profile_id,creator_name,title,type,price,duration_minutes,details,time_zone)
   values('${cp}','QA','Evento QA','qa-session',20,60,${details},'America/Tegucigalpa') returning id`);
  const booking=as(fan,`select reserve_book_event_seat('${event}','Zona de prueba')`);
  expect(saved(booking)==='America/Tegucigalpa','el evento tomó el horario de disponibilidad');
 });
 await check('Rechaza zonas inválidas sin dejar reservas ni cambiar disponibilidad',()=>{
  const before=psql(DB,'select count(*) from vip_bookings');
  raises(()=>custom(43,"'Marte/Olympus'"),/time_zone_check/,'zona inválida');
  raises(()=>availability('Marte/Olympus'),/time_zone_check/,'horario inválido');
  expect(psql(DB,'select count(*) from vip_bookings')===before,'persistió una reserva inválida');
  expect(psql(DB,`select time_zone from vip_availability where creator_profile_id='${cp}'`)==='Europe/Madrid','cambió el horario rechazado');
 });
 await check('Una zona explícita válida se conserva y las reservas heredadas admiten null',()=>{
  expect(saved(custom(44,"'America/New_York'"))==='America/New_York','sobrescribió una zona explícita');
  availability(null);expect(saved(custom(45))==='','asignó una zona inexistente');
 });
 await check('Honduras permanece UTC−6 y Madrid respeta invierno y verano',()=>{
  expect(psql(DB,"select ('2026-11-02 18:00'::timestamp at time zone 'America/Tegucigalpa') at time zone 'Europe/Madrid'")==='2026-11-03 01:00:00','invierno incorrecto');
  expect(psql(DB,"select ('2026-07-01 18:00'::timestamp at time zone 'America/Tegucigalpa') at time zone 'Europe/Madrid'")==='2026-07-02 02:00:00','verano incorrecto');
 });
 await check('El trigger no es una acción pública ejecutable por fans o visitantes',()=>{
  for(const role of ['anon','authenticated'])expect(psql(DB,`select has_function_privilege('${role}','public.reserve_booking_time_zone()','execute')`)==='f','trigger ejecutable por '+role);
 });
});
