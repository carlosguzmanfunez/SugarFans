// Numeral 3: each creator's own @usuario (unique, changeable, reserved names
// blocked, fansreserve.com/@usuario resolves it) and their social networks, on a
// throwaway Postgres with every migration.
// Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:creator-links-db
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_creator_links_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);

const handleOf = (uid) => psql(DB, `select coalesce(username, '') from public.profiles where id = '${uid}'`);
const profileOf = (uid) => psql(DB, `select creator_profile_id from public.profiles where id = '${uid}'`);
const rename = (uid, name) => psql(DB, `update auth.users set raw_user_meta_data = raw_user_meta_data || '{"name":"${name}"}' where id = '${uid}'; update public.profiles set name = '${name}' where id = '${uid}'`);

finish(async () => {
  setup();
  console.log('\n@usuario y redes del creador');
  const ana = user('ana.lopez@test.com', 'creator');
  const fan = user('fan@test.com', 'fan');

  await check('Un creador nuevo recibe un @usuario a partir de su nombre; un fan no tiene', async () => {
    expect(/^ana_lopez/.test(handleOf(ana)), handleOf(ana));
    expect(handleOf(fan) === '', `el fan tiene ${handleOf(fan)}`);
  });
  await check('Dos creadores con el mismo nombre no chocan', async () => {
    const a1 = user('x1@test.com', 'creator');
    const a2 = user('x2@test.com', 'creator');
    rename(a1, 'Luz María');
    rename(a2, 'Luz María');
    psql(DB, `update public.profiles set username = null where id in ('${a1}', '${a2}')`);
    expect(handleOf(a1) !== handleOf(a2) && /^luz_maria/.test(handleOf(a1)), `${handleOf(a1)} / ${handleOf(a2)}`);
  });
  await check('El creador elige el suyo, en minúsculas', async () => {
    as(ana, `update public.profiles set username = 'Ana_Fit' where id = '${ana}'`);
    expect(handleOf(ana) === 'ana_fit', handleOf(ana));
  });
  await check('No se puede usar uno ocupado, reservado o mal escrito', async () => {
    const b = user('b@test.com', 'creator');
    raises(() => as(b, `update public.profiles set username = 'ana_fit' where id = '${b}'`), /ya está en uso/, 'ocupado');
    raises(() => as(b, `update public.profiles set username = 'admin' where id = '${b}'`), /reservado/, 'reservado');
    raises(() => as(b, `update public.profiles set username = 'valentina_rose' where id = '${b}'`), /reservado/, 'de un demo');
    raises(() => as(b, `update public.profiles set username = 'ana lópez' where id = '${b}'`), /de 3 a 30/, 'con espacios');
    raises(() => as(b, `update public.profiles set username = 'ab' where id = '${b}'`), /de 3 a 30/, 'muy corto');
  });
  await check('Un fan no se puede apartar un @usuario', async () => {
    as(fan, `update public.profiles set username = 'fan_cool' where id = '${fan}'`);
    expect(handleOf(fan) === '', handleOf(fan));
  });
  await check('fansreserve.com/@usuario lleva al perfil, y sus redes son públicas', async () => {
    as(ana, `update public.profiles set settings = settings || '{"socials":{"instagram":"ana.fit","tiktok":"anafit"}}' where id = '${ana}'`);
    expect(psql(DB, `set role anon; select public.creator_by_username('@ana_fit')`) === profileOf(ana), 'con @');
    expect(psql(DB, `set role anon; select public.creator_by_username('ANA_FIT')`) === profileOf(ana), 'no lo encontró');
    const links = JSON.parse(psql(DB, `set role anon; select public.creator_links('${profileOf(ana)}')`));
    expect(links.username === 'ana_fit' && links.socials.instagram === 'ana.fit', JSON.stringify(links));
    expect(psql(DB, `set role anon; select count(*) from public.creator_usernames() where username = 'ana_fit'`) === '1', 'no sale en la lista');
  });
  await check('Un creador suspendido no se encuentra por su @usuario', async () => {
    psql(DB, `insert into public.account_restrictions (user_id, suspended_until) values ('${ana}', now() + interval '1 day')`);
    expect(psql(DB, `set role anon; select coalesce(public.creator_by_username('ana_fit'), '')`) === '', 'sigue apareciendo');
  });
});
