// Recordatorios al creador por una solicitud de Reserve sin respuesta
// (supabase/migrations/20261107230000_reserve_response_reminders.sql).
import { createDbTest } from './db-harness.mjs';
const DB = 'fr_reserve_response_reminders_test';
const { setup, user, psql, as, raises, check, expect, finish } = createDbTest(DB);

finish(async () => {
  setup();
  const admin = user('nudge-admin@example.invalid', 'admin');
  psql(DB, `update public.profiles set role='admin' where id='${admin}'`);
  const creator = user('nudge-creator@example.invalid', 'creator');
  const fan = user('nudge-fan@example.invalid', 'fan');
  const cp = psql(DB, `select creator_profile_id from profiles where id='${creator}'`);
  let fans = 0;
  const book = (title) => {
    const fan = user(`nudge-fan-${++fans}@example.invalid`, 'fan');
    return psql(DB, `insert into vip_bookings(experience_id,creator_profile_id,title,creator_name,price,fan_id,fan_name,fan_email,date,time,status,duration_minutes,time_zone,details)
      values('custom','${cp}','${title}','Mariana QA',25,'${fan}','Lucía Fan','nudge-fan@example.invalid',current_date+5,'15:00','pending',15,'America/Tegucigalpa','{"kind":"custom","modality":"virtual"}') returning id`);
  };
  // Pretend the request arrived `hours` ago with the usual 48 h to answer.
  const age = (id, hours, window = 48) =>
    psql(DB, `update vip_bookings set created_at=now()-interval '${hours} hours', respond_by=now()-interval '${hours} hours'+interval '${window} hours' where id='${id}'`);
  const dispatch = () => Number(psql(DB, 'select reserve_dispatch_response_reminders()'));
  const rows = (id) => JSON.parse(psql(DB, `select coalesce(jsonb_agg(jsonb_build_object('step',step,'skipped',skipped,'bell',notification_id is not null,'email',email_id is not null) order by created_at, due_at),'[]') from reserve_response_reminders where booking_id='${id}'`));
  const plan = (hours) => psql(DB, `select string_agg(step||':'||(extract(epoch from due_at-'2026-11-01 00:00+00')/3600)::int||':'||bell||':'||email, ' ' order by due_at) from reserve_response_plan('2026-11-01 00:00+00','2026-11-01 00:00+00'::timestamptz+interval '${hours} hours')`);

  await check('Cadencia de 48 h: aviso al llegar, a las 3 h, 24 h, 6 h y 1 h antes del plazo', () => {
    expect(plan(48) === 'inicio:0:false:true r3h:3:true:false h24:24:true:true h6:42:true:false h1:47:true:true', plan(48));
  });
  await check('Plazos cortos: se omiten los pasos que no caben y nunca dos seguidos a menos de 1 h', () => {
    expect(plan(12) === 'inicio:0:false:true r3h:3:true:false h6:6:true:false h1:11:true:true', plan(12));
    expect(plan(4) === 'inicio:0:false:true h1:3:true:true', plan(4));
    expect(plan(1) === 'inicio:0:false:true', plan(1));
  });

  const a = book('Videollamada QA');
  const bellCount = () => Number(psql(DB, `select count(*) from notifications where user_id='${creator}'`));
  await check('Al llegar la solicitud sale el correo (la campana ya la manda la alerta original)', () => {
    const bells = bellCount();
    expect(dispatch() === 1, 'no envió');
    const r = rows(a);
    expect(r.length === 1 && r[0].step === 'inicio' && r[0].email && !r[0].bell, JSON.stringify(r));
    expect(bellCount() === bells, 'duplicó la campana');
    const mail = psql(DB, `select to_email||'|'||subject||'|'||body from email_outbox where booking_id='${a}'`);
    expect(mail.startsWith('nudge-creator@example.invalid|Lucía quiere reservar contigo|'), mail);
    expect(/reserveNudge=[0-9a-f-]{36}/.test(mail) && mail.includes('Tienes hasta el'), mail);
  });
  await check('Repetir el job no envía nada dos veces', () => {
    expect(dispatch() === 0 && rows(a).length === 1, 'repitió');
  });
  await check('A las 3 h: campana + celular, sin correo', () => {
    age(a, 3.1);
    const emails = psql(DB, 'select count(*) from email_outbox');
    expect(dispatch() === 1, 'no envió');
    const r = rows(a).at(-1);
    expect(r.step === 'r3h' && r.bell && !r.email, JSON.stringify(r));
    expect(psql(DB, 'select count(*) from email_outbox') === emails, 'mandó correo');
    const n = psql(DB, `select title||'|'||kind||'|'||link from notifications where user_id='${creator}' order by created_at desc, id desc limit 1`);
    expect(n.startsWith('Lucía sigue esperando tu respuesta|reserve_request|/creator/dashboard?tab=vip&reserveNudge='), n);
  });
  await check('Si el job se atrasa sale solo el aviso más reciente y el anterior consta como omitido', () => {
    age(a, 42.2);
    expect(dispatch() === 1, 'envió de más');
    const r = rows(a);
    expect(r.map((x) => `${x.step}${x.skipped ? '-omitido' : ''}`).join(' ') === 'inicio r3h h24-omitido h6', JSON.stringify(r));
  });
  await check('Última hora: campana + celular + correo', () => {
    age(a, 47.1);
    expect(dispatch() === 1, 'no envió');
    const r = rows(a).at(-1);
    expect(r.step === 'h1' && r.bell && r.email, JSON.stringify(r));
    expect(psql(DB, `select subject from email_outbox where booking_id='${a}' order by sent_at desc, id desc limit 1`) === 'Última hora: Lucía espera tu respuesta', 'asunto');
  });
  await check('Abrir el enlace queda registrado solo para el creador dueño', () => {
    const id = psql(DB, `select id from reserve_response_reminders where booking_id='${a}' and step='h1'`);
    as(fan, `select reserve_open_response_reminder('${id}')`);
    expect(psql(DB, `select opened_at is null from reserve_response_reminders where id='${id}'`) === 't', 'otro usuario lo marcó');
    as(creator, `select reserve_open_response_reminder('${id}')`);
    expect(psql(DB, `select opened_at is not null from reserve_response_reminders where id='${id}'`) === 't', 'no registró');
  });
  await check('Al aceptar deja de recordar y los avisos sin leer salen de la campana', () => {
    const b = book('Aceptada QA');
    age(b, 3.1);
    dispatch();
    psql(DB, `update vip_bookings set status='accepted' where id='${b}'`);
    age(b, 30);
    expect(dispatch() === 0, 'siguió enviando');
    expect(psql(DB, `select count(*) from notifications n join reserve_response_reminders r on r.notification_id=n.id where r.booking_id='${b}' and n.read_at is null`) === '0', 'quedó sin leer');
    const log = JSON.parse(as(admin, 'select admin_reserve_response_log(7)')).items.find((x) => x.booking_id === b);
    expect(log.reminders.find((x) => x.step === 'r3h').bell_read_at === null, 'la limpieza contó como lectura');
  });
  await check('Al rechazar o contraofertar también se detiene', () => {
    for (const status of ['rejected', 'countered']) {
      const b = book(`Respondida ${status}`);
      psql(DB, `update vip_bookings set status='${status}' where id='${b}'`);
      expect(dispatch() === 0 && rows(b).length === 0, status);
    }
  });
  await check('Vencida no recibe más avisos', () => {
    const b = book('Vencida QA');
    psql(DB, `update vip_bookings set created_at=now()-interval '49 hours', respond_by=now()-interval '1 hour' where id='${b}'`);
    expect(dispatch() === 0 && rows(b).length === 0, 'avisó vencida');
  });
  await check('Admin ve la constancia de cada envío; creador y fan no', () => {
    const log = JSON.parse(as(admin, 'select admin_reserve_response_log(7)'));
    const item = log.items.find((x) => x.booking_id === a);
    expect(item && item.waiting && item.reminders.length === 5, JSON.stringify(item));
    const h1 = item.reminders.find((x) => x.step === 'h1');
    expect(h1.bell && h1.email && h1.opened_at && h1.email_delivered_at === null, JSON.stringify(h1));
    expect(log.items.some((x) => x.status === 'accepted' && !x.waiting), 'falta la aceptada');
    raises(() => as(creator, 'select admin_reserve_response_log(7)'), /Solo administración/, 'creador');
    raises(() => as(fan, 'select admin_reserve_response_log(7)'), /Solo administración/, 'fan');
    raises(() => as(fan, 'select * from reserve_response_reminders'), /permission denied/, 'tabla privada');
  });
});
