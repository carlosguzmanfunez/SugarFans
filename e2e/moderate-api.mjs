// Tests api/moderate.ts with Sightengine and Supabase replaced by fakes (no network):
// only the uploader can ask for a scan, explicit content is blocked, doubtful content
// goes to an admin, a clean profile photo goes on the profile, and nothing is
// published when the service is missing or fails.
// Run: node e2e/moderate-api.mjs
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'moderate-api-'));
await build({ entryPoints: ['api/moderate.ts'], outfile: join(dir, 'moderate.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const api = await import(pathToFileURL(join(dir, 'moderate.mjs')).href);

const USER = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-2222-3333-4444-555555555555';
const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const clean = { sexual_activity: 0.01, sexual_display: 0.01, erotica: 0.01, very_suggestive: 0.02, suggestive: 0.05, none: 0.95 };
const explicit = { ...clean, sexual_display: 0.97, erotica: 0.98, none: 0.01 };
const doubtful = { ...clean, erotica: 0.6, none: 0.3 };

const rows = new Map();
const patches = [];
const profilePatches = [];
let sightengine = { kind: 'ok', nudity: clean };
let sightCalls = 0;

const row = (path, extra = {}) =>
  rows.set(path, { bucket: 'post-media', path, owner_id: USER, kind: 'post', media_type: 'image', status: 'pending', reason: '', public_url: '', ...extra });

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const h = init.headers ?? {};
  if (u.endsWith('/auth/v1/user')) return h.authorization === 'Bearer user-token' ? res(200, { id: USER }) : res(401, { msg: 'bad jwt' });
  if (u.includes('/rest/v1/media_moderation')) {
    if (h.apikey !== 'sb_secret_test') return res(401, {});
    const path = decodeURIComponent(u.match(/path=eq\.([^&]+)/)[1]);
    if ((init.method ?? 'GET') === 'GET') return res(200, rows.has(path) ? [rows.get(path)] : []);
    const body = JSON.parse(init.body);
    patches.push({ path, body });
    const r = rows.get(path);
    if (r && r.status === 'pending') Object.assign(r, body);
    return new Response(null, { status: 204 });
  }
  if (u.includes('/rest/v1/profiles')) {
    profilePatches.push({ u, body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  }
  if (u.includes('/storage/v1/object/sign/post-media/')) return res(200, { signedURL: '/object/sign/post-media/x?token=t' });
  if (u.startsWith('https://api.sightengine.com/1.0/')) {
    sightCalls++;
    const params = u.includes('?') ? new URL(u).searchParams : new URLSearchParams(String(init.body));
    if (params.get('api_secret') !== 'se-secret') return res(401, { status: 'failure', error: { message: 'bad key' } });
    if (sightengine.kind === 'down') return res(500, { status: 'failure', error: { message: 'internal' } });
    if (sightengine.kind === 'long') return res(400, { status: 'failure', error: { message: 'Video duration should be less than 60 seconds' } });
    if (u.includes('/video/check-sync.json'))
      return res(200, { status: 'success', data: { frames: sightengine.frames.map((n, i) => ({ info: { position: i * 1000 }, nudity: n })) } });
    return res(200, { status: 'success', nudity: sightengine.nudity });
  }
  return res(500, { error: `unexpected ${u}` });
};

const ask = (path, token = 'user-token', bucket = 'post-media') =>
  api.POST(new Request('https://fansreserve.com/api/moderate', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ bucket, path }) }));
const statusOf = async (r) => (await r.json()).status;

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`✓ ${name}`);
};

// Not set up: disabled; files stay pending and nothing is sent anywhere.
let r = await api.GET();
assert.equal((await r.json()).enabled, false);
row(`${USER}/a.jpg`);
assert.equal(await statusOf(await ask(`${USER}/a.jpg`)), 'pending');
assert.equal(sightCalls, 0);
ok('Sin claves: el archivo queda pendiente para un admin');

process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
assert.equal(await statusOf(await ask(`${USER}/a.jpg`)), 'pending');
assert.equal(sightCalls, 0);
process.env.SIGHTENGINE_API_USER = 'se-user';
process.env.SIGHTENGINE_API_SECRET = 'se-secret';
r = await api.GET();
const cfg = await r.json();
assert.equal(cfg.enabled, true);
assert.ok(!JSON.stringify(cfg).includes('se-secret'));
ok('GET dice si está configurado sin revelar secretos');

r = await ask(`${USER}/a.jpg`, 'bad-token');
assert.equal(r.status, 401);
row(`${OTHER}/b.jpg`, { owner_id: OTHER });
r = await ask(`${OTHER}/b.jpg`);
assert.equal(r.status, 404);
assert.equal(rows.get(`${OTHER}/b.jpg`).status, 'pending');
ok('Solo quien subió el archivo puede pedir el escaneo');

sightengine = { kind: 'ok', nudity: clean };
assert.equal(await statusOf(await ask(`${USER}/a.jpg`)), 'approved');
assert.equal(rows.get(`${USER}/a.jpg`).provider, 'sightengine');
ok('Foto normal: aprobada');

row(`${USER}/c.jpg`);
sightengine = { kind: 'ok', nudity: explicit };
assert.equal(await statusOf(await ask(`${USER}/c.jpg`)), 'rejected');
ok('Desnudez explícita: bloqueada');

row(`${USER}/d.jpg`);
sightengine = { kind: 'ok', nudity: doubtful };
assert.equal(await statusOf(await ask(`${USER}/d.jpg`)), 'review');
ok('Dudosa: a revisión de un admin');

const calls = sightCalls;
assert.equal(await statusOf(await ask(`${USER}/c.jpg`)), 'rejected');
assert.equal(sightCalls, calls);
ok('Un archivo ya decidido no se vuelve a escanear');

row(`${USER}/v.mp4`, { media_type: 'video' });
sightengine = { kind: 'ok', frames: [clean, clean, explicit, clean] };
assert.equal(await statusOf(await ask(`${USER}/v.mp4`)), 'rejected');
row(`${USER}/w.mp4`, { media_type: 'video' });
sightengine = { kind: 'ok', frames: [clean, clean] };
assert.equal(await statusOf(await ask(`${USER}/w.mp4`)), 'approved');
ok('Video: cuenta el peor fotograma');

row(`${USER}/long.mp4`, { media_type: 'video' });
sightengine = { kind: 'long' };
assert.equal(await statusOf(await ask(`${USER}/long.mp4`)), 'review');
ok('Video de más de un minuto: revisión manual');

row(`${USER}/e.jpg`);
sightengine = { kind: 'down' };
assert.equal(await statusOf(await ask(`${USER}/e.jpg`)), 'pending');
assert.match(rows.get(`${USER}/e.jpg`).reason, /falló/);
ok('Si el servicio falla, no se publica: queda pendiente');

const avatarUrl = `https://x.supabase.co/storage/v1/object/public/profile-images/${USER}/avatar-1.jpg`;
row(`${USER}/avatar-1.jpg`, { bucket: 'profile-images', kind: 'avatar', public_url: avatarUrl });
sightengine = { kind: 'ok', nudity: clean };
assert.equal(await statusOf(await ask(`${USER}/avatar-1.jpg`, 'user-token', 'profile-images')), 'approved');
assert.deepEqual(profilePatches.at(-1).body, { avatar: avatarUrl });
row(`${USER}/cover-1.jpg`, { bucket: 'profile-images', kind: 'cover', public_url: avatarUrl.replace('avatar', 'cover') });
sightengine = { kind: 'ok', nudity: explicit };
const before = profilePatches.length;
assert.equal(await statusOf(await ask(`${USER}/cover-1.jpg`, 'user-token', 'profile-images')), 'rejected');
assert.equal(profilePatches.length, before);
ok('Foto de perfil aprobada: sale en el perfil; bloqueada: no');

r = await api.POST(new Request('https://fansreserve.com/api/moderate', { method: 'POST', headers: { authorization: 'Bearer user-token' }, body: JSON.stringify({ bucket: 'otro', path: 'x' }) }));
assert.equal(r.status, 400);
ok('Rechaza peticiones raras');

console.log(`\n${passed} comprobaciones de la moderación automática`);
