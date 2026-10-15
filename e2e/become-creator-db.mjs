// "Hazte creador": a fan account becomes a creator account without losing anything,
// gets its public profile and @usuario, and is treated like any new creator (drafts
// and no payments until verified). On a throwaway Postgres with every migration.
// Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:become-creator-db
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_become_creator_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);

const row = (uid) =>
  JSON.parse(psql(DB, `select row_to_json(p) from (select role, creator_profile_id, subscription_price, username, bio, is_verified from public.profiles where id = '${uid}') p`));

finish(async () => {
  setup();
  console.log('\nHazte creador (fan → creador)');
  const vale = user('vale@test.com', 'creator');
  const fan = user('luz.maria@test.com', 'fan');
  psql(DB, `insert into public.subscriptions (fan_id, creator_id, price) values ('${fan}', '${row(vale).creator_profile_id}', 9.99)`);
  psql(DB, `insert into public.follows (user_id, creator_profile_id) values ('${fan}', '${row(vale).creator_profile_id}')`);

  await check('Un fan se convierte en creador con su perfil y su @usuario', async () => {
    const handle = as(fan, `select public.become_creator()`);
    const r = row(fan);
    expect(r.role === 'creator', `rol: ${r.role}`);
    expect(r.creator_profile_id === fan, `perfil: ${r.creator_profile_id}`);
    expect(Number(r.subscription_price) === 9.99, `precio: ${r.subscription_price}`);
    expect(/^luz_maria/.test(r.username) && handle === r.username, `@usuario: ${r.username} / ${handle}`);
    expect(r.is_verified === false, 'no debía quedar verificado');
  });
  await check('Conserva sus suscripciones y lo que sigue', async () => {
    expect(psql(DB, `select count(*) from public.subscriptions where fan_id = '${fan}'`) === '1', 'perdió la suscripción');
    expect(psql(DB, `select count(*) from public.follows where user_id = '${fan}'`) === '1', 'perdió lo que sigue');
  });
  await check('Sin verificar: publica en borrador y nadie le puede pagar', async () => {
    const draft = as(fan, `insert into public.creator_posts (creator_id, content) values ('${fan}', 'hola') returning is_draft`);
    expect(draft === 't', `is_draft: ${draft}`);
    expect(psql(DB, `select public.creator_accepts_payments('${fan}')`) === 'f', 'acepta pagos sin verificar');
  });
  await check('Al verificarse queda como cualquier creador', async () => {
    psql(DB, `update public.profiles set is_verified = true where id = '${fan}'`);
    expect(psql(DB, `select public.creator_accepts_payments('${fan}')`) === 't', 'no acepta pagos verificado');
    expect(psql(DB, `select count(*) from public.creator_posts where creator_id = '${fan}' and is_draft`) === '0', 'el borrador no se publicó');
  });
  await check('Un creador no lo puede volver a usar', async () => {
    raises(() => as(fan, `select public.become_creator()`), /ya es de creador/, 'creador');
  });
  await check('Admin, cuentas demo y cuentas suspendidas no pueden', async () => {
    const admin = user('boss@test.com', 'fan');
    psql(DB, `update public.profiles set role = 'admin' where id = '${admin}'`);
    raises(() => as(admin, `select public.become_creator()`), /no se puede convertir/, 'admin');
    const demo = user('fan@sugarfans.com', 'fan');
    raises(() => as(demo, `select public.become_creator()`), /cuentas demo/, 'demo');
    const banned = user('banned@test.com', 'fan');
    psql(DB, `insert into public.account_restrictions (user_id, suspended_until) values ('${banned}', now() + interval '1 day')`);
    raises(() => as(banned, `select public.become_creator()`), /suspendida/, 'suspendida');
    expect(row(banned).role === 'fan' && row(demo).role === 'fan', 'cambió de rol');
  });
  await check('Un fan sigue sin poder cambiarse el rol a mano', async () => {
    const other = user('other@test.com', 'fan');
    as(other, `update public.profiles set role = 'creator', creator_profile_id = '${other}' where id = '${other}'`);
    expect(row(other).role === 'fan' && row(other).creator_profile_id === null, JSON.stringify(row(other)));
  });
  await check('Sin sesión no se puede llamar', async () => {
    raises(() => psql(DB, `set role anon; select public.become_creator()`), /permission denied/, 'anon');
  });
});
