// Real local PostgreSQL, committed transactions and complete migrations.
// Fan proposals (custom Reserve requests) take any day and any hour.
import {createDbTest} from './db-harness.mjs';
const DB='fr_proposal_hours_test';
const {setup,user,psql,as,raises,check,expect,finish}=createDbTest(DB);
finish(async()=>{
 setup();
 const creator=user('hours-creator@example.invalid','creator');
 const fan=user('hours-fan@example.invalid','fan');
 const cp=psql(DB,`select creator_profile_id from profiles where id='${creator}'`);
 // Weekdays 10:00-18:00 only: the creator's own schedule must not limit proposals.
 as(creator,`insert into vip_availability(creator_profile_id,days,hours) values('${cp}','{1,2,3,4,5}','{10:00,12:00}')
  on conflict(creator_profile_id) do update set days=excluded.days,hours=excluded.hours`);
 const saturday="current_date + ((6 - extract(dow from current_date)::int + 7) % 7 + 7)";
 const propose=(time,day=saturday)=>as(fan,`select reserve_request_custom('${cp}',${day},'${time}',30,50,1,
  'Una clase de guitarra por videollamada','Experiencia personalizada',
  jsonb_build_object('modality','virtual','locationType','online','purpose','class'))`);
 await check('Una propuesta puede pedir un sábado a las 23:00 aunque el creador solo abra entre semana',()=>{
  const id=propose('23:00');
  expect(psql(DB,`select extract(dow from date)::int||' '||time from vip_bookings where id='${id}'`)==='6 23:00','no guardó sábado 23:00');
 });
 await check('También de madrugada y en domingo',()=>{
  propose('02:00',`${saturday}+1`);
 });
 await check('Rechaza una hora mal formada y el mismo horario dos veces',()=>{
  raises(()=>propose('25:00'),/Elige una hora/,'hora inválida');
  raises(()=>propose('9pm'),/Elige una hora/,'hora inválida');
  raises(()=>propose('23:00'),/ya no está disponible/,'horario repetido');
 });
});
