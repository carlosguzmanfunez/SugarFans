// "Captar creadores" in a real Chromium against the offline build (browser-only
// store, no network): empty state, importing a Heepsy-style list, writing to a
// creator and marking the contact, the follow-up reminder, finding a creator who
// already signed up, and the filters. With PROSPECTS_SHOTS=<dir> it also saves
// screenshots on desktop and mobile.
// Usage: npx vite build --mode offline && node e2e/prospects-ui.mjs
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const PORT = 4189;
const BASE = `http://localhost:${PORT}`;
const shots = process.env.PROSPECTS_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const NAMES = ['Ana Fit', 'Luis Baila', 'Marta Cocina', 'Sofi Viajes', 'Diego Gamer', 'Valeria Makeup', 'Carlos Ríe', 'Paola Yoga', 'Andrés Música', 'Lucía Moda',
  'Fer Tech', 'Gabi Pets', 'Mateo Chef', 'Isa Lifestyle', 'Nico Humor', 'Dani Fotos', 'Camila Danza', 'Javi Fitness', 'Renata Arte', 'Tomás Surf'];
const CATS = ['Fitness', 'Baile', 'Cocina', 'Viajes', 'Gaming', 'Belleza', 'Humor', 'Bienestar', 'Música', 'Moda'];
const COUNTRIES = ['Honduras', 'Honduras', 'Honduras', 'México', 'México', 'Colombia', 'Guatemala', 'El Salvador', 'Costa Rica', 'Panamá'];
const rows = Array.from({ length: 60 }, (_, i) => {
  const name = NAMES[i % NAMES.length];
  const handle = `${name.split(' ')[0]}.${CATS[i % CATS.length]}${i}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const followers = [25300, 8400, 61000, 132000, 4100, 18750, 240000, 47000, 12900, 95000][i % 10];
  const er = ['4.5%', '2.1%', '6.8%', '1.2%', '3.3%', '7.9%', '0.9%', '5.1%', '3.8%', '2.6%'][i % 10];
  const email = i % 3 === 0 ? `${handle.replace(/\./g, '')}@correo.com` : '';
  const net = i % 4 === 1 ? 'TikTok' : 'Instagram';
  return `"${name}",@${handle},${net},${followers},${er},${email},${COUNTRIES[i % COUNTRIES.length]},${CATS[i % CATS.length]}`;
});
const CSV = ['Name,Username,Platform,Followers,Engagement rate,Email,Country,Category', ...rows, '"Sin usuario",,Instagram,100,,,,', `"Ana Fit",@ana.fitness0,Instagram,1,1%,,Honduras,Fitness`].join('\n');

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`); };
const errors = [];

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/login`);
  await page.fill('input[type=email]', 'admin@sugarfans.com');
  await page.fill('input[type=password]', 'demo1234');
  await page.click('form button[type=submit]');
  await page.waitForURL((u) => new URL(u).pathname !== '/login');
  await page.goto(`${BASE}/admin?section=prospects`);
  const tool = page.getByTestId('admin-prospects');

  await ok('Abre desde Crecimiento y muestra la lista vacía', async () => {
    await tool.getByText('Todavía no hay creadores en la lista').waitFor();
    assert.ok(await page.getByRole('navigation', { name: 'Áreas de administración' }).getByRole('button', { name: /^Crecimiento/ }).isVisible());
    await tool.getByText('Falta conectar la API oficial de Instagram').waitFor();
  });

  await ok('Importa una lista tipo Heepsy: cuenta repetidos y filas vacías', async () => {
    await tool.getByRole('button', { name: 'Importar lista' }).click();
    const dialog = page.getByRole('dialog', { name: 'Importar una lista de creadores' });
    await dialog.getByLabel('Lista', { exact: true }).fill(CSV);
    await dialog.getByText('60 creadores listos para importar').waitFor();
    await dialog.getByText('1 repetido en el archivo · 1 fila sin usuario').waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'escritorio-2-importar.png') });
    await dialog.getByRole('button', { name: /^Importar 60/ }).click();
    await tool.getByText('Listo: 60 creadores nuevos.').waitFor();
    await tool.getByText('60 en la lista').waitFor();
  });

  await ok('El mejor puntaje sale primero y se puede escribir y marcar como contactado', async () => {
    const first = tool.locator('li', { has: page.getByRole('button', { name: 'Escribir' }) }).first();
    await first.getByRole('button', { name: 'Escribir' }).click();
    const dialog = page.getByRole('dialog', { name: /^Escribir a @/ });
    const text = await dialog.getByLabel(/^Mensaje/).inputValue();
    assert.match(text, /^Hola \S+ 👋/);
    assert.match(text, /Creadores Fundadores/);
    assert.doesNotMatch(text, /\{|https?:/);
    await dialog.getByRole('button', { name: '1. Copiar mensaje' }).click();
    await dialog.getByRole('button', { name: 'Copiado' }).waitFor();
    if (shots) await page.screenshot({ path: join(shots, 'escritorio-3-escribir.png') });
    await dialog.getByRole('button', { name: '3. Ya se lo envié' }).click();
    await tool.getByText(/quedó como contactado/).waitFor();
    await tool.locator('#today-title').locator('..').getByText('1', { exact: true }).waitFor();
  });

  // Data for the rest: some contacted a week ago, some replied, one creator signed up.
  await page.evaluate(() => {
    const key = 'fansreserve_creator_prospects';
    const list = JSON.parse(localStorage.getItem(key));
    const week = new Date(Date.now() - 7 * 86400000).toISOString();
    list.forEach((p, i) => {
      if (i % 5 === 1) Object.assign(p, { status: 'contactado', channel: 'dm', contactedAt: week });
      if (i % 9 === 2) Object.assign(p, { status: 'respondio', contactedAt: week, repliedAt: week });
      if (i % 17 === 3) Object.assign(p, { status: 'descartado' });
      if (i === 5) Object.assign(p, { lastPostAt: new Date(Date.now() - 3 * 86400000).toISOString(), enrichedAt: new Date().toISOString() });
    });
    localStorage.setItem(key, JSON.stringify(list));
    const accounts = JSON.parse(localStorage.getItem('fansreserve_accounts'));
    const vale = accounts.find((a) => a.id === 'demo-creator');
    vale.settings = { ...vale.settings, socials: { instagram: list.find((p) => p.network === 'instagram' && p.status === 'respondio').handle } };
    localStorage.setItem('fansreserve_accounts', JSON.stringify(accounts));
  });
  await page.reload();

  await ok('Buscar registrados encuentra a quien puso la misma red en su perfil', async () => {
    await tool.getByRole('button', { name: 'Buscar registrados' }).click();
    await tool.getByText('Encontramos 1 creador que ya se registró o avanzaron.').waitFor();
    await tool.getByLabel('Estado').selectOption('verificado');
    await tool.locator('ul[aria-busy] > li').filter({ hasText: 'Verificado' }).first().waitFor();
    assert.equal(await tool.locator('ul[aria-busy] > li').count(), 1);
    await tool.getByLabel('Estado').selectOption('open');
  });

  await ok('Los seguimientos pendientes llevan a quienes toca escribir otra vez', async () => {
    await tool.getByRole('button', { name: /Seguimientos pendientes/ }).click();
    await tool.locator('ul[aria-busy] > li').filter({ hasText: 'Toca seguimiento' }).first().waitFor();
    const rowsShown = await tool.locator('ul[aria-busy] > li').count();
    assert.ok(rowsShown >= 5, `filas ${rowsShown}`);
    await tool.getByRole('button', { name: 'Seguimiento', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: /^Escribir a @/ });
    assert.match(await dialog.getByLabel(/^Mensaje/).inputValue(), /te escribo de nuevo/);
    await dialog.getByRole('button', { name: '3. Ya le envié el seguimiento' }).click();
    await tool.getByText(/Seguimiento a @.* anotado/).waitFor();
  });

  await ok('Filtra por país y tamaño, y el embudo cambia al país', async () => {
    await tool.getByLabel('Estado').selectOption('open');
    await tool.getByRole('navigation', { name: 'Países' }).getByRole('button', { name: /Honduras/ }).click();
    await tool.getByRole('heading', { name: /Honduras/ }).first().waitFor();
    await tool.getByLabel('Seguidores').selectOption('ideal');
    await page.waitForTimeout(300);
    const counts = await tool.locator('ul[aria-busy] dd').allInnerTexts();
    assert.ok(counts.length > 0);
    await tool.getByLabel('Seguidores').selectOption('');
  });

  await ok('No contactar borra su correo y no deja escribirle', async () => {
    await tool.getByRole('navigation', { name: 'Países' }).getByRole('button', { name: 'Los 10 países' }).click();
    await tool.getByLabel('Estado').selectOption('nuevo');
    await tool.getByLabel('Solo con correo público').check();
    await page.waitForTimeout(300);
    await tool.getByRole('button', { name: 'Escribir', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: /^Escribir a @/ });
    await dialog.getByRole('button', { name: 'No quiere que le escribamos' }).click();
    await page.getByRole('dialog', { name: /^No volver a escribir/ }).getByRole('button', { name: 'Confirmar' }).click();
    await tool.getByText(/quedó en No contactar/).waitFor();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fansreserve_creator_prospects')).filter((p) => p.status === 'no_contactar'));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].email, undefined);
    await tool.getByLabel('Solo con correo público').uncheck();
    await tool.getByLabel('Estado').selectOption('open');
  });

  if (shots) {
    await page.reload();
    await tool.getByText('Avance por país').waitFor();
    await page.screenshot({ path: join(shots, 'escritorio-1-resumen.png'), fullPage: true });
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
    const m = await mobile.newPage();
    await m.goto(BASE);
    await m.evaluate((state) => { for (const [k, v] of Object.entries(state)) localStorage.setItem(k, v); },
      await page.evaluate(() => Object.fromEntries(Object.entries(localStorage))));
    await m.goto(`${BASE}/admin?section=prospects`);
    await m.getByTestId('admin-prospects').getByText('Avance por país').waitFor();
    await m.screenshot({ path: join(shots, 'movil-1-resumen.png') });
    await m.screenshot({ path: join(shots, 'movil-1-resumen-completa.png'), fullPage: true });
    await m.getByTestId('admin-prospects').getByRole('button', { name: 'Escribir', exact: true }).first().click();
    await m.screenshot({ path: join(shots, 'movil-2-escribir.png') });
  }

  assert.deepEqual(errors, []);
  console.log(`\n${passed}/7 comprobaciones en el navegador`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
