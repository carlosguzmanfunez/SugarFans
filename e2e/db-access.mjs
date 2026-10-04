// The database side of the new hierarchy, against a throwaway local Postgres with
// every migration applied (plus a small stand-in for Supabase's auth schema).
// Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:db
//   (needs psql and a Postgres server you can create databases on; nothing remote)
//
// Checks: Open Live refused while open_live_enabled() is false and back when true;
// Subscriber Live alerts only active subscribers; Reserve Event seats (capacity, one
// per fan, several fans at the same time, payment); Reserve 1:1 keeps one booking per
// slot; guards on event seats; subscriptions and gifts create no access.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const DB = 'fr_access_test';
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name}\n      ${String(err.message || err).split('\n').slice(0, 4).join('\n      ')}`);
  }
};
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const psql = (db, input) => {
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', db], { input, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim());
  return r.stdout.trim();
};
// Runs as a signed-in user through row security, like the app does.
const as = (uid, query) =>
  psql(DB, `begin;\nset local role authenticated;\nselect set_config('request.jwt.claim.sub', '${uid}', true) \\g /dev/null\n${query};\ncommit;`);
const raises = (fn, pattern, what) => {
  try {
    fn();
  } catch (err) {
    expect(pattern.test(err.message), `${what}: error inesperado: ${err.message.split('\n')[0]}`);
    return;
  }
  throw new Error(`${what}: debía fallar y no falló`);
};

// Supabase pieces the migrations rely on.
const SHIM = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now(), email_confirmed_at timestamptz);
create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid, provider text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
grant usage on schema auth to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
create schema extensions;
create publication supabase_realtime;
create schema cron;
create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
create schema realtime; create table realtime.messages (id bigserial, topic text, extension text); alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql as $$ select '' $$;
grant usage on schema public to anon, authenticated;
`;

const setup = () => {
  psql('postgres', `drop database if exists ${DB};\ncreate database ${DB};`);
  // Roles are cluster-wide: create them only once.
  const roles = psql('postgres', "select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')");
  psql(DB, roles === '3' ? SHIM.replace(/^create role .*$/m, '') : SHIM);
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort())
    psql(DB, readFileSync(new URL(f, dir), 'utf8').replace(/^create extension if not exists pg_cron;$/m, ''));
};

const user = (email, role) =>
  psql(DB, `insert into auth.users (email, raw_user_meta_data) values ('${email}', '{"role":"${role}","name":"${email.split('@')[0]}","age_verified":true}') returning id`);

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
    as(fanA, `select public.vip_pay_booking('${seat}', '${method}')`);
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

run()
  .catch((err) => {
    console.error(err.message || err);
    results.push({ name: 'run', ok: false });
  })
  .finally(() => {
    try {
      psql('postgres', `drop database if exists ${DB};`);
    } catch {
      // ignore
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} comprobaciones de base de datos`);
    process.exit(failed ? 1 : 0);
  });
