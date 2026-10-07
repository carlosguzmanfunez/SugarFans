// Money only moves through PayPal, and only toward profiles someone owns.
// Against a throwaway local Postgres with every migration applied.
// Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:payments
//
// Checks: the browser can no longer call the simulated purchase functions; the
// server path after a PayPal capture (paypal_fulfill) still works; demo catalogue
// profiles without an owner refuse PayPal orders, subscriptions, gifts and paid sales,
// while creator accounts and admin-run profiles keep receiving them; subscriptions
// outside PayPal end with the month already paid instead of renewing.
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_payments_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);
const DEMO = /de demostración y todavía no recibe pagos/;

const run = async () => {
  setup();
  const fan = user('fan@test.local', 'fan');
  const vale = user('vale@test.local', 'creator');
  const other = user('other@test.local', 'creator');
  // Valentina's account owns demo profile '1'; profiles '2'…'9' have no owner.
  psql(DB, `update public.profiles set creator_profile_id = '1' where id = '${vale}'`);
  const managed = psql(DB, `insert into public.managed_profiles (name, username, avatar, cover, subscription_price)
    values ('Perfil IA', 'perfil_ia', '/a.png', '/c.png', 6.99) returning id`);
  const method = psql(DB, `insert into public.payment_methods (user_id, kind, label) values ('${fan}', 'card', 'Visa •••• 4242') returning id`);
  const coins = () => psql(DB, `select public.coin_balance('${fan}')`);

  console.log('Compras solo desde el servidor');
  await check('Con sesión no se puede llamar a buy_coins, send_tip, vip_pay_booking ni subscribe_and_pay', async () => {
    raises(() => as(fan, `select public.buy_coins('bolsita', '${method}')`), /permission denied/, 'buy_coins');
    raises(() => as(fan, `select public.send_tip('${other}', 'Otro', 5, '${method}', null, '')`), /permission denied/, 'send_tip');
    raises(() => as(fan, `select public.vip_pay_booking(gen_random_uuid(), '${method}')`), /permission denied/, 'vip_pay_booking');
    raises(() => as(fan, `select public.subscribe_and_pay('${other}', 'Otro', 9.99, '${method}')`), /permission denied/, 'subscribe_and_pay');
    expect(coins() === '0', `se crearon Créditos: ${coins()}`);
    expect(psql(DB, `select count(*) from public.transactions`) === '0', 'quedó una venta registrada');
  });
  await check('Tras la captura de PayPal el servidor sí entrega Créditos y propinas', async () => {
    psql(DB, `insert into public.paypal_orders (id, user_id, kind, params, amount) values
      ('C1', '${fan}', 'coins', '{"packId":"bolsita"}', 4.99),
      ('T1', '${fan}', 'tip', '{"creatorProfileId":"${other}","amount":5}', 5)`);
    psql(DB, `begin; set local role service_role;
      select public.paypal_fulfill('C1', '${fan}', 'CAP1', 4.99);
      select public.paypal_fulfill('T1', '${fan}', 'CAP2', 5); commit;`);
    expect(coins() === '500', `Créditos: ${coins()}`);
    expect(psql(DB, `select count(*) from public.transactions where kind = 'tip' and creator_profile_id = '${other}' and method_label = 'PayPal'`) === '1', 'falta la propina');
    expect(psql(DB, `select count(*) from public.payment_methods where kind = 'paypal'`) === '0', 'quedó el método temporal');
  });

  console.log('Perfiles demo sin dueño');
  await check('PayPal no cotiza propinas ni suscripciones para un perfil demo sin dueño', async () => {
    raises(() => as(fan, `select public.paypal_quote('tip', '{"creatorProfileId":"2","amount":5}')`), DEMO, 'propina demo');
    raises(() => as(fan, `select public.paypal_subscription_quote('2')`), DEMO, 'suscripción demo');
  });
  await check('Un regalo con Créditos a un perfil demo sin dueño se rechaza y no gasta Créditos', async () => {
    raises(() => as(fan, `select public.send_gift('2', 'Diego', 'caramelo', null, '', '')`), DEMO, 'regalo demo');
    expect(coins() === '500', `se gastaron Créditos: ${coins()}`);
  });
  await check('Ninguna venta pagada se puede registrar para un perfil demo sin dueño', async () => {
    raises(() => psql(DB, `insert into public.transactions (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status)
      values ('x', '${fan}', 'Fan', '3', 'Sofía', 'tip', 5, 'PayPal', 'paid')`), DEMO, 'venta demo');
  });
  await check('Valentina (con dueño), los creadores con cuenta y los perfiles del admin sí reciben', async () => {
    as(fan, `select public.paypal_quote('tip', '{"creatorProfileId":"1","amount":5}')`);
    as(fan, `select public.paypal_subscription_quote('1')`);
    as(fan, `select public.paypal_quote('tip', '{"creatorProfileId":"${managed}","amount":5}')`);
    as(fan, `select public.send_gift('1', 'Valentina', 'caramelo', null, '', '')`);
    as(fan, `select public.send_gift('${other}', 'Otro', 'caramelo', null, '', '')`);
    expect(coins() === '460', `Créditos: ${coins()}`);
    expect(psql(DB, `select public.creator_accepts_payments('1')::text || public.creator_accepts_payments('2')::text`) === 'truefalse', 'creator_accepts_payments');
  });

  console.log('Renovaciones');
  await check('Una suscripción fuera de PayPal no se cobra: dura hasta el mes pagado y termina', async () => {
    psql(DB, `insert into public.subscriptions (fan_id, creator_id, price, since, cancel_at, paypal_subscription_id) values
      ('${fan}', '${other}', 9.99, now() - interval '40 days', null, null),
      ('${fan}', '1', 9.99, now() - interval '40 days', null, 'I-PAYPAL')`);
    psql(DB, `select public.bill_all_renewals()`);
    expect(psql(DB, `select count(*) from public.transactions where kind = 'renewal'`) === '0', 'se cobró una renovación');
    const ends = psql(DB, `select (cancel_at = since + interval '2 months')::text from public.subscriptions where fan_id = '${fan}' and creator_id = '${other}'`);
    expect(ends === 'true', `fin de acceso: ${ends}`);
    expect(psql(DB, `select public.has_subscription('${fan}', '${other}')::text`) === 'true', 'perdió el mes pagado');
    expect(psql(DB, `select (cancel_at is null)::text from public.subscriptions where paypal_subscription_id = 'I-PAYPAL'`) === 'true', 'tocó la de PayPal');
  });
};

finish(run);
