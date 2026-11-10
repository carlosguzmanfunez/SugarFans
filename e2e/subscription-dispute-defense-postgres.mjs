// Defensa de suscripciones ante disputas de PayPal, en un Postgres local
// desechable con todas las migraciones: pausa del acceso mientras la disputa
// está abierta, aviso de renovación 3 días antes (campana + correo, sin enlace
// para cancelar), registro de accesos y expediente de administración.
// Uso: PGHOST=localhost PGUSER=… PGPASSWORD=… npm run test:subscription-disputes-db
import { createDbTest } from './db-harness.mjs';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DB = 'fr_subscription_disputes_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);
const sr = (sql) => psql(DB, `set role service_role; ${sql}`);
const literal = (v) => "'" + String(typeof v === 'object' ? JSON.stringify(v) : v).replaceAll("'", "''") + "'";
const rpc = (name, args) => JSON.parse(sr(`select public.${name}(${args.map(literal).join(',')})`));
let version = 0;
// Mismo contrato que la API: aviso de disputa de PayPal ya consultado al proveedor.
const dispute = (sale, amount, outcome) => {
  const native = { dispute_id: 'PP-D-' + sale, status: outcome ? 'RESOLVED' : 'OPEN', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', create_time: '2026-11-10T12:00:00Z',
    update_time: new Date(Date.parse('2026-11-10T12:00:00Z') + (++version) * 1000).toISOString(),
    disputed_transactions: [{ seller_transaction_id: sale, gross_amount: { currency_code: 'USD', value: amount } }],
    ...(outcome ? { dispute_outcome: { outcome_code: outcome, ...(outcome === 'RESOLVED_BUYER_FAVOUR' ? { amount_refunded: { currency_code: 'USD', value: amount } } : {}) } } : {}) };
  const saved = rpc('paypal_income_receive', ['sandbox', 'QA_APP', { id: randomUUID(), event_type: outcome ? 'CUSTOMER.DISPUTE.RESOLVED' : 'CUSTOMER.DISPUTE.CREATED', resource: native }]);
  const claimed = rpc('paypal_income_claim', [saved.id, 'sandbox', 'QA_APP']);
  return rpc('paypal_income_apply', [saved.id, claimed.token, { resource: native }]);
};
const subscribe = (id, fan, cp, sale) => sr(`select public.paypal_subscription_register('${id}', '${fan}', '${cp}', 7.99, now());
  select public.paypal_subscription_activate('${id}'); select public.paypal_subscription_payment('${id}', '${sale}', 7.99);`);
const sees = (fan, cp) => as(fan, `select public.subscribed_to('${cp}')`) === 't';
const lockedRows = (fan, cp) => Number(as(fan, `select count(*) from public.creator_posts where creator_profile_id = '${cp}' and is_locked`));

finish(async () => {
  setup();
  const admin = user('subs-admin@example.invalid', 'admin'), creator = user('subs-creator@example.invalid', 'creator');
  const fan = user('subs-fan@example.invalid', 'fan'), fan2 = user('subs-fan2@example.invalid', 'fan'), outsider = user('subs-out@example.invalid', 'fan');
  psql(DB, `update public.profiles set role = 'admin' where id = '${admin}'`);
  const cp = psql(DB, `select creator_profile_id from public.profiles where id = '${creator}'`);
  const post = psql(DB, `insert into public.creator_posts (creator_id, content, is_locked) values ('${creator}', 'Exclusivo', true) returning id`);
  const open = psql(DB, `insert into public.creator_posts (creator_id, content, is_locked) values ('${creator}', 'Público', false) returning id`);
  subscribe('I-SUBQA1', fan, cp, 'SALEQA1');

  await check('Con la suscripción activa el fan ve el contenido exclusivo', () => {
    expect(sees(fan, cp) && lockedRows(fan, cp) === 1, 'sin acceso');
  });

  await check('Registro de accesos: perfil y publicaciones exclusivas, sin duplicar en 30 min', () => {
    as(fan, `select public.subscription_log_access('${cp}')`);
    as(fan, `select public.subscription_log_access('${cp}')`);
    as(fan, `select public.subscription_log_access('${cp}', '${post}')`);
    as(fan, `select public.subscription_log_access('${cp}', '${open}')`); // pública: no cuenta
    as(outsider, `select public.subscription_log_access('${cp}')`); // no suscrito
    const rows = psql(DB, `select string_agg(kind || ':' || coalesce(locked_posts::text, '-'), ',' order by id) from public.subscription_access_log`);
    expect(rows === 'profile_view:1,post_open:-', rows);
    raises(() => as(fan, 'select count(*) from public.subscription_access_log'), /permission denied/, 'el fan lee el registro');
    const cols = psql(DB, `select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name = 'subscription_access_log'`);
    expect(!/ip|agent|device/i.test(cols), 'guarda datos del dispositivo: ' + cols);
  });

  await check('Disputa abierta: el acceso queda en pausa y se avisa al fan y al creador', () => {
    const r = dispute('SALEQA1', '7.99');
    expect(['applied', 'pending'].includes(r.state), JSON.stringify(r));
    expect(psql(DB, `select status from public.transactions where key = 'paypal-sub:I-SUBQA1:SALEQA1'`) === 'disputed', 'el cobro no quedó en disputa');
    expect(psql(DB, `select dispute_paused_at is not null from public.subscriptions where paypal_subscription_id = 'I-SUBQA1'`) === 't', 'sin pausa');
    expect(!sees(fan, cp) && lockedRows(fan, cp) === 0, 'sigue viendo el contenido exclusivo');
    expect(psql(DB, `select count(*) from public.notifications where user_id = '${fan}' and title = 'Acceso en pausa'`) === '1', 'sin aviso al fan');
    expect(psql(DB, `select count(*) from public.notifications where user_id = '${creator}' and title = 'Un pago de suscripción está en disputa'`) === '1', 'sin aviso al creador');
    const before = psql(DB, 'select count(*) from public.subscription_access_log');
    as(fan, `select public.subscription_log_access('${cp}', '${post}')`);
    expect(psql(DB, 'select count(*) from public.subscription_access_log') === before, 'registró acceso durante la pausa');
  });

  await check('Si ganamos la disputa el acceso se restaura solo', () => {
    dispute('SALEQA1', '7.99', 'RESOLVED_SELLER_FAVOUR');
    expect(psql(DB, `select status from public.transactions where key = 'paypal-sub:I-SUBQA1:SALEQA1'`) === 'paid', 'el cobro no volvió');
    expect(psql(DB, `select dispute_paused_at is null from public.subscriptions where paypal_subscription_id = 'I-SUBQA1'`) === 't', 'sigue en pausa');
    expect(sees(fan, cp) && lockedRows(fan, cp) === 1, 'no recuperó el acceso');
    expect(psql(DB, `select count(*) from public.notifications where user_id = '${fan}' and title = 'Acceso restaurado'`) === '1', 'sin aviso de restauración');
  });

  await check('Si la disputa termina en reembolso, la suscripción termina sin aviso de restauración', () => {
    subscribe('I-SUBQA2', fan2, cp, 'SALEQA2');
    dispute('SALEQA2', '7.99');
    expect(!sees(fan2, cp), 'no se pausó');
    dispute('SALEQA2', '7.99', 'RESOLVED_BUYER_FAVOUR');
    expect(!sees(fan2, cp), 'recuperó el acceso al perder la disputa');
    // Reembolso completo de USD 7.99 (antes fallaba por redondeo, 20261110230000).
    const r = { id: 'RF-SALEQA2', state: 'completed', sale_id: 'SALEQA2', amount: { total: '7.99', currency: 'USD' } };
    const saved = rpc('paypal_refund_receive', ['sandbox', 'QA_APP', { id: 'EVENT-RF-SALEQA2', event_type: 'PAYMENT.SALE.REFUNDED', resource: r }]);
    const applied = rpc('paypal_refund_apply', [saved.id, 'SALEQA2', r, { id: 'SALEQA2', state: 'refunded', amount: { total: '7.99', currency: 'USD' } }]);
    expect(applied.state === 'applied' && applied.full === true, JSON.stringify(applied));
    expect(psql(DB, `select status from public.transactions where key = 'paypal-sub:I-SUBQA2:SALEQA2'`) === 'refunded', 'el cobro no quedó reembolsado');
    expect(psql(DB, `select cancel_at <= now() from public.subscriptions where paypal_subscription_id = 'I-SUBQA2'`) === 't', 'sigue activa');
    expect(!sees(fan2, cp), 'recuperó el acceso');
    expect(psql(DB, `select count(*) from public.notifications where user_id = '${fan2}' and title = 'Acceso restaurado'`) === '0', 'avisó restauración');
  });

  await check('Aviso de renovación 3 días antes: campana + correo, una sola vez y sin enlace para cancelar', () => {
    psql(DB, `update public.subscriptions set since = now() - interval '1 month' + interval '2 days' where paypal_subscription_id = 'I-SUBQA1'`);
    expect(psql(DB, 'select public.subscription_dispatch_renewal_reminders()') === '1', 'no envió el aviso');
    expect(psql(DB, 'select public.subscription_dispatch_renewal_reminders()') === '0', 'lo repitió');
    const bell = JSON.parse(psql(DB, `select row_to_json(n) from public.notifications n where user_id = '${fan}' and title = 'Tu suscripción se renueva pronto'`));
    expect(bell.link === '' && /Mi cuenta/.test(bell.body) && !/http/.test(bell.body), 'campana: ' + JSON.stringify(bell));
    const mail = JSON.parse(psql(DB, `select row_to_json(e) from public.email_outbox e where user_id = '${fan}'`));
    expect(mail.to_email === 'subs-fan@example.invalid' && /USD 7\.99/.test(mail.body) && /Mi cuenta/.test(mail.body), 'correo: ' + mail.body);
    expect(!/https?:\/\//.test(mail.body) && !/cancelar ahora|cancel now/i.test(mail.body), 'el correo trae enlace para cancelar');
    raises(() => as(fan, 'select public.subscription_dispatch_renewal_reminders()'), /permission denied/, 'un fan dispara avisos');
  });

  await check('Sin aviso si ya canceló la renovación, si falta más de 3 días o si está en pausa', () => {
    const fan3 = user('subs-fan3@example.invalid', 'fan');
    subscribe('I-SUBQA3', fan3, cp, 'SALEQA3');
    expect(psql(DB, 'select public.subscription_dispatch_renewal_reminders()') === '0', 'avisó a 30 días');
    psql(DB, `update public.subscriptions set since = now() - interval '1 month' + interval '1 day', cancel_at = now() + interval '1 day' where paypal_subscription_id = 'I-SUBQA3'`);
    expect(psql(DB, 'select public.subscription_dispatch_renewal_reminders()') === '0', 'avisó una suscripción cancelada');
    psql(DB, `update public.subscriptions set cancel_at = null, dispute_paused_at = now() where paypal_subscription_id = 'I-SUBQA3'`);
    expect(psql(DB, 'select public.subscription_dispatch_renewal_reminders()') === '0', 'avisó una suscripción en pausa');
  });

  await check('Expediente: solo administración, por suscripción, transacción o disputa', () => {
    raises(() => as(fan, `select public.subscription_admin_dispute_dossier('I-SUBQA1')`), /Solo administración/, 'fan');
    raises(() => as(creator, `select public.subscription_admin_dispute_dossier('I-SUBQA1')`), /Solo administración/, 'creador');
    raises(() => as(admin, `select public.subscription_admin_dispute_dossier('x or 1=1')`), /Escribe el ID/, 'referencia inválida');
    raises(() => as(admin, `select public.subscription_admin_dispute_dossier('I-NOEXISTE')`), /No encontramos/, 'inexistente');
    for (const ref of ['I-SUBQA1', 'i-subqa1', 'SALEQA1', 'PP-D-SALEQA1']) {
      const d = JSON.parse(as(admin, `select public.subscription_admin_dispute_dossier('${ref}')`));
      expect(d.subscription.paypal_subscription_id === 'I-SUBQA1', 'no encontró ' + ref);
    }
    const d = JSON.parse(as(admin, `select public.subscription_admin_dispute_dossier('PP-D-SALEQA1')`));
    expect(d.disputed_sale === 'SALEQA1' && d.charges.length === 1 && d.charges[0].sale_id === 'SALEQA1', 'cobros');
    expect(d.disputes.length === 1 && d.disputes[0].outcome === 'RESOLVED_SELLER_FAVOUR' && d.disputes[0].reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', 'disputas');
    expect(d.renewal_reminders.length === 1 && d.renewal_reminders[0].email === true, 'avisos');
    expect(d.access_log.length === 2 && d.access_log.some((l) => l.kind === 'post_open' && l.post_id === post), 'accesos');
    expect(d.content.locked_now === 1 && Array.isArray(d.content.posts_since_start) && Array.isArray(d.fan.terms_history), 'contenido');
    expect(d.fan.email === 'subs-fan@example.invalid', 'correo del fan');
  });

  await check('El expediente en inglés resume cobro, aviso, accesos y contenido; avisa si falta prueba', async () => {
    const out = resolve('e2e/.subscription-dossier-test.mjs');
    await build({ entryPoints: ['src/lib/subscriptionDisputeDossier.ts'], outfile: out, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
    try {
      const { subscriptionDossierHtml, subscriptionDossierFileName } = await import(pathToFileURL(out));
      const d = JSON.parse(as(admin, `select public.subscription_admin_dispute_dossier('SALEQA1')`));
      // El aviso de esta prueba anunció la renovación de hoy + 2 días: lo alineamos con el cobro.
      d.renewal_reminders[0].renews_at = d.charges[0].created_at; d.charges[0].kind = 'renewal';
      d.renewal_reminders[0].email_delivered_at = d.renewal_reminders[0].sent_at;
      const html = subscriptionDossierHtml(d);
      for (const text of ['Seller evidence for PayPal dispute (subscription)', 'SALEQA1', 'I-SUBQA1', 'Opened an exclusive post', 'Website notification + E-mail', 'we do not store IP addresses'])
        expect(html.includes(text), 'falta: ' + text);
      expect(!html.includes('Internal review needed'), 'pidió revisión con pruebas completas');
      expect(subscriptionDossierFileName(d) === 'fans-reserve-subscription-dispute-SALEQA1.html', subscriptionDossierFileName(d));
      const bare = subscriptionDossierHtml({ ...d, access_log: [], renewal_reminders: [] });
      expect(bare.includes('Internal review needed') && bare.includes('no access by the buyer') && bare.includes('no renewal reminder'), 'no advirtió la falta de pruebas');
      expect(!subscriptionDossierHtml({ ...d, fan: { ...d.fan, name: '<script>x</script>' } }).includes('<script>x'), 'sin escapar');
    } finally { unlinkSync(out); }
  });
});
