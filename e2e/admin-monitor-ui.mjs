// "Mano derecha" admin tab with fictional data (no provider, no network):
// renders the real component at phone and desktop width and checks what Carlos sees.
// Needs `npm run build` first (uses the built CSS). Screenshots go to MONITOR_SHOTS if set.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const shots = process.env.MONITOR_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const fixture = JSON.stringify(resolve('e2e/helpers/admin-monitor-fixture.ts').replaceAll('\\', '/'));
const plugin = { name: 'fictional-monitor', setup(b) {
  b.onResolve({ filter: /\/lib\/backend$|^\.\/backend$/ }, () => ({ path: 'backend', namespace: 'monitor-demo' }));
  b.onLoad({ filter: /.*/, namespace: 'monitor-demo' }, () => ({ contents: `export { backend } from ${fixture};`, resolveDir: process.cwd(), loader: 'ts' }));
} };
const out = join(tmpdir(), 'fr-admin-monitor.js');
await build({
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import AdminMonitor from'./src/components/AdminMonitor';
window.opened=[];createRoot(document.getElementById('root')).render(<div className="min-h-screen bg-gray-50 p-3 sm:p-8"><div className="max-w-6xl mx-auto"><AdminMonitor onOpen={s=>window.opened.push(s)}/></div></div>);`,
    resolveDir: process.cwd(), loader: 'tsx' },
  outfile: out, bundle: true, format: 'esm', plugins: [plugin], jsx: 'automatic',
  define: { 'import.meta.env': JSON.stringify({ MODE: 'offline', DEV: true }) }, logLevel: 'silent',
});
const assets = resolve('dist/assets');
const css = readdirSync(assets).find((x) => /^index-.*\.css$/.test(x));
if (!css) throw Error('Ejecuta npm run build primero');
const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/${css}"><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(readFileSync(out)); return; }
  if (req.url?.startsWith('/assets/')) {
    const file = basename(req.url.split('?')[0]);
    if (!readdirSync(assets).includes(file)) { res.writeHead(404).end(); return; }
    res.setHeader('content-type', file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream');
    res.end(readFileSync(join(assets, file))); return;
  }
  res.setHeader('content-type', 'text/html'); res.end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const checks = [];
try {
  for (const [name, viewport] of [['escritorio', { width: 1280, height: 900 }], ['movil', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: shots ? 2 : 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(`${base}/?s=alert`);
    await page.getByTestId('monitor-problems').waitFor();
    assert.match(await page.getByTestId('monitor-status').innerText(), /1 asunto urgente/);
    assert.match(await page.getByTestId('monitor-status').innerText(), /Próximo reporte/);
    assert.match(await page.getByTestId('monitor-profit').innerText(), /con ISV[\s\S]*sin ISV/);
    await page.getByRole('button', { name: 'Abrir' }).first().click();
    assert.deepEqual(await page.evaluate(() => window.opened), ['finance']);
    await page.getByTestId('monitor-refresh').click();
    await page.getByText('Revisando…').waitFor();
    if (shots) await page.screenshot({ path: join(shots, `${name}-con-avisos.png`), fullPage: true });
    await page.getByRole('button', { name: /Reporte de mediodía/ }).click();
    const frame = page.frameLocator('iframe[title^="Reporte de mediodía"]');
    await frame.getByText('Ganancia de Fans Reserve').waitFor();
    if (shots) {
      await page.locator('iframe[title^="Reporte de mediodía"]').scrollIntoViewIfNeeded();
      await page.locator('iframe[title^="Reporte de mediodía"]').screenshot({ path: join(shots, `${name}-reporte-correo.png`) });
    }
    checks.push(`${name}: avisos, abrir sección, actualizar y reporte`);

    // Control en el celular: llave existente, crear una (se ve una vez) y revocar.
    await page.getByTestId('monitor-phone-keys').getByText('iPhone de Carlos').waitFor();
    await page.getByLabel('Nombre de la llave').fill('Android');
    await page.getByTestId('monitor-phone-create').click();
    assert.match(await page.getByTestId('monitor-phone-new').innerText(), /no se vuelve a mostrar/);
    assert.match(await page.getByTestId('monitor-phone-key').innerText(), /^frc_[0-9a-f]{64}$/);
    assert.match(await page.getByRole('link', { name: 'Abrir aquí' }).getAttribute('href'), /\/control#k=frc_/);
    if (shots) await page.getByTestId('monitor-phone-card').screenshot({ path: join(shots, `${name}-control-celular.png`) });
    const androidRow = page.getByTestId('monitor-phone-keys').locator('li', { hasText: 'Android' });
    await androidRow.getByRole('button', { name: 'Revocar' }).click();
    await androidRow.getByRole('button', { name: 'Sí, revocar' }).click();
    await page.getByTestId('monitor-phone-new').waitFor({ state: 'detached' });
    assert.equal(await page.getByTestId('monitor-phone-keys').locator('li').count(), 1);
    checks.push(`${name}: llave del celular (crear, ver una vez, revocar)`);

    await page.goto(`${base}/?s=ok`);
    await page.getByTestId('monitor-ok').waitFor();
    assert.match(await page.getByTestId('monitor-status').innerText(), /Todo en orden/);
    if (shots) await page.screenshot({ path: join(shots, `${name}-todo-en-orden.png`), fullPage: true });
    checks.push(`${name}: todo en orden`);

    await page.goto(`${base}/?s=empty`);
    await page.getByText('Preparando la primera revisión').waitFor();
    await page.getByText('Se llena solo cada hora.').waitFor();
    checks.push(`${name}: sin datos todavía`);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, `${name}: la página no debe desbordarse a lo ancho`);
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
for (const c of checks) console.log('OK', c);
console.log(`${checks.length} comprobaciones de Mano derecha correctas. Datos ficticios, sin red.`);
