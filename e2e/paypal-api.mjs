// Tests api/paypal.ts with PayPal and Supabase replaced by fakes (no network):
// the amount comes from the database quote, the purchase is fulfilled only
// after PayPal reports a completed capture for that amount, and a capture that
// can't be fulfilled is refunded. Run: node e2e/paypal-api.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'paypal-api-'));
await build({ entryPoints: ['api/paypal.ts'], outfile: join(dir, 'paypal.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });

Object.assign(process.env, { PAYPAL_CLIENT_ID: 'AXclient', PAYPAL_CLIENT_SECRET: 'PP-SECRET-VALUE', PAYPAL_ENV: 'sandbox', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test' });
const api = await import(pathToFileURL(join(dir, 'paypal.mjs')).href);

// --- fakes ------------------------------------------------------------------
const db = { orders: new Map(), fulfilled: [], marks: [], fulfillError: '' };
const pp = { orders: new Map(), refunds: [], captureStatus: 'COMPLETED' };
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

await check('Las suscripciones todavía no van por este camino', async () => {
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

await check('La service role solo se usa en llamadas del servidor', async () => {
  const leaked = calls.filter((c) => c.h.apikey === 'sb_secret_test' && !/paypal_(register|fulfill|mark)/.test(c.u));
  expect(leaked.length === 0, leaked.map((c) => c.u).join(', '));
});

rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} pruebas fallaron` : '\nTodas las pruebas de la API de PayPal pasaron');
process.exit(failures ? 1 : 0);
