// Actual PostgreSQL, every migration, authenticated roles and disposable local DB.
// No remote database, PayPal or credentials.
import { createDbTest } from './db-harness.mjs';
const DB = 'fr_reserve_city_test';
const { setup, user, psql, as, raises, check, expect, finish } = createDbTest(DB);
finish(async () => {
  setup();
  const creator = user('city-creator@example.invalid', 'creator');
  const fan = user('city-fan@example.invalid', 'fan');
  const other = user('city-other@example.invalid', 'fan');
  const cp = psql(DB, `select creator_profile_id from profiles where id='${creator}'`);
  psql(DB, `insert into vip_availability(creator_profile_id,days,hours,time_zone) values('${cp}',array[0,1,2,3,4,5,6]::smallint[],array['10:00','12:00','14:00'],'America/Tegucigalpa') on conflict(creator_profile_id) do update set days=excluded.days,hours=excluded.hours,time_zone=excluded.time_zone`);
  const loc = { country: 'HN', region: 'Francisco Morazán', city: 'Tegucigalpa' };
  const j = d => JSON.stringify(d).replaceAll("'", "''");
  const details = (patch = {}) => ({ categoryId:'fitness', modality:'presencial', locationTypes:['gym'], includes:[], excludes:[], requirements:{verifiedFans:false,subscribersOnly:false}, minNoticeHours:24, maxParticipants:1, approval:'automatic', cancellationPolicy:'moderate', ...loc, ...patch });
  const offer = (id, patch = {}) => psql(DB, `insert into vip_experiences(id,creator_profile_id,creator_name,title,description,type,price,duration_minutes,image,active,details) values('${id}','${cp}','Creador QA','Clase QA','Entrenamiento guiado de prueba.','training-1-1',25,30,'',true,'${j(details(patch))}')`);
  const select = (uid, d = loc) => as(uid, `select reserve_select_attendance_city('${d.country}','${d.region}','${d.city}')`);
  let day = 2;
  const book = (id, uid = fan) => as(uid, `select reserve_create_booking('${id}',current_date+${++day},'10:00','',1)`);
  const state = id => psql(DB, `select status from vip_bookings where id='${id}'`);
  const quote = (uid, id) => as(uid, `select paypal_quote('booking','{"bookingId":"${id}"}')`);
  const field = (id, sql) => psql(DB, `select ${sql} from vip_bookings where id='${id}'`);
  offer('city-physical'); offer('city-online', { modality:'virtual', locationTypes:['online'] });

  await check('Una experiencia presencial nueva exige país, departamento y ciudad', () => {
    raises(() => offer('city-incomplete', {country:undefined}), /país|ciudad/, 'sin país');
    raises(() => offer('city-no-region', {region:''}), /país|ciudad/, 'sin departamento');
    raises(() => offer('city-unknown-country', {country:'ZZ'}), /país|ciudad/, 'país desconocido');
  });
  await check('Sin ciudad confirmada no se crea una reserva ni se ocupa horario', () => {
    raises(() => book('city-physical'), /Selecciona y confirma/, 'sin selección');
    expect(psql(DB, `select count(*) from vip_bookings where fan_id='${fan}'`)==='0', 'creó una reserva');
  });
  await check('Las experiencias virtuales siguen abiertas sin seleccionar ciudad', () => {
    const id = book('city-online'); expect(state(id)==='accepted','no aceptó la virtual');
    expect(JSON.parse(quote(fan,id)).amount===25,'cotización virtual');
  });
  await check('Mismo nombre de ciudad en otro país no habilita la reserva', () => {
    select(fan,{...loc,country:'MX'});
    raises(() => book('city-physical'), /Selecciona y confirma/, 'otro país');
  });
  await check('Mismo país y ciudad en otro departamento no habilita la reserva', () => {
    select(fan,{...loc,region:'Cortés'});
    raises(() => book('city-physical'), /Selecciona y confirma/, 'otro departamento');
  });
  await check('Otra ciudad tampoco habilita la reserva', () => {
    select(fan,{...loc,city:'San Pedro Sula'});
    raises(() => book('city-physical'), /Selecciona y confirma/, 'otra ciudad');
  });
  let physical;
  await check('Un viajero confirma destino; el país del perfil no cambia', () => {
    psql(DB,`update profiles set country='ES' where id='${fan}'`);
    select(fan);
    physical=book('city-physical');
    expect(state(physical)==='accepted','no creó la reserva');
    expect(field(physical,"details->>'country'")==='HN','no guardó país de la experiencia');
    expect(field(physical,"details->'attendance'->>'city'")==='Tegucigalpa','sin confirmación');
    expect(psql(DB,`select country from profiles where id='${fan}'`)==='ES','cambió residencia');
    expect(JSON.parse(quote(fan,physical)).amount===25,'monto incorrecto');
  });
  await check('Acentos, mayúsculas y espacios no cambian el destino', () => {
    select(other,{country:'HN',region:' FRANCISCO  MORAZAN ',city:'TEGUCIGALPA'});
    expect(state(book('city-physical',other))==='accepted','normalización distinta');
  });
  await check('Cambiar la ciudad para otro viaje no invalida la reserva previamente confirmada', () => {
    select(fan,{...loc,country:'MX'});
    as(fan,`select reserve_confirm_booking_attendance('${physical}')`);
    expect(JSON.parse(quote(fan,physical)).amount===25,'perdió reserva confirmada');
  });
  await check('Otra persona no confirma, no cotiza ni modifica reservas ajenas', () => {
    raises(()=>as(other,`select reserve_confirm_booking_attendance('${physical}')`), /no encontrada/, 'otro fan');
    raises(()=>quote(other,physical), /no encontrada/, 'cotización ajena');
    expect(as(other,`update vip_bookings set details='{}' where id='${physical}' returning id`)==='', 'modificó reserva');
  });
  await check('El lugar no puede cambiar ni pasar a virtual para saltarse la comprobación', () => {
    raises(()=>psql(DB,`update vip_bookings set details=jsonb_set(details,'{city}','"Otra ciudad"') where id='${physical}'`), /lugar de una reserva/, 'cambio de ciudad');
    raises(()=>psql(DB,`update vip_bookings set details=jsonb_set(details,'{modality}','"virtual"') where id='${physical}'`), /lugar de una reserva/, 'falsa virtual');
  });
  await check('Un pedido antiguo sin asistencia confirmada no se cotiza ni captura ni se paga con Créditos', () => {
    // Simulate a record that existed before the new rule. No financial state changed.
    psql(DB,`update vip_bookings set details=details-'attendance' where id='${physical}'`);
    raises(()=>quote(fan,physical), /Selecciona y confirma/, 'cotización');
    psql(DB,`insert into paypal_orders(id,user_id,kind,params,amount) values('CITY-ORDER','${fan}','booking','{"bookingId":"${physical}"}',25)`);
    raises(()=>as(fan,`select reserve_assert_order_attendance('CITY-ORDER')`), /Selecciona y confirma/, 'captura');
    psql(DB,`insert into credit_grants(user_id,coins,reason) values('${fan}',5000,'reserve_cancel')`);
    raises(()=>as(fan,`select reserve_pay_with_credits('${physical}')`), /Selecciona y confirma/, 'Créditos');
    expect(psql(DB,`select coin_balance('${fan}')`)==='5000','gastó créditos');
    expect(state(physical)==='accepted','confirmó sin permiso');
  });
  await check('Tras confirmar la ciudad se recupera el mismo pedido y se paga una sola vez', () => {
    select(fan); as(fan,`select reserve_confirm_booking_attendance('${physical}')`);
    as(fan,`select reserve_assert_order_attendance('CITY-ORDER')`);
    as(fan,`select reserve_pay_with_credits('${physical}')`);
    expect(state(physical)==='confirmed','no confirmó');
    expect(psql(DB,`select coin_balance('${fan}')`)==='2500','no descontó el monto');
    raises(()=>as(fan,`select reserve_pay_with_credits('${physical}')`), /aceptada/, 'doble pago');
  });
  await check('Cancelar una reserva pagada funciona aunque el fan cambie de ciudad', () => {
    select(fan,{...loc,country:'MX'});
    as(fan,`select reserve_cancel('${physical}')`);
    expect(state(physical)==='cancelled','no canceló');
    expect(psql(DB,`select coin_balance('${fan}')`)==='5000','no devolvió créditos');
  });
  await check('Los pedidos ajenos y visitantes no pueden usar la comprobación', () => {
    raises(()=>as(other,`select reserve_assert_order_attendance('CITY-ORDER')`), /Pedido no encontrado/, 'pedido ajeno');
    for(const fn of ['reserve_select_attendance_city(text,text,text)','reserve_confirm_booking_attendance(uuid)','reserve_assert_order_attendance(text)'])
      expect(psql(DB,`select has_function_privilege('anon','public.${fn}','execute')`)==='f','anon ejecuta '+fn);
  });
  await check('Los asientos de eventos también exigen la ciudad y conservan el país', () => {
    const date=psql(DB,"select (current_date+25)::text");
    offer('city-event',{format:'event',eventDate:date,eventTime:'14:00',maxParticipants:10});
    select(fan,{...loc,country:'MX'});
    raises(()=>as(fan,"select reserve_book_event_seat('city-event','')"),/Selecciona y confirma/,'evento de otro país');
    select(fan);
    const id=as(fan,"select reserve_book_event_seat('city-event','')");
    expect(field(id,"details->>'country'")==='HN','sin país en el asiento');
  });
  await check('Un ticket gratuito tampoco salta el control de ciudad', () => {
    const ticket=psql(DB,`insert into experience_tickets(fan_id,creator_profile_id,experience_id,experience_title,amount,bonus) values('${fan}','${cp}','city-physical','Clase QA',25,'thank-you') returning id`);
    select(fan,{...loc,country:'MX'});
    raises(()=>as(fan,`select book_with_ticket('${ticket}',current_date+27,'12:00','')`),/Selecciona y confirma/,'ticket fuera de ciudad');
    expect(psql(DB,`select status from experience_tickets where id='${ticket}'`)==='active','consumió ticket');
    select(fan);
    const id=as(fan,`select book_with_ticket('${ticket}',current_date+27,'12:00','')`);
    expect(state(id)==='confirmed','no confirmó el ticket');
  });
  await check('Solicitudes personalizadas solo donde el creador ofrece presencia física', () => {
    select(fan);
    const custom = (city) => as(fan,`select reserve_request_custom('${cp}',current_date+${++day},'12:00',30,25,1,'Quiero una clase de prueba.','Experiencia personalizada · Clase','{"modality":"presencial","purpose":"class","locationType":"gym","city":"${city}"}')`);
    expect(field(custom('Tegucigalpa'),"details->>'country'")==='HN','país personalizado');
    raises(()=>custom('San Pedro Sula'), /no ofrece|Selecciona/, 'otra ciudad');
    select(fan,{...loc,country:'MX'});
    raises(()=>custom('Tegucigalpa'), /no ofrece|Selecciona/, 'sin cobertura');
  });
});
