// Oficina del celular (/oficina): entra con la misma llave de /control, dibuja la oficina,
// abre la ficha de cada agente, lista los pendientes, cuadra el dinero, revisa proveedores,
// olvida una llave revocada y sigue mostrando lo último sin internet.
// Datos ficticios; la base y las APIs se simulan. Needs `npm run build` first (uses dist/).
// Screenshots go to OFICINA_SHOTS if set.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const shots = process.env.OFICINA_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
assert.ok(existsSync('dist/oficina.html'), 'Primero: npm run build');
const KEY = `frc_${'cd34'.repeat(16)}`;

const money = (cobrado, pagos) => {
  const fee = Math.round((cobrado * 0.054 + pagos * 0.3) * 100) / 100;
  const creadores = Math.round((cobrado - fee) * 0.7 * 100) / 100;
  const fr = Math.round((cobrado - fee - creadores) * 100) / 100;
  const isv = Math.round(fr * 0.15 * 100) / 100;
  return { cobrado, comision_paypal: fee, creadores, fr_con_isv: fr, isv, fr_sin_isv: Math.round((fr - isv) * 100) / 100,
    pagos, fans_que_pagaron: Math.max(0, pagos - 1), devuelto: 12.5, en_disputa: 25, retiros_pagados: { n: 2, monto: 140 },
    personas_nuevas: 14, creadores_verificados: 2, reservas_nuevas: 6, reservas_pagadas: 4, errores_pagina: 3 };
};
const now = Date.now();
const day = (i) => new Date(now - 6 * 3600e3 - i * 86400e3).toISOString().slice(0, 10);
const live = {
  ahora: {
    at: new Date(now).toISOString(), dia: day(0), ultima_hora: money(25, 1), hoy: money(412.6, 16), mes: money(2481.4, 131),
    problemas: [
      { code: 'devoluciones', nivel: 'media', n: 1, titulo: '1 devolución por terminar ($12.50)', donde: 'Dinero > Retiros y devoluciones' },
      { code: 'disputas', nivel: 'alta', n: 1, titulo: '1 disputa abierta ($25.00)', donde: 'Dinero > Pagos a creadores' },
      { code: 'errores_web', nivel: 'baja', n: 1, titulo: '<img src=x onerror="window.pwned=1">' },
    ],
    pendiente: { retiros_enviandose: 0, reserve_por_responder: 3, reserve_confirmadas_proximas: 7 },
  },
  horas: Array.from({ length: 24 }, (_, i) => ({ at: new Date(now - (23 - i) * 3600e3).toISOString(), cobrado: i % 3 ? 0 : 25 })),
  dias: [412.6, 288.3, 351.9, 199.7, 466.2, 310.4, 0].map((c, i) => ({ day: day(i), closed: i > 0, dinero: money(c, 20) })),
  reportes: [{ kind: 'midday', day: day(0), title: 'Reporte de mediodía', body: 'Cobrado: $186.47\n<script>window.pwned=2</script>',
    created_at: new Date(now - 2 * 3600e3).toISOString(), emailed_at: new Date(now - 2 * 3600e3).toISOString() }],
  ultima_revision: new Date(now - 20 * 60e3).toISOString(),
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/oficina') path = '/oficina.html';
  if (path === '/control') path = '/control.html';
  const file = normalize(join('dist', path));
  if (!file.startsWith('dist') || !existsSync(file)) { res.statusCode = 404; return res.end('no'); }
  res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const checks = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: shots ? 2 : 1, hasTouch: true });
  let mode = 'ok';
  const sent = [];
  await ctx.route('**/rest/v1/rpc/monitor_live', async (route) => {
    sent.push(JSON.parse(route.request().postData() || '{}').p_key);
    if (mode === 'offline') return route.abort();
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(mode === 'revoked' ? null : live) });
  });
  const api = { paypal: { enabled: true, env: 'live' }, usage: { enabled: false, checks: { resend: 'FALTA' } }, didit: { enabled: true }, moderate: { enabled: true } };
  await ctx.route(/\/api\/(paypal|usage|didit|moderate)$/, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(api[route.request().url().split('/api/')[1]]) }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // 1) Sin llave pide la llave; una llave mal copiada no se manda.
  await page.goto(`${base}/oficina`);
  await page.getByText('Entra con tu llave').waitFor();
  await page.getByLabel('Llave privada').fill('frc_corta');
  await page.getByRole('button', { name: 'Entrar a la oficina' }).click();
  await page.getByText(/68 caracteres/).waitFor();
  assert.equal(sent.length, 0);
  if (shots) await page.screenshot({ path: join(shots, 'oficina-llave.png') });
  checks.push('sin llave pide la llave y valida el formato');

  // 2) Con el link entra, guarda la llave (la misma de /control) y la quita de la barra.
  await page.goto(`${base}/oficina#k=${KEY}`);
  await page.locator('#strip').getByText('1 decisión: D1').waitFor();
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(sent.at(-1), KEY);
  assert.equal(await page.evaluate(() => localStorage.getItem('fr-control-key')), KEY, 'comparte la llave con /control');
  assert.match(await page.locator('#strip').innerText(), /Rojo/);
  assert.equal(await page.locator('#badge').innerText(), '2', 'D1 y F1 abiertos; lo informativo no cuenta');
  assert.match(await page.locator('#greetText').innerText(), /Sofía: .*Hoy solo necesito una cosa de ti: D1/);
  await page.waitForTimeout(400);
  const box = await page.locator('#office').boundingBox();
  assert.ok(box.width > 300 && box.y + box.height <= 844 - 58, 'la oficina cabe en la pantalla, arriba de las pestañas');
  if (shots) await page.screenshot({ path: join(shots, 'oficina-celular.png') });
  checks.push('con el link entra con la llave de /control y la oficina cabe en una pantalla');

  // 3) Tocar un cubículo abre la ficha desde abajo; Disputas trae la única decisión.
  await page.mouse.click(box.x + box.width * (158 / 192), box.y + box.height * (60 / 276));
  await page.locator('#sheetName').getByText('Marisol').waitFor();
  await page.waitForTimeout(400);
  const sheetTop = (await page.locator('#sheet').boundingBox()).y;
  assert.ok(sheetTop > 200 && sheetTop < 844, 'la ficha sube a media pantalla');
  await page.locator('#strip').click();
  await page.locator('#decision').getByText('¿Respondemos la disputa con el expediente?').waitFor();
  assert.match(await page.locator('#sheetBody').innerText(), /Lo que hago:[\s\S]*Manual 4 · disputas/);
  if (shots) await page.screenshot({ path: join(shots, 'oficina-ficha.png') });
  await page.locator('#sheetClose').click();
  checks.push('el cubículo abre la ficha y la franja lleva directo a la decisión');

  // 4) Pendientes: agrupados, lo urgente primero; el texto de la base nunca se ejecuta.
  await page.getByRole('tab', { name: /Pendientes/ }).click();
  const pend = await page.locator('#v-pendientes').innerText();
  assert.ok(pend.indexOf('NECESITA TU SÍ AHORA') < pend.indexOf('EN COLA PARA TU SÍ'));
  assert.ok(pend.indexOf('EN COLA PARA TU SÍ') < pend.indexOf('SOLO PARA QUE SEPAS'));
  assert.match(pend, /F1[\s\S]*devoluciones/);
  assert.match(pend, /<img src=x onerror/, 'se muestra como texto');
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  await page.getByRole('button', { name: 'Ver ficha de Nico' }).click();
  await page.locator('#sheetName').getByText('Nico').waitFor();
  assert.match(await page.locator('#sheetBody').innerText(), /CALENDARIO DE PAGOS/);
  await page.locator('#sheetClose').click();
  checks.push('pendientes agrupados, con su ficha, y sin ejecutar texto de la base');

  // 5) Dinero: con y sin ISV, cuadre y glosario.
  await page.getByRole('tab', { name: /Dinero/ }).click();
  const din = await page.locator('#v-dinero').innerText();
  assert.match(din, /Cobrado\s*\$412\.60/);
  assert.match(din, /Fans Reserve con ISV[\s\S]*Fans Reserve sin ISV/);
  assert.match(din, /Cuadra: .* = \$412\.60 ✓/);
  await page.locator('#v-dinero').getByRole('button', { name: 'Mes' }).click();
  assert.match(await page.locator('#v-dinero').innerText(), /Cobrado\s*\$2,481\.40/);
  await page.locator('#v-dinero').getByRole('button', { name: 'con ISV' }).click();
  await page.locator('#pop').getByText(/15% de ISV/).waitFor();
  await page.locator('#popClose').click();
  if (shots) await page.screenshot({ path: join(shots, 'oficina-dinero.png') });
  checks.push('dinero con y sin ISV, cuadre y glosario');

  // 6) Proveedores: chequeos reales de la web (solo OK/FALTA).
  await page.getByRole('tab', { name: /Proveedores/ }).click();
  await page.locator('#v-proveedores').getByText('Configurado · Live').waitFor();
  const prov = await page.locator('#v-proveedores').innerText();
  assert.match(prov, /Resend[\s\S]*Rojo[\s\S]*resend: FALTA/);
  assert.match(prov, /Supabase[\s\S]*Conectado/);
  assert.ok(prov.indexOf('Resend') < prov.indexOf('PayPal'), 'lo que falla va arriba');
  checks.push('proveedores con su chequeo; lo que falla va primero');

  // 7) Sin internet muestra lo último; con la llave revocada vuelve a pedirla y la borra.
  mode = 'offline';
  await page.goto(`${base}/oficina`);
  await page.locator('#offline').getByText(/Sin conexión: mostrando lo último/).waitFor();
  assert.match(await page.locator('#liveText').innerText(), /Sin conexión/);
  checks.push('sin internet muestra lo último que cargó');
  mode = 'revoked';
  await page.goto(`${base}/oficina`);
  await page.getByText(/revocada/).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('fr-control-key')), null);
  checks.push('llave revocada: vuelve a pedir llave y borra lo guardado');

  // 8) Escritorio: la ficha queda fija a la derecha.
  mode = 'ok';
  const desk = await browser.newPage({ viewport: { width: 1366, height: 820 } });
  await desk.route('**/rest/v1/rpc/monitor_live', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(live) }));
  await desk.route(/\/api\/(paypal|usage|didit|moderate)$/, (route) => route.fulfill({ contentType: 'application/json', body: '{"enabled":true,"checks":{"resend":"OK"}}' }));
  await desk.goto(`${base}/oficina#k=${KEY}`);
  await desk.locator('#sheetName').getByText('Sofía').waitFor();
  const sb = await desk.locator('#sheet').boundingBox();
  assert.ok(sb.x > 800 && sb.height > 500, 'ficha fija a la derecha');
  await desk.locator('#sheetBody').getByText('ASÍ ESTÁ CADA ÁREA').waitFor();
  assert.match(await desk.locator('#sheetBody').innerText(), /ÚLTIMO REPORTE/);
  assert.equal(await desk.evaluate(() => window.pwned), undefined);
  if (shots) await desk.screenshot({ path: join(shots, 'oficina-escritorio.png') });
  checks.push('en escritorio la ficha de la Mano derecha queda a la derecha');

  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  server.close();
}
for (const c of checks) console.log('OK', c);
console.log(`${checks.length} comprobaciones de la oficina. Datos ficticios, sin red.`);
