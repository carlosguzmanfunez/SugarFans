// PayPal refunds, disputes and paying yourself, on a throwaway Postgres with every
// migration: refunded money leaves the creator's sales, a dispute freezes it until
// PayPal decides, and nobody pays their own creator account from a fan account.
// Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:refunds-db
import { createDbTest } from './db-harness.mjs';
import { randomUUID } from 'node:crypto';

const DB = 'fr_refunds_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);

const sr = (sql) => psql(DB, `set role service_role; ${sql}`);
const profileOf = (uid) => psql(DB, `select creator_profile_id from public.profiles where id = '${uid}'`);
const literal = value => "'"+String(typeof value==='object'?JSON.stringify(value):value).replaceAll("'","''")+"'";
const rpc = (name,args) => JSON.parse(sr(`select public.${name}(${args.map(literal).join(',')})`));
let nativeVersion=0;
// Simulated canonical provider evidence enters the same server-only contracts as
// the API. The retired arbitrary refund writer is deliberately never used.
const back = (ref, action) => {
  const original=JSON.parse(psql(DB,`select json_build_object('amount',t.amount,'sale',t.key like 'paypal-sub:%') from public.transactions t where t.kind<>'referral' and (t.paypal_ref=${literal(ref)} or (t.key like 'paypal-sub:%' and split_part(t.key,':',3)=${literal(ref)}))
    union all select json_build_object('amount',c.price,'sale',false) from public.coin_purchases c where c.paypal_ref=${literal(ref)}`));
  const amount=Number(original.amount).toFixed(2);
  if(action==='refund'){
    const refund=original.sale?{id:'RF-'+ref,state:'completed',sale_id:ref,amount:{total:amount,currency:'USD'}}:
      {id:'RF-'+ref,status:'COMPLETED',amount:{value:amount,currency_code:'USD'},links:[{rel:'up',href:'https://api-m.sandbox.paypal.com/v2/payments/captures/'+ref}]};
    const event={id:'EVENT-RF-'+ref,event_type:original.sale?'PAYMENT.SALE.REFUNDED':'PAYMENT.CAPTURE.REFUNDED',resource:refund};
    const saved=rpc('paypal_refund_receive',['sandbox','NATIVE_QA_APP',event]);
    return rpc('paypal_refund_apply',[saved.id,ref,refund,original.sale?{id:ref,state:'refunded',amount:{total:amount,currency:'USD'}}:{id:ref,status:'REFUNDED',amount:{value:amount,currency_code:'USD'}}]);
  }
  const resolved=action==='release',native={dispute_id:'D-'+ref,status:resolved?'RESOLVED':'OPEN',update_time:new Date(Date.parse('2026-10-23T12:00:00Z')+(++nativeVersion)*1000).toISOString(),disputed_transactions:[{seller_transaction_id:ref,gross_amount:{currency_code:'USD',value:amount}}],...(resolved?{dispute_outcome:{outcome_code:'RESOLVED_SELLER_FAVOUR'}}:{})};
  const saved=rpc('paypal_income_receive',['sandbox','NATIVE_QA_APP',{id:randomUUID(),event_type:resolved?'CUSTOMER.DISPUTE.RESOLVED':'CUSTOMER.DISPUTE.CREATED',resource:native}]);
  const claimed=rpc('paypal_income_claim',[saved.id,'sandbox','NATIVE_QA_APP']);
  return rpc('paypal_income_apply',[saved.id,claimed.token,{resource:native}]);
};
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
    psql(DB, "update public.transactions set created_at=now()-interval '40 days' where paypal_ref='CAP-TIP'");
    expect(psql(DB, `select paypal_ref from public.transactions where kind = 'tip'`) === 'CAP-TIP', 'sin referencia');
  });
  await check('Disputa: la venta queda congelada; si PayPal da la razón al creador, vuelve', async () => {
    expect(back('CAP-TIP', 'dispute').state === 'applied', 'no concilió la disputa');
    expect(status(`kind = 'tip'`) === 'disputed', status(`kind = 'tip'`));
    back('CAP-TIP', 'release');
    expect(status(`kind = 'tip'`) === 'paid', 'no volvió a pagada');
  });
  await check('Reembolso: la venta deja de contar para el creador, y repetir el aviso no hace nada', async () => {
    back('CAP-TIP', 'dispute');
    expect(back('CAP-TIP', 'refund').matched === 1, 'no la reembolsó');
    expect(status(`kind = 'tip'`) === 'refunded', status(`kind = 'tip'`));
    expect(psql(DB, `select status from public.paypal_orders where id = 'o-tip'`) === 'refunded', 'el pedido sigue completado');
    const receipts=psql(DB,"select count(*) from finance_private.refund_receipts"),journal=psql(DB,"select count(*) from public.finance_journal");
    back('CAP-TIP', 'refund');
    expect(psql(DB,"select count(*) from finance_private.refund_receipts")===receipts && psql(DB,"select count(*) from public.finance_journal")===journal, 'contó dos veces');
    back('CAP-TIP', 'release');expect(status(`kind = 'tip'`) === 'refunded', 'un reembolso volvió a pagado');
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
  await check('Si no fue culpa del creador, un admin lo cubre y el creador conserva su parte', async () => {
    const admin = user('admin@test.com', 'fan');
    psql(DB, `update public.profiles set role = 'admin' where id = '${admin}'`);
    const avail = () => Number(psql(DB, `select public.creator_available_balance('${lola}')`));
    const before = avail();
    const tip = psql(DB, `select id from public.transactions where paypal_ref = 'CAP-TIP'`);
    const incident=psql(DB,`select id from public.finance_incidents where code='DISPUTE_CASE' and reference='${tip}'`);
    raises(() => as(lola, `select public.finance_case_preview('${incident}')`), /no está permitida|para administradores/, 'el creador se lo cubre solo');
    const cover=party=>{const preview=JSON.parse(as(admin,`select public.finance_case_preview('${incident}')`));as(admin,`select public.finance_case_act('${incident}','${randomUUID()}','${preview.hash}','coverage','${party}','${party==='platform'?'platform_processing':'service_delivery'}','QA original provider proof and contract reviewed','QA documented responsibility and coverage assessment',null,null)`);};
    cover('platform');
    expect(avail() > before, `saldo ${before} → ${avail()}`);
    cover('creator');
    expect(avail() === before, 'quitar la cobertura no lo descontó');
    raises(() => as(admin, `select public.admin_cover_refund('${tip}', true)`), /expediente/i, 'sin evaluación de expediente');
  });
  await check('Un fan no registra avisos y el escritor antiguo permanece retirado incluso para el servidor', async () => {
    raises(() => as(fan, `select public.paypal_money_back('CAP-VIP', 'release')`), /permission denied/, 'un fan');
    raises(() => sr(`select public.paypal_money_back('CAP-VIP', 'release')`), /permission denied/, 'el servidor usando el escritor retirado');
    raises(() => as(fan, `select public.paypal_refund_receive('sandbox','NATIVE_QA_APP','{}')`), /permission denied/, 'un fan registrando un aviso');
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
