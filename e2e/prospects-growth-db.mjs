// Creator recruitment, part 3: message versions A/B and their reply rate, the
// creators invited by other creators, the morning email's data (service role only)
// and the TikTok account a user connects (only the server writes it).
// On a throwaway Postgres with every migration.
// Usage: PGHOST=127.0.0.1 PGUSER=postgres npm run test:prospects-db
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_prospects_growth_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);

const lit = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const service = (query) => psql(DB, `begin;\nset local role service_role;\n${query};\ncommit;`);
const anon = (query) => psql(DB, `begin;\nset local role anon;\n${query};\ncommit;`);
const save = (uid, id, username, followers = 25300) =>
  `select public.social_connection_save('${uid}', 'tiktok', '${id}', '${username}', 'Ana', 'https://p16.tiktokcdn.com/a.jpg', ${followers}, 120000, 85, false)`;

finish(async () => {
  setup();
  console.log('\nCaptar creadores: versiones, resumen diario y TikTok');
  const admin = user('boss@test.com', 'fan');
  psql(DB, `update public.profiles set role = 'admin' where id = '${admin}'`);
  const fan = user('luz@test.com', 'fan');
  const ana = user('ana@test.com', 'creator');
  const beto = user('beto@test.com', 'creator');
  as(admin, `select public.prospects_import(${lit(
    ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'e1', 'e2', 'n1', 'n2'].map((h) => ({ network: 'instagram', handle: h, country: 'HN' })),
  )}, 'manual')`);

  await check('Cada contacto guarda su versión A o B y solo acepta esas dos', async () => {
    as(admin, `update public.creator_prospects set status = 'contactado', channel = 'dm', message_variant = 'A' where handle like 'a%'`);
    as(admin, `update public.creator_prospects set status = 'contactado', channel = 'dm', message_variant = 'B' where handle like 'b%'`);
    as(admin, `update public.creator_prospects set status = 'contactado', channel = 'email', message_variant = 'A' where handle like 'e%'`);
    raises(() => as(admin, `update public.creator_prospects set message_variant = 'C' where handle = 'n1'`), /message_variant_check/, 'versión C');
  });

  await check('Insights: % de respuesta por canal y versión (cuenta respondió, interesados y registrados)', async () => {
    as(admin, `update public.creator_prospects set status = 'respondio' where handle in ('a1', 'b1', 'b2')`);
    psql(DB, `update public.creator_prospects set interested_at = now() where handle = 'a2'`);
    psql(DB, `update public.creator_prospects set status = 'registrado' where handle = 'e1'`);
    const v = JSON.parse(as(admin, `select public.prospects_insights()`)).variants;
    const get = (c, x) => v.find((r) => r.channel === c && r.variant === x);
    expect(get('dm', 'A').contacted === 4 && get('dm', 'A').replied === 2, JSON.stringify(v));
    expect(get('dm', 'B').contacted === 3 && get('dm', 'B').replied === 2, JSON.stringify(v));
    expect(get('email', 'A').contacted === 2 && get('email', 'A').replied === 1 && v.length === 3, JSON.stringify(v));
    raises(() => as(fan, `select public.prospects_insights()`), /administrador/, 'un fan ve los insights');
  });

  await check('Insights: creadores invitados por otros creadores y quién invita más', async () => {
    const ref = psql(DB, `select creator_profile_id from public.profiles where id = '${ana}'`);
    const betoProfile = psql(DB, `select creator_profile_id from public.profiles where id = '${beto}'`);
    expect(ref && betoProfile, 'sin creator_profile_id');
    psql(DB, `insert into public.creator_invites (creator_id, creator_profile_id, referrer_profile_id) values ('${beto}', '${betoProfile}', '${ref}')`);
    psql(DB, `update public.profiles set is_verified = true where id = '${beto}'`);
    const i = JSON.parse(as(admin, `select public.prospects_insights()`));
    expect(i.creator_invites.total === 1 && i.creator_invites.verified === 1 && i.creator_invites.selling === 0 && i.creator_invites.last_30_days === 1, JSON.stringify(i.creator_invites));
    expect(i.top_inviters.length === 1 && i.top_inviters[0].count === 1 && i.top_inviters[0].name, JSON.stringify(i.top_inviters));
  });

  await check('El resumen diario: lo de las últimas 24 horas, con nombres, y lo pendiente', async () => {
    const code = psql(DB, `select invite_code from public.creator_prospects where handle = 'n1'`);
    anon(`select public.prospect_interest('${code}', 'n1@correo.com')`);
    psql(DB, `update public.creator_prospects set contacted_at = now() - interval '6 days' where handle in ('a3', 'a4')`);
    const d = JSON.parse(service(`select public.prospects_digest()`));
    expect(d.last_24h.contactado === 9 && d.last_24h.interesado === 1 && d.last_24h.registrado === 1, JSON.stringify(d.last_24h));
    expect(d.people.interesado?.[0]?.handle === 'n1' && d.people.registrado?.[0]?.handle === 'e1', JSON.stringify(d.people));
    expect(d.interested === 4 && d.follow_ups_due === 2 && d.to_contact === 1 && d.creators_invited_24h === 1, JSON.stringify(d));
    raises(() => as(admin, `select public.prospects_digest()`), /permission denied/, 'un admin desde el navegador');
    raises(() => anon(`select public.prospects_digest()`), /permission denied/, 'un visitante');
  });

  await check('TikTok conectado: solo lo guarda el servidor y llena la red en el perfil', async () => {
    raises(() => as(ana, save(ana, 'open-1', 'ana.fit')), /permission denied/, 'el usuario lo escribe');
    raises(() => as(ana, `insert into public.social_connections (user_id, network, external_id) values ('${ana}', 'tiktok', 'x')`), /permission denied/, 'insert directo');
    expect(service(save(ana, 'open-1', '@Ana.Fit')) === 't', 'guardar');
    const row = JSON.parse(as(ana, `select row_to_json(s) from public.social_connections s`));
    expect(row.username === 'ana.fit' && row.followers === 25300 && row.likes === 120000 && row.videos === 85, JSON.stringify(row));
    expect(psql(DB, `select settings->'socials'->>'tiktok' from public.profiles where id = '${ana}'`) === 'ana.fit', 'red en el perfil');
    expect(as(fan, `select count(*) from public.social_connections`) === '0', 'otro usuario la ve');
    expect(as(admin, `select count(*) from public.social_connections`) === '1', 'el admin no la ve');
  });

  await check('Reconectar actualiza los números; la misma cuenta en otro usuario se mueve; desconectar la borra', async () => {
    service(save(ana, 'open-1', 'ana.fit', 30000));
    expect(psql(DB, `select followers from public.social_connections where user_id = '${ana}'`) === '30000', 'no actualizó');
    service(save(beto, 'open-1', 'ana.fit'));
    expect(psql(DB, `select string_agg(user_id::text, ',') from public.social_connections`) === beto, 'quedó en dos cuentas');
    expect(service(`select public.social_connection_save('00000000-0000-0000-0000-000000000000', 'tiktok', 'z', 'z', '', '', 1, 1, 1, false)`) === 'f', 'usuario que no existe');
    raises(() => service(`select public.social_connection_save('${ana}', 'instagram', 'z', 'z', '', '', 1, 1, 1, false)`), /no válida/, 'otra red');
    as(beto, `delete from public.social_connections where network = 'tiktok'`);
    expect(psql(DB, `select count(*) from public.social_connections`) === '0', 'no se desconectó');
  });
});
