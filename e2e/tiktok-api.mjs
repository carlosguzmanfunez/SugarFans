// "Conecta tu TikTok" (api/tiktok.ts) with TikTok and Supabase replaced by fakes
// (no network): without keys it says FALTA; only a signed-in user can start; the
// state is signed, expires and is tied to the browser's cookie; cancelling or a
// forged state saves nothing; a good return saves the public numbers for that
// user, asks only for the fields they agreed to share and revokes the token.
// Run: node e2e/tiktok-api.mjs
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'tiktok-api-'));
await build({ entryPoints: ['api/tiktok.ts'], outfile: join(dir, 'tiktok.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const api = await import(pathToFileURL(join(dir, 'tiktok.mjs')).href);

const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const calls = [];
let scope = 'user.info.basic,user.info.profile,user.info.stats';
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const h = init.headers ?? {};
  calls.push({ u, body: init.body ? String(init.body) : '' });
  if (u.endsWith('/auth/v1/user')) return h.authorization === 'Bearer ana' ? res(200, { id: 'user-ana' }) : res(401, {});
  if (u === 'https://open.tiktokapis.com/v2/oauth/token/') {
    const b = new URLSearchParams(String(init.body));
    assert.equal(b.get('client_secret'), 'secreto');
    assert.equal(b.get('redirect_uri'), 'https://fansreserve.com/api/tiktok');
    return b.get('code') === 'bueno' ? res(200, { access_token: 'act', open_id: 'open-1', scope }) : res(400, { error: 'invalid_grant' });
  }
  if (u.startsWith('https://open.tiktokapis.com/v2/user/info/')) {
    assert.equal(h.authorization, 'Bearer act');
    return res(200, { data: { user: { open_id: 'open-1', username: 'ana.fit', display_name: 'Ana', avatar_url: 'https://p16/a.jpg', is_verified: false, follower_count: 25300, likes_count: 120000, video_count: 85 } }, error: { code: 'ok' } });
  }
  if (u === 'https://open.tiktokapis.com/v2/oauth/revoke/') return new Response('', { status: 200 });
  if (u.endsWith('/rest/v1/rpc/social_connection_save')) return res(200, true);
  throw new Error(`Llamada inesperada: ${u}`);
};

const SITE = 'https://fansreserve.com';
const start = (auth, back = '/settings') =>
  api.POST(new Request(`${SITE}/api/tiktok`, { method: 'POST', headers: auth ? { authorization: `Bearer ${auth}`, 'content-type': 'application/json' } : {}, body: JSON.stringify({ action: 'start', back }) }));
const ret = (query, cookie) => api.GET(new Request(`${SITE}/api/tiktok?${query}`, { headers: cookie ? { cookie } : {} }));
const saved = () => calls.filter((c) => c.u.endsWith('social_connection_save'));
let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`); };

await ok('Sin claves dice FALTA y no deja empezar', async () => {
  const health = await (await api.GET(new Request(`${SITE}/api/tiktok`))).json();
  assert.deepEqual(health, { enabled: false, checks: { clientKey: 'FALTA', clientSecret: 'FALTA', serviceRoleKey: 'FALTA' } });
  assert.equal((await start('ana')).status, 503);
});

process.env.TIKTOK_CLIENT_KEY = ' "llave" ';
process.env.TIKTOK_CLIENT_SECRET = 'secreto';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_x';

let state, cookie;
await ok('Con sesión devuelve la dirección de TikTok con permisos, redirect y estado firmado; sin sesión no', async () => {
  assert.equal((await start()).status, 401);
  assert.equal((await start('otro')).status, 401);
  const r = await start('ana', '//malo.com');
  const { url } = await r.json();
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://www.tiktok.com/v2/auth/authorize/');
  assert.equal(u.searchParams.get('client_key'), 'llave');
  assert.equal(u.searchParams.get('scope'), 'user.info.basic,user.info.profile,user.info.stats');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://fansreserve.com/api/tiktok');
  state = u.searchParams.get('state');
  assert.match(state, /^[\w-]+\.[\w-]+$/);
  cookie = r.headers.get('set-cookie').split(';')[0];
  assert.match(r.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.doesNotMatch(url, /secreto/);
});

await ok('Un estado falso, vencido o de otro navegador no guarda nada', async () => {
  const [body, mac] = state.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), u: 'user-x' })).toString('base64url');
  let r = await ret(`code=bueno&state=${forged}.${mac}`, cookie);
  assert.equal(r.headers.get('location'), `${SITE}/settings?tiktok=vencido`);
  r = await ret(`code=bueno&state=${state}`);
  assert.equal(r.headers.get('location'), `${SITE}/settings?tiktok=vencido`, 'sin cookie');
  r = await ret(`code=bueno&state=${state}`, 'fr_tiktok=otra');
  assert.equal(r.headers.get('location'), `${SITE}/settings?tiktok=vencido`, 'cookie de otro');
  assert.equal(saved().length, 0);
});

await ok('Si cancela en TikTok vuelve con "cancelado"', async () => {
  const r = await ret(`error=access_denied&state=${state}`, cookie);
  assert.equal(r.headers.get('location'), `${SITE}/settings?tiktok=cancelado`);
  assert.equal(saved().length, 0);
});

await ok('Al volver bien guarda sus números para ese usuario, revoca el token y regresa con ok', async () => {
  const r = await ret(`code=bueno&scopes=user.info.basic&state=${state}`, cookie);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), `${SITE}/settings?tiktok=ok`);
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  const body = JSON.parse(saved()[0].body);
  assert.deepEqual([body.p_user, body.p_external_id, body.p_username, body.p_followers, body.p_likes, body.p_videos], ['user-ana', 'open-1', 'ana.fit', 25300, 120000, 85]);
  assert.match(calls.find((c) => c.u.includes('/user/info/')).u, /fields=open_id,display_name,avatar_url,username,is_verified,follower_count,likes_count,video_count$/);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(calls.some((c) => c.u.endsWith('/oauth/revoke/') && /token=act/.test(c.body)), 'no revocó');
});

await ok('Si solo comparte lo básico, no pide seguidores; un código malo vuelve con error', async () => {
  scope = 'user.info.basic';
  calls.length = 0;
  await ret(`code=bueno&state=${state}`, cookie);
  assert.match(calls.find((c) => c.u.includes('/user/info/')).u, /fields=open_id,display_name,avatar_url$/);
  const r = await ret(`code=malo&state=${state}`, cookie);
  assert.equal(r.headers.get('location'), `${SITE}/settings?tiktok=error`);
});

console.log(`\n${passed}/6 comprobaciones de Conecta tu TikTok`);
