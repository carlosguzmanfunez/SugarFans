// Cupos en vivo: a creator opens today's 1:1 slots during a TikTok/Instagram live and
// fans grab them from fansreserve.com/@usuario/ahora. Runs every migration on a
// throwaway local Postgres (PGHOST=127.0.0.1).
import {createDbTest} from './db-harness.mjs';
process.env.PGTZ='UTC';
const DB='fr_reserve_live_slots_test';
const {setup,user,psql,as,raises,check,expect,finish}=createDbTest(DB);
finish(async()=>{
 setup({transformMigration:(name,sql)=>name.includes('reserve_session_attendance_reminders')?
  "create or replace function public.push_notification() returns trigger language plpgsql security definer set search_path='' as $$ begin return null; end $$;\n"+sql:sql});
 const creator=user('live-creator@example.invalid','creator');
 const unverified=user('live-new@example.invalid','creator',{verified:false});
 const fans=[1,2,3,4,5,6,7,8].map(i=>user(`live-fan${i}@example.invalid`,'fan'));
 const visitorStatus=()=>JSON.parse(psql(DB,`begin; set local role anon; select reserve_live_status('${username}'); commit;`));
 const username=psql(DB,`update profiles set username='livecreadora' where id='${creator}' returning username`);
 const cp=psql(DB,`select creator_profile_id from profiles where id='${creator}'`);
 let drop, board;

 await check('Solo un creador verificado abre cupos y con valores permitidos',()=>{
  raises(()=>as(fans[0],'select reserve_live_open(3,15,25,0,15)'),/Solo los creadores/,'fan abrió cupos');
  raises(()=>as(unverified,'select reserve_live_open(3,15,25,0,15)'),/Verifica tu identidad/,'creador sin verificar');
  raises(()=>as(creator,'select reserve_live_open(3,17,25,0,15)'),/10, 15, 20 o 30/,'minutos raros');
  raises(()=>as(creator,'select reserve_live_open(3,15,2,0,15)'),/\$5/,'precio bajo');
  raises(()=>as(creator,'select reserve_live_open(30,15,25,0,15)'),/entre 1 y 20/,'demasiados cupos');
  drop=as(creator,'select reserve_live_open(3,15,25,0,15)');
  expect(/^[0-9a-f-]{36}$/.test(drop),'no devolvió el id');
 });

 await check('La experiencia de respaldo queda oculta del catálogo',()=>{
  const row=psql(DB,`select active, details->>'liveDrop', details->>'approval', duration_minutes from vip_experiences e join reserve_live_drops d on d.experience_id=e.id where d.id='${drop}'`);
  expect(row==='f|true|automatic|15',`experiencia inesperada: ${row}`);
  expect(psql(DB,`begin; set local role anon; select count(*) from vip_experiences where details->>'liveDrop'='true'; commit;`)==='0','visitantes la ven');
 });

 await check('Un visitante ve los cupos libres sin datos de fans',()=>{
  const s=visitorStatus();
  expect(s.creatorId===cp&&s.drop?.left===3&&s.drop.price===25&&s.drop.minutes===15,`estado: ${JSON.stringify(s)}`);
  expect(!('mine' in s),'mostró una reserva a un visitante');
  expect(new Date(s.drop.firstStartAt).getUTCMinutes()%5===0,'la primera llamada no cae en múltiplo de 5');
 });

 await check('Cada fan toma el siguiente cupo, pendiente de pago 10 minutos, y repetir no duplica',()=>{
  const b1=as(fans[0],`select reserve_live_claim('${drop}')`);
  expect(as(fans[0],`select reserve_live_claim('${drop}')`)===b1,'duplicó el cupo del mismo fan');
  const row=psql(DB,`select status, details->>'liveSlot', price, duration_minutes, payment_due_at between now()+interval '9 minutes' and now()+interval '10 minutes' from vip_bookings where id='${b1}'`);
  expect(row==='accepted|1|25.00|15|t',`reserva inesperada: ${row}`);
  const b2=as(fans[1],`select reserve_live_claim('${drop}')`);
  expect(psql(DB,`select details->>'liveSlot' from vip_bookings where id='${b2}'`)==='2','no tomó el siguiente cupo');
  const mine=JSON.parse(as(fans[1],`select reserve_live_status('${username}')`));
  expect(mine.mine?.bookingId===b2&&mine.drop.left===1,`estado del fan: ${JSON.stringify(mine)}`);
 });

 await check('El apartado no avisa al creador; el pago sí, con el número de cupo',()=>{
  expect(psql(DB,`select count(*) from notifications where user_id='${creator}'`)==='0','avisó por un apartado sin pagar');
  psql(DB,`update vip_bookings set status='confirmed',paid_at=now() where fan_id='${fans[0]}' and details->>'liveDropId'='${drop}'`);
  expect(psql(DB,`select title from notifications where user_id='${creator}'`)==='Cupo en vivo pagado · #1','aviso de pago incorrecto');
 });

 await check('Al agotarse, el siguiente fan recibe un mensaje claro',()=>{
  as(fans[2],`select reserve_live_claim('${drop}')`);
  expect(visitorStatus().drop.left===0,'siguen quedando cupos');
  raises(()=>as(fans[3],`select reserve_live_claim('${drop}')`),/Ya no quedan cupos/,'cuarto fan');
 });

 await check('Un apartado sin pagar se libera y otro fan puede tomarlo',()=>{
  psql(DB,`set session_replication_role=replica; update vip_bookings set payment_due_at=now()-interval '1 minute' where fan_id='${fans[1]}' and details->>'liveDropId'='${drop}'`);
  expect(visitorStatus().drop.left===1,'no se liberó el cupo vencido');
  const b=as(fans[3],`select reserve_live_claim('${drop}')`);
  expect(psql(DB,`select details->>'liveSlot' from vip_bookings where id='${b}'`)==='2','no reutilizó el cupo liberado');
  expect(psql(DB,`select status from vip_bookings where fan_id='${fans[1]}' and details->>'liveDropId'='${drop}'`)==='expired','el apartado vencido no expiró');
 });

 await check('El creador no se reserva a sí mismo y cerrar detiene la venta',()=>{
  raises(()=>as(creator,`select reserve_live_claim('${drop}')`),/propio cupo/,'autorreserva');
  raises(()=>as(fans[0],`select reserve_live_close('${drop}')`),/no encontrados/,'un fan cerró los cupos');
  as(creator,`select reserve_live_close('${drop}')`);
  expect(visitorStatus().drop.closed===true,'no se ve cerrado');
  raises(()=>as(fans[1],`select reserve_live_claim('${drop}')`),/cerró los cupos/,'vendió con cupos cerrados');
 });

 await check('Cupos programados: cuenta regresiva y no se venden antes de abrir',()=>{
  const later=as(creator,'select reserve_live_open(2,10,15,30,15)');
  const s=visitorStatus();
  expect(s.drop.id===later&&new Date(s.drop.opensAt)>new Date(s.now),'no muestra la apertura futura');
  raises(()=>as(fans[1],`select reserve_live_claim('${later}')`),/todavía no se abren/,'vendió antes de abrir');
  expect(psql(DB,`select count(*) from reserve_live_drops where creator_profile_id='${cp}' and closed_at is null`)==='1','quedaron dos ventas abiertas');
 });

 await check('Tablero: cada cupo con su hora y estado, sin datos de fans',()=>{
  // Stand-in for Supabase Realtime: records each broadcast.
  psql(DB,`create schema if not exists realtime; create table realtime.sent(payload jsonb, event text, topic text, private boolean);
   create function realtime.send(payload jsonb, event text, topic text, private boolean) returns void language sql as $f$ insert into realtime.sent values(payload,event,topic,private) $f$;`);
  board=as(creator,'select reserve_live_open(4,10,15,0,60)');
  const s=visitorStatus();
  expect(s.drop.id===board&&s.drop.board.length===4,`tablero: ${JSON.stringify(s.drop)}`);
  expect(s.drop.board.every((x,i)=>x.n===i+1&&Object.keys(x).sort().join()==='n,start,state'),'el tablero trae datos de más');
  expect(new Date(s.drop.board[1].start)-new Date(s.drop.board[0].start)===600000,'las horas no van seguidas');
  // The first drop's paid call (fan 1) and held slots overlap nothing here: 60 minutes later.
  expect(s.drop.board.map(x=>x.state).join()==='free,free,free,free'&&s.drop.left===4,`estados: ${JSON.stringify(s.drop.board)}`);
  expect(psql(DB,`select count(*) from realtime.sent where topic='cupos:${cp}' and event='cambio' and not private and payload='{}'`)!=='0','abrir cupos no avisó a las páginas');
 });

 await check('El fan elige su cupo por número; apartado y pagado se ven para todos',()=>{
  psql(DB,'truncate realtime.sent');
  const b=as(fans[4],`select reserve_live_claim('${board}',3)`);
  expect(psql(DB,`select details->>'liveSlot' from vip_bookings where id='${b}'`)==='3','no apartó el cupo elegido');
  expect(psql(DB,`select count(*) from realtime.sent where topic='cupos:${cp}'`)==='1','apartar no avisó una vez');
  expect(visitorStatus().drop.board.map(x=>x.state).join()==='free,free,held,free','el apartado no se ve');
  expect(as(fans[4],`select reserve_live_claim('${board}',1)`)===b,'el mismo fan apartó dos cupos');
  raises(()=>as(fans[5],`select reserve_live_claim('${board}',3)`),/Recarga la página/,'dos fans en el mismo cupo');
  raises(()=>as(fans[5],`select reserve_live_claim('${board}',9)`),/Recarga la página/,'cupo que no existe');
  psql(DB,`update vip_bookings set status='confirmed',paid_at=now() where id='${b}'`);
  const s=visitorStatus();
  expect(s.drop.board.map(x=>x.state).join()==='free,free,taken,free'&&s.drop.left===3,`pagado: ${JSON.stringify(s.drop.board)}`);
  expect(psql(DB,`select count(*) from realtime.sent where topic='cupos:${cp}'`)==='2','pagar no avisó a las páginas');
  const mine=JSON.parse(as(fans[4],`select reserve_live_status('${username}')`));
  expect(mine.mine?.slot===3&&mine.mine.status==='confirmed','el fan no ve su cupo pagado');
 });

 await check('Un cupo apartado sin pagar vuelve a quedar libre y se puede elegir',()=>{
  const b=as(fans[5],`select reserve_live_claim('${board}',2)`);
  psql(DB,`set session_replication_role=replica; update vip_bookings set payment_due_at=now()-interval '1 minute' where id='${b}'`);
  expect(visitorStatus().drop.board[1].state==='free','el apartado vencido sigue ocupando la casilla');
  const again=as(fans[6],`select reserve_live_claim('${board}',2)`);
  expect(again!==b&&psql(DB,`select details->>'liveSlot' from vip_bookings where id='${again}'`)==='2','no se pudo elegir el cupo liberado');
 });

 await check('Otra reserva del creador a esa hora marca la casilla como ocupada',()=>{
  const first=visitorStatus().drop.board[0].start;
  const exp=psql(DB,`select experience_id from vip_bookings where creator_profile_id='${cp}' and status='confirmed' and details->>'liveDropId'='${drop}' limit 1`);
  psql(DB,`set session_replication_role=replica; update vip_bookings set date=(timestamptz '${first}' at time zone time_zone)::date, time=to_char(timestamptz '${first}' at time zone time_zone,'HH24:MI') where experience_id='${exp}' and status='confirmed'`);
  const s=visitorStatus();
  expect(s.drop.board[0].state==='taken'&&s.drop.left===1,`choque de horario: ${JSON.stringify(s.drop.board)}`);
  raises(()=>as(fans[7],`select reserve_live_claim('${board}',1)`),/Recarga la página/,'apartó un cupo que choca');
 });

 await check('Cerrar los cupos también avisa a las páginas abiertas',()=>{
  psql(DB,'truncate realtime.sent');
  as(creator,`select reserve_live_close('${board}')`);
  expect(psql(DB,`select count(*) from realtime.sent where topic='cupos:${cp}'`)==='1','cerrar no avisó');
 });

 await check('Tabla interna: un fan no ve los cupos de otro creador ni puede escribirlos',()=>{
  expect(as(fans[0],'select count(*) from reserve_live_drops')==='0','un fan lee la tabla');
  raises(()=>as(creator,`insert into reserve_live_drops(creator_profile_id,experience_id,slots,slot_minutes,price,opens_at,first_start_at,time_zone,created_by) values('x','x',1,10,5,now(),now()+interval '1 hour','UTC','${creator}')`),/permission denied/,'escritura directa');
 });
});
