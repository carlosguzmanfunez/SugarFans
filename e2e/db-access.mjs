// The database side of the new hierarchy, against a throwaway local Postgres with
// every migration applied (plus a small stand-in for Supabase's auth schema).
// Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:db
//   (needs psql and a Postgres server you can create databases on; nothing remote)
//
// Checks: Open Live refused while open_live_enabled() is false and back when true;
// Subscriber Live alerts only active subscribers; Reserve Event seats (capacity, one
// per fan, several fans at the same time, payment); Reserve 1:1 keeps one booking per
// slot; guards on event seats; Reserve alerts, read receipts and the answer deadline;
// subscriptions and gifts create no access.
import { readdirSync, readFileSync } from 'node:fs';
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_access_test';
const { check, expect, psql, as, asServer, raises, setup, user, finish } = createDbTest(DB);

const run = async () => {
  setup();
  // Applying the new migration a second time changes nothing.
  psql(DB, readFileSync(new URL('../supabase/migrations/20261004000004_subscriber_live_reserve_events.sql', import.meta.url), 'utf8'));

  const creator = user('creator@test.local', 'creator');
  const sub = user('sub@test.local', 'fan');
  const follower = user('follower@test.local', 'fan');
  const expired = user('expired@test.local', 'fan');
  const quiet = user('quiet@test.local', 'fan');
  const fanA = user('a@test.local', 'fan');
  const fanB = user('b@test.local', 'fan');
  const fanC = user('c@test.local', 'fan');
  const cp = creator; // a creator's profile id is their user id
  psql(DB, `
    insert into public.subscriptions (fan_id, creator_id, price, since, cancel_at) values
      ('${sub}', '${cp}', 9.99, now(), null),
      ('${expired}', '${cp}', 9.99, now() - interval '2 months', now() - interval '1 day'),
      ('${quiet}', '${cp}', 9.99, now(), null);
    insert into public.follows (user_id, creator_profile_id, live_alerts) values
      ('${follower}', '${cp}', true), ('${quiet}', '${cp}', false), ('${sub}', '${cp}', true);`);

  console.log('Open Live');
  await check('start_live (Open Live) se rechaza mientras open_live_enabled() es false', async () => {
    raises(() => as(creator, `select public.start_live('Live abierto')`), /Live abierto está desactivado/, 'start_live');
    expect(psql(DB, `select count(*) from public.live_broadcasts`) === '0', 'se creó un Live');
  });
  await check('Activando open_live_enabled() el Open Live vuelve a funcionar (sin borrar nada)', async () => {
    const out = psql(DB, `begin;
      create or replace function public.open_live_enabled() returns boolean language sql immutable set search_path = '' as $$ select true $$;
      set local role authenticated;
      select set_config('request.jwt.claim.sub', '${creator}', true) \\g /dev/null
      select (public.start_live('Live abierto de prueba'))->>'notified';
      reset role;
      select mode from public.live_broadcasts where ended_at is null;
      rollback;`);
    expect(out.split('\n').pop() === 'open', `modo inesperado: ${out}`);
  });

  console.log('Subscriber Live');
  await check('start_subscriber_live crea un Live de modo subscriber y avisa solo a suscriptores activos', async () => {
    const r = JSON.parse(as(creator, `select public.start_subscriber_live('Live exclusivo para suscriptores')`));
    expect(r.notified === 1, `avisó a ${r.notified}, esperaba 1`);
    expect(psql(DB, `select mode from public.live_broadcasts where ended_at is null`) === 'subscriber', 'modo incorrecto');
    const who = psql(DB, `select user_id from public.notifications`).split('\n');
    expect(who.length === 1 && who[0] === sub, 'avisó a quien no debía (seguidor sin suscripción, vencida o campanita apagada)');
  });
  await check('Un fan no puede iniciar un Subscriber Live', async () => {
    raises(() => as(fanA, `select public.start_subscriber_live('No soy creator')`), /Solo los creators/, 'fan');
  });
  await check('end_live cierra el Subscriber Live como cualquier Live', async () => {
    as(creator, `select public.end_live()`);
    expect(psql(DB, `select count(*) from public.live_broadcasts where ended_at is null`) === '0', 'sigue abierto');
  });

  console.log('Reserve Event');
  const eventDetails = (seats, extra = '') =>
    `jsonb_build_object('modality','virtual','locationTypes',jsonb_build_array('online'),'format','event','eventDate',to_char(current_date + 5,'YYYY-MM-DD'),'eventTime','20:00','includes','[]'::jsonb,'excludes','[]'::jsonb,'requirements',jsonb_build_object('verifiedFans',false,'subscribersOnly',false),'minNoticeHours',24,'maxParticipants',${seats},'approval','automatic','cancellationPolicy','moderate'${extra})`;
  let ev = '';
  await check('El creator publica un Reserve Event (fecha, hora, plazas y duración obligatorias)', async () => {
    raises(
      () => as(creator, `insert into public.vip_experiences (creator_profile_id, creator_name, title, type, price, duration_minutes, details) values ('${cp}', 'x', 'Evento sin plazas', 'qa-session', 15, 60, ${eventDetails(1)})`),
      /entre 2 y 50 plazas/,
      'evento de 1 plaza'
    );
    raises(
      () => as(creator, `insert into public.vip_experiences (creator_profile_id, creator_name, title, type, price, duration_minutes, details) values ('${cp}', 'x', 'Evento sin fecha', 'qa-session', 15, 60, ${eventDetails(2)} - 'eventDate')`),
      /fecha y la hora/,
      'evento sin fecha'
    );
    ev = as(creator, `insert into public.vip_experiences (creator_profile_id, creator_name, title, type, price, duration_minutes, details) values ('${cp}', 'x', 'Beauty Q&A', 'qa-session', 15, 60, ${eventDetails(2)}) returning id`);
    expect(!!ev, 'no se creó');
  });
  await check('Varios fans reservan plaza para la misma hora; una plaza por fan; sin plazas al llenarse', async () => {
    const a = as(fanA, `select public.reserve_book_event_seat('${ev}', 'Hola')`);
    raises(() => as(fanA, `select public.reserve_book_event_seat('${ev}', '')`), /Ya tienes una plaza/, 'segunda plaza');
    as(fanB, `select public.reserve_book_event_seat('${ev}', '')`);
    raises(() => as(fanC, `select public.reserve_book_event_seat('${ev}', '')`), /No quedan plazas/, 'evento lleno');
    expect(psql(DB, `select status from public.vip_bookings where id = '${a}'`) === 'accepted', 'aprobación automática debería dejarla aceptada');
    expect(psql(DB, `select taken from public.reserve_event_seats(array['${ev}'])`) === '2', 'conteo de plazas');
  });
  await check('La plaza se paga como cualquier Reserve y queda confirmada', async () => {
    const method = psql(DB, `insert into public.payment_methods (user_id, kind, label) values ('${fanA}', 'card', 'Visa 4242') returning id`);
    const seat = psql(DB, `select id from public.vip_bookings where fan_id = '${fanA}'`);
    asServer(fanA, `select public.vip_pay_booking('${seat}', '${method}')`);
    expect(psql(DB, `select status from public.vip_bookings where id = '${seat}'`) === 'confirmed', 'no quedó confirmada');
  });
  await check('Un Reserve Event no se reserva como 1:1, y su fecha no se cambia por participante', async () => {
    raises(() => as(fanC, `select public.reserve_create_booking('${ev}', current_date + 5, '20:00', '', 1)`), /plaza desde el evento|horario/, 'reserva 1:1 de un evento');
    raises(() => psql(DB, `update public.vip_bookings set date = date + 1 where fan_id = '${fanB}'`), /no se cambia/, 'mover una plaza');
  });
  await check('Un evento solo para suscriptores pide suscripción; la suscripción no da plaza por sí sola', async () => {
    const subsOnly = as(
      creator,
      `insert into public.vip_experiences (creator_profile_id, creator_name, title, type, price, duration_minutes, details) values ('${cp}', 'x', 'Q&A para suscriptores', 'qa-session', 10, 45, ${eventDetails(5, ",'requirements',jsonb_build_object('verifiedFans',false,'subscribersOnly',true)")}) returning id`
    );
    raises(() => as(fanC, `select public.reserve_book_event_seat('${subsOnly}', '')`), /solo para suscriptores/, 'no suscriptor');
    expect(psql(DB, `select count(*) from public.vip_bookings where fan_id = '${sub}'`) === '0', 'la suscripción creó una reserva');
    as(sub, `select public.reserve_book_event_seat('${subsOnly}', '')`);
    expect(psql(DB, `select status from public.vip_bookings where fan_id = '${sub}'`) === 'accepted', 'la suscriptora no reservó su plaza (pagada aparte)');
  });

  console.log('Reserve 1:1');
  await check('Sigue habiendo una sola reserva 1:1 activa por horario del creator', async () => {
    const row = (fan) =>
      `insert into public.vip_bookings (experience_id, creator_profile_id, title, creator_name, price, fan_id, fan_name, fan_email, date, time, status, details) values ('custom', '${cp}', 'Sesión privada', 'x', 90, '${fan}', 'f', 'f@x', current_date + 9, '16:00', 'pending', '{"kind":"custom"}')`;
    psql(DB, row(fanA));
    raises(() => psql(DB, row(fanB)), /vip_bookings_active_slot/, 'dos reservas 1:1 en el mismo horario');
  });
  await check('Las reservas solo las ve su fan y su creator (la sala 1:1 se decide con esto)', async () => {
    expect(as(fanC, `select count(*) from public.vip_bookings`) === '0', 'un tercero ve reservas ajenas');
    expect(as(sub, `select count(*) from public.vip_bookings where fan_id <> '${sub}'`) === '0', 'una suscriptora ve reservas ajenas');
    expect(Number(as(creator, `select count(*) from public.vip_bookings`)) >= 4, 'el creator no ve sus reservas');
  });

  console.log('Avisos de Reserve');
  const request = (fan, day, extra = '') =>
    psql(DB, `insert into public.vip_bookings (experience_id, creator_profile_id, title, creator_name, price, fan_id, fan_name, fan_email, date, time, status, details) values ('custom', '${cp}', 'Clase privada', 'Vale Rose', 60, '${fan}', 'Ana Pérez', 'a@x', current_date + ${day}, '10:00', 'pending', '{"kind":"custom"}') returning id${extra}`);
  let req = '';
  await check('Una solicitud nueva avisa al creator y le da 48 horas para responder', async () => {
    req = request(fanC, 20);
    const n = psql(DB, `select kind || '|' || title || '|' || link from public.notifications where user_id = '${creator}' order by created_at desc limit 1`);
    expect(n === 'reserve_request|Nueva solicitud de Reserve|/creator/dashboard?tab=vip', `aviso inesperado: ${n}`);
    const hours = Number(psql(DB, `select round(extract(epoch from respond_by - now()) / 3600) from public.vip_bookings where id = '${req}'`));
    expect(hours === 48, `plazo de ${hours} h`);
  });
  await check('Al abrir Reservas el creator la marca como vista y el fan lo ve', async () => {
    expect(as(fanC, `select seen_at is null from public.vip_bookings where id = '${req}'`) === 't', 'ya estaba vista');
    expect(as(fanC, `select public.reserve_mark_seen()`) === '0', 'un fan marcó solicitudes ajenas');
    expect(Number(as(creator, `select public.reserve_mark_seen()`)) >= 1, 'no marcó nada');
    expect(as(fanC, `select seen_at is not null from public.vip_bookings where id = '${req}'`) === 't', 'el fan no ve que fue vista');
  });
  await check('Cuando el creator acepta, el fan recibe el aviso', async () => {
    as(creator, `select public.vip_update_booking('${req}', 'accepted')`);
    const n = as(fanC, `select kind || '|' || title from public.notifications order by created_at desc limit 1`);
    expect(n === 'reserve_update|Vale aceptó tu solicitud', `aviso inesperado: ${n}`);
  });
  await check('Sin respuesta a tiempo la solicitud expira, el fan lo sabe y el horario queda libre', async () => {
    const late = request(fanB, 22);
    psql(DB, `update public.vip_bookings set respond_by = now() - interval '1 minute' where id = '${late}'`);
    raises(() => as(creator, `select public.vip_update_booking('${late}', 'accepted')`), /expiró/, 'aceptar tarde');
    expect(psql(DB, `select public.expire_reserve_requests()`) === '1', 'no expiró');
    expect(psql(DB, `select status from public.vip_bookings where id = '${late}'`) === 'expired', 'estado incorrecto');
    const n = as(fanB, `select title from public.notifications order by created_at desc limit 1`);
    expect(n === 'Tu solicitud expiró sin respuesta', `aviso inesperado: ${n}`);
    request(fanA, 22); // the same slot can be requested again
  });
  await check('Cada quien guarda solo su celular para avisos; las claves del servidor no se leen', async () => {
    as(fanA, `select public.save_push_subscription('https://push.example/abc', 'k', 'a')`);
    expect(as(fanB, `select count(*) from public.push_subscriptions`) === '0', 'otro usuario ve la suscripción');
    expect(as(fanA, `select count(*) from public.push_subscriptions`) === '1', 'no se guardó');
    raises(() => as(fanA, `select count(*) from public.app_secrets`), /permission denied/, 'leer app_secrets');
  });

  console.log('Regalos');
  await check('Ninguna función de regalos crea reservas, plazas ni suscripciones', async () => {
    const src = readdirSync(new URL('../supabase/migrations/', import.meta.url))
      .map((f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8'))
      .join('\n');
    const body = src.match(/create or replace function public\.send_gift\([\s\S]*?\n\$\$;/g)?.pop() ?? '';
    expect(body.length > 0, 'no encontré send_gift');
    expect(!/vip_bookings|subscriptions/.test(body), 'send_gift toca reservas o suscripciones');
  });
};

finish(run);
