import {createDbTest} from './db-harness.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
process.env.PGTZ='UTC';
const DB='fr_reserve_session_test';
const {setup,user,psql,as,raises,check,expect,finish}=createDbTest(DB);
finish(async()=>{
 setup({transformMigration:(name,sql)=>name.includes('reserve_session_attendance_reminders')?
  "create or replace function public.push_notification() returns trigger language plpgsql security definer set search_path='' as $$ begin return null; end $$;\n"+sql:sql});
 const creator=user('session-creator@example.invalid','creator'),fan=user('session-fan@example.invalid','fan'),other=user('session-other@example.invalid','fan');
 const cp=psql(DB,`select creator_profile_id from profiles where id='${creator}'`);
 const book=(f,minutes,creatorProfile=cp)=>psql(DB,`insert into vip_bookings(experience_id,creator_profile_id,title,creator_name,price,fan_id,fan_name,fan_email,date,time,status,duration_minutes,time_zone,details)
 values('custom','${creatorProfile}','Sesión QA','QA',25,'${f}','Fan','session-fan@example.invalid',(now()+interval '${minutes} minutes')::date,to_char(now()+interval '${minutes} minutes','HH24:MI'),'confirmed',30,'UTC','{"kind":"custom","modality":"virtual"}') returning id`);
 const past=book(fan,-40),upcoming=book(other,9);
 const start=id=>psql(DB,`select reserve_session_start(b) from vip_bookings b where id='${id}'`);
 const provider=(id,eventId,kind,person=fan,room=`booking-${id}`,sid='PA_TEST',when=start(id))=>psql(DB,`set role service_role; select reserve_record_room_event('${eventId}','${kind}','${room}','${sid}','${person}','${start(id)}','${when}')`);
 await check('Recordatorios apagados por defecto y sin movimientos financieros',()=>{
  expect(psql(DB,'select reminders_enabled from reserve_session_settings')==='f','se activó solo');
  expect(psql(DB,'select reserve_dispatch_session_reminders()')==='0','generó avisos con control apagado');
 });
 await check('Conserva el aislamiento de QA sin reactivar su manejador antiguo de avisos',()=>{
  expect(!psql(DB,"select pg_get_functiondef('public.push_notification()'::regprocedure)").includes('net.http_post'),'reactivó los avisos anteriores');
  expect(psql(DB,"select count(*) from pg_trigger where tgname='reserve_push_session_reminder'")==='1','falta salida independiente');
 });
 await check('Fan y creador registran su preparación con hora del servidor; nadie suplanta asistencia',()=>{
  as(fan,`select reserve_session_event('${past}','policy_accepted','{"occurred_at":"2000-01-01","participantRole":"creator"}')`);
  as(fan,`select reserve_session_event('${past}','ready','{"camera":true,"microphone":true}')`);
  as(creator,`select reserve_session_event('${past}','policy_accepted')`);
  expect(psql(DB,`select count(*) from reserve_session_events where booking_id='${past}' and source='browser' and participant_role='fan'`) === '2','identidad falsificada');
  expect(psql(DB,`select bool_and(occurred_at>now()-interval '1 minute') from reserve_session_events`) === 't','confió en hora del cliente');
  raises(()=>as(fan,`select reserve_session_event('${past}','participant_joined')`),/no permitido/,'asistencia inventada');
  raises(()=>as(other,`select reserve_session_event('${past}','ready')`),/no encontrada/,'reserva ajena');
 });
 await check('Registros internos cerrados a fans, visitantes y modificación del historial',()=>{
  raises(()=>as(fan,'select * from reserve_session_events'),/permission denied/,'tabla interna');
  raises(()=>as(fan,`select reserve_record_room_event('x','participant_joined','booking-${past}','PA','${fan}','${start(past)}','${start(past)}')`),/permission denied/,'proveedor falso');
  raises(()=>psql(DB,`update reserve_session_events set kind='ready'`),/solo lectura/,'reescribir historial');
  raises(()=>psql(DB,'delete from reserve_session_events'),/solo lectura/,'borrar historial');
 });
 await check('Avisos de diez minutos para cada parte, sin duplicados al repetir la ronda',()=>{
  psql(DB,"update reserve_session_settings set reminders_enabled=true,delivery_base_url='https://qa.example.invalid'");
  expect(psql(DB,'select reserve_dispatch_session_reminders()')==='2','faltan destinatarios');
  expect(psql(DB,'select reserve_dispatch_session_reminders()')==='0','duplicó avisos');
  expect(psql(DB,`select count(*) from reserve_session_reminders where booking_id='${upcoming}' and minutes_before=10`) === '2','no separó a cada participante');
  expect(psql(DB,`select bool_and(body like '%desbloqueado%' and body like '%visible%') from notifications where id in (select notification_id from reserve_session_reminders)`) === 't','falta indicación de pantalla');
 });
 await check('Abrir un recordatorio solo acredita apertura a su destinatario',()=>{
  const r=psql(DB,`select id from reserve_session_reminders where user_id='${other}' limit 1`);
  as(fan,`select reserve_open_reminder('${r}')`);
  expect(psql(DB,`select opened_at is null from reserve_session_reminders where id='${r}'`) === 't','otro fan marcó lectura');
  as(other,`select reserve_open_reminder('${r}')`);
  expect(psql(DB,`select opened_at is not null from reserve_session_reminders where id='${r}'`) === 't','no guardó apertura');
 });
 await check('Una cancelación invalida el enlace antes de enviarlo al celular',()=>{
  const nid=psql(DB,`select notification_id from reserve_session_reminders where booking_id='${upcoming}' limit 1`);
  expect(psql(DB,`select reserve_reminder_delivery_context('${nid}')->>'valid'`)==='true','aviso válido rechazado');
  psql(DB,`update vip_bookings set status='cancelled' where id='${upcoming}'`);
  expect(psql(DB,`select reserve_reminder_delivery_context('${nid}')->>'valid'`)==='false','aviso cancelado sigue activo');
 });
 await check('Un cambio de horario invalida los avisos anteriores y crea los del horario nuevo',()=>{
  psql(DB,`update vip_bookings set status='confirmed',time=to_char(now()+interval '8 minutes','HH24:MI') where id='${upcoming}'`);
  expect(psql(DB,'select reserve_dispatch_session_reminders()')==='2','no creó nuevos avisos');
  expect(psql(DB,`select count(*) from reserve_session_reminders where booking_id='${upcoming}'`) === '4','sobrescribió historia');
 });
 await check('Aviso de un minuto no repite uno tardío de diez minutos',()=>{
  psql(DB,`update vip_bookings set time=to_char(date_trunc('minute',now())+interval '1 minute','HH24:MI'),date=(date_trunc('minute',now())+interval '1 minute')::date where id='${upcoming}'`);
  expect(psql(DB,'select reserve_dispatch_session_reminders()')==='2','no generó el aviso de un minuto');
  expect(psql(DB,`select count(*) from reserve_session_reminders where booking_id='${upcoming}' and minutes_before=1`) === '2','faltó aviso de una parte');
 });
 await check('Eventos del proveedor comprobados, idempotentes y ligados a identidad y horario',()=>{
  expect(provider(past,'evt-join','participant_joined')==='1','no guardó entrada');
  expect(provider(past,'evt-join','participant_joined')==='0','duplicó webhook');
  expect(provider(past,'evt-wrong-user','participant_joined',other)==='0','aceptó otro fan');
  expect(provider(past,'evt-creator','participant_joined',creator)==='1','faltó creador');
  expect(provider(past,'evt-leave','participant_left',fan,`booking-${past}`,'PA_TEST',psql(DB,`select reserve_session_start(b)+interval '20 minutes' from vip_bookings b where id='${past}'`))==='1','faltó salida');
  expect(psql(DB,`select count(*) from reserve_session_events where booking_id='${past}' and source='livekit'`) === '3','registros de asistencia incorrectos');
 });
 await check('Constancia visible solo para sus participantes y sin datos de otros fans',()=>{
  const receipt=JSON.parse(as(fan,`select reserve_session_status('${past}')`));
  expect(receipt.events.some(e=>e.source==='livekit'&&e.role==='creator'),'no incluyó creador');
  expect(receipt.events.every(e=>!('user_id' in e)),'filtró identificadores');
  raises(()=>as(other,`select reserve_session_status('${past}')`),/no encontrada/,'recibo ajeno');
 });
 await check('La constancia no activa devoluciones, descuentos ni pagos por sí sola',()=>{
  expect(psql(DB,`select status from vip_bookings where id='${past}'`)==='confirmed','cambió la reserva');
  expect(psql(DB,`select details->>'sessionPolicyVersion' from vip_bookings where id='${past}'`)==='reserve-session-2026-11-04','falta versión');
 });
 await check('Evento grupal: un aviso al creador, asistencia individual y sin mezclar fans',()=>{
  const owner=user('group-session-owner@example.invalid','creator'),a=user('group-session-a@example.invalid','fan'),z=user('group-session-z@example.invalid','fan');
  const cp2=psql(DB,`select creator_profile_id from profiles where id='${owner}'`);
  const exp=as(owner,`insert into vip_experiences(creator_profile_id,creator_name,title,type,price,duration_minutes,time_zone,details)
   values('${cp2}','QA','Evento QA','qa-session',25,30,'UTC',jsonb_build_object('modality','virtual','locationTypes',jsonb_build_array('online'),'format','event',
   'eventDate',to_char(now()+interval '5 minutes','YYYY-MM-DD'),'eventTime',to_char(now()+interval '5 minutes','HH24:MI'),'includes','[]'::jsonb,'excludes','[]'::jsonb,
   'requirements',jsonb_build_object('verifiedFans',false,'subscribersOnly',false),'minNoticeHours',0,'maxParticipants',5,'approval','automatic','cancellationPolicy','moderate')) returning id`);
  const ba=as(a,`select reserve_book_event_seat('${exp}','QA')`),bz=as(z,`select reserve_book_event_seat('${exp}','QA')`);
  psql(DB,`update vip_bookings set status='confirmed' where id in ('${ba}','${bz}')`);
  expect(psql(DB,'select reserve_dispatch_session_reminders()')==='3','duplicó avisos al creador del evento');
  const room=psql(DB,`select 'event-'||experience_id||'-'||date::text||'-'||replace(time,':','') from vip_bookings where id='${ba}'`);
  // Stay clear of the minute-boundary expiry of the one-minute reminder. A
  // connection during preparation is valid, but its event time must be now,
  // not the future contractual start supplied separately in the metadata.
  const joinedAt=psql(DB,'select clock_timestamp()');
  expect(provider(ba,'group-fan','participant_joined',a,room,'PA_TEST',joinedAt)==='1','atribuyó un fan a dos plazas');
  expect(provider(ba,'group-owner','participant_joined',owner,room,'PA_OWNER',joinedAt)==='2','no vinculó al creador con las dos plazas');
  expect(psql(DB,`select count(*) from reserve_session_events where booking_id='${bz}' and participant_role='fan'`)==='0','filtró presencia de otro fan');
  const source=psql(DB,`select booking_id from reserve_session_reminders where user_id='${owner}' limit 1`);
  const nid=psql(DB,`select notification_id from reserve_session_reminders where user_id='${owner}' limit 1`);
  psql(DB,`update vip_bookings set status='cancelled' where id='${source}'`);
  const context=JSON.parse(psql(DB,`select reserve_reminder_delivery_context('${nid}')`));
  expect(context.valid&&context.booking_id!==source,'cancelar una plaza bloqueó al creador y al resto del evento');
 });
 await check('Dos conexiones independientes no duplican recordatorios',async()=>{
  const concurrentCreator=user('concurrent-session-creator@example.invalid','creator');
  const concurrentProfile=psql(DB,`select creator_profile_id from profiles where id='${concurrentCreator}'`);
  book(user('concurrent-session-fan@example.invalid','fan'),6,concurrentProfile);
  const run=promisify(execFile);
  const runs=await Promise.all([0,1].map(()=>run('psql',['-X','-q','-At','-v','ON_ERROR_STOP=1','-d',DB,'-c','select reserve_dispatch_session_reminders()'])));
  expect(runs.map(r=>Number(r.stdout.trim())).sort().join(',')==='0,2','duplicó o perdió el envío concurrente');
 });
 await check('Tablas privadas con RLS; visitantes y fans no cambian los controles',()=>{
  expect(psql(DB,"select bool_and(relrowsecurity) from pg_class where oid in ('reserve_session_events'::regclass,'reserve_session_reminders'::regclass,'reserve_session_settings'::regclass)")==='t','falta RLS');
  raises(()=>as(fan,'update reserve_session_settings set reminders_enabled=true'),/permission denied/,'control del programador');
  expect(psql(DB,"select has_function_privilege('anon','public.reserve_session_status(uuid)','EXECUTE')") === 'f','RPC pública');
  psql(DB,'update reserve_session_settings set delivery_base_url=null');
  raises(()=>psql(DB,'select reserve_dispatch_session_reminders()'),/destino de los avisos/,'destino sin configurar');
 });
});
