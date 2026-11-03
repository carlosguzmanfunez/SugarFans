// Security review B3 + B4 on a throwaway Postgres with every migration:
// the person can't edit their post counter or take back "18+", and a fan can't
// delete a subscription row behind PayPal's back.
// Usage: PGHOST=127.0.0.1 PGUSER=postgres npm run test:profile-guards-db
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_profile_guards_test';
const { check, expect, psql, as, setup, finish } = createDbTest(DB);

const signUp = (email, role, age = true) =>
  psql(
    DB,
    `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('${email}', '{"name":"${email.split('@')[0]}","role":"${role}","age_verified":${age}}', '{"provider":"email"}') returning id`,
  );
const col = (uid, c) => psql(DB, `select ${c} from public.profiles where id = '${uid}'`);

finish(async () => {
  setup();
  console.log('\nDatos protegidos del perfil y de la suscripción');
  const lola = signUp('lola@test.com', 'creator');
  const fan = signUp('fan@test.com', 'fan', false);
  psql(DB, `set role service_role; select public.didit_record('${lola}', 's1', 'Approved', 'Lola', '1995-04-02', 'HN', 'dni', '1', null)`);
  const lolaProfile = col(lola, 'creator_profile_id');

  await check('El contador de publicaciones no se puede inflar a mano', async () => {
    as(lola, `update public.profiles set posts = 999 where id = '${lola}'`);
    expect(col(lola, 'posts') === '0', `quedó en ${col(lola, 'posts')}`);
  });
  await check('El contador sigue subiendo y bajando solo con las publicaciones', async () => {
    as(lola, `insert into public.creator_posts (creator_id, content) values ('${lola}', 'uno')`);
    as(lola, `insert into public.creator_posts (creator_id, content) values ('${lola}', 'dos')`);
    expect(col(lola, 'posts') === '2', `cuenta ${col(lola, 'posts')}`);
    as(lola, `delete from public.creator_posts where content = 'uno'`);
    expect(col(lola, 'posts') === '1', `cuenta ${col(lola, 'posts')}`);
  });
  await check('La persona confirma que es mayor de edad (y no lo puede quitar)', async () => {
    as(fan, `update public.profiles set age_verified = true where id = '${fan}'`);
    expect(col(fan, 'age_verified') === 't', 'no se guardó la confirmación');
    as(fan, `update public.profiles set age_verified = false where id = '${fan}'`);
    expect(col(fan, 'age_verified') === 't', 'lo pudo quitar');
  });
  await check('El resto del perfil se sigue editando normal', async () => {
    as(fan, `update public.profiles set bio = 'hola' where id = '${fan}'`);
    expect(col(fan, 'bio') === 'hola', 'no se guardó la bio');
  });

  psql(DB, `insert into public.subscriptions (fan_id, creator_id, price, paypal_subscription_id) values ('${fan}', '${lolaProfile}', 9.99, 'I-TEST')`);
  await check('El fan no puede borrar su suscripción sin pasar por PayPal', async () => {
    try {
      as(fan, `delete from public.subscriptions where fan_id = '${fan}'`);
    } catch (err) {
      expect(/permission denied/.test(err.message), err.message);
    }
    expect(psql(DB, `select count(*) from public.subscriptions where fan_id = '${fan}'`) === '1', 'la borró');
  });
  await check('Cancelar una suscripción de PayPal desde la base pide ir por PayPal', async () => {
    let msg = '';
    try {
      as(fan, `select public.cancel_subscription('${lolaProfile}')`);
    } catch (err) {
      msg = err.message;
    }
    expect(/se paga con PayPal/.test(msg), `respuesta: ${msg || 'sin error'}`);
  });
  await check('Sigue viendo su suscripción', async () => {
    expect(as(fan, `select count(*) from public.subscriptions`) === '1', 'no la ve');
  });
});
