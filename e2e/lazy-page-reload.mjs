// Después de publicar una versión nueva, una página abierta pide archivos que ya no
// existen ("Failed to fetch dynamically imported module"). lazyPage recarga una sola
// vez para traer la versión nueva y no entra en bucle si vuelve a fallar.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const out = join(tmpdir(), 'fr-lazy-page.js');
await build({
  stdin: { contents: `import React, { Suspense } from 'react'; import { createRoot } from 'react-dom/client';
import { lazyPage, isStaleChunk, claimReload } from './src/lib/lazyPage';
window.checks = {
  chrome: isStaleChunk(new TypeError('Failed to fetch dynamically imported module: https://x/assets/A-1.js')),
  safari: isStaleChunk(new TypeError('Importing a module script failed.')),
  firefox: isStaleChunk(new TypeError('error loading dynamically imported module: https://x/a.js')),
  other: isStaleChunk(new Error('Cannot read properties of undefined')),
};
const mem = new Map(); const s = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
window.checks.claim = [claimReload(s, 100000), claimReload(s, 120000), claimReload(s, 140000)];
window.checks.blocked = claimReload({ getItem() { throw Error('x'); }, setItem() {} }, 1);
const Page = lazyPage(() => import(location.search.includes('ok') ? '/ok-chunk.js' : '/missing-chunk.js'));
createRoot(document.getElementById('root')).render(<Suspense fallback={<p id="loading">Cargando…</p>}><Page /></Suspense>);`,
    resolveDir: process.cwd(), loader: 'tsx' },
  outfile: out, bundle: true, format: 'esm', jsx: 'automatic', external: ['/missing-chunk.js', '/ok-chunk.js'], logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"production"' },
});
let loads = 0;
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(readFileSync(out)); return; }
  if (path === '/ok-chunk.js') { res.setHeader('content-type', 'text/javascript'); res.end('export default function P(){return "Página nueva"}'); return; }
  if (path === '/missing-chunk.js') { res.writeHead(404).end(); return; }
  if (path !== '/') { res.writeHead(404).end(); return; }
  loads += 1;
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="/app.js"></script>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage();
  await page.goto(`${base}/?ok`);
  await page.getByText('Página nueva').waitFor();
  const c = await page.evaluate(() => window.checks);
  assert.deepEqual(c, { chrome: true, safari: true, firefox: true, other: false, claim: [true, false, true], blocked: false });
  console.log('OK reconoce el fallo en Chrome, Safari y Firefox; no confunde otros errores');
  console.log('OK una recarga cada 30 s como máximo; sin almacenamiento no recarga');

  loads = 0;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/?viejo`);
  await page.waitForTimeout(2500);
  assert.equal(loads, 2, `debía cargar la página 2 veces (original + 1 recarga), cargó ${loads}`);
  assert.ok(errors.some((e) => /dynamically imported module/.test(e)), 'si vuelve a fallar, el error sigue registrándose');
  console.log('OK archivo viejo: recarga una sola vez y no entra en bucle');
} finally {
  await browser.close();
  server.close();
}
console.log('3 comprobaciones de recarga tras publicar una versión nueva.');
