// PayPal refunds, disputes and paying yourself, on a throwaway Postgres with every
// migration: refunded money leaves the creator's sales, a dispute freezes it until
// PayPal decides, and nobody pays their own creator account from a fan account.
// Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:refunds-db
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_refunds_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);

const sr = (sql) => psql(DB, `set role service_role; ${sql}`);
const profileOf = (uid) => psql(DB, `select creator_profile_id from public.profiles where id = '${uid}'`);
const back = (ref, action) => JSON.parse(sr(`select public.paypal_money_back('${ref}', '${action}')`));
const status = (where) => psql(DB, `select string_agg(status, ',' order by created_at, id) from public.transactions where ${where}`);
const balance = (uid) => Number(psql(DB, `select public.coin_balance('${uid}')`));
const pay = (order, uid, kind, params, amount, capture) =>
  sr(`select public.paypal_register('${order}', '${uid}', '${kind}', '${JSON.stringify(params)}', ${amount});
      select public.paypal_fulfill('${order}', '${uid}', '${capture}', ${amount});`);
const gift = (uid, cp, id) => as(uid, `select public.send_gift('${cp}', 'Lola', '${id}', null, '', null)`);
const selfPay = (uid, kind, params, email = null) =>
  sr(`select public.paypal_self_pay('${uid}', '${kind}', '${JSON.stringify(params)}', ${email ? `'${email}'` : 'null'})`);

finish(async () => {
  setup();
  console.log('\nReembolsos, disputas y autopago');
  const lola = user('lola@test.com', 'creator');
  const cp = profileOf(lola);
  const fan = user('fan@test.com', 'fan');

  await check('Una propina pagada con PayPal recuerda su cobro', async () => {
    pay('o-tip', fan, 'tip', { creatorProfileId: cp, amount: 10 }, 10, 'CAP-TIP');
    expect(psql(DB, `select paypal_ref from public.transactions where kind = 'tip'`) === 'CAP-TIP', 'sin referencia');
  });
  await check('Disputa: la venta queda congelada; si PayPal da la razón al creador, vuelve', async () => {
    expect(back('CAP-TIP', 'dispute').matched === 1, 'no encontró la venta');
    expect(status(`kind = 'tip'`) === 'disputed', status(`kind = 'tip'`));
    back('CAP-TIP', 'release');
    expect(status(`kind = 'tip'`) === 'paid', 'no volvió a pagada');
  });
  await check('Reembolso: la venta deja de contar para el creador, y repetir el aviso no hace nada', async () => {
    back('CAP-TIP', 'dispute');
    expect(back('CAP-TIP', 'refund').matched === 1, 'no la reembolsó');
    expect(status(`kind = 'tip'`) === 'refunded', status(`kind = 'tip'`));
    expect(psql(DB, `select status from public.paypal_orders where id = 'o-tip'`) === 'refunded', 'el pedido sigue completado');
    expect(back('CAP-TIP', 'refund').matched === 0, 'contó dos veces');
    expect(back('CAP-TIP', 'release').matched === 0, 'un reembolso volvió a pagado');
  });
  await check('Una Reserve reembolsada se cancela', async () => {
    const b = psql(DB, `insert into public.vip_bookings (experience_id, creator_profile_id, title, creator_name, price, fan_id, fan_name, fan_email, date, time, status, details) values ('custom', '${cp}', 'Clase', 'Lola', 20, '${fan}', 'Fan', 'fan@test.com', current_date + 5, '10:00', 'accepted', '{"kind":"custom"}') returning id`);
    pay('o-vip', fan, 'booking', { bookingId: b }, 20, 'CAP-VIP');
    expect(psql(DB, `select status from public.vip_bookings where id = '${b}'`) === 'confirmed', 'no quedó pagada');
    back('CAP-VIP', 'refund');
    expect(psql(DB, `select status from public.vip_bookings where id = '${b}'`) === 'cancelled', 'sigue confirmada');
    expect(status(`key = 'vip:${b}'`) === 'refunded', 'la venta sigue contando');
  });
  await check('Un pago de suscripción reembolsado corta el acceso y pide cancelarla en PayPal', async () => {
    sr(`select public.paypal_subscription_register('I-SUB', '${fan}', '${cp}', 7.99, now());
        select public.paypal_subscription_activate('I-SUB');
        select public.paypal_subscription_payment('I-SUB', 'SALE-1', 7.99);`);
    const r = back('SALE-1', 'refund');
    expect(r.matched === 1 && r.subscription === 'I-SUB', JSON.stringify(r));
    expect(status(`key like 'paypal-sub:I-SUB:%'`) === 'refunded', 'el pago sigue contando');
    expect(psql(DB, `select cancel_at <= now() from public.subscriptions where paypal_subscription_id = 'I-SUB'`) === 't', 'sigue con acceso');
  });
  await check('Créditos reembolsados: salen de la billetera y los regalos ya enviados se revierten', async () => {
    const fan2 = user('fan2@test.com', 'fan');
    pay('o-c1', fan2, 'coins', { packId: 'bolsita' }, 4.99, 'CAP-C1'); // 500
    pay('o-c2', fan2, 'coins', { packId: 'bolsita' }, 4.99, 'CAP-C2'); // 500
    for (const g of ['cupcake', 'cupcake', 'cupcake', 'cupcake', 'cupcake', 'cupcake', 'cupcake']) gift(fan2, cp, g); // 700
    expect(balance(fan2) === 300, `saldo ${balance(fan2)}`);
    back('CAP-C2', 'dispute');
    expect(balance(fan2) === 0, `saldo en disputa ${balance(fan2)}`);
    expect(status(`payer_id = '${fan2}' and kind = 'gift'`) === 'paid,paid,paid,paid,paid,disputed,disputed', status(`payer_id = '${fan2}' and kind = 'gift'`));
    back('CAP-C2', 'release');
    expect(balance(fan2) === 300 && !status(`payer_id = '${fan2}' and kind = 'gift'`).includes('disputed'), 'no volvió todo');
    back('CAP-C2', 'refund');
    expect(balance(fan2) === 0, `saldo ${balance(fan2)}`);
    expect(status(`payer_id = '${fan2}' and kind = 'gift'`) === 'paid,paid,paid,paid,paid,refunded,refunded', status(`payer_id = '${fan2}' and kind = 'gift'`));
  });
  await check('Solo el servidor marca reembolsos', async () => {
    raises(() => as(fan, `select public.paypal_money_back('CAP-VIP', 'release')`), /permission denied/, 'un fan');
  });

  console.log('\nPagarse a uno mismo');
  await check('Personas distintas pagan sin problema', async () => {
    expect(selfPay(fan, 'tip', { creatorProfileId: cp }, 'fan@test.com') === 'f', 'bloqueó a un fan normal');
  });
  await check('Pagar con el PayPal donde el creador retira o con el que entra', async () => {
    psql(DB, `insert into public.payout_accounts (user_id, holder, bank, account_last4, paypal_email) values ('${lola}', 'Lola', 'PayPal', 'abcd', 'Lola.Pay@Test.com')`);
    expect(selfPay(fan, 'tip', { creatorProfileId: cp }, 'lola.pay@test.com') === 't', 'PayPal de retiros');
    expect(selfPay(fan, 'tip', { creatorProfileId: cp }, 'LOLA@test.com') === 't', 'correo de la cuenta');
  });
  await check('Una cuenta fan con el correo del PayPal del creador', async () => {
    const alt = user('lola.pay@test.com', 'fan');
    expect(selfPay(alt, 'subscription', { creatorProfileId: cp }) === 't', 'no lo vio');
  });
  await check('Mismo teléfono, o misma identidad verificada', async () => {
    const p = user('p@test.com', 'fan');
    psql(DB, `update public.profiles set phone = '+50499998888' where id in ('${lola}', '${p}')`);
    expect(selfPay(p, 'tip', { creatorProfileId: cp }) === 't', 'teléfono');
    const v = user('v@test.com', 'fan');
    for (const [id, name] of [[lola, 'Lola  Pérez'], [v, 'lola pérez']])
      psql(DB, `insert into public.identity_verifications (user_id, user_name, email, role, legal_name, birth_date, country, doc_type, doc_number, status) values ('${id}', 'x', 'x@x', 'fan', '${name}', '1995-04-02', 'HN', 'dni', '', 'approved') on conflict (user_id) do update set legal_name = excluded.legal_name, birth_date = excluded.birth_date, status = 'approved'`);
    expect(selfPay(v, 'tip', { creatorProfileId: cp }) === 't', 'identidad');
  });
  await check('Aunque llegue a cobrarse, la base de datos no lo registra', async () => {
    const p = psql(DB, `select id from public.profiles where email = 'p@test.com'`);
    raises(() => pay('o-self', p, 'tip', { creatorProfileId: cp, amount: 5 }, 5, 'CAP-SELF'), /No puedes pagarte a ti mismo/, 'propina');
    sr(`select public.paypal_register('o-c3', '${p}', 'coins', '{"packId":"bolsita"}', 4.99); select public.paypal_fulfill('o-c3', '${p}', 'CAP-C3', 4.99);`);
    raises(() => gift(p, cp, 'cupcake'), /No puedes pagarte a ti mismo/, 'regalo');
    raises(() => sr(`select public.paypal_subscription_register('I-SELF', '${p}', '${cp}', 7.99, now()); select public.paypal_subscription_activate('I-SELF'); select public.paypal_subscription_payment('I-SELF', 'SALE-S', 7.99);`), /No puedes pagarte a ti mismo/, 'suscripción');
  });
  await check('Un creador tampoco se paga desde su propia cuenta', async () => {
    expect(selfPay(lola, 'tip', { creatorProfileId: cp }) === 't', 'misma cuenta');
  });
});
