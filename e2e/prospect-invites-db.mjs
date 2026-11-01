// Creator recruitment, invite links: every prospect gets a private code; a visitor
// without an account opens the link (recorded once, admins don't count), says
// "quiero participar" or unsubscribes; the account they create is linked with
// prospect_claim(); the daily check follows that account to verificado/activo;
// emails sent from the console respect the daily count and move the funnel; the
// summary shows the last 24 hours and the last automatic check.
// On a throwaway Postgres with every migration.
// Usage: PGHOST=127.0.0.1 PGUSER=postgres npm run test:prospects-db
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_prospect_invites_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);

const lit = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const row = (handle) => JSON.parse(psql(DB, `select row_to_json(p) from public.creator_prospects p where handle = '${handle}'`) || 'null');
const anon = (query) => psql(DB, `begin;\nset local role anon;\n${query};\ncommit;`);
const events = (handle) => psql(DB, `select string_agg(e.kind, ',' order by e.id) from public.prospect_events e join public.creator_prospects p on p.id = e.prospect_id where p.handle = '${handle}'`);

finish(async () => {
  setup();
  console.log('\nCaptar creadores: links de invitación');
  const admin = user('boss@test.com', 'fan');
  psql(DB, `update public.profiles set role = 'admin' where id = '${admin}'`);
  const fan = user('luz@test.com', 'fan');
  as(admin, `select public.prospects_import(${lit([
    { network: 'instagram', handle: 'ana.fit', country: 'HN', display_name: 'Ana Pérez', email: 'ana@correo.com' },
    { network: 'instagram', handle: 'beto', country: 'MX' },
    { network: 'tiktok', handle: 'carla', country: 'CO', email: 'carla@correo.com' },
  ])}, 'heepsy')`);
  const code = (h) => row(h).invite_code;

  await check('Cada creador importado tiene su código privado, distinto y de 12 caracteres', async () => {
    const codes = ['ana.fit', 'beto', 'carla'].map(code);
    expect(codes.every((c) => /^[a-f0-9]{12}$/.test(c)) && new Set(codes).size === 3, codes.join(' '));
    raises(() => anon(`select invite_code from public.creator_prospects`), /permission denied/, 'un visitante lee la tabla');
    raises(() => as(fan, `select public.prospects_email_quota()`), /administrador/, 'un fan ve la cuota');
    raises(() => as(fan, `select public.prospects_sync_run(true)`), /permission denied/, 'un fan corre la revisión');
  });

  await check('Abrir el link sin cuenta muestra para quién es y lo anota una sola vez como evento', async () => {
    const info = JSON.parse(anon(`select public.prospect_invite('${code('ana.fit').toUpperCase()} ')`));
    expect(info.handle === 'ana.fit' && info.name === 'Ana Pérez' && info.country === 'HN' && !info.interested && !info.registered, JSON.stringify(info));
    expect(!('email' in info) && !('notes' in info), 'expone datos de contacto');
    anon(`select public.prospect_invite('${code('ana.fit')}')`);
    const ana = row('ana.fit');
    expect(ana.opened_at && ana.open_count === 2 && ana.last_opened_at, JSON.stringify(ana));
    expect(events('ana.fit') === 'abrio', events('ana.fit'));
    expect(anon(`select public.prospect_invite('000000000000')`) === '', 'un código que no existe');
  });

  await check('Si lo abre alguien del equipo no cuenta', async () => {
    JSON.parse(as(admin, `select public.prospect_invite('${code('beto')}')`));
    expect(row('beto').opened_at === null && row('beto').open_count === 0, JSON.stringify(row('beto')));
  });

  await check('"Quiero participar" pasa a Respondió, guarda el correo si no tenía y no pisa uno existente', async () => {
    raises(() => anon(`select public.prospect_interest('${code('beto')}', 'no-es-correo')`), /correo/, 'correo inválido');
    expect(anon(`select public.prospect_interest('${code('beto')}', ' Beto@Mail.com ')`) === 't', 'beto');
    const beto = row('beto');
    expect(beto.status === 'respondio' && beto.interested_at && beto.email === 'beto@mail.com' && beto.replied_at, JSON.stringify(beto));
    anon(`select public.prospect_interest('${code('ana.fit')}', 'otro@mail.com')`);
    expect(row('ana.fit').email === 'ana@correo.com', 'pisó el correo');
    anon(`select public.prospect_interest('${code('beto')}', null)`);
    expect(events('beto') === 'interesado', events('beto'));
  });

  await check('Darse de baja deja No contactar, borra el correo y el link ya no muestra la invitación', async () => {
    expect(anon(`select public.prospect_unsubscribe('${code('carla')}')`) === 't', 'baja');
    const carla = row('carla');
    expect(carla.status === 'no_contactar' && carla.email === null, JSON.stringify(carla));
    const info = JSON.parse(anon(`select public.prospect_invite('${code('carla')}')`));
    expect(info.unsubscribed === true && !info.name, JSON.stringify(info));
    expect(anon(`select public.prospect_interest('${code('carla')}', 'carla@correo.com')`) === 'f', 'volvió a entrar');
    expect(row('carla').email === null && events('carla') === 'baja', events('carla'));
  });

  await check('Al crear su cuenta, el link la conecta: Registrado; el admin y otro usuario no pueden', async () => {
    const ana = user('ana@test.com', 'creator');
    expect(as(admin, `select public.prospect_claim('${code('ana.fit')}')`) === 'f', 'el admin se conectó');
    expect(as(ana, `select public.prospect_claim('${code('ana.fit')}')`) === 't', 'ana');
    expect(row('ana.fit').status === 'registrado' && row('ana.fit').matched_profile_id === ana, JSON.stringify(row('ana.fit')));
    expect(as(fan, `select public.prospect_claim('${code('ana.fit')}')`) === 'f', 'otro usuario se la quedó');
    raises(() => anon(`select public.prospect_claim('${code('ana.fit')}')`), /permission denied/, 'un visitante conecta');

    // The daily check follows the claimed account even without the handle in her profile.
    psql(DB, `update public.profiles set is_verified = true where id = '${ana}'`);
    psql(DB, `select public.prospects_sync_run(true)`);
    expect(row('ana.fit').status === 'verificado', row('ana.fit').status);
    expect(events('ana.fit') === 'abrio,interesado,registrado,verificado', events('ana.fit'));
  });

  await check('Los correos enviados se cuentan por día y mueven el embudo', async () => {
    as(admin, `select public.prospects_import(${lit([{ network: 'instagram', handle: 'dani', email: 'dani@x.com' }, { network: 'instagram', handle: 'eva', email: 'eva@x.com' }])}, 'manual')`);
    const ids = psql(DB, `select string_agg(id::text, ',') from public.creator_prospects where handle in ('dani', 'eva')`);
    expect(as(admin, `select public.prospects_email_quota()`) === '0', 'cuota inicial');
    expect(as(admin, `select public.prospects_email_sent('{${ids}}'::uuid[], false)`) === '2', 'enviados');
    expect(row('dani').status === 'contactado' && row('dani').channel === 'email' && row('dani').contacted_at, JSON.stringify(row('dani')));
    expect(as(admin, `select public.prospects_email_quota()`) === '2', 'cuota');
    as(admin, `select public.prospects_email_sent('{${ids.split(',')[0]}}'::uuid[], true)`);
    expect(as(admin, `select public.prospects_email_quota()`) === '3', 'seguimiento cuenta');
    expect(psql(DB, `select sum(follow_ups) from public.creator_prospects where handle in ('dani', 'eva')`) === '1', 'seguimiento');
    raises(() => as(fan, `select public.prospects_email_sent('{${ids}}'::uuid[], false)`), /administrador/, 'un fan marca correos');
  });

  await check('El resumen trae las últimas 24 horas y la última revisión automática', async () => {
    const s = JSON.parse(as(admin, `select public.prospects_summary()`));
    expect(s.last_24h.abrio === 1 && s.last_24h.interesado === 2 && s.last_24h.baja === 1 && s.last_24h.registrado === 1 && s.last_24h.verificado === 1, JSON.stringify(s.last_24h));
    expect(s.last_24h.correo === 3 && s.emails_today === 3 && s.last_24h.contactado === 2, JSON.stringify(s.last_24h));
    expect(s.last_auto_sync, 'sin revisión automática');
    psql(DB, `update public.prospect_events set at = now() - interval '2 days'`);
    expect(Object.keys(JSON.parse(as(admin, `select public.prospects_summary()`)).last_24h).length === 0, 'eventos viejos');
    // The admin button is still admin-only and logs a manual run.
    raises(() => as(fan, `select public.prospects_sync()`), /administrador/, 'fan');
    as(admin, `select public.prospects_sync()`);
    expect(psql(DB, `select count(*) filter (where automatic) || '/' || count(*) from public.prospect_sync_runs`) === '1/2', 'corridas');
  });

  await check('Borrar a alguien borra también sus eventos', async () => {
    as(admin, `delete from public.creator_prospects where handle = 'beto'`);
    expect(psql(DB, `select count(*) from public.prospect_events e where not exists (select 1 from public.creator_prospects p where p.id = e.prospect_id)`) === '0', 'quedaron eventos');
  });
});
