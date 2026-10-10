// Account management from the admin panel, on a throwaway Postgres with every
// migration: suspend (logs the user out of Supabase Auth, hides a creator and stops
// payments to them), freeze withdrawals, take away "Verificado", delete; all logged.
// Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:admin-accounts
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_admin_accounts_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);

const sr = (sql) => psql(DB, `set role service_role; ${sql}`);
const profileOf = (uid) => psql(DB, `select creator_profile_id from public.profiles where id = '${uid}'`);
const act = (admin, uid, action, reason = 'Prueba', days = 'null') =>
  as(admin, `select public.admin_account_action('${uid}', '${action}', '${reason}', ${days})`);
const listed = (cp) => psql(DB, `select count(*) from public.public_creators() where id = '${cp}'`) === '1';
const tip = (order, fan, cp) =>
  sr(`select public.paypal_register('${order}', '${fan}', 'tip', '{"creatorProfileId":"${cp}","amount":5}', 5);
      select public.paypal_fulfill('${order}', '${fan}', 'CAP-${order}', 5);`);

finish(async () => {
  setup();
  console.log('\nGestión de cuentas (admin)');
  const admin = user('admin@test.com', 'fan');
  psql(DB, `update public.profiles set role = 'admin' where id = '${admin}'`);
  const lola = user('lola@test.com', 'creator');
  const cp = profileOf(lola);
  const fan = user('fan@test.com', 'fan');

  await check('Solo un admin gestiona cuentas, y nunca otra cuenta admin', async () => {
    raises(() => act(fan, lola, 'suspend'), /no está permitida/, 'un fan');
    raises(() => act(lola, fan, 'suspend'), /no está permitida/, 'un creador');
    const admin2 = user('admin2@test.com', 'fan');
    psql(DB, `update public.profiles set role = 'admin' where id = '${admin2}'`);
    raises(() => act(admin, admin2, 'suspend'), /administrador/, 'otro admin');
    raises(() => act(admin, lola, 'suspend', ''), /motivo/, 'sin motivo');
    raises(() => act(admin, lola, 'borrar'), /no válida/, 'acción inventada');
  });
  await check('Nadie más lee las restricciones ni el historial', async () => {
    expect(as(fan, `select count(*) from public.admin_actions`) === '0', 'un fan ve el historial');
    raises(() => as(fan, `insert into public.account_restrictions (user_id, payouts_frozen) values ('${fan}', false)`), /permission denied|row-level security/, 'un fan se escribe');
  });
  await check('Suspender 7 días: no entra, desaparece de Explorar y nadie le puede pagar', async () => {
    expect(listed(cp), 'no aparecía antes');
    act(admin, lola, 'suspend', 'Contenido prohibido', 7);
    const days = Number(psql(DB, `select round(extract(epoch from banned_until - now()) / 86400) from auth.users where id = '${lola}'`));
    expect(days === 7, `bloqueo de ${days} días`);
    expect(!listed(cp), 'sigue en Explorar');
    raises(() => tip('o-1', fan, cp), /no está disponible/, 'propina a suspendida');
    raises(() => psql(DB, `select public.payout_checks('${lola}')`), /en revisión/, 'retiro de suspendida');
  });
  await check('Quitar la suspensión la devuelve a la normalidad', async () => {
    act(admin, lola, 'unsuspend', '');
    expect(psql(DB, `select banned_until is null from auth.users where id = '${lola}'`) === 't', 'sigue bloqueada');
    expect(listed(cp), 'no volvió a Explorar');
    tip('o-2', fan, cp);
  });
  await check('Suspensión indefinida dura años', async () => {
    act(admin, fan, 'suspend', 'Fraude');
    expect(psql(DB, `select banned_until > now() + interval '50 years' from auth.users where id = '${fan}'`) === 't', 'no es indefinida');
    act(admin, fan, 'unsuspend', '');
  });
  await check('Congelar retiros: la creadora sigue vendiendo pero no puede retirar', async () => {
    psql(DB, `insert into public.payout_accounts (user_id, holder, bank, account_last4, paypal_email) values ('${lola}', 'Lola', 'PayPal', 'abcd', 'lola@pp.com')`);
    act(admin, lola, 'freeze_payouts', 'Revisión de pagos');
    raises(() => psql(DB, `select public.payout_checks('${lola}')`), /en revisión/, 'retiro congelado');
    tip('o-3', fan, cp);
    act(admin, lola, 'unfreeze_payouts', '');
    raises(() => psql(DB, `select public.payout_checks('${lola}')`), /Necesitas al menos/, 'sigue congelado');
  });
  await check('Quitar Verificado', async () => {
    act(admin, lola, 'unverify', 'Documento falso');
    expect(psql(DB, `select is_verified from public.profiles where id = '${lola}'`) === 'f', 'sigue verificada');
  });
  await check('Cancelar la cuenta la borra, y el historial la recuerda', async () => {
    const bye = user('bye@test.com', 'fan');
    act(admin, bye, 'delete', 'Pidió borrar su cuenta');
    expect(psql(DB, `select count(*) from auth.users where id = '${bye}'`) === '0', 'sigue existiendo');
    expect(psql(DB, `select count(*) from public.profiles where id = '${bye}'`) === '0', 'el perfil sigue');
    expect(as(admin, `select action || ':' || reason from public.admin_actions where user_id = '${bye}'`) === 'delete:Pidió borrar su cuenta', 'sin historial');
    expect(Number(as(admin, `select count(*) from public.admin_actions`)) >= 8, 'faltan acciones en el historial');
  });
});
