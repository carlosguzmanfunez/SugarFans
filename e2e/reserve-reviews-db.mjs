// Reserve time zones and reviews on a throwaway Postgres with every migration.
// Usage: PGHOST=/var/run/postgresql PGUSER=root npm run test:reserve-reviews-db
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_reserve_reviews_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);

finish(async () => {
  setup();
  console.log('\nReserve: zonas horarias y reseñas');
  const creator = user('ana.creadora@test.com', 'creator');
  const fan = user('luz maria@test.com', 'fan');
  const other = user('otro@test.com', 'fan');
  const admin = user('admin@test.com', 'admin');
  psql(DB, `update public.profiles set name = 'Luz María Pérez' where id = '${fan}'`);
  psql(DB, `update public.profiles set role = 'admin' where id = '${admin}'`);
  const cp = psql(DB, `select creator_profile_id from public.profiles where id = '${creator}'`);
  psql(DB, `insert into public.vip_availability (creator_profile_id, days, hours, time_zone) values ('${cp}', '{1,2,3,4,5}', '{18:00}', 'America/Tegucigalpa')`);
  psql(DB, `insert into public.vip_experiences (id, creator_profile_id, creator_name, title, price, duration_minutes, created_by, time_zone)
            values ('exp-tz', '${cp}', 'Ana', 'Videollamada 1:1', 25, 30, '${creator}', 'Europe/Madrid')`);
  psql(DB, `insert into public.vip_experiences (id, creator_profile_id, creator_name, title, price, duration_minutes, created_by, time_zone, details)
            values ('ev-tz', '${cp}', 'Ana', 'Clase grupal', 15, 60, '${creator}', 'Europe/Madrid', '{"format":"event","eventDate":"2030-01-08","eventTime":"18:00","maxParticipants":5,"modality":"virtual","locationTypes":["online"],"includes":[],"excludes":[],"requirements":{"verifiedFans":false,"subscribersOnly":false},"minNoticeHours":24,"approval":"automatic","cancellationPolicy":"moderate"}')`);
  const booking = (status, date, time = '18:00', extra = '') =>
    psql(DB, `insert into public.vip_bookings (experience_id, creator_profile_id, title, creator_name, price, fan_id, fan_name, fan_email, date, time, status, duration_minutes${extra ? ', details' : ''})
              values ('${extra ? 'ev-tz' : 'exp-tz'}', '${cp}', 'Videollamada 1:1', 'Ana', 25, '${fan}', 'Luz', 'luz@test.com', '${date}', '${time}', '${status}', 30${extra ? `, '${extra}'` : ''}) returning id`);

  await check('Una reserva toma la zona horaria del horario del creador', async () => {
    const id = booking('pending', '2030-01-07');
    expect(psql(DB, `select time_zone from public.vip_bookings where id = '${id}'`) === 'America/Tegucigalpa', 'zona incorrecta');
  });
  await check('Una plaza de evento toma la zona del evento', async () => {
    const id = booking('confirmed', '2030-01-08', '18:00', '{"kind":"event"}');
    expect(psql(DB, `select time_zone from public.vip_bookings where id = '${id}'`) === 'Europe/Madrid', 'zona incorrecta');
  });
  await check('Una zona horaria inventada se rechaza', async () => {
    raises(() => psql(DB, `update public.vip_availability set time_zone = 'Marte/Olympus' where creator_profile_id = '${cp}'`), /time_zone_check/, 'zona falsa');
  });
  await check('La experiencia termina a la hora correcta en su zona', async () => {
    // 18:00 in Tegucigalpa (UTC-6) + 30 min = 00:30 UTC next day.
    const end = psql(DB, `select to_char(public.reserve_booking_ends_at('2030-01-07', '18:00', 30, 'America/Tegucigalpa') at time zone 'UTC', 'YYYY-MM-DD HH24:MI')`);
    expect(end === '2030-01-08 00:30', `fin: ${end}`);
  });

  const past = booking('confirmed', '2026-01-05');
  const future = booking('confirmed', '2030-02-04');
  const pending = booking('pending', '2026-01-06');

  await check('El fan reseña su experiencia ya realizada (solo su nombre de pila)', async () => {
    as(fan, `select public.reserve_submit_review('${past}', 5, 'Súper clara y puntual.')`);
    const r = JSON.parse(psql(DB, `select row_to_json(r) from (select rating, comment, fan_name, creator_profile_id from public.reserve_reviews where booking_id = '${past}') r`));
    expect(r.rating === 5 && r.comment === 'Súper clara y puntual.' && r.fan_name === 'Luz' && r.creator_profile_id === cp, JSON.stringify(r));
  });
  await check('Puede editar su reseña sin duplicarla', async () => {
    as(fan, `select public.reserve_submit_review('${past}', 4, 'Muy buena.')`);
    expect(psql(DB, `select count(*) || ':' || max(rating) from public.reserve_reviews`) === '1:4', 'no se editó');
  });
  await check('No se puede reseñar antes de que termine, ni una reserva sin pagar', async () => {
    raises(() => as(fan, `select public.reserve_submit_review('${future}', 5, '')`), /cuando termine/, 'futura');
    raises(() => as(fan, `select public.reserve_submit_review('${pending}', 5, '')`), /confirmada/, 'pendiente');
  });
  await check('Nadie reseña una reserva ajena ni escribe directo en la tabla', async () => {
    raises(() => as(other, `select public.reserve_submit_review('${past}', 1, '')`), /No encontramos/, 'ajena');
    raises(() => as(fan, `insert into public.reserve_reviews (booking_id, creator_profile_id, experience_id, experience_title, fan_id, fan_name, rating) values ('${future}', '${cp}', 'exp-tz', 'x', '${fan}', 'Luz', 5)`), /permission denied/, 'insert directo');
    raises(() => as(fan, `update public.reserve_reviews set rating = 5`), /permission denied/, 'update directo');
  });
  await check('Las estrellas van de 1 a 5 y el texto prohibido se bloquea', async () => {
    raises(() => as(fan, `select public.reserve_submit_review('${past}', 6, '')`), /1 a 5/, 'seis estrellas');
    raises(() => as(fan, `select public.reserve_submit_review('${past}', 5, 'ofrece servicios sexuales')`), /no está permitido/, 'texto prohibido');
  });
  await check('Cualquiera ve las reseñas y la media del creador', async () => {
    expect(psql(DB, `begin; set local role anon; select count(*) from public.reserve_reviews; commit;`) === '1', 'anon no ve la reseña');
    const r = psql(DB, `begin; set local role anon; select average || '/' || total from public.reserve_creator_rating('${cp}'); commit;`);
    expect(r === '4.0/1', `media: ${r}`);
  });
  await check('Un admin oculta una reseña; su autor la sigue viendo', async () => {
    raises(() => as(other, `select public.admin_set_review_hidden('${past}', true)`), /administrador/, 'no admin');
    as(admin, `select public.admin_set_review_hidden('${past}', true)`);
    expect(as(other, `select count(*) from public.reserve_reviews`) === '0', 'otro fan la sigue viendo');
    expect(as(fan, `select count(*) from public.reserve_reviews`) === '1', 'el autor ya no la ve');
    expect(psql(DB, `select total from public.reserve_creator_rating('${cp}')`) === '0', 'la media cuenta la oculta');
  });
});
