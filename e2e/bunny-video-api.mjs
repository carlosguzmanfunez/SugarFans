// Tests the Bunny Stream video copy (api/_bunny.ts through api/moderate.ts) with
// Supabase and Bunny replaced by fakes (no network, no real keys):
//   - without the Bunny settings nothing changes (Supabase links as before)
//   - only videos Storage signs for THIS viewer get a Bunny link, with a valid token
//   - a video is copied once, only if approved, and streamed Supabase → Bunny
//   - finished conversion turns into a link; deleting removes the copy (owner only)
// Run: node e2e/bunny-video-api.mjs
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

// Read when the module loads.
Object.assign(process.env, { SUPABASE_URL: 'https://db.example.invalid', SUPABASE_ANON_KEY: 'public-anon' });
const dir = mkdtempSync(join(tmpdir(), 'bunny-api-'));
await build({ entryPoints: ['api/moderate.ts'], outfile: join(dir, 'moderate.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const api = await import(pathToFileURL(join(dir, 'moderate.mjs')).href);

const USER = '11111111-2222-3333-4444-555555555555';
const FAN = '22222222-2222-3333-4444-555555555555';
const MINE = `${USER}/clip.mp4`;
const LOCKED = `${USER}/exclusivo.mp4`;
const PENDING = `${USER}/nuevo.mp4`;
const res = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const cdn = new Map(); // path → row
const moderation = new Map([[MINE, { status: 'approved', media_type: 'video' }], [LOCKED, { status: 'approved', media_type: 'video' }], [PENDING, { status: 'pending', media_type: 'video' }]]);
const bunnyVideos = new Map(); // guid → {status, width, height, bytes}
const log = [];
let guidN = 0;

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const h = init.headers ?? {};
  const method = init.method ?? 'GET';
  if (u.endsWith('/auth/v1/user')) {
    if (h.authorization === 'Bearer creator-token') return res(200, { id: USER });
    if (h.authorization === 'Bearer fan-token') return res(200, { id: FAN });
    return res(401, {});
  }
  // Batch signing with the VIEWER's session: the creator sees all; a fan only free videos; a visitor too.
  if (u.endsWith('/storage/v1/object/sign/post-media') && method === 'POST') {
    const { paths } = JSON.parse(init.body);
    const who = h.authorization === 'Bearer creator-token' ? 'creator' : h.authorization === 'Bearer fan-token' ? 'fan' : h.apikey === 'public-anon' ? 'anon' : 'none';
    log.push(`sign-as-${who}`);
    return res(200, paths.map((p) => (who === 'creator' || ((who === 'fan' || who === 'anon') && p !== LOCKED) ? { path: p, signedURL: `/object/sign/post-media/${p}?token=v` } : { path: p, error: 'Object not found', signedURL: null })));
  }
  // Server signing (service role) to stream the file to Bunny.
  if (u.includes('/storage/v1/object/sign/post-media/') && method === 'POST') {
    assert.equal(h.apikey, 'sb_secret_test');
    return res(200, { signedURL: `/object/sign/post-media/${decodeURIComponent(u.split('/post-media/')[1])}?token=srv` });
  }
  if (u.includes('/storage/v1/object/sign/post-media/') && method === 'GET') {
    return new Response(new Uint8Array(1234), { status: 200, headers: { 'content-length': '1234' } });
  }
  if (u.includes('/rest/v1/media_moderation')) {
    const path = decodeURIComponent(u.match(/path=eq\.([^&]+)/)[1]);
    return res(200, moderation.has(path) ? [moderation.get(path)] : []);
  }
  if (u.includes('/rest/v1/media_cdn')) {
    assert.equal(h.apikey, 'sb_secret_test', 'media_cdn solo con la clave del servidor');
    if (method === 'GET') {
      const list = decodeURIComponent(u.match(/path=in\.([^&]+)/)[1]).slice(1, -1).split(',').map((s) => s.replace(/"/g, ''));
      return res(200, list.filter((p) => cdn.has(p)).map((p) => cdn.get(p)));
    }
    if (method === 'POST') {
      const row = JSON.parse(init.body);
      if (cdn.has(row.path)) return res(201, []);
      const full = { video_id: null, width: null, height: null, updated_at: new Date().toISOString(), ...row };
      cdn.set(row.path, full);
      return res(201, [full]);
    }
    const path = decodeURIComponent(u.match(/path=eq\.([^&]+)/)[1]);
    if (method === 'DELETE') {
      cdn.delete(path);
      return res(204);
    }
    const r = cdn.get(path);
    const since = u.match(/updated_at=eq\.([^&]+)/);
    if (!r || (since && decodeURIComponent(since[1]) !== r.updated_at)) return res(200, []);
    Object.assign(r, JSON.parse(init.body));
    return res(200, [r]);
  }
  if (u.startsWith('https://video.bunnycdn.com/library/777/')) {
    assert.equal(h.AccessKey, 'bunny-api-key');
    const rest = u.slice('https://video.bunnycdn.com/library/777'.length);
    if (rest === '/videos' && method === 'POST') {
      const guid = `guid-${++guidN}`;
      bunnyVideos.set(guid, { status: 0 });
      log.push(`bunny-create ${JSON.parse(init.body).title}`);
      return res(200, { guid });
    }
    const id = decodeURIComponent(rest.replace('/videos/', ''));
    if (method === 'PUT') {
      let bytes = 0;
      for await (const chunk of init.body) bytes += chunk.length;
      Object.assign(bunnyVideos.get(id), { status: 1, bytes });
      log.push(`bunny-put ${id} ${bytes}`);
      return res(200, { success: true });
    }
    if (method === 'DELETE') {
      bunnyVideos.delete(id);
      log.push(`bunny-delete ${id}`);
      return res(200, { success: true });
    }
    return res(200, { guid: id, ...bunnyVideos.get(id) });
  }
  return res(500, { error: `unexpected ${method} ${u}` });
};

const post = (body, token) =>
  api.POST(new Request('https://fansreserve.com/api/moderate', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }));
const access = async (paths, token) => (await post({ action: 'video-access', paths }, token)).json();

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`✓ ${name}`);
};
const setEnv = (on) => {
  for (const k of ['BUNNY_STREAM_LIBRARY_ID', 'BUNNY_STREAM_API_KEY', 'BUNNY_STREAM_TOKEN_KEY']) delete process.env[k];
  Object.assign(process.env, { SUPABASE_URL: 'https://db.example.invalid', SUPABASE_ANON_KEY: 'public-anon', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test' });
  if (on) Object.assign(process.env, { BUNNY_STREAM_LIBRARY_ID: '777', BUNNY_STREAM_API_KEY: 'bunny-api-key', BUNNY_STREAM_TOKEN_KEY: 'token-key' });
};

// 1. Not set up: everything stays on Supabase, no call to Bunny.
setEnv(false);
let out = await access([MINE], 'creator-token');
assert.equal(out.enabled, false);
assert.deepEqual(out.urls, {});
let health = await (await api.GET()).json();
assert.equal(health.video.enabled, false);
assert.equal(health.video.apiKey, 'FALTA');
assert.ok(!log.some((l) => l.startsWith('bunny')));
ok('Sin claves de Bunny todo sigue como hoy');

setEnv(true);
health = await (await api.GET()).json();
assert.equal(health.video.enabled, true);
assert.ok(!JSON.stringify(health).includes('bunny-api-key') && !JSON.stringify(health).includes('token-key'));
ok('El diagnóstico dice OK sin mostrar claves');

// 2. Nothing copied yet: no link, the video is "pending" to be copied.
out = await access([MINE, 'malo.exe', '../x.mp4'], 'creator-token');
assert.deepEqual(out.urls, {});
assert.deepEqual(out.pending, [MINE]);
ok('Video sin copia: sigue en Supabase y se pide la copia (rutas raras ignoradas)');

// 3. A video waiting for moderation is never copied.
let r = await (await post({ action: 'video-ingest', path: PENDING }, 'creator-token')).json();
assert.equal(r.status, 'waiting');
assert.ok(!cdn.has(PENDING));
ok('Un video sin aprobar no se copia a Bunny');

// 4. A fan can't trigger a copy of a locked video they can't see.
r = await post({ action: 'video-ingest', path: LOCKED }, 'fan-token');
assert.equal(r.status, 404);
assert.ok(!cdn.has(LOCKED));
ok('Un fan sin acceso no puede pedir la copia de un video exclusivo');

// 5. Copy: created once, file streamed from Supabase to Bunny.
r = await (await post({ action: 'video-ingest', path: MINE }, 'creator-token')).json();
assert.equal(r.status, 'encoding');
const row = cdn.get(MINE);
assert.equal(row.status, 'encoding');
assert.ok(row.video_id);
assert.equal(bunnyVideos.get(row.video_id).bytes, 1234);
const again = await (await post({ action: 'video-ingest', path: MINE }, 'fan-token')).json();
assert.equal(again.status, 'encoding');
assert.equal(log.filter((l) => l.startsWith('bunny-create')).length, 1);
ok('El video se copia una sola vez, directo de Supabase a Bunny');

// 6. Still converting: no link yet. Finished: link with Bunny's token formula.
out = await access([MINE], 'fan-token');
assert.deepEqual(out.urls, {});
assert.deepEqual(out.pending, []);
bunnyVideos.get(row.video_id).status = 4;
Object.assign(bunnyVideos.get(row.video_id), { width: 1080, height: 1920 });
row.updated_at = new Date(Date.now() - 60_000).toISOString();
out = await access([MINE], 'fan-token');
const link = out.urls[MINE];
assert.ok(link, 'debía dar enlace de Bunny');
const u = new URL(link.split('#')[0]);
assert.equal(u.origin + u.pathname, `https://player.mediadelivery.net/embed/777/${row.video_id}`);
const expires = Number(u.searchParams.get('expires'));
assert.ok(expires > Date.now() / 1000 + 3000 && expires <= Date.now() / 1000 + 3600 + 5);
assert.equal(u.searchParams.get('token'), createHash('sha256').update(`token-key${row.video_id}${expires}`).digest('hex'));
const frag = new URLSearchParams(link.split('#')[1]);
assert.equal(frag.get('r'), '1080x1920');
const thumb = new URL(frag.get('p'));
assert.equal(thumb.origin + thumb.pathname, `https://vz-e42e9f31-307.b-cdn.net/${row.video_id}/thumbnail.jpg`);
const tExp = thumb.searchParams.get('expires');
const tTok = createHash('sha256').update(`token-key/${row.video_id}/thumbnail.jpg${tExp}`).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
assert.equal(thumb.searchParams.get('token'), tTok);
assert.equal(cdn.get(MINE).status, 'ready');
ok('Al terminar de convertirse da un enlace firmado que vence en 1 hora, con su miniatura firmada');

// 7. Visitors without a session get links for free videos (Storage decides, as anon).
out = await access([MINE], undefined);
assert.ok(out.urls[MINE]);
assert.ok(log.includes('sign-as-anon'));
ok('Un visitante sin sesión ve los videos libres (lo decide Storage)');

// 8. A locked video copied by its creator: a fan without subscription gets no link.
cdn.set(LOCKED, { path: LOCKED, video_id: 'guid-locked', status: 'ready', width: 1920, height: 1080, attempts: 1, updated_at: new Date().toISOString() });
out = await access([LOCKED, MINE], 'fan-token');
assert.ok(!out.urls[LOCKED]);
assert.ok(out.urls[MINE]);
out = await access([LOCKED], 'creator-token');
assert.ok(out.urls[LOCKED]);
ok('Un video exclusivo no da enlace a quien no está suscrito');

// 9. Delete: only the owner; it removes the Bunny copy and the row.
r = await post({ action: 'video-forget', path: MINE }, 'fan-token');
assert.equal(r.status, 403);
assert.ok(cdn.has(MINE));
r = await (await post({ action: 'video-forget', path: MINE }, 'creator-token')).json();
assert.equal(r.status, 'deleted');
assert.ok(!cdn.has(MINE));
assert.ok(log.includes(`bunny-delete ${row.video_id}`));
r = await post({ action: 'video-forget', path: MINE });
assert.equal(r.status, 401);
ok('Al borrar el video se borra su copia (solo su dueño)');

// 10. Moderation keeps working exactly as before (no action field).
r = await post({ bucket: 'post-media', path: `${USER}/foto.jpg` });
assert.equal(r.status, 401);
ok('La moderación normal no cambió');

console.log(`\n${passed} comprobaciones de videos por Bunny Stream`);
