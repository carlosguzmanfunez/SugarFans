// A verified creator's country is the one on their identity document: Didit (or an
// admin approving the manual form) sets it, the creator can't change it in Ajustes,
// and removing "Verificado" unlocks it. On a throwaway Postgres with every migration.
// Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:creator-country-db
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_creator_country_test';
const { check, expect, psql, as, setup, finish } = createDbTest(DB);

const signUp = (email, country) =>
  psql(
    DB,
    `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('${email}', '{"name":"X","role":"creator","age_verified":true,"country":"${country}"}', '{"provider":"email"}') returning id`,
  );
const didit = (user, country) =>
  psql(DB, `set role service_role; select public.didit_record('${user}', 's-${user}', 'Approved', 'Ana López', '1995-04-02', '${country}', 'passport', 'p1', null)`);
const countries = (user) => psql(DB, `select coalesce(country, '-') || '|' || coalesce(id_country, '-') from public.profiles where id = '${user}'`);

finish(async () => {
  setup();
  console.log('\nPaís del creador = país de su documento');

  await check('Los nombres y códigos de Didit se convierten al código del sitio', async () => {
    const got = psql(DB, `select string_agg(coalesce(public.country_code(x), 'null'), ',' order by n) from unnest(array['Honduras', 'HND', 'hn', 'México', 'Mexico', 'Spain', 'España', 'United States of America', 'Brasil', 'Narnia', '']) with ordinality as t(x, n)`);
    expect(got === 'HN,HN,HN,MX,MX,ES,ES,US,BR,null,null', got);
  });
  const ana = signUp('ana@test.com', 'MX');
  await check('Al verificarse con Didit, su país pasa a ser el del documento', async () => {
    didit(ana, 'Honduras');
    expect(countries(ana) === 'HN|HN', countries(ana));
  });
  await check('El creador verificado no puede cambiar su país ni desbloquearlo', async () => {
    as(ana, `update public.profiles set country = 'CO' where id = '${ana}'`);
    as(ana, `update public.profiles set id_country = null, country = 'CO' where id = '${ana}'`);
    expect(countries(ana) === 'HN|HN', countries(ana));
  });
  await check('Sí puede cambiar sus otros datos', async () => {
    as(ana, `update public.profiles set bio = 'hola', phone = '+50499998888' where id = '${ana}'`);
    expect(psql(DB, `select bio from public.profiles where id = '${ana}'`) === 'hola', 'no guardó la bio');
  });
  await check('Un creador sin verificar sigue eligiendo su país', async () => {
    const bea = signUp('bea@test.com', 'MX');
    as(bea, `update public.profiles set country = 'CO' where id = '${bea}'`);
    as(bea, `update public.profiles set id_country = 'CO' where id = '${bea}'`);
    expect(countries(bea) === 'CO|-', countries(bea));
  });
  await check('Si el admin quita "Verificado", el país queda libre otra vez', async () => {
    psql(DB, `update public.profiles set is_verified = false where id = '${ana}'`);
    as(ana, `update public.profiles set country = 'CO' where id = '${ana}'`);
    expect(countries(ana) === 'CO|-', countries(ana));
  });
  await check('El formulario manual aprobado por el admin también fija el país', async () => {
    const eva = signUp('eva@test.com', 'MX');
    psql(DB, `insert into public.identity_verifications (user_id, user_name, email, role, legal_name, birth_date, country, doc_type, doc_number, doc_front, selfie, status)
              values ('${eva}', 'Eva', 'eva@test.com', 'creator', 'Eva', '1990-01-01', 'Guatemala', 'dni', '1', '', '', 'pending')`);
    psql(DB, `update public.profiles set is_verified = true where id = '${eva}'`);
    expect(countries(eva) === 'GT|GT', countries(eva));
  });
  await check('Un país que no se reconoce no bloquea nada', async () => {
    const zoe = signUp('zoe@test.com', 'MX');
    didit(zoe, 'Narnia');
    expect(psql(DB, `select is_verified from public.profiles where id = '${zoe}'`) === 't', 'no se verificó');
    expect(countries(zoe) === 'MX|-', countries(zoe));
  });
});
