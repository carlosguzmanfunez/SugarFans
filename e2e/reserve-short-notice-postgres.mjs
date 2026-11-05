import {createDbTest} from './db-harness.mjs';
import {spawn} from 'node:child_process';
const DB='fr_reserve_short_notice_test';
const {setup,user,psql,as,raises,check,expect,finish}=createDbTest(DB);
finish(async()=>{
 setup();
 const creator=user('short-creator@example.invalid','creator');
 const cp=psql(DB,`select creator_profile_id from profiles where id='${creator}'`);
 const zone=psql(DB,`select z from unnest(array['America/Tegucigalpa','Pacific/Honolulu','Asia/Tokyo']) with ordinality t(z,n) where extract(hour from now() at time zone z)<=17 order by n limit 1`);
 const day=psql(DB,`select (now() at time zone '${zone}')::date`);
 const first=`date_trunc('hour',now() at time zone '${zone}')+interval '3 hours'`;
 const times=JSON.parse(psql(DB,`select json_agg(to_char(${first}+n*interval '30 minutes','HH24:MI')) from generate_series(0,6) n`));
 const soon=psql(DB,`select to_char(date_trunc('hour',now() at time zone '${zone}')+interval '1 hour','HH24:MI')`);
 as(creator,`insert into vip_availability(creator_profile_id,days,hours,time_zone) values('${cp}',array[0,1,2,3,4,5,6]::smallint[],array[${[soon,...times].map(t=>"'"+t+"'").join(',')}],'${zone}')`);
 const details=notice=>JSON.stringify({modality:'virtual',locationTypes:['online'],includes:[],excludes:[],requirements:{verifiedFans:false,subscribersOnly:false},minNoticeHours:notice,maxParticipants:1,approval:'automatic',cancellationPolicy:'moderate',days:[0,1,2,3,4,5,6],hours:[soon,...times]});
 const ids={};
 const offer=(id,notice)=>ids[id]=as(creator,`insert into vip_experiences(creator_profile_id,creator_name,title,type,price,duration_minutes,time_zone,details) values('${cp}','QA','Plática QA','live-1-1',25,30,'${zone}','${details(notice)}') returning id`);
 let sequence=0;
 const fan=()=>user('short-fan-'+(++sequence)+'@example.invalid','fan');
 const book=(f,time,id='short')=>as(f,`select reserve_create_booking_in_zone('${ids[id]}','${day}','${time}','Prueba virtual',1,'${zone}')`);
 await check('El creador guarda 1 hora de anticipación y cinco inicios cada media hora',()=>{
  offer('short',1);
  expect(psql(DB,`select details->>'minNoticeHours' from vip_experiences where id='${ids.short}'`)==='1','no conservó la anticipación');
  expect(times.slice(0,5).some(t=>t.endsWith(':30')),'faltan medias horas');
 });
 await check('Cinco fans diferentes apartan cinco espacios de hoy, sin cobros reales',()=>{
  for(const time of times.slice(0,5))book(fan(),time);
  expect(psql(DB,`select count(*) from vip_bookings where experience_id='${ids.short}' and status='accepted' and date='${day}'`)==='5','no guardó cinco reservas de hoy');
  expect(psql(DB,'select count(*) from transactions')==='0','generó dinero al apartar');
 });
 await check('El servidor rechaza reservar antes de la anticipación elegida',()=>{
  raises(()=>book(fan(),soon),/anticipación/,'demasiado cerca');
 });
 await check('Una experiencia que mantiene 24 horas no permite reservar para hoy',()=>{
  offer('strict',24);raises(()=>book(fan(),times[5],'strict'),/anticipación/,'24 horas');
  expect(psql(DB,`select details->>'minNoticeHours' from vip_experiences where id='${ids.strict}'`)==='24','cambió otra experiencia');
 });
 await check('Sin anticipación mínima admite un inicio futuro, pero nunca el pasado',()=>{
  offer('instant',0);book(fan(),soon,'instant');
  const past=psql(DB,`select to_char(date_trunc('hour',now() at time zone '${zone}')-interval '1 hour','HH24:MI')`);
  raises(()=>book(fan(),past,'instant'),/anticipación|comenzó|disponible/,'hora pasada');
 });
 await check('Un horario ocupado no vuelve a ofrecerse aunque tenga anticipación corta',()=>{
  raises(()=>book(fan(),times[0]),/ya no está disponible/,'doble horario');
 });
 await check('Dos conexiones no pueden apartar el mismo espacio cercano',async()=>{
  const attempt=f=>new Promise(resolve=>{const p=spawn('psql',['-X','-q','-At','-v','ON_ERROR_STOP=1','-d',DB],{windowsHide:true,stdio:'pipe'});let error='';p.stderr.on('data',d=>error+=d);p.on('close',code=>resolve({code,error}));p.stdin.end(`begin;set local role authenticated;select set_config('request.jwt.claim.sub','${f}',true);select reserve_create_booking_in_zone('${ids.short}','${day}','${times[6]}','Carrera QA',1,'${zone}');select pg_sleep(0.2);commit;`);});
  const a=fan(),b=fan(),r=await Promise.all([attempt(a),attempt(b)]);
  expect(r.filter(x=>x.code===0).length===1,JSON.stringify(r));
 });
 await check('Se conservan los límites por fan y los permisos existentes',()=>{
  const f=fan();book(f,times[5]);
  raises(()=>book(f,times[5]),/una reserva activa|ya no está disponible/,'límite por creador');
  expect(psql(DB,"select has_function_privilege('anon','public.reserve_create_booking_in_zone(text,date,text,text,integer,text)','execute')")==='f','visitante reservó');
  expect(psql(DB,"select has_function_privilege('authenticated','public.reserve_details_error(jsonb)','execute')")==='f','expuso el validador privado');
 });
});
