// Search engines and AI search: the dynamic sitemap (api/_sitemap.ts via api/usage.ts, Supabase
// replaced by a fake), llms.txt, and the per-page title/description hook on every
// public page. Run: node e2e/seo.mjs
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'seo-'));
await build({ entryPoints: ['api/usage.ts'], outfile: join(dir, 'usage.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const api = await import(pathToFileURL(join(dir, 'usage.mjs')).href);

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`✓ ${name}`);
};

const rows = [
  { id: 'abc-123', is_verified: true, created_at: '2026-11-01T10:00:00Z' },
  { id: 'sin-verificar', is_verified: false, created_at: '2026-11-01T10:00:00Z' },
  { id: 'abc-123', is_verified: true, created_at: '2026-11-01T10:00:00Z' },
  { id: 'a&b', is_verified: true },
];
const usernames = [{ id: 'con-usuario', username: 'valen_rose' }, { id: 'sin-verificar', username: 'oculta' }, { id: 'raro', username: 'no válido' }];
rows.push({ id: 'con-usuario', is_verified: true }, { id: 'raro', is_verified: true });
let calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  const body = String(url).endsWith('/creator_usernames') ? usernames : rows;
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

await check('El sitemap lista las páginas públicas y solo creadores verificados, sin repetir', async () => {
  const r = await api.GET(new Request('https://fansreserve.com/api/usage?sitemap=1'));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/xml/);
  const xml = await r.text();
  for (const p of ['/', '/explore', '/reserve', '/recorrido', '/help', '/legal']) assert.ok(xml.includes(`<loc>https://fansreserve.com${p}</loc>`), p);
  assert.equal(xml.split('/creator/abc-123<').length - 1, 1);
  assert.ok(!xml.includes('sin-verificar'));
  assert.ok(xml.includes('<lastmod>2026-11-01</lastmod>'));
  assert.ok(xml.includes('/creator/a%26b<'), 'id escapado');
  assert.ok(calls.some((c) => c.url.endsWith('/rest/v1/rpc/public_creators')));
});

await check('El perfil con @usuario va en el sitemap como fansreserve.com/@usuario (el nombre en la URL)', async () => {
  const xml = await (await api.GET(new Request('https://fansreserve.com/api/usage?sitemap=1'))).text();
  assert.ok(xml.includes('<loc>https://fansreserve.com/@valen_rose</loc>'));
  assert.ok(!xml.includes('/creator/con-usuario'), 'sin la dirección vieja repetida');
  assert.ok(!xml.includes('oculta'), 'sin verificar no entra aunque tenga @usuario');
  assert.ok(xml.includes('/creator/raro<'), 'un @usuario inválido se queda con /creator/<id>');
});

await check('Si Supabase falla, el sitemap sigue con las páginas públicas', async () => {
  globalThis.fetch = async () => {
    throw new Error('sin red');
  };
  const xml = await (await api.GET(new Request('https://fansreserve.com/api/usage?sitemap=1'))).text();
  assert.ok(xml.includes('<loc>https://fansreserve.com/explore</loc>'));
  assert.ok(!xml.includes('/creator/'));
});

await check('No pasa de 12 funciones (límite del plan Hobby de Vercel)', async () => {
  const fns = readdirSync('api').filter((f) => /\.(ts|js|mjs)$/.test(f) && !f.startsWith('_'));
  assert.ok(fns.length <= 12, `funciones: ${fns.length}`);
});

await check('vercel.json manda /sitemap.xml a la función antes del catch-all', async () => {
  const { rewrites } = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const i = rewrites.findIndex((r) => r.source === '/sitemap.xml' && r.destination === '/api/usage?sitemap=1');
  const spa = rewrites.findIndex((r) => r.destination === '/index.html');
  assert.ok(i >= 0 && i < spa);
  assert.ok(!existsSync('public/sitemap.xml'), 'un sitemap estático taparía la función');
  assert.match(readFileSync('public/robots.txt', 'utf8'), /Sitemap: https:\/\/fansreserve.com\/sitemap.xml/);
});

await check('llms.txt existe, describe la marca y no suena a contenido adulto', async () => {
  const txt = readFileSync('public/llms.txt', 'utf8');
  assert.ok(txt.startsWith('# Fans Reserve\n'));
  assert.match(txt, /Reserva experiencias, no personas/);
  assert.ok(!/onlyfans|sexy|er[oó]tic|xxx|para adultos|contenido adulto|escort/i.test(txt));
});

await check('Cada página pública pone su propio título y descripción', async () => {
  const pages = { Explore: 'explore', VIPExperiences: 'reserve', SalesTour: 'tour', Help: 'help', LegalPolicies: 'legal' };
  for (const [file, key] of Object.entries(pages)) {
    assert.match(readFileSync(`src/pages/${file}.tsx`, 'utf8'), new RegExp(`useSeoPage\\('${key}'`), file);
  }
  assert.match(readFileSync('src/pages/CreatorProfile.tsx', 'utf8'), /usePageMeta\(/);
  const lang = readFileSync('src/context/LanguageContext.tsx', 'utf8');
  for (const key of [...Object.values(pages).flatMap((k) => [`seo.${k}.title`, `seo.${k}.description`]), 'seo.creator.title', 'seo.creator.description']) {
    assert.equal(lang.split(`'${key}':`).length - 1, 5, `${key} en los 5 idiomas`);
  }
});

await check('El perfil abre en /@usuario sin saltar a /creator/<id>, con datos estructurados', async () => {
  const handle = readFileSync('src/pages/HandleLink.tsx', 'utf8');
  assert.ok(!/<Navigate/.test(handle), 'no redirige');
  assert.match(handle, /<CreatorProfile profileId=/);
  const profile = readFileSync('src/pages/CreatorProfile.tsx', 'utf8');
  assert.match(profile, /`\/@\$\{links\.username\}`/);
  assert.match(profile, /'@type': 'ProfilePage'/);
});

await check('Quien llega desde Google no cuenta como fan traído por el link del creador', async () => {
  const dir2 = mkdtempSync(join(tmpdir(), 'seo-handle-'));
  await build({ stdin: { contents: readFileSync('src/pages/HandleLink.tsx', 'utf8').match(/const SEARCH_REFERRER[^\n]+\n[^\n]+fromSearchEngine[^\n]+/)[0], loader: 'ts' }, outfile: join(dir2, 'h.mjs'), format: 'esm', logLevel: 'silent' });
  const { fromSearchEngine } = await import(pathToFileURL(join(dir2, 'h.mjs')).href);
  for (const r of ['https://www.google.com/', 'https://www.google.com.hn/', 'https://www.bing.com/search?q=x', 'https://duckduckgo.com/', 'https://search.yahoo.com/']) assert.ok(fromSearchEngine(r), r);
  for (const r of ['', 'https://www.tiktok.com/', 'https://l.instagram.com/', 'https://fansreserve.com/explore', 'https://notgoogle.example.com/']) assert.ok(!fromSearchEngine(r), r || '(vacío)');
});

console.log(`\n${passed} comprobaciones OK`);
