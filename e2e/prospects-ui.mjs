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

  await ok('Lote de DMs: copia, abre el perfil y pasa al siguiente marcando a cada uno', async () => {
    await page.evaluate(() => { window.open = (url) => { window.__opened = [...(window.__opened ?? []), url]; return null; }; });
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('fansreserve_creator_prospects')).filter((p) => p.status === 'contactado').length);
    await tool.getByRole('button', { name: 'Lote de DMs' }).click();
    let dialog = page.getByRole('dialog', { name: 'Lote de DMs' });
    await dialog.getByLabel('Cuántos').selectOption('10');
    await dialog.getByRole('button', { name: 'Empezar el lote' }).click();
    dialog = page.getByRole('dialog', { name: /^Lote de DMs · 1 de 10/ });
    assert.match(await dialog.getByLabel('Mensaje').inputValue(), /^Hola .+ 👋/);
    await dialog.getByRole('button', { name: '1. Copiar y abrir su perfil' }).click();
    if (shots) await page.screenshot({ path: join(shots, 'escritorio-4-lote-dms.png') });
    await dialog.getByRole('button', { name: /2\. Enviado, siguiente/ }).click();
    await page.getByRole('dialog', { name: /^Lote de DMs · 2 de 10/ }).getByRole('button', { name: 'Saltar' }).click();
    await page.getByRole('dialog', { name: /^Lote de DMs · 3 de 10/ }).getByRole('button', { name: /2\. Enviado, siguiente/ }).click();
    await page.getByRole('dialog', { name: /^Lote de DMs · 4 de 10/ }).getByRole('button', { name: 'Terminar aquí' }).click();
    await tool.getByText('Lote terminado: 2 mensajes enviados, 1 descartados o saltados.').waitFor();
    const opened = await page.evaluate(() => window.__opened);
    assert.equal(opened.length, 1);
    assert.match(opened[0], /^https:\/\/www\.(instagram|tiktok)\.com\//);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('fansreserve_creator_prospects')).filter((p) => p.status === 'contactado').length);
    assert.equal(after, before + 2);
  });

  await ok('Lote de correos: descarga cada correo ya escrito y marca el lote como contactado', async () => {
    await tool.getByRole('button', { name: 'Lote de correos' }).click();
    const dialog = page.getByRole('dialog', { name: 'Lote de correos' });
    await dialog.getByLabel('Cuántos').selectOption('25');
    const [file] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Descargar el lote' }).click()]);
    const csv = (await import('node:fs')).readFileSync(await file.path(), 'utf8').replace(/^\uFEFF/, '');
    const lines = csv.split('\n');
    assert.equal(lines[0], 'email,first_name,username,network,country,category,subject,body');
    assert.match(csv, /@correo\.com,[A-Z][a-z]+,/);
    assert.match(csv, /te invitamos al lanzamiento de Fans Reserve en (Honduras|México|Colombia|Guatemala|El Salvador|Costa Rica|Panamá)/);
    const count = Number((await dialog.getByText(/Se descargó el archivo con/).innerText()).match(/(\d+) correos/)[1]);
    assert.ok(count > 0 && count <= 25);
    await dialog.getByRole('button', { name: new RegExp(`^Marcar los ${count} como contactados`) }).click();
    await tool.getByText(`${count} creadores quedaron como contactados por correo.`).waitFor();
    const byEmail = await page.evaluate(() => JSON.parse(localStorage.getItem('fansreserve_creator_prospects')).filter((p) => p.channel === 'email' && p.status === 'contactado').length);
    assert.equal(byEmail, count);
  });


  // The personal invite link, opened by a visitor in another browser.
  const store = async (from) => from.evaluate(() => ({
    list: localStorage.getItem('fansreserve_creator_prospects'), events: localStorage.getItem('fansreserve_prospect_events') ?? '[]',
  }));
  const load = async (to, data) => to.evaluate((d) => {
    localStorage.setItem('fansreserve_creator_prospects', d.list); localStorage.setItem('fansreserve_prospect_events', d.events);
  }, data);
  const prospects = async (from) => from.evaluate(() => JSON.parse(localStorage.getItem('fansreserve_creator_prospects')));
  let invited, link;

  await ok('Cada creador tiene su link: se copia, y si lo abre el equipo no cuenta', async () => {
    await tool.getByLabel('Estado').selectOption('nuevo');
    await page.waitForTimeout(300);
    await tool.getByRole('button', { name: 'Escribir', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: /^Escribir a @/ });
    invited = (await dialog.getByRole('heading').innerText()).replace(/^Escribir a @/, '');
    await dialog.getByRole('button', { name: 'Copiar su link' }).click();
    await dialog.getByRole('button', { name: 'Link copiado' }).waitFor();
    link = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(link, new RegExp(`^${BASE}/c/[a-f0-9]{12}$`));
    await dialog.getByRole('button', { name: 'Cerrar' }).first().click();
    await tool.getByLabel('Estado').selectOption('open');
    await page.goto(link);
    await page.getByTestId('invite-team-preview').waitFor();
    assert.equal((await prospects(page)).find((p) => p.handle === invited).openedAt, undefined);
  });

  const visitor = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  const v = await visitor.newPage();
  v.on('pageerror', (e) => errors.push(String(e)));

  await ok('Antes del lanzamiento, el creador abre su link (sin cuenta) y aparta su lugar', async () => {
    await v.goto(BASE);
    await load(v, await store(page));
    await v.evaluate(() => localStorage.setItem('fansreserve_forceLaunchGate', 'true'));
    await v.goto(link);
    const invite = v.getByTestId('prospect-invite');
    await invite.getByRole('heading', { name: /Te invitamos al lanzamiento de Fans Reserve/ }).waitFor();
    await invite.getByText(/^Hola, .+ 👋$/).waitFor();
    if (shots) await v.screenshot({ path: join(shots, 'movil-3-invitacion.png'), fullPage: true });
    await invite.getByLabel(/Tu correo/).fill('malo@sinpunto');
    await invite.getByRole('button', { name: 'Quiero participar' }).click();
    await invite.getByRole('alert').getByText(/correo no parece válido/).waitFor();
    await invite.getByLabel(/Tu correo/).fill('creadora@correo.com');
    await invite.getByRole('button', { name: 'Quiero participar' }).click();
    await invite.getByTestId('invite-joined').getByText('¡Listo! Tu lugar está apartado 🎉').waitFor();
    if (shots) await v.screenshot({ path: join(shots, 'movil-4-lugar-apartado.png') });
    const me = (await prospects(v)).find((p) => p.handle === invited);
    assert.ok(me.openedAt && me.interestedAt && me.status === 'respondio' && me.email === 'creadora@correo.com', JSON.stringify(me));
    // The home page is still "Muy pronto" for them.
    await v.goto(BASE);
    await v.getByTestId('coming-soon').waitFor();
  });

  await ok('Desde el link puede pedir no recibir más mensajes', async () => {
    const other = (await prospects(v)).find((p) => p.email && p.status !== 'no_contactar' && p.handle !== invited);
    await v.goto(`${BASE}/c/${other.inviteCode}?baja=1`);
    await v.getByRole('heading', { name: '¿No quieres recibir más mensajes de Fans Reserve?' }).waitFor();
    await v.getByTestId('invite-leave-confirm').click();
    await v.getByRole('heading', { name: 'Listo, no te volveremos a escribir' }).waitFor();
    const after = (await prospects(v)).find((p) => p.id === other.id);
    assert.equal(after.status, 'no_contactar');
    assert.equal(after.email, undefined);
  });

  await ok('Al iniciar sesión, su cuenta queda conectada a la invitación (Registrado)', async () => {
    await v.goto(link);
    await v.getByTestId('invite-joined').waitFor();
    await v.evaluate(() => localStorage.removeItem('fansreserve_forceLaunchGate'));
    await v.goto(`${BASE}/login`);
    await v.fill('input[type=email]', 'creator@sugarfans.com');
    await v.fill('input[type=password]', 'demo1234');
    await v.click('form button[type=submit]');
    await v.waitForURL((u) => new URL(u).pathname !== '/login');
    await v.waitForFunction((h) => JSON.parse(localStorage.getItem('fansreserve_creator_prospects')).find((p) => p.handle === h)?.status === 'registrado', invited);
    assert.equal(await v.evaluate(() => localStorage.getItem('fansreserve_prospectInvite')), null);
  });

  await ok('El equipo lo ve en la lista y en "Últimas 24 horas"', async () => {
    await page.goto(BASE);
    await load(page, await store(v));
    await page.goto(`${BASE}/admin?section=prospects`);
    const box = tool.getByTestId('prospects-last24h');
    await box.getByText('Abrieron su link').waitFor();
    const text = (await box.innerText()).replace(/\s+/g, ' ');
    assert.match(text, /Abrieron su link 2/);
    assert.match(text, /Quieren participar 1/);
    assert.match(text, /Se registraron 1/);
    assert.match(text, /Pidieron no recibir más 1/);
    await tool.getByLabel('Buscar').fill(invited);
    const row = tool.locator('ul[aria-busy] > li').filter({ hasText: `@${invited}` });
    await row.getByText('Quiere participar').waitFor();
    await row.getByText(/^Abrió su link/).waitFor();
    await row.getByText('Registrado').waitFor();
    await tool.getByLabel('Buscar').fill('');
  });

  await ok('Con Zoho conectado, el lote de correos sale desde la consola con su link y respeta el límite', async () => {
    await page.evaluate(() => localStorage.setItem('fansreserve_prospectsFakeZoho', 'true'));
    await page.reload();
    await tool.getByRole('button', { name: 'Importar lista' }).click();
    const imp = page.getByRole('dialog', { name: 'Importar una lista de creadores' });
    await imp.getByLabel('Lista', { exact: true }).fill('usuario,email,pais\n@nueva.uno,uno@correo.com,Honduras\n@nueva.dos,dos@correo.com,Honduras\n@nueva.tres,tres@correo.com,México');
    await imp.getByRole('button', { name: /^Importar 3/ }).click();
    await tool.getByText(/^Listo: 3 creadores nuevos/).waitFor();
    await tool.getByRole('button', { name: 'Lote de correos' }).click();
    const dialog = page.getByRole('dialog', { name: 'Lote de correos' });
    await dialog.getByText('carlos@fansreserve.com').first().waitFor();
    await dialog.getByText(/Hoy van 0 de 30 correos/).waitFor();
    await dialog.getByLabel('Cuántos').selectOption('5');
    if (shots) await page.screenshot({ path: join(shots, 'escritorio-5-correos-zoho.png') });
    const waiting = await page.evaluate(() => JSON.parse(localStorage.getItem('fansreserve_creator_prospects')).filter((p) => p.status === 'nuevo' && p.email).length);
    await dialog.getByTestId('zoho-send-batch').click();
    const sent = Math.min(5, waiting);
    assert.ok(sent >= 3, `por contactar con correo: ${waiting}`);
    await tool.getByText(new RegExp(`^Salieron ${sent} correos? desde Zoho`)).waitFor();
    const events = await page.evaluate(() => JSON.parse(localStorage.getItem('fansreserve_prospect_events')).filter((e) => e.kind === 'correo').length);
    assert.equal(events, sent);
    await page.evaluate(() => localStorage.removeItem('fansreserve_prospectsFakeZoho'));
    await page.reload();
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
  console.log(`\n${passed}/15 comprobaciones en el navegador`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
