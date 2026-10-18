// Provider usage ("Consumo" tab and the daily check): infra_usage() counts this
// month's emails, scans, Didit checks, active users and video minutes (a 1:1 is two
// people, an Event is each seat plus the creator once); only admins and the server
// read it; only admins change the plans and the fund share; each alert is stored once.
// On a throwaway Postgres with every migration.
// Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:infra-usage-db
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_infra_usage_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);

const server = (query) => psql(DB, `begin;\nset local role service_role;\nselect set_config('request.jwt.claim.role', 'service_role', true) \\g /dev/null\n${query};\ncommit;`);
const usage = (who) => JSON.parse(who(`select public.infra_usage()`));

finish(async () => {
  setup();
  console.log('\nConsumo de proveedores y fondo');
  const fan = user('luz@test.com', 'fan');
  const creator = user('ana@test.com', 'creator');
  const admin = user('boss@test.com', 'fan');
  psql(DB, `update public.profiles set role = 'admin' where id = '${admin}'`);
  psql(DB, `update auth.users set last_sign_in_at = now() - interval '2 days' where id in ('${fan}', '${admin}')`);
  psql(DB, `update auth.users set last_sign_in_at = now() - interval '60 days' where id = '${creator}'`);

  const booking = (kind, minutes, status, slot = '16:00', exp = 'x1', extra = '', who = fan) =>
    `insert into public.vip_bookings (experience_id, creator_profile_id, title, creator_name, price, fan_id, fan_name, fan_email, date, time, status, duration_minutes, details)
     values ('${exp}', 'c1', 't', 'c', 10, '${who}', 'f', 'f@x', date_trunc('month', now())::date + 1, '${slot}', '${status}', ${minutes}, '{"kind":"${kind}"${extra}}')`;
  psql(DB, `set session_replication_role = replica;
    ${booking('call', 30, 'confirmed')};
    ${booking('call', 20, 'pending', '17:00')};
    ${booking('call', 60, 'confirmed', '10:00', 'x2', ',"modality":"in_person"')};
    ${booking('event', 45, 'confirmed', '18:00', 'ev')};
    ${booking('event', 45, 'confirmed', '18:00', 'ev', '', admin)};
    ${booking('event', 45, 'confirmed', '18:00', 'ev', '', creator)};
    insert into public.email_outbox (to_email, subject, body, delivered_at) values ('a@x', 's', 'b', now()), ('b@x', 's', 'b', now() - interval '40 days'), ('c@x', 's', 'b', null);
    insert into public.identity_verifications (user_id, user_name, email, role, legal_name, country, doc_type, doc_number, provider, status) select '${creator}', 'Ana', 'a@x', 'creator', 'Ana', 'HN', 'dni', '1', 'didit', 'approved';
    insert into public.media_moderation (bucket, path, owner_id, kind, media_type, status, provider) values
      ('post-media', 'a.jpg', '${creator}', 'post', 'image', 'approved', 'sightengine'),
      ('post-media', 'b.jpg', '${creator}', 'post', 'image', 'approved', 'anterior');`);

  await check('Un fan no puede ver el consumo', async () => {
    raises(() => as(fan, `select public.infra_usage()`), /administrador/, 'fan');
  });
  await check('El admin ve el consumo del mes', async () => {
    const u = usage((q) => as(admin, q));
    expect(u.mau === 2 && u.users_total === 3, `usuarios ${u.mau}/${u.users_total}`);
    expect(u.emails_month === 1, `correos ${u.emails_month}`);
    expect(u.scans_month === 1, `revisiones ${u.scans_month}`);
    expect(u.kyc_month === 1, `didit ${u.kyc_month}`);
    expect(u.db_bytes > 0 && u.fund_pct === 10, JSON.stringify(u));
  });
  await check('Minutos de video: 1:1 por dos, evento por asiento más el creador una vez', async () => {
    const u = usage((q) => as(admin, q));
    // 30×2 (1:1) + 45×3 seats + 45 creator; pending and in-person don't count.
    expect(u.video_minutes_month === 60 + 135 + 45, `minutos ${u.video_minutes_month}`);
  });
  await check('El servidor (service role) lo lee para la revisión diaria', async () => {
    expect(usage(server).month.length === 7, 'sin mes');
  });
  await check('Solo el admin cambia los planes y el porcentaje del fondo', async () => {
    raises(() => as(fan, `select public.set_infra_settings('{"livekit":"ship"}', 20)`), /administrador/, 'fan');
    raises(() => as(admin, `select public.set_infra_settings('{}', 80)`), /entre 0% y 50%/, 'fuera de rango');
    as(admin, `select public.set_infra_settings('{"livekit":"ship"}', 15)`);
    const u = usage((q) => as(admin, q));
    expect(u.plans.livekit === 'ship' && u.fund_pct === 15, JSON.stringify(u.plans));
  });
  await check('Un aviso se guarda una sola vez y un fan no lo ve', async () => {
    server(`insert into public.usage_alerts (month, metric, level, pct) values ('2026-10', 'livekit_minutes', 70, 72) on conflict do nothing`);
    server(`insert into public.usage_alerts (month, metric, level, pct) values ('2026-10', 'livekit_minutes', 70, 75) on conflict do nothing`);
    expect(as(admin, `select count(*) from public.usage_alerts`) === '1', 'duplicado');
    expect(as(fan, `select count(*) from public.usage_alerts`) === '0', 'el fan lo ve');
  });
});
