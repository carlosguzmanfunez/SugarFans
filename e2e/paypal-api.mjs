// Tests api/paypal.ts with PayPal and Supabase replaced by fakes (no network):
// the amount comes from the database quote, the purchase is fulfilled only
// after PayPal reports a completed capture for that amount, and a capture that
// can't be fulfilled is refunded. Subscriptions: one PayPal plan per price,
// access only once PayPal says ACTIVE, cancelling stops PayPal first, and the
// webhook is believed only after PayPal verifies its signature.
// Run: node e2e/paypal-api.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'paypal-api-'));
await build({ entryPoints: ['api/paypal.ts'], outfile: join(dir, 'paypal.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });

Object.assign(process.env, { PAYPAL_CLIENT_ID: 'AXclient', PAYPAL_CLIENT_SECRET: 'PP-SECRET-VALUE', PAYPAL_ENV: 'sandbox', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test', PAYPAL_WEBHOOK_ID: 'WH-1' });
const api = await import(pathToFileURL(join(dir, 'paypal.mjs')).href);

// --- fakes ------------------------------------------------------------------
const db = { orders: new Map(), fulfilled: [], marks: [], fulfillError: '', catalog: new Map(), subs: new Map(), payments: new Map(), ended: [], access: new Map() };
const pp = { orders: new Map(), refunds: [], captureStatus: 'COMPLETED', products: 0, plans: [], subs: new Map(), cancels: [], saleRefunds: [] };
const calls = [];
const res = (status, body) =>
  status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body;
  const h = init.headers ?? {};
  calls.push({ u, body, h });
  if (u.endsWith('/auth/v1/user')) return h.authorization === 'Bearer fan-token' ? res(200, { id: 'fan-1' }) : res(401, { msg: 'bad jwt' });
  if (u.endsWith('/rest/v1/rpc/paypal_quote')) {
    if (body.p_kind === 'tip' && body.p_params.amount > 500) return res(400, { message: 'La propina debe estar entre $1 y $500' });
    return res(200, { amount: body.p_kind === 'coins' ? 4.99 : body.p_params.amount, description: 'Prueba' });
  }
  if (u.endsWith('/rest/v1/rpc/paypal_register')) {
    if (h.apikey !== 'sb_secret_test') return res(401, {});
    db.orders.set(body.p_order_id, { status: 'created', amount: body.p_amount, user: body.p_user });
    return res(204, null);
  }
  if (u.includes('/rest/v1/paypal_orders?id=eq.')) {
    const id = decodeURIComponent(u.split('id=eq.')[1].split('&')[0]);
    const o = db.orders.get(id);
    return res(200, o && o.user === 'fan-1' ? [{ status: o.status, amount: o.amount }] : []);
  }
  if (u.endsWith('/rest/v1/rpc/paypal_fulfill')) {
    if (db.fulfillError) return res(400, { message: db.fulfillError });
    const o = db.orders.get(body.p_order_id);
    if (body.p_amount !== o.amount) return res(400, { message: 'El monto cobrado no coincide con el pedido' });
    o.status = 'completed';
    db.fulfilled.push(body);
    return res(204, null);
  }
  if (u.endsWith('/rest/v1/rpc/paypal_mark')) {
    db.marks.push(body);
    db.orders.get(body.p_order_id).status = body.p_status;
    return res(204, null);
  }
  // Subscriptions: database side.
  if (u.endsWith('/rest/v1/rpc/paypal_subscription_quote')) {
    if (body.p_creator_profile_id === 'mine') return res(400, { message: 'No puedes suscribirte a tu propio perfil' });
    return res(200, { amount: 9.99, description: 'Suscripción mensual a Diego', startTime: null });
  }
  if (u.includes('/rest/v1/paypal_catalog')) {
    if (h.apikey !== 'sb_secret_test') return res(401, {});
    if (init.method === 'POST') {
      if (!db.catalog.has(body.key)) db.catalog.set(body.key, body.paypal_id);
      return res(201, null);
    }
    const key = decodeURIComponent(u.split('key=eq.')[1].split('&')[0]);
    return res(200, db.catalog.has(key) ? [{ paypal_id: db.catalog.get(key) }] : []);
  }
  if (u.endsWith('/rest/v1/rpc/paypal_subscription_register')) {
    if (h.apikey !== 'sb_secret_test') return res(401, {});
    db.subs.set(body.p_id, { user: body.p_user, creator: body.p_creator_profile_id, status: 'created', starts: body.p_starts_at });
    return res(204, null);
  }
  if (u.endsWith('/rest/v1/rpc/paypal_subscription_activate')) {
    const o = db.subs.get(body.p_id);
    if (!o) return res(400, { message: 'Suscripción de PayPal no encontrada' });
    if (o.status === 'created') {
      o.status = 'active';
      db.access.set(`${o.user}:${o.creator}`, body.p_id);
    }
    return res(204, null);
  }
  if (u.endsWith('/rest/v1/rpc/paypal_subscription_payment')) {
    const o = db.subs.get(body.p_id);
    if (!o) return res(200, 'unknown');
    if (db.access.get(`${o.user}:${o.creator}`) !== body.p_id) return res(200, 'orphan');
    db.payments.set(body.p_sale_id, body);
    return res(200, 'recorded');
  }
  if (u.endsWith('/rest/v1/rpc/paypal_subscription_ended')) {
    db.ended.push(body);
    return res(200, '2026-11-03T00:00:00+00:00');
  }
  if (u.includes('/rest/v1/paypal_subscriptions?id=eq.')) {
    const id = decodeURIComponent(u.split('id=eq.')[1].split('&')[0]);
    const o = db.subs.get(id);
    return res(200, o && o.user === 'fan-1' ? [{ status: o.status, creator_id: o.creator, starts_at: o.starts }] : []);
  }
  if (u.includes('/rest/v1/subscriptions?creator_id=eq.')) {
    const creator = decodeURIComponent(u.split('creator_id=eq.')[1].split('&')[0]);
    const id = db.access.get(`fan-1:${creator}`);
    return res(200, id ? [{ paypal_subscription_id: id }] : []);
  }
  // Subscriptions: PayPal side.
  if (u.endsWith('/v1/catalogs/products')) return res(201, { id: `PROD-${++pp.products}` });
  if (u.endsWith('/v1/billing/plans')) {
    pp.plans.push(body);
    return res(201, { id: `P-${pp.plans.length}`, status: 'ACTIVE' });
  }
  if (u.endsWith('/v1/billing/subscriptions') && init.method === 'POST') {
    const id = `I-SUB${pp.subs.size + 1}`;
    pp.subs.set(id, { ...body, status: 'ACTIVE', sales: [{ id: `SALE-${id}`, status: 'COMPLETED', amount_with_breakdown: { gross_amount: { value: '9.99' } } }] });
    return res(201, { id, status: 'APPROVAL_PENDING' });
  }
  const subCancel = u.match(/\/v1\/billing\/subscriptions\/([\w-]+)\/cancel$/);
  if (subCancel) {
    pp.cancels.push({ id: subCancel[1], at: calls.length });
    if (pp.subs.has(subCancel[1])) pp.subs.get(subCancel[1]).status = 'CANCELLED';
    return res(204, null);
  }
  const subTx = u.match(/\/v1\/billing\/subscriptions\/([\w-]+)\/transactions\?/);
  if (subTx) return res(200, { transactions: pp.subs.get(subTx[1])?.sales ?? [] });
  const subGet = u.match(/\/v1\/billing\/subscriptions\/([\w-]+)$/);
  if (subGet) {
    const sub = pp.subs.get(subGet[1]);
    return sub ? res(200, { id: subGet[1], status: sub.status, custom_id: sub.custom_id, plan_id: sub.plan_id }) : res(404, {});
  }
  if (u.endsWith('/v1/notifications/verify-webhook-signature')) {
    const v = JSON.parse(init.body);
    return res(200, { verification_status: v.transmission_sig === 'good' && v.webhook_id === 'WH-1' && v.webhook_event?.id ? 'SUCCESS' : 'FAILURE' });
  }
  const saleRefund = u.match(/\/v1\/payments\/sale\/([\w-]+)\/refund$/);
  if (saleRefund) {
    pp.saleRefunds.push(saleRefund[1]);
    return res(201, { state: 'completed' });
  }
  if (u.endsWith('/v1/oauth2/token')) return res(200, { access_token: 'pp-token' });
  if (u.endsWith('/v2/checkout/orders') && init.method === 'POST') {
    const id = `ORDER${pp.orders.size + 1}`;
    pp.orders.set(id, { amount: body.purchase_units[0].amount, captured: false });
    return res(201, { id, status: 'CREATED' });
  }
  const cap = u.match(/\/v2\/checkout\/orders\/(\w+)\/capture$/);
  if (cap) {
    const o = pp.orders.get(cap[1]);
    if (o.captured) return res(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] });
    o.captured = true;
    return res(201, { id: cap[1], status: pp.captureStatus, purchase_units: [{ payments: { captures: [{ id: `CAP-${cap[1]}`, status: pp.captureStatus, amount: o.amount }] } }] });
  }
  const get = u.match(/\/v2\/checkout\/orders\/(\w+)$/);
  if (get) {
    const o = pp.orders.get(get[1]);
    return res(200, { id: get[1], status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: `CAP-${get[1]}`, status: 'COMPLETED', amount: o.amount }] } }] });
  }
  const refund = u.match(/\/v2\/payments\/captures\/([\w-]+)\/refund$/);
  if (refund) {
    pp.refunds.push(refund[1]);
    return res(201, { status: 'COMPLETED' });
  }
  throw new Error(`unexpected fetch ${u}`);
};

const post = async (body, token = 'fan-token') => {
  const r = await api.POST(new Request('https://x/api/paypal', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: r.status, data: await r.json() };
};

const hook = async (event, sig = 'good') => {
  const r = await api.POST(
    new Request('https://x/api/paypal?webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'paypal-transmission-sig': sig, 'paypal-transmission-id': 't1', 'paypal-auth-algo': 'SHA256withRSA' },
      body: JSON.stringify({ id: `WH-EV-${Math.random()}`, ...event }),
    }),
  );
  return { status: r.status, data: await r.json() };
};

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}: ${err.message}`);
  }
};
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

console.log('API de PayPal (con PayPal y Supabase simulados)');

await check('GET da el Client ID público y nunca el Secret', async () => {
  const r = await api.GET();
  const data = await r.json();
  expect(data.enabled && data.clientId === 'AXclient' && data.env === 'sandbox', JSON.stringify(data));
  expect(!JSON.stringify(data).includes('PP-SECRET-VALUE'), 'muestra el secret');
  expect(!JSON.stringify(data).includes('sb_secret_test'), 'muestra la service role');
});

await check('Sin sesión no se puede pagar', async () => {
  const r = await post({ action: 'create', kind: 'coins', params: { packId: 'bolsita' } }, 'otro');
  expect(r.status === 401, `status ${r.status}`);
});

await check('El monto lo decide la base, no el navegador', async () => {
  const r = await post({ action: 'create', kind: 'coins', params: { packId: 'bolsita', amount: 0.01 } });
  expect(r.status === 200 && r.data.orderId, JSON.stringify(r.data));
  expect(pp.orders.get(r.data.orderId).amount.value === '4.99' && pp.orders.get(r.data.orderId).amount.currency_code === 'USD', 'monto o moneda incorrectos');
  expect(db.orders.get(r.data.orderId)?.amount === 4.99, 'pedido no registrado');
});

await check('Una propina inválida no llega a PayPal', async () => {
  const before = pp.orders.size;
  const r = await post({ action: 'create', kind: 'tip', params: { creatorProfileId: '2', amount: 900 } });
  expect(r.status === 400 && /500/.test(r.data.error) && pp.orders.size === before, JSON.stringify(r.data));
});

await check('Las suscripciones no se cobran como pago único', async () => {
  const r = await post({ action: 'create', kind: 'subscription', params: { creatorProfileId: '2' } });
  expect(r.status === 400, `status ${r.status}`);
});

await check('Capturar confirma la compra una sola vez', async () => {
  const { data } = await post({ action: 'create', kind: 'tip', params: { creatorProfileId: '2', amount: 12.5 } });
  const r = await post({ action: 'capture', orderId: data.orderId });
  expect(r.status === 200 && r.data.ok && r.data.captureId === `CAP-${data.orderId}`, JSON.stringify(r.data));
  const f = db.fulfilled.at(-1);
  expect(f.p_order_id === data.orderId && f.p_user === 'fan-1' && f.p_amount === 12.5 && f.p_capture_id === `CAP-${data.orderId}`, JSON.stringify(f));
  const n = db.fulfilled.length;
  const again = await post({ action: 'capture', orderId: data.orderId });
  expect(again.status === 200 && db.fulfilled.length === n, 'se cumplió dos veces');
});

await check('No se puede capturar el pedido de otra persona', async () => {
  const r = await post({ action: 'capture', orderId: 'NOEXISTE' });
  expect(r.status === 404, `status ${r.status}`);
});

await check('Si PayPal no completa el pago, no se entrega nada', async () => {
  const { data } = await post({ action: 'create', kind: 'coins', params: { packId: 'bolsita' } });
  pp.captureStatus = 'DECLINED';
  const n = db.fulfilled.length;
  const r = await post({ action: 'capture', orderId: data.orderId });
  pp.captureStatus = 'COMPLETED';
  expect(r.status === 402 && db.fulfilled.length === n, JSON.stringify(r.data));
});

await check('Si la compra ya no es válida, se devuelve el dinero', async () => {
  const { data } = await post({ action: 'create', kind: 'booking', params: { bookingId: 'b1', amount: 80 } });
  db.fulfillError = 'Solo puedes pagar una reserva aceptada por el creador';
  const r = await post({ action: 'capture', orderId: data.orderId });
  db.fulfillError = '';
  expect(r.status === 409 && /devolvimos/.test(r.data.error), JSON.stringify(r.data));
  expect(pp.refunds.includes(`CAP-${data.orderId}`), 'no reembolsó');
  expect(db.marks.at(-1).p_status === 'refunded' && db.orders.get(data.orderId).status === 'refunded', 'no marcó el pedido');
});

await check('Suscribirse crea un solo plan por precio y la suscripción lleva al fan y al perfil', async () => {
  const a = await post({ action: 'subscribe', creatorProfileId: '2' });
  const b = await post({ action: 'subscribe', creatorProfileId: '3' });
  expect(a.status === 200 && b.status === 200 && a.data.subscriptionId && b.data.subscriptionId, JSON.stringify([a.data, b.data]));
  expect(pp.products === 1 && pp.plans.length === 1, `productos ${pp.products}, planes ${pp.plans.length}`);
  const plan = pp.plans[0];
  expect(plan.billing_cycles[0].pricing_scheme.fixed_price.value === '9.99' && plan.billing_cycles[0].frequency.interval_unit === 'MONTH', JSON.stringify(plan));
  expect(pp.subs.get(a.data.subscriptionId).custom_id === 'fan-1:2' && pp.subs.get(a.data.subscriptionId).plan_id === 'P-1', 'custom_id o plan');
  expect(db.subs.get(a.data.subscriptionId)?.status === 'created', 'no registrada');
});

await check('No se puede suscribir a su propio perfil', async () => {
  const before = pp.subs.size;
  const r = await post({ action: 'subscribe', creatorProfileId: 'mine' });
  expect(r.status === 400 && pp.subs.size === before, JSON.stringify(r.data));
});

await check('Activar da acceso y registra el primer pago una sola vez', async () => {
  const id = 'I-SUB1';
  const r = await post({ action: 'activate', subscriptionId: id });
  expect(r.status === 200 && r.data.ok, JSON.stringify(r.data));
  expect(db.access.get('fan-1:2') === id && db.payments.has(`SALE-${id}`), 'sin acceso o sin pago');
  const again = await post({ action: 'activate', subscriptionId: id });
  expect(again.status === 200 && db.payments.size === 1, 'pago doble');
});

await check('Sin ACTIVE en PayPal no hay acceso', async () => {
  pp.subs.get('I-SUB2').status = 'APPROVAL_PENDING';
  const r = await post({ action: 'activate', subscriptionId: 'I-SUB2' });
  expect(r.status === 402 && !db.access.has('fan-1:3'), JSON.stringify(r.data));
  pp.subs.get('I-SUB2').status = 'ACTIVE';
});

await check('No se puede activar la suscripción de otra persona', async () => {
  const r = await post({ action: 'activate', subscriptionId: 'I-SUB-NOEXISTE' });
  expect(r.status === 404, `status ${r.status}`);
});

await check('Cancelar detiene PayPal primero y deja el mes pagado', async () => {
  const before = calls.length;
  const r = await post({ action: 'cancel-subscription', creatorProfileId: '2' });
  expect(r.status === 200 && r.data.until, JSON.stringify(r.data));
  const cancelAt = calls.findIndex((c, i) => i >= before && /\/I-SUB1\/cancel$/.test(c.u));
  const endedAt = calls.findIndex((c, i) => i >= before && c.u.endsWith('paypal_subscription_ended'));
  expect(cancelAt >= 0 && endedAt > cancelAt, 'orden incorrecto');
  expect(db.ended.at(-1).p_id === 'I-SUB1' && db.ended.at(-1).p_now === false, JSON.stringify(db.ended.at(-1)));
});

await check('El webhook sin firma válida no cambia nada', async () => {
  const n = db.payments.size;
  const r = await hook({ event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: 'SALE-FAKE', billing_agreement_id: 'I-SUB1', amount: { total: '9.99' } } }, 'bad');
  expect(r.status === 401 && db.payments.size === n, JSON.stringify(r.data));
});

await check('El webhook registra cada renovación una vez', async () => {
  await post({ action: 'activate', subscriptionId: 'I-SUB2' });
  const ev = { event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: 'SALE-R2', billing_agreement_id: 'I-SUB2', amount: { total: '9.99', currency: 'USD' } } };
  const r = await hook(ev);
  await hook(ev);
  expect(r.status === 200 && db.payments.get('SALE-R2')?.p_amount === 9.99, JSON.stringify(r.data));
});

await check('Un cobro de una suscripción que ya no existe aquí se cancela y se devuelve', async () => {
  db.access.delete('fan-1:3'); // the fan deleted their account
  const r = await hook({ event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: 'SALE-R3', billing_agreement_id: 'I-SUB2', amount: { total: '9.99' } } });
  expect(r.status === 200 && pp.cancels.some((c) => c.id === 'I-SUB2') && pp.saleRefunds.includes('SALE-R3'), JSON.stringify(pp.saleRefunds));
});

await check('Un pago fallido (suspendida) quita el acceso al momento', async () => {
  const r = await hook({ event_type: 'BILLING.SUBSCRIPTION.SUSPENDED', resource: { id: 'I-SUB2' } });
  expect(r.status === 200 && db.ended.at(-1).p_id === 'I-SUB2' && db.ended.at(-1).p_now === true, JSON.stringify(db.ended.at(-1)));
});

await check('Sin PAYPAL_WEBHOOK_ID el webhook no acepta nada', async () => {
  delete process.env.PAYPAL_WEBHOOK_ID;
  const r = await hook({ event_type: 'BILLING.SUBSCRIPTION.CANCELLED', resource: { id: 'I-SUB1' } });
  process.env.PAYPAL_WEBHOOK_ID = 'WH-1';
  expect(r.status === 503, `status ${r.status}`);
});

await check('La service role solo se usa en llamadas del servidor', async () => {
  const leaked = calls.filter((c) => c.h.apikey === 'sb_secret_test' && !/paypal_(register|fulfill|mark|catalog|subscription_(register|activate|payment|ended))/.test(c.u));
  expect(leaked.length === 0, leaked.map((c) => c.u).join(', '));
});

rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} pruebas fallaron` : '\nTodas las pruebas de la API de PayPal pasaron');
process.exit(failures ? 1 : 0);
