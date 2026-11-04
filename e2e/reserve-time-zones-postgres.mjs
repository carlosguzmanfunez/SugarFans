// Real local PostgreSQL, committed transactions and complete migrations.
// No provider calls, credentials or production data.
import {createDbTest} from './db-harness.mjs';
import {spawn} from 'node:child_process';
const DB='fr_reserve_time_zones_test';
const {setup,user,psql,as,raises,check,expect,finish}=createDbTest(DB);
finish(async()=>{
 setup();
 // This suite isolates clock invariants with a shared fan. Fan quotas and expiry
 // are exercised with independent accounts in reserve-controls-postgres.mjs.
 psql(DB,'alter table vip_bookings disable trigger aa_reserve_fan_lifecycle');
 const creator=user('tz-creator@example.invalid','creator');
 const fan=user('tz-fan@example.invalid','fan');
 const cp=psql(DB,`select creator_profile_id from profiles where id='${creator}'`);
 const availability=zone=>as(creator,`insert into vip_availability(creator_profile_id,time_zone)
  values('${cp}',${zone===null?'null':"'"+zone+"'"}) on conflict(creator_profile_id) do update set time_zone=excluded.time_zone`);
 const custom=(day,zone='null',time='18:00')=>psql(DB,`insert into vip_bookings
  (experience_id,creator_profile_id,title,creator_name,price,fan_id,fan_name,fan_email,date,time,status,details,time_zone)
  values('custom','${cp}','QA timezone','QA',20,'${fan}','Fan','tz-fan@example.invalid',current_date+${day},'${time}','accepted','{"kind":"custom"}',${zone}) returning id`);
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
 await check('No permite mover una reserva existente cambiando su zona horaria',()=>{
  availability('America/Tegucigalpa'); const id=custom(50);
  raises(()=>psql(DB,`update vip_bookings set time_zone='Europe/Madrid' where id='${id}'`),/zona horaria.*no se cambia/,'reserva histórica');
  expect(saved(id)==='America/Tegucigalpa','se movió la reserva');
 });
 await check('Impide reservar la misma hora real después de cambiar la zona del creador',()=>{
  raises(()=>custom(50,"'America/New_York'",'19:00'),/ya no está disponible/,'mismo instante en otro país');
  const id=custom(50,"'America/New_York'",'20:00');
  expect(saved(id)==='America/New_York','bloqueó una hora contigua libre');
  const sameWallTime=custom(50,"'Europe/Madrid'",'18:00');
  expect(saved(sameWallTime)==='Europe/Madrid','confundió la misma hora escrita con el mismo instante');
 });
 await check('Rechaza la hora que desaparece en el cambio de horario de verano',()=>{
  raises(()=>custom("(date '2027-03-28'-current_date)","'Europe/Madrid'",'02:30'),/hora no existe/,'hora inexistente');
 });
 await check('La hora repetida coincide con la conversión del navegador',()=>{
  expect(psql(DB,"select ('2026-11-01 01:30'::timestamp at time zone 'America/New_York') at time zone 'UTC'")==='2026-11-01 06:30:00','hora repetida distinta');
 });
 await check('Las confirmaciones por correo indican la zona guardada y no la del servidor',()=>{
  const id=custom(51,"'America/Tegucigalpa'");
  psql(DB,`insert into email_outbox(user_id,booking_id,to_email,subject,body) values('${fan}','${id}','tz-fan@example.invalid','QA','Tu reserva está confirmada')`);
  expect(psql(DB,`select body like '%America/Tegucigalpa%' from email_outbox where booking_id='${id}'`)==='t','correo sin zona');
 });
 await check('El calendario público revela solo intervalos y las funciones internas siguen cerradas',()=>{
  expect(psql(DB,`select count(*) > 0 from reserve_taken_slots('${cp}') where time_zone='America/Tegucigalpa'`)==='t','falta zona de ocupación');
  for(const name of ['reserve_email_clock','reserve_event_clock_guard','reserve_clock_conflict'])
   expect(psql(DB,`select has_function_privilege('authenticated','public.${name}()','execute')`)==='f','función interna expuesta');
 });
 await check('Dos conexiones independientes no reservan el mismo instante en zonas diferentes',async()=>{
  const insert=(time,zone)=>new Promise(resolve=>{
   const process=spawn('psql',['-X','-q','-At','-v','ON_ERROR_STOP=1','-d',DB],{stdio:'pipe',windowsHide:true});
   let error='';process.stderr.on('data',data=>error+=data);process.on('close',code=>resolve({code,error}));
   process.stdin.end(`begin; insert into vip_bookings(experience_id,creator_profile_id,title,creator_name,price,fan_id,fan_name,fan_email,date,time,status,details,time_zone)
    values('custom','${cp}','Concurrente','QA',25,'${fan}','Fan','tz-fan@example.invalid',current_date+60,'${time}','accepted','{"kind":"custom"}','${zone}'); select pg_sleep(0.2); commit;`);
  });
  const attempts=await Promise.all([insert('18:00','America/Tegucigalpa'),insert('19:00','America/New_York')]);
  expect(attempts.filter(x=>x.code===0).length===1,JSON.stringify(attempts));
  expect(attempts.some(x=>/ya no está disponible/.test(x.error)),'no informó el conflicto');
  expect(psql(DB,`select count(*) from vip_bookings where title='Concurrente'`)==='1','duplicó la reserva');
 });
 await check('La reserva publicada valida la zona que vio el fan antes de crearla',()=>{
  availability('America/Tegucigalpa');
  as(creator,`update vip_availability set days='{0,1,2,3,4,5,6}',hours='{14:00}' where creator_profile_id='${cp}'`);
  const id=as(creator,`insert into vip_experiences(creator_profile_id,creator_name,title,type,price,duration_minutes,time_zone)
   values('${cp}','QA','Plática QA','qa-session',25,30,'America/Tegucigalpa') returning id`);
  const call=zone=>as(fan,`select reserve_create_booking_in_zone('${id}',current_date+63,'14:00','QA',1,'${zone}')`);
  raises(()=>call('Europe/Madrid'),/zona horaria cambió/,'reloj desactualizado');
  expect(saved(call('America/Tegucigalpa'))==='America/Tegucigalpa','no conservó la zona publicada');
 });
 await check('La propuesta conserva el pago posterior y rechaza una zona desactualizada',()=>{
  const call=zone=>as(fan,`select reserve_request_custom_in_zone('${cp}',current_date+64,'15:00',30,25,1,'Una plática para revisar horarios',
   'Experiencia personalizada','{"modality":"virtual","locationType":"online","purpose":"class"}','${zone}')`);
  raises(()=>call('Europe/Madrid'),/zona horaria cambió/,'propuesta desactualizada');
  const id=call('America/Tegucigalpa');
  expect(psql(DB,`select status||'/'||coalesce(paid_at::text,'') from vip_bookings where id='${id}'`)==='pending/','cobró o aceptó la propuesta');
 });
 await check('El evento comprueba su zona y no permite cambiarla con plazas reservadas',()=>{
  const event=psql(DB,`select id from vip_experiences where creator_profile_id='${cp}' and details->>'format'='event' limit 1`);
  const second=user('tz-second-fan@example.invalid','fan');
  raises(()=>as(second,`select reserve_book_event_in_zone('${event}','QA','Europe/Madrid')`),/zona horaria cambió/,'evento desactualizado');
  const id=as(second,`select reserve_book_event_in_zone('${event}','QA','America/Tegucigalpa')`);
  expect(saved(id)==='America/Tegucigalpa','evento sin zona');
  raises(()=>as(creator,`update vip_experiences set time_zone='Europe/Madrid' where id='${event}'`),/ya tiene reservas/,'evento movido');
 });
 await check('El límite de respuesta se calcula desde la hora real de la reserva',()=>{
  const at="(now()+interval '90 minutes') at time zone 'America/Tegucigalpa'";
  const id=psql(DB,`insert into vip_bookings(experience_id,creator_profile_id,title,creator_name,price,fan_id,fan_name,fan_email,date,time,status,details,time_zone)
   values('custom','${cp}','Respuesta QA','QA',25,'${fan}','Fan','tz-fan@example.invalid',(${at})::date,to_char(${at},'HH24:MI'),'pending','{"kind":"custom"}','America/Tegucigalpa') returning id`);
  expect(psql(DB,`select respond_by=((date+time::time) at time zone time_zone) from vip_bookings where id='${id}'`)==='t','vencimiento usa UTC o el reloj del fan');
 });
});
