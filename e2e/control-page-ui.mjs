// Página del celular (/control): entra con la llave, muestra los números, cambia de
// periodo, olvida una llave revocada y sigue mostrando lo último sin internet.
// Datos ficticios; la base se simula. Needs `npm run build` first (uses dist/control.html).
// Screenshots go to CONTROL_SHOTS if set.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const shots = process.env.CONTROL_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const html = readFileSync('dist/control.html', 'utf8');
const KEY = `frc_${'ab12'.repeat(16)}`;

const money = (cobrado, pagos) => {
  const fee = Math.round((cobrado * 0.054 + pagos * 0.3) * 100) / 100;
  const creadores = Math.round((cobrado - fee) * 0.7 * 100) / 100;
  const fr = Math.round((cobrado - fee - creadores) * 100) / 100;
  const isv = Math.round(fr * 0.15 * 100) / 100;
  return { cobrado, comision_paypal: fee, creadores, fr_con_isv: fr, isv, fr_sin_isv: Math.round((fr - isv) * 100) / 100,
    pagos, fans_que_pagaron: Math.max(0, pagos - 1), devuelto: 12.5, en_disputa: 25,
    retiros_pagados: { n: 2, monto: 140 }, personas_nuevas: 14, creadores_verificados: 2, reservas_nuevas: 6, reservas_pagadas: 4 };
};
const now = Date.now();
const hourly = [0, 0, 0, 0, 0, 0, 25, 0, 9.99, 34.99, 0, 25, 60, 19.99, 0, 25, 49.98, 9.99, 0, 25, 34.99, 0, 15.99, 25];
const live = {
  ahora: {
    at: new Date(now).toISOString(), dia: new Date(now - 6 * 3600e3).toISOString().slice(0, 10),
    ultima_hora: money(25, 1), hoy: money(412.6, 16), mes: money(2481.4, 131),
    problemas: [
      { code: 'devoluciones', nivel: 'media', n: 1, titulo: '1 devolución por terminar ($12.50)', donde: 'Dinero > Retiros y devoluciones' },
      { code: 'disputas', nivel: 'alta', n: 1, titulo: '1 disputa abierta ($25.00)', donde: 'Dinero > Pagos a creadores' },
      { code: 'x', nivel: 'baja', n: 1, titulo: '<img src=x onerror="window.pwned=1">' },
    ],
    pendiente: { retiros_enviandose: 1, reserve_por_responder: 3, reserve_confirmadas_proximas: 7 },
  },
  horas: hourly.map((c, i) => ({ at: new Date(now - (23 - i) * 3600e3).toISOString(), cobrado: c })),
  dias: [412.6, 288.3, 351.9, 199.7, 466.2, 310.4, 0].map((c, i) => ({
    day: new Date(now - 6 * 3600e3 - i * 86400e3).toISOString().slice(0, 10), closed: i > 0, dinero: money(c, 20) })),
  reportes: [{ kind: 'midday', day: '2026-11-07', title: 'Reporte de mediodía · 07/11/2026', body: 'Cobrado: $186.47\nFans Reserve con ISV: $52.00',
    created_at: new Date(now - 2 * 3600e3).toISOString(), emailed_at: new Date(now - 2 * 3600e3).toISOString() }],
  ultima_revision: new Date(now - 20 * 60e3).toISOString(),
};

const server = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(html); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const checks = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: shots ? 2 : 1 });
  let mode = 'ok';
  const sent = [];
  await ctx.route('**/rest/v1/rpc/monitor_live', async (route) => {
    sent.push(JSON.parse(route.request().postData() || '{}').p_key);
    if (mode === 'offline') return route.abort();
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(mode === 'revoked' ? null : live) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${base}/control`);
  await page.getByText('Entra con tu llave').waitFor();
  await page.getByLabel('Llave privada').fill('frc_corta');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByText(/68 caracteres/).waitFor();
  assert.equal(sent.length, 0, 'una llave mal copiada no se manda');
  if (shots) await page.screenshot({ path: join(shots, 'control-llave.png') });
  checks.push('sin llave pide la llave y valida el formato');

  await page.goto(`${base}/control#k=${KEY}`);
  await page.locator('#bandTitle').getByText('1 asunto urgente').waitFor();
  assert.equal(new URL(page.url()).hash, '', 'la llave sale de la barra de direcciones');
  assert.equal(sent.at(-1), KEY);
  assert.equal(await page.locator('#cobrado').innerText(), '$412.60');
  const rows = await page.locator('#money').innerText();
  assert.match(rows, /Fans Reserve con ISV[\s\S]*Fans Reserve sin ISV/);
  assert.match(await page.locator('#problems .prob').first().innerText(), /disputa/, 'lo urgente va primero');
  assert.equal(await page.evaluate(() => window.pwned), undefined, 'los textos de la base no ejecutan código');
  await page.getByRole('button', { name: 'Mes' }).click();
  assert.equal(await page.locator('#cobrado').innerText(), '$2,481.40');
  await page.getByRole('button', { name: 'Hoy' }).click();
  await page.getByText(/Reporte de mediodía/).click();
  await page.getByText('Cobrado: $186.47').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'no se desborda a lo ancho');
  if (shots) await page.screenshot({ path: join(shots, 'control-en-vivo.png'), fullPage: true });
  checks.push('con el link entra, guarda la llave, muestra dinero, avisos, días y reportes');

  mode = 'offline';
  await page.reload();
  await page.getByText(/Sin conexión: mostrando lo último/).waitFor();
  assert.equal(await page.locator('#cobrado').innerText(), '$412.60');
  checks.push('sin internet muestra lo último que cargó');

  mode = 'revoked';
  await page.reload();
  await page.getByText(/revocada/).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('fr-control-key')), null, 'olvida la llave revocada');
  assert.equal(await page.evaluate(() => localStorage.getItem('fr-control-last')), null, 'y borra los números guardados');
  checks.push('llave revocada: vuelve a pedir llave y borra lo guardado');

  mode = 'ok';
  await page.getByLabel('Llave privada').fill(KEY);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.locator('#app').waitFor();
  await page.getByRole('button', { name: 'Salir' }).click();
  await page.getByText('Entra con tu llave').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('fr-control-key')), null);
  checks.push('pegar la llave a mano y salir');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  server.close();
}
for (const c of checks) console.log('OK', c);
console.log(`${checks.length} comprobaciones de la página del celular. Datos ficticios, sin red.`);
