// Fans Reserve · security acceptance on disposable local PostgreSQL only.
// Apply every migration through db-harness, create fake identities/transactions,
// test as anon, fan, creator and admin. NEVER connects to production or PayPal.
// Usage: npm run test:supabase-permissions
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_permission_audit_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);
const guest = (sql) => psql(DB, `begin; set local role anon; ${sql}; commit;`);

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
  await check('Las políticas de órdenes y suscripciones PayPal siguen restringidas por usuario', () => {
    for (const table of ['paypal_orders', 'paypal_subscriptions']) {
      const policy = psql(DB, `select qual from pg_policies where schemaname='public'
         and tablename='${table}' and policyname='${table}: own rows'`);
      expect(/user_id/i.test(policy) && /select\\s+auth\\.uid\\(\\)/i.test(policy),
        `RLS ${table} tiene política inesperada: ${policy}`);
    }
  });
});
