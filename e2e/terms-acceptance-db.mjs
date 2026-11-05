// Terms acceptance record (migration 20261105000002) on a throwaway Postgres:
// the server stamps when and which version each person accepted, and nobody can
// edit it by hand.
// Usage: PGHOST=127.0.0.1 PGUSER=postgres npm run test:terms-acceptance-db
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_terms_acceptance_test';
const { check, expect, psql, as, setup, finish } = createDbTest(DB);

const signUp = (email, meta) =>
  psql(
    DB,
    `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('${email}', '${JSON.stringify({ name: email.split('@')[0], role: 'fan', age_verified: true, ...meta })}', '{"provider":"email"}') returning id`,
  );
const col = (uid, c) => psql(DB, `select ${c} from public.profiles where id = '${uid}'`);
const history = (uid) => psql(DB, `select string_agg(version || ':' || method, ',' order by id) from public.terms_acceptances where user_id = '${uid}'`);

finish(async () => {
  setup();
  console.log('\nFecha de aceptación de los Términos');
  const ana = signUp('ana@test.com', { terms_version: '1.2.0' });
  const goo = signUp('goo@test.com', {});

  await check('Registro con email: guarda versión y fecha del servidor', async () => {
    expect(col(ana, 'terms_version') === '1.2.0', `versión ${col(ana, 'terms_version')}`);
    expect(col(ana, "terms_accepted_at > now() - interval '1 minute'") === 't', 'sin fecha');
    expect(history(ana) === '1.2.0:signup', `historial ${history(ana)}`);
  });
  await check('Sin aceptar (Google antes de completar): queda vacío', async () => {
    expect(col(goo, 'terms_accepted_at') === '', `fecha ${col(goo, 'terms_accepted_at')}`);
  });
  await check('Google: accept_terms guarda versión y fecha', async () => {
    as(goo, `select public.accept_terms('1.2.0')`);
    expect(col(goo, 'terms_version') === '1.2.0', `versión ${col(goo, 'terms_version')}`);
    expect(history(goo) === '1.2.0:social', `historial ${history(goo)}`);
  });
  await check('Nadie puede cambiar la fecha ni la versión a mano', async () => {
    const before = col(ana, 'terms_accepted_at');
    as(ana, `update public.profiles set terms_accepted_at = '2020-01-01', terms_version = 'x', bio = 'hola' where id = '${ana}'`);
    expect(col(ana, 'terms_accepted_at') === before, 'cambió la fecha');
    expect(col(ana, 'terms_version') === '1.2.0', 'cambió la versión');
    expect(col(ana, 'bio') === 'hola', 'el resto del perfil dejó de editarse');
  });
  await check('Una nueva versión queda en el historial como re-aceptación', async () => {
    as(ana, `select public.accept_terms('1.3.0')`);
    expect(history(ana) === '1.2.0:signup,1.3.0:reaccept', `historial ${history(ana)}`);
  });
  await check('Cada persona solo ve su propio historial', async () => {
    expect(as(goo, `select count(*) from public.terms_acceptances where user_id = '${ana}'`) === '0', 've el de otra persona');
  });
  await check('Un visitante sin sesión no puede aceptar', async () => {
    let msg = '';
    try { psql(DB, `set role anon; select public.accept_terms('1.2.0')`); } catch (err) { msg = err.message; }
    expect(/permission denied/.test(msg), msg || 'lo dejó');
  });
});
