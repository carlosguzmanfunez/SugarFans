// Country and phone at sign-up, on a throwaway Postgres with every migration.
// Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:country
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_country_test';
const { check, expect, psql, as, raises, setup, finish } = createDbTest(DB);

const signUp = (email, meta, provider = 'email') =>
  psql(
    DB,
    `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('${email}', '${JSON.stringify(meta)}', '{"provider":"${provider}"}') returning id`,
  );

finish(async () => {
  setup();
  console.log('\nPaís y teléfono en el registro');

  const fan = signUp('ana@test.com', { name: 'Ana', role: 'fan', age_verified: true, country: 'HN', phone: '+50499998888' });
  const creator = signUp('lola@test.com', { name: 'Lola', role: 'creator', age_verified: true, country: 'MX' });

  await check('El registro con email guarda el país y el teléfono', async () => {
    expect(psql(DB, `select country || ' ' || phone from public.profiles where id = '${fan}'`) === 'HN +50499998888', 'no se guardaron');
  });
  await check('Un país o teléfono mal escrito no bloquea la cuenta: solo no se guarda', async () => {
    const id = signUp('raro@test.com', { name: 'Raro', role: 'fan', age_verified: true, country: 'Honduras', phone: '1234' });
    expect(psql(DB, `select coalesce(country, '-') || coalesce(phone, '-') from public.profiles where id = '${id}'`) === '--', 'guardó valores inválidos');
  });
  await check('La base de datos rechaza teléfonos sin formato internacional', async () => {
    raises(() => as(fan, `update public.profiles set phone = '99998888' where id = '${fan}'`), /profiles_phone_check/, 'teléfono sin +');
    as(fan, `update public.profiles set phone = '+50433334444', country = 'HN' where id = '${fan}'`);
    expect(psql(DB, `select phone from public.profiles where id = '${fan}'`) === '+50433334444', 'el usuario no pudo cambiar su teléfono');
  });
  await check('Nadie más ve el teléfono ni el país de otra cuenta', async () => {
    expect(as(creator, `select count(*) from public.profiles where id = '${fan}'`) === '0', 'otro usuario lee el perfil');
  });
  await check('creator_countries() expone solo el país de los creadores (y los demo)', async () => {
    const rows = psql(DB, `set role anon; select string_agg(id || ':' || country, ',' order by id) from public.creator_countries()`);
    expect(rows.includes(`${creator}:MX`), `falta la creadora: ${rows}`);
    expect(rows.includes('5:HN') && rows.includes('1:CO'), `faltan los demo: ${rows}`);
    expect(!rows.includes(fan), 'incluye a un fan');
  });
  await check('El registro con Google pide el país al completar y lo guarda', async () => {
    const id = signUp('gina@test.com', { full_name: 'Gina' }, 'google');
    expect(psql(DB, `select coalesce(country, '-') from public.profiles where id = '${id}'`) === '-', 'el país llegó antes de tiempo');
    as(id, `select public.complete_social_signup('creator', null, 'CO', '+573001234567')`);
    expect(psql(DB, `select role || ' ' || country || ' ' || phone from public.profiles where id = '${id}'`) === 'creator CO +573001234567', 'no se guardó');
  });
  await check('complete_social_signup sigue funcionando sin país (versión anterior de la app)', async () => {
    const id = signUp('old@test.com', { full_name: 'Old' }, 'google');
    as(id, `select public.complete_social_signup(p_role => 'fan', p_ref => null)`);
    expect(psql(DB, `select signup_completed from public.profiles where id = '${id}'`) === 't', 'no completó');
  });
});
