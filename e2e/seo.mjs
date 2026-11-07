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
let calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
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
  assert.ok(calls[0].url.endsWith('/rest/v1/rpc/public_creators'));
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
  for (const key of [...Object.values(pages).flatMap((k) => [`seo.${k}.title`, `seo.${k}.description`]), 'seo.creator.description']) {
    assert.equal(lang.split(`'${key}':`).length - 1, 5, `${key} en los 5 idiomas`);
  }
});

console.log(`\n${passed} comprobaciones OK`);
