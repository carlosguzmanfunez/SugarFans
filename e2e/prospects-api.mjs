// Tests api/prospects.ts with Meta and Supabase replaced by fakes (no network):
// only an admin can ask, at most 25 usernames, personal accounts are reported as
// such, the numbers come from the official answer, and an expired token or the
// hourly limit stops the run with a clear message and what was already read.
// Run: node e2e/prospects-api.mjs
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'prospects-api-'));
await build({ entryPoints: ['api/prospects.ts'], outfile: join(dir, 'prospects.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const api = await import(pathToFileURL(join(dir, 'prospects.mjs')).href);

const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const days = (n) => new Date(Date.now() - n * 86400000).toISOString().replace('Z', '+0000');
let graphCalls = 0;
let graphError = null;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const h = init.headers ?? {};
  if (u.endsWith('/rest/v1/rpc/is_admin')) return h.authorization === 'Bearer admin' ? res(200, true) : h.authorization === 'Bearer fan' ? res(200, false) : res(401, {});
  if (u.startsWith('https://graph.facebook.com/v26.0/17841400000')) {
    graphCalls++;
    assert.match(u, /access_token=tok/);
    if (graphError) return res(400, { error: graphError });
    const handle = decodeURIComponent(u).match(/username\(([^)]+)\)/)[1];
    if (handle === 'personal') return res(400, { error: { code: 110, message: 'Invalid user id' } });
    return res(200, {
      business_discovery: {
        username: handle, name: 'Ana Fit', biography: 'Rutinas 💪 Contacto: Ana@Correo.com', website: 'https://ana.fit',
        followers_count: 20000, media_count: 300,
        media: { data: [
          { timestamp: days(2), like_count: 900, comments_count: 100 },
          { timestamp: days(9), like_count: 700, comments_count: 100 },
          { timestamp: days(20) }, // likes hidden: not counted
        ] },
      },
    });
  }
  throw Error('Red no esperada: ' + u);
};

const post = (auth, body) => api.POST(new Request('https://fansreserve.com/api/prospects', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body),
}));
let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`); };

await ok('Sin claves, dice FALTA y no consulta a Meta', async () => {
  delete process.env.INSTAGRAM_BUSINESS_ID; delete process.env.INSTAGRAM_ACCESS_TOKEN;
  const health = await (await api.GET()).json();
  assert.equal(health.checks.instagram, 'FALTA');
  assert.equal((await post('admin', { handles: ['ana'] })).status, 503);
  assert.equal(graphCalls, 0);
});

process.env.INSTAGRAM_BUSINESS_ID = ' "17841400000" ';
process.env.INSTAGRAM_ACCESS_TOKEN = 'tok\n';

await ok('Con claves, dice OK sin mostrarlas', async () => {
  const text = await (await api.GET()).text();
  assert.match(text, /"instagram":"OK"/);
  assert.doesNotMatch(text, /tok|17841400000/);
});

await ok('Solo un admin con sesión puede consultar', async () => {
  assert.equal((await post(null, { handles: ['ana'] })).status, 401);
  assert.equal((await post('fan', { handles: ['ana'] })).status, 403);
  assert.equal((await post('expired', { handles: ['ana'] })).status, 401);
  assert.equal(graphCalls, 0);
});

await ok('Máximo 25 usuarios por consulta', async () => {
  assert.equal((await post('admin', { handles: Array.from({ length: 26 }, (_, i) => `u${i}`) })).status, 400);
  assert.equal((await post('admin', { handles: [] })).status, 400);
});

await ok('Devuelve los números públicos y el correo de la bio', async () => {
  const r = await post('admin', { handles: ['@Ana.Fit', 'ana.fit', 'personal', 'no valido'] });
  assert.equal(r.status, 200);
  const { results } = await r.json();
  assert.equal(results.length, 3, 'repetidos se consultan una vez');
  const ana = results.find((x) => x.handle === 'ana.fit');
  assert.equal(ana.ok, true);
  assert.equal(ana.data.followers, 20000);
  assert.equal(ana.data.engagement, 4.5); // (1000 + 800) / 2 / 20000
  assert.equal(ana.data.email, 'ana@correo.com');
  assert.equal(ana.data.display_name, 'Ana Fit');
  assert.ok(ana.data.last_post_at);
  assert.match(results.find((x) => x.handle === 'personal').note, /personal/);
  assert.match(results.find((x) => x.handle === 'no valido').note, /válido/);
});

await ok('Token vencido o límite por hora: para y explica qué hacer', async () => {
  graphError = { code: 190, message: 'expired' };
  let r = await post('admin', { handles: ['ana'] });
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /venció/);
  graphError = { code: 4, message: 'limit' };
  r = await post('admin', { handles: ['ana', 'luis'] });
  assert.match((await r.json()).error, /límite/);
  graphError = null;
});

console.log(`\n${passed}/6 comprobaciones de la API de Instagram`);
