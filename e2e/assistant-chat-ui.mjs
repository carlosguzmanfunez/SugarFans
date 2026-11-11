// "Mano derecha" chat with fictional data and a fictional answer (no Claude, no
// network, no cost): the 3 steps, Aplicar with confirmation, money warning, safe
// fallbacks for invented cases or actions, and the "not connected yet" message.
// Needs `npm run build` first (uses the built CSS). Screenshots go to CHAT_SHOTS if set.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const shots = process.env.CHAT_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const fixture = JSON.stringify(resolve('e2e/helpers/assistant-chat-fixture.ts').replaceAll('\\', '/'));
const plugin = { name: 'fictional-admin', setup(b) {
  b.onResolve({ filter: /^\.\/backend$|^\.\/platform$/ }, (a) => (a.importer.endsWith('assistantData.ts') ? { path: 'fixture', namespace: 'chat-demo' } : undefined));
  b.onLoad({ filter: /.*/, namespace: 'chat-demo' }, () => ({ contents: `export * from ${fixture};`, resolveDir: process.cwd(), loader: 'ts' }));
} };
const out = join(tmpdir(), 'fr-assistant-chat.js');
await build({
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Chat from'./src/components/AdminAssistantChat';
window.opened=[];const lang=new URLSearchParams(location.search).get('lang')||'es';
createRoot(document.getElementById('root')).render(<div className="min-h-screen bg-gray-50 p-3 sm:p-8"><div className="max-w-4xl mx-auto"><Chat user={{id:'a1',role:'admin',name:'Carlos'}} lang={lang} onOpen={s=>window.opened.push(s)}/></div></div>);`,
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

const plan = {
  reply: 'Tienes 7 casos. Lo urgente: la disputa de PayPal y el retiro fallido de Ana.',
  problems: [
    { case_id: 'D1', title: 'Disputa PayPal de Mario por la videollamada con Ana ($25.00)', level: 'alta' },
    { case_id: 'P1', title: 'Retiro de Ana ($80.00) falló', level: 'alta' },
    { case_id: 'F1', title: 'Devolución pendiente de Mario ($25.00)', level: 'media' },
    { case_id: 'R1', title: 'Denuncia de spam sin pruebas', level: 'media' },
    { case_id: 'Z9', title: 'Caso inventado', level: 'alta' },
  ],
  solutions: [
    { case_id: 'D1', rule: 'Manual 4 · disputas', solution: 'Genera el expediente en inglés y decide quién paga el cargo.', action: 'open', reason: '' },
    { case_id: 'P1', rule: 'Manual 4 · retiros fallidos', solution: 'No reenviar. Pedirle a Ana su correo de PayPal correcto.', action: 'open', reason: '' },
    { case_id: 'F1', rule: 'Cancelación con 24 h o más', solution: 'Aprobar: se devuelven $20.85 al método original.', action: 'refund_approve', reason: 'Cancelación con más de 24 h' },
    { case_id: 'R1', rule: 'Manual 7 · denuncias', solution: 'Descartar: no hay pruebas.', action: 'report_dismiss', reason: '' },
    { case_id: 'V1', rule: 'Manual 6', solution: 'Revisar documento.', action: 'refund_approve', reason: '' },
    { case_id: 'M1', rule: 'Manual 7 · moderación', solution: 'Rechazar la foto.', action: 'media_reject', reason: 'Contenido sugerente' },
    { case_id: 'Z9', rule: '', solution: 'Inventado', action: 'refund_approve', reason: '' },
  ],
};

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const checks = [];
try {
  for (const [name, viewport] of [['escritorio', { width: 1280, height: 900 }], ['movil', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: shots ? 2 : 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    let sent;
    await page.route('**/api/usage', async (route) => {
      sent = JSON.parse(route.request().postData());
      assert.equal(route.request().headers().authorization, 'Bearer token-de-prueba');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan }) });
    });
    await page.goto(base);
    if (shots) await page.screenshot({ path: join(shots, `${name}-1-vacio.png`) });
    await page.getByRole('button', { name: 'Resuelve los casos abiertos' }).click();
    await page.getByTestId('assistant-problems').waitFor();

    // What travels to the server: short ids, no emails, no internal ids.
    assert.equal(sent.action, 'assistant');
    assert.deepEqual(sent.cases.map((c) => c.id), ['D1', 'P1', 'F1', 'R1', 'V1', 'M1', 'A1']);
    const wire = JSON.stringify(sent);
    for (const secret of ['x@y.z', 'ver-1', 'rep-1', 'ref-1', 'u1/foto.jpg']) assert.ok(!wire.includes(secret), `no debe viajar ${secret}`);

    // Step 1: list; the invented case is not shown.
    const problems = await page.getByTestId('assistant-problems').innerText();
    assert.match(problems, /1\. Problemas[\s\S]*Urgente[\s\S]*Disputa PayPal/);
    assert.ok(!problems.includes('Z9'));
    // Step 2 + 3: solutions; V1 had a refund action that does not fit → "Abrir".
    const sols = page.getByTestId('assistant-solution');
    assert.equal(await sols.count(), 6);
    const v1 = sols.filter({ hasText: 'V1' });
    assert.equal(await v1.getByRole('button', { name: /Aplicar/ }).count(), 0);
    await sols.filter({ hasText: 'D1' }).getByRole('button', { name: 'Abrir' }).click();
    assert.deepEqual(await page.evaluate(() => window.opened), ['finance']);
    if (shots) await page.screenshot({ path: join(shots, `${name}-2-respuesta.png`), fullPage: true });

    // Normal action: confirm, then it runs the same call as its screen.
    const r1 = sols.filter({ hasText: 'R1' });
    await r1.getByRole('button', { name: /Aplicar: Descartar denuncia/ }).click();
    assert.deepEqual((await page.evaluate(() => window.calls)).filter((c) => c.startsWith('report')), [], 'no corre antes de confirmar');
    await r1.getByRole('button', { name: 'Cancelar' }).click();
    await r1.getByRole('button', { name: /Aplicar: Descartar denuncia/ }).click();
    await r1.getByRole('button', { name: 'Sí, aplicar' }).click();
    await r1.getByTestId('assistant-applied').waitFor();
    assert.ok((await page.evaluate(() => window.calls)).includes('report:rep-1:dismiss'));

    // Money: red warning with the amount, then the decision is recorded.
    const f1 = sols.filter({ hasText: 'F1' });
    assert.match(await f1.innerText(), /Esto mueve dinero/);
    await f1.getByRole('button', { name: /Aplicar: Aprobar devolución/ }).click();
    assert.match(await f1.getByTestId('assistant-confirm').innerText(), /Esto mueve dinero: \$25\.00/);
    if (shots) await f1.screenshot({ path: join(shots, `${name}-3-confirmar-dinero.png`) });
    await f1.getByRole('button', { name: 'Sí, aplicar' }).click();
    await f1.getByTestId('assistant-applied').waitFor();
    assert.ok((await page.evaluate(() => window.calls)).includes('refund:ref-1:approve:Cancelación con más de 24 h'));
    checks.push(`${name}: 3 pasos, aplicar con confirmación, dinero con aviso, casos inventados descartados`);

    // Follow-up question keeps the conversation.
    await page.getByTestId('assistant-input').fill('¿Y la disputa?');
    await page.getByTestId('assistant-send').click();
    await page.getByTestId('assistant-answer').nth(1).waitFor();
    assert.equal(sent.history.length, 2);
    assert.equal(sent.history[0].role, 'user');
    checks.push(`${name}: segunda pregunta con el historial`);

    // Not connected yet.
    await page.unroute('**/api/usage');
    await page.route('**/api/usage', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Falta', code: 'setup' }) }));
    await page.getByTestId('assistant-clear').click();
    await page.getByRole('button', { name: '¿Qué es lo más urgente hoy?' }).click();
    await page.getByText(/falta la llave de Claude/).waitFor();
    if (shots) await page.screenshot({ path: join(shots, `${name}-4-sin-llave.png`) });
    checks.push(`${name}: aviso cuando falta la llave`);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, `${name}: la página no debe desbordarse a lo ancho`);
    assert.deepEqual(errors, []);
    await page.close();
  }
  const en = await browser.newPage();
  await en.goto(`${base}/?lang=en`);
  await en.getByRole('heading', { name: 'Ask Mano derecha' }).waitFor();
  await en.getByRole('button', { name: 'Resolve the open cases' }).waitFor();
  checks.push('inglés');
  await en.close();
} finally {
  await browser.close();
  server.close();
}
for (const c of checks) console.log('OK', c);
console.log(`${checks.length} comprobaciones del chat de Mano derecha correctas. Datos ficticios, sin Claude ni red.`);
