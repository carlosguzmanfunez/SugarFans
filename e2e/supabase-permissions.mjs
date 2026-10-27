// Fans Reserve · security acceptance on disposable local PostgreSQL only.
// Apply every migration through db-harness, create fake identities/transactions,
// test as anon, fan, creator and admin. NEVER connects to production or PayPal.
// Usage: npm run test:supabase-permissions
import { createDbTest } from './db-harness.mjs';
import { randomUUID, createHash } from 'node:crypto';

const DB = 'fr_permission_audit_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);
const guest = (sql) => psql(DB, `begin; set local role anon; ${sql}; commit;`);
const lit = v => v == null ? 'null' : "'" + String(v).replaceAll("'", "''") + "'";
const report = (actor, email, description = 'Mensaje de soporte válido de QA') => {
  const request = randomUUID();
  const ipKey = createHash('sha256').update(request).digest('hex');
  return psql(DB, `set role service_role; select public.report_submit_checked(
    ${lit(actor)},${lit(ipKey)},${lit(request)},'support',null,'Ayuda','Consulta',${lit(description)},${lit(email)})`);
};

finish(async () => {
  setup();
  const creator = user('security-creator@test.local', 'creator');
  const fan = user('security-fan@test.local', 'fan');
  const stranger = user('security-stranger@test.local', 'fan');
  const admin = user('security-admin@test.local', 'fan');
  const cp = psql(DB, `select creator_profile_id from public.profiles where id = '${creator}'`);
  psql(DB, `update public.profiles set role='admin' where id='${admin}'`);

  // Fake QA-only booking and gift, created in a throwaway database.
  const booking = psql(DB, `insert into public.vip_bookings
    (experience_id,creator_profile_id,title,creator_name,price,fan_id,fan_name,fan_email,date,time,status,details)
    values ('custom','${cp}','QA booking','QA creator',25,'${fan}','QA fan','fan@test.local',
    current_date+7,'13:30','pending','{"kind":"custom"}') returning id`);
  psql(DB, `insert into public.transactions
    (key,payer_name,creator_profile_id,creator_name,kind,amount,method_label,status)
    values ('qa-permission-check','QA Synthetic Fan','${cp}','QA Creator','gift',7.25,'QA','paid')`);

  await check('Visitantes ven el catálogo público, pero no reservas ajenas', () => {
    expect(guest(`select count(*) from public.public_creator('${cp}')`) === '1', 'rompió el catálogo público');
    expect(guest('select count(*) from public.vip_bookings') === '0', 'anon lee reservas');
    expect(guest('select count(*) from public.payouts') === '0', 'anon lee payouts');
  });
  await check('Un fan no ve reservas ajenas y el dueño sí ve la suya', () => {
    expect(as(stranger, `select count(*) from public.vip_bookings where id='${booking}'`) === '0', 'IDOR entre fans');
    expect(as(fan, `select count(*) from public.vip_bookings where id='${booking}'`) === '1', 'fan no puede leer reserva propia');
    expect(as(creator, `select count(*) from public.vip_bookings where id='${booking}'`) === '1', 'creador no puede leer su reserva');
  });
  await check('Los datos de pagos a otros creadores no son públicos', () => {
    expect(psql(DB, "select has_function_privilege('anon','public.top_fans(text)','EXECUTE')") === 'f', 'EXECUTE anon abierto');
    raises(() => guest(`select count(*) from public.top_fans('${cp}')`), /permission denied/i, 'top_fans anon');
    expect(as(stranger, `select count(*) from public.top_fans('${cp}')`) === '0', 'otro fan ve importes');
  });
  await check('Creador y administrador ven los regalos del creador', () => {
    for (const actor of [creator, admin]) {
      const value = as(actor, `select value from public.top_fans('${cp}') where name='QA Synthetic Fan'`);
      expect(value === '7.25', 'el autorizado no ve su reporte: ' + value);
    }
  });
  await check('Una cuenta fan no ejecuta acciones financieras privilegiadas', () => {
    raises(
      () => as(fan, `select public.finance_collection_context('booking','00000000-0000-4000-8000-000000000999'::uuid)`),
      /solo est[aá] disponible para administradores/i,'finance_collection_context');
    raises(
      () => as(fan, `select public.admin_account_action('${stranger}','freeze_payouts','QA',null)`),
      /solo est[aá] disponible para administradores/i,'admin_account_action');
    raises(() => as(fan, 'select count(*) from public.finance_journal'), /permission denied/i, 'finance_journal');
    expect(psql(DB, "select has_function_privilege('authenticated','public.paypal_payout_begin(uuid,text,text)','EXECUTE')") === 'f',
      'PayPal payout begin no debe estar abierto al fan');
  });
  await check('Soporte anónimo sigue permitido, sin revelar reportes privados', () => {
    const guestMail = 'qa-guest-report@test.local';
    report(null, guestMail);
    expect(psql(DB, `select count(*) from public.reports where contact_email='${guestMail}'`) === '1', 'no se recibió el reporte anónimo');
    expect(guest('select count(*) from public.reports') === '0', 'los visitantes pueden leer reportes privados');
    raises(() => guest(`select public.submit_report('support',null,'Soporte','Consulta',
      'Mensaje de prueba con longitud válida','qa-direct@test.local')`), /permission denied/i, 'el acceso antiguo no evita el filtro');
    raises(() => report(null, 'qa-large@test.local', 'x'.repeat(4001)), /entre 10 y 4000 caracteres/, 'texto de 4001 caracteres');
  });
  await check('Reportes repetidos se limitan por identidad sin bloquear a otros', () => {
    const guestMail = 'qa-guest-report@test.local';
    for (let i = 2; i <= 5; i++) {
      report(null, guestMail);
    }
    raises(() => report(null, guestMail),
      /muchos reportes/i,'tope público de cinco reportes por hora');
    for (let i = 1; i <= 10; i++) {
      report(fan, null);
    }
    raises(() => report(fan, null),
      /muchos reportes/i,'tope de diez reportes por hora');
    report(stranger, null);
    expect(psql(DB, `select count(*) from public.reports where reporter_id='${stranger}'`) === '1', 'limitó a un fan distinto');
  });
  await check('Un beneficio heredado vencido NO reembolsa regalos ni devuelve Créditos', () => {
    const secondCreator = user('security-second-creator@test.local', 'creator');
    const secondFan = user('security-second-fan@test.local', 'fan');
    const cp2 = psql(DB, `select creator_profile_id from public.profiles where id = '${secondCreator}'`);
    psql(DB, `insert into public.coin_purchases
      (user_id,pack_id,coins,price,method_label,status)
      values ('${fan}','caja',2000,19.99,'QA','paid')`);
    const gift = (key, who, creatorId) => psql(DB, `insert into public.transactions
      (key,payer_id,payer_name,creator_profile_id,creator_name,kind,amount,method_label,status)
      values ('${key}','${who}','QA Gift Fan','${creatorId}','QA Gift Creator','gift',5.50,'QA','paid') returning id`);
    const ownGift = gift('qa-perk-expiry-a',fan,cp);
    const foreignGift = gift('qa-perk-expiry-b',secondFan,cp2);
    const overdue = (txn, who, creatorId) => psql(DB, `insert into public.perk_requests
      (transaction_id,fan_id,fan_name,creator_profile_id,creator_name,kind,request,status,due_at)
      values ('${txn}','${who}','QA Fan','${creatorId}','QA Creator','video','Legacy agreement','pending',
       now() - interval '1 hour')`);
    overdue(ownGift,fan,cp);
    overdue(foreignGift,secondFan,cp2);
    const before = psql(DB, `select public.coin_balance('${fan}')`);
    expect(before === '1450', 'se esperaba 2000 Créditos comprados menos 550 regalados');

    for (const actor of [fan,secondCreator]) {
      as(actor, 'select public.settle_overdue_perks()');
    }
    expect(psql(DB, `select status from public.transactions where id='${ownGift}'`) === 'paid',
      'el vencimiento reembolsó un regalo ya entregado');
    expect(psql(DB, `select status from public.transactions where id='${foreignGift}'`) === 'paid',
      'el vencimiento cambió una transacción de otro creador');
    expect(psql(DB, `select status from public.perk_requests where transaction_id='${ownGift}'`) === 'pending',
      'la obligación de beneficio antiguo se eliminó sin revisión');
    expect(psql(DB, `select public.coin_balance('${fan}')`) === before,
      'se restauraron monedas tras el vencimiento');
    raises(() => guest('select public.settle_overdue_perks()'), /permission denied/i,
      'el visitante no debe invocar la función de mantenimiento');
  });

  await check('Las políticas de órdenes y suscripciones PayPal siguen restringidas por usuario', () => {
    for (const table of ['paypal_orders', 'paypal_subscriptions']) {
      const policy = psql(DB, `select qual from pg_policies where schemaname='public'
         and tablename='${table}' and policyname='${table}: own rows'`);
      expect(/user_id/i.test(policy) && /select\s+auth\.uid\(\)/i.test(policy),
        `RLS ${table} tiene política inesperada: ${policy}`);
    }
  });
});
