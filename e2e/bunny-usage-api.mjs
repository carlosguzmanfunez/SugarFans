// Tests the admin "Consumo" numbers for Bunny Stream: POST /api/usage {action:'bunny-usage'}
// (api/usage.ts → bunnyUsage in api/_bunny.ts) with Supabase and Bunny replaced by fakes
// (no network, no real keys):
//   - only admins get the numbers (is_admin with their own session)
//   - library key: videos, storage, views and minutes this month
//   - account key (optional): GB served, this month's charges and balance
//   - keys are sent only to Bunny and never returned
// Run: node e2e/bunny-usage-api.mjs
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

Object.assign(process.env, { SUPABASE_URL: 'https://db.example.invalid', SUPABASE_ANON_KEY: 'public-anon' });
const dir = mkdtempSync(join(tmpdir(), 'bunny-usage-'));
await build({ entryPoints: ['api/usage.ts'], outfile: join(dir, 'usage.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const api = await import(pathToFileURL(join(dir, 'usage.mjs')).href);

const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const calls = [];
let accountDown = false;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const h = init.headers ?? {};
  calls.push({ u, h });
  if (u === 'https://db.example.invalid/rest/v1/rpc/is_admin') {
    assert.equal(h.apikey, 'public-anon');
    if (h.authorization === 'Bearer admin-token') return res(200, true);
    if (h.authorization === 'Bearer fan-token') return res(200, false);
    return res(401, { message: 'JWT expired' });
  }
  if (u.startsWith('https://video.bunnycdn.com/library/777/')) {
    assert.equal(h.AccessKey, 'library-key');
    if (u.includes('/videos?page=1')) return res(200, { totalItems: 2, items: [{ storageSize: 3 * 1024 ** 2 }, { storageSize: 5 * 1024 ** 2 }] });
    if (u.includes('/statistics?')) {
      assert.match(u, /dateFrom=2026-11-01T00%3A00%3A00\.000Z/);
      return res(200, { viewsChart: { '2026-11-11': 4, '2026-11-12': 6 }, watchTimeChart: { '2026-11-11': 600, '2026-11-12': 300 } });
    }
  }
  if (u.startsWith('https://api.bunny.net/')) {
    assert.equal(h.AccessKey, 'account-key');
    if (accountDown) return res(500, {});
    if (u === 'https://api.bunny.net/billing') return res(200, { Balance: 9.5, ThisMonthCharges: 0.42 });
    if (u.startsWith('https://api.bunny.net/statistics?')) return res(200, { TotalBandwidthUsed: 2 * 1024 ** 3 });
  }
  throw new Error(`Llamada inesperada: ${u}`);
};

const post = async (token, body = { action: 'bunny-usage' }) => {
  const r = await api.POST(new Request('https://fansreserve.com/api/usage', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};
const setEnv = (library, account) => {
  for (const k of ['BUNNY_STREAM_LIBRARY_ID', 'BUNNY_STREAM_API_KEY', 'BUNNY_ACCOUNT_API_KEY']) delete process.env[k];
  if (library) Object.assign(process.env, { BUNNY_STREAM_LIBRARY_ID: '777', BUNNY_STREAM_API_KEY: 'library-key' });
  if (account) process.env.BUNNY_ACCOUNT_API_KEY = 'account-key';
};

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`✓ ${name}`);
};
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) {
    super(...(a.length ? a : ['2026-11-12T03:40:00Z']));
  }
  static now() {
    return new RealDate('2026-11-12T03:40:00Z').getTime();
  }
};

// 1. Only admins.
setEnv(true, true);
assert.equal((await post(undefined)).status, 403);
assert.equal((await post('fan-token')).status, 403);
assert.equal((await post('expired-token')).status, 403);
assert.ok(!calls.some((c) => c.u.includes('bunny')), 'sin admin no se le pregunta nada a Bunny');
ok('Solo un administrador puede ver el consumo de Bunny');

// 2. Library + account keys: every number.
let out = await post('admin-token');
assert.equal(out.status, 200);
assert.deepEqual(
  { ...out.body, measuredAt: undefined },
  { enabled: true, account: true, videos: 2, storageBytes: 8 * 1024 ** 2, viewsMonth: 10, watchMinutesMonth: 15, bandwidthBytesMonth: 2 * 1024 ** 3, chargesMonth: 0.42, balance: 9.5, measuredAt: undefined },
);
assert.ok(!/library-key|account-key/.test(JSON.stringify(out.body)), 'las llaves no salen del servidor');
ok('Con las dos llaves: videos, espacio, vistas, minutos, descarga, cobro y saldo');

// 3. Without the account key: library numbers only, no call to the account API.
setEnv(true, false);
calls.length = 0;
out = await post('admin-token');
assert.equal(out.body.account, false);
assert.equal(out.body.videos, 2);
assert.equal(out.body.balance, null);
assert.ok(!calls.some((c) => c.u.startsWith('https://api.bunny.net/')));
ok('Sin la llave de la cuenta muestra lo de la biblioteca y pide la llave');

// 4. Account API down: the rest still shows.
setEnv(true, true);
accountDown = true;
out = await post('admin-token');
assert.equal(out.status, 200);
assert.equal(out.body.videos, 2);
assert.equal(out.body.balance, null);
assert.equal(out.body.bandwidthBytesMonth, null);
accountDown = false;
ok('Si la cuenta de Bunny no responde, lo demás se sigue viendo');

// 5. Bunny not set up.
setEnv(false, false);
calls.length = 0;
out = await post('admin-token');
assert.equal(out.body.enabled, false);
assert.ok(!calls.some((c) => c.u.includes('bunny')));
ok('Sin Bunny configurado avisa que los videos salen de Supabase');

// 6. Unknown action and health check.
assert.equal((await post('admin-token', { action: 'otra' })).status, 400);
const health = await (await api.GET(new Request('https://fansreserve.com/api/usage'))).json();
assert.equal(health.checks.bunnyAccount, 'FALTA');
ok('Acción desconocida rechazada; el diagnóstico muestra la llave de la cuenta OK/FALTA');

globalThis.Date = RealDate;
console.log(`\n${passed} comprobaciones del consumo de Bunny`);
