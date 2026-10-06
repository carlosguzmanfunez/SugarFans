// End-to-end check of every user flow in a real Chromium.
// Usage: npm run e2e (offline, browser-only store) or npm run e2e:supabase
// (against the Supabase project; needs network access to supabase.co and
// "Confirm email" disabled). Serves dist/ with `vite preview`.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const PORT = 4173;
const BASE = process.env.E2E_BASE_URL || `http://localhost:${PORT}`;
const results = [];
const consoleErrors = [];

const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: String(err.message || err).split('\n')[0] });
    console.log(`  ✗ ${name}\n      ${String(err.message || err).split('\n').slice(0, 3).join('\n      ')}`);
  }
};

// Reserve's product rules (categories, allowed experiences, moderation and
// validation), bundled straight from the sources the app uses.
const loadReserveRules = async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'reserve-rules-')), 'rules.mjs');
  await build({
    stdin: {
      contents: "export * from './src/config/reserve.ts'; export * from './src/lib/moderation.ts'; export { validateExperience, defaultDetails } from './src/lib/vip.ts';",
      resolveDir: new URL('..', import.meta.url).pathname,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    logLevel: 'silent',
  });
  return import(pathToFileURL(out).href);
};

// Special-account rules (Reserve al neto), bundled from the sources the app uses.
const loadRewardRules = async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'reward-rules-')), 'rules.mjs');
  await build({
    stdin: { contents: "export * from './src/lib/rewardRules.ts';", resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    logLevel: 'silent',
  });
  return import(pathToFileURL(out).href);
};

const loadSpecialRules = async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'special-rules-')), 'rules.mjs');
  await build({
    stdin: { contents: "export * from './src/lib/specialRules.ts';", resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    logLevel: 'silent',
  });
  return import(pathToFileURL(out).href);
};

const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const startServer = async () => {
  if (process.env.E2E_BASE_URL) return null;
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return server;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start');
};

const newPage = async (context) => {
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(`${page.url()}: ${m.text()}`));
  page.on('pageerror', (e) => consoleErrors.push(`${page.url()}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  return page;
};

const newContext = async (browser, opts = {}) => {
  const context = await browser.newContext(opts);
  context.setDefaultTimeout(5000);
  // Keep the run offline and fast: only the app itself is loaded.
  await context.route('**/*', (route) => {
    const url = route.request().url();
    return url.startsWith(BASE) ? route.continue() : route.abort();
  });
  return context;
};

const path = (page) => new URL(page.url()).pathname;
const waitPath = (page, p) => page.waitForURL((u) => new URL(u).pathname === p, { timeout: 5000 });

const login = async (page, email, password, { remember = true } = {}) => {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  const box = page.locator('form input[type=checkbox]');
  if ((await box.isChecked()) !== remember) await box.click();
  await page.click('form button[type=submit]');
};

const logoutViaMenu = async (page) => {
  await page.click('button[aria-label="Menú de cuenta"]');
  await page.getByRole('button', { name: /Cerrar sesión/ }).click();
  await waitPath(page, '/');
};

const register = async (page, { name, email, password, confirm = password, role = 'fan', terms = true, country = 'ES', phone = '' }) => {
  await page.goto(`${BASE}/register`);
  await page.fill('input[type=text]', name);
  await page.fill('input[type=email]', email);
  await page.selectOption('[data-testid=signup-country]', country);
  if (phone) await page.fill('[data-testid=signup-phone]', phone);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  if (await page.locator('[class*="bg-red-50"]').count()) return;
  const pw = page.locator('input[type=password]');
  await pw.nth(0).fill(password);
  await pw.nth(1).fill(confirm);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  if (await page.locator('[class*="bg-red-50"]').count()) return;
  if (role === 'creator') await page.getByRole('button', { name: /Creador/ }).click();
  if (terms) await page.check('input[type=checkbox]');
  await page.getByRole('button', { name: /Crear cuenta|Crear cuenta|Registrarse/ }).last().click();
};

const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
let vipDate = '';

// Opens the Reserve request for the first experience (Valentina Rose's 1:1 video
// call, creator profile 1: manual approval, 24 h minimum notice).
const RESERVE_BUTTON = /^(Solicitar|Reservar)( sesión privada)?: /;
const openBooking = async (page) => {
  await page.goto(`${BASE}/reserve`);
  await page.getByRole('button', { name: RESERVE_BUTTON }).first().click();
  await page.getByTestId('booking-calendar').waitFor();
};

// First bookable day at least two days ahead, so the 24 h minimum notice never
// hides part of the day.
const pickFirstDate = async (page) => {
  const cal = page.getByTestId('booking-calendar');
  const from = isoDate(new Date(Date.now() + 2 * 86400000));
  for (let i = 0; i < 4; i++) {
    const days = cal.locator('button[data-date]:not([disabled])');
    for (let j = 0; j < (await days.count()); j++) {
      const iso = await days.nth(j).getAttribute('data-date');
      if (iso >= from) {
        await days.nth(j).click();
        return iso;
      }
    }
    await cal.getByRole('button', { name: 'Mes siguiente' }).click();
  }
  throw new Error('no hay días disponibles');
};

// Creates an experience with the 14-step "Crear experiencia" wizard, keeping the
// defaults except name, description and price.
const createExperience = async (page, { title, description, price }) => {
  await page.getByRole('button', { name: /Crear experiencia/ }).click();
  const form = page.getByTestId('experience-form');
  const next = () => form.getByRole('button', { name: 'Siguiente' }).click();
  await next();
  await form.locator('input[name=expTitle]').fill(title);
  await next();
  await form.locator('textarea[name=expDescription]').fill(description);
  await next();
  await next(); // modalidad
  await next(); // duración
  await form.locator('input[name=expPrice]').fill(String(price));
  for (let i = 5; i < 13; i++) await next();
  await form.getByRole('button', { name: 'Publicar experiencia' }).click();
};

// Opens a section of the creator's Reserve tab.
const openReserveSection = async (page, section) => {
  await page.getByTestId('dashboard-reservas').click();
  await page.getByRole('navigation', { name: 'Secciones de Reserve' }).getByRole('button', { name: new RegExp(`^${section}`) }).click();
};

const pickDate = async (page, iso) => {
  const cal = page.getByTestId('booking-calendar');
  for (let i = 0; i < 4 && !(await cal.locator(`button[data-date="${iso}"]`).count()); i++) {
    await cal.getByRole('button', { name: 'Mes siguiente' }).click();
  }
  await cal.locator(`button[data-date="${iso}"]`).click();
};

// 1x1 PNG, enough for the upload/downscale pipeline.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const photo = (name) => ({ name, mimeType: 'image/png', buffer: PNG });

const submitVerification = async (page, { name = 'Nombre Apellido', birth = '1990-05-10' } = {}) => {
  await page.goto(`${BASE}/settings?section=verification`);
  await page.fill('input[name=legalName]', name);
  await page.fill('input[name=birthDate]', birth);
  await page.fill('input[name=country]', 'México');
  await page.fill('input[name=docNumber]', 'ABC123456');
  await page.setInputFiles('input[name=docFront]', photo('frente.png'));
  await page.setInputFiles('input[name=selfie]', photo('selfie.png'));
  await page.getByRole('button', { name: 'Enviar para verificación' }).click();
};

const addCard = async (scope, number = '4242 4242 4242 4242') => {
  await scope.getByPlaceholder('Titular de la tarjeta').fill('Ana Prueba');
  await scope.getByPlaceholder('Número de tarjeta').fill(number);
  await scope.getByPlaceholder('MM/AA').fill('12/30');
  await scope.getByPlaceholder('CVC').fill('123');
  await scope.getByRole('button', { name: 'Guardar método de pago' }).click();
};

// Pay an accepted VIP booking: the dialog preselects a saved card, or asks for one.
const payBooking = async (page, booking) => {
  await booking.getByRole('button', { name: /Pagar/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Confirmar pago/ }).waitFor();
  if (await dialog.getByPlaceholder('Número de tarjeta').count()) await addCard(dialog);
  await dialog.getByRole('button', { name: /Confirmar pago/ }).click();
  await dialog.waitFor({ state: 'detached' });
};

const amountOf = (text) => Number(String(text).replace(/[^0-9.]/g, ''));
// Balances render $0.00 until the earnings query resolves, so wait for it before reading.
const readAmount = async (page, testId) => {
  await page.locator('[data-testid=earnings][aria-busy=false]').waitFor();
  return amountOf(await page.getByTestId(testId).textContent());
};
const waitAmount = (page, testId, text) => page.getByTestId(testId).filter({ hasText: new RegExp(`^\\${text.replace('.', '\\.')}$`) }).waitFor();
const money = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const platformData = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('fansreserve_platform') || '{}'));

// A short WebM recorded in the browser (a real, playable file).
const recordWebm = (page) =>
  page.evaluate(async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 160, height: 120 });
    const ctx = canvas.getContext('2d');
    const rec = new MediaRecorder(canvas.captureStream(15), { mimeType: 'video/webm' });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    rec.start();
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = `hsl(${i * 30}, 80%, 60%)`;
      ctx.fillRect(0, 0, 160, 120);
      await new Promise((r) => setTimeout(r, 60));
    }
    rec.stop();
    await done;
    const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let bin = '';
    buf.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
  });

const errorText = async (page) => (await page.locator('[class*="bg-red-50"]').first().textContent({ timeout: 3000 }))?.trim();

const run = async () => {
  const server = await startServer();
  // Fake camera/microphone so the live VIP room can be tested end to end.
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const stamp = Date.now();
  const fanEmail = `nuevo.fan.${stamp}@test.com`;
  const creatorEmail = `nueva.creadora.${stamp}@test.com`;

  try {
    const context = await newContext(browser, { locale: 'es-ES' });
    const page = await newPage(context);

    console.log('\nNavegación pública y verificación de edad');
    await check('La portada carga', async () => {
      await page.goto(BASE);
      await page.getByRole('link', { name: /Fans Reserve/ }).first().waitFor();
    });
    await check('La marca Fans Reserve está en título, metadatos y portada, sin rastro de la anterior', async () => {
      expect((await page.title()).startsWith('Fans Reserve'), 'título inesperado');
      const og = await page.locator('meta[property="og:site_name"]').getAttribute('content');
      expect(og === 'Fans Reserve', 'og:site_name inesperado');
      expect(!/sugar\s*fans/i.test(await page.locator('body').innerText()), 'queda la marca anterior en la portada');
    });
    await check('La portada usa solo imágenes propias y ninguna está rota', async () => {
      await page.goto(BASE);
      await page.evaluate(async () => {
        // Load lazy images: scroll through the page.
        for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); }
        await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
      });
      const imgs = await page.evaluate(() => [...document.images].map((i) => ({ src: i.currentSrc || i.src, ok: i.complete && i.naturalWidth > 0 })));
      const external = imgs.filter((i) => !i.src.startsWith(BASE));
      const broken = imgs.filter((i) => !i.ok);
      expect(imgs.length > 10, 'la portada no muestra imágenes');
      expect(external.length === 0, `imágenes externas: ${external.map((i) => i.src).join(', ')}`);
      expect(broken.length === 0, `imágenes rotas: ${broken.map((i) => i.src).join(', ')}`);
    });
    await check('Ninguna página pública muestra la marca antigua, Terrones ni imágenes externas', async () => {
      for (const path of ['/', '/explore', '/creator/1', '/reserve', '/help', '/legal', '/register', '/login']) {
        await page.goto(`${BASE}${path}`);
        await page.locator('main, #root').first().waitFor();
        await page.waitForTimeout(150);
        const text = await page.locator('body').innerText();
        expect(!/sugar\s?fans|terrones|de azúcar|\bverify\b|\bverified\b/i.test(text), `${path} muestra copy antiguo`);
        const ext = await page.evaluate(() => [...document.images].map((i) => i.currentSrc || i.src).filter((src) => src && !src.startsWith(location.origin) && !src.startsWith('data:')));
        expect(ext.length === 0, `${path} carga imágenes externas: ${ext.join(', ')}`);
      }
      await page.goto(`${BASE}/creator/1`);
      await page.getByText('Verificado', { exact: true }).waitFor();
      expect((await fetch(`${BASE}/brand/coin.png`)).ok, 'falta el icono de créditos');
    });
    await check('Favicon, iconos PWA y preview social existen', async () => {
      const manifest = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
      expect(manifest.name === 'Fans Reserve', 'manifest sin la marca');
      const og = await page.locator('meta[property="og:image"]').getAttribute('content');
      const files = [...manifest.icons.map((i) => i.src), '/favicon.svg', '/icons/icon-180.png', new URL(og).pathname];
      for (const f of files) expect((await fetch(`${BASE}${f}`)).ok, `falta ${f}`);
    });
    await check('Los datos guardados con la marca anterior se conservan tras el cambio de nombre', async () => {
      await page.evaluate(() => localStorage.setItem('sugarfans_ref', JSON.stringify({ id: 'x', at: Date.now() })));
      await page.reload();
      const keys = await page.evaluate(() => [localStorage.getItem('fansreserve_ref'), localStorage.getItem('sugarfans_ref')]);
      expect(keys[0] && JSON.parse(keys[0]).id === 'x' && keys[1] === null, 'no se migró la clave antigua');
      await page.evaluate(() => localStorage.removeItem('fansreserve_ref'));
    });
    await check('Página protegida sin edad verificada redirige a verificación de edad', async () => {
      await page.goto(`${BASE}/profile`);
      await waitPath(page, '/age-verification');
    });
    await check('Tras confirmar la edad vuelve al destino (login con retorno a /profile)', async () => {
      await page.getByRole('button', { name: /Soy mayor|18/ }).first().click();
      await waitPath(page, '/login');
    });
    await check('La verificación de edad persiste tras recargar', async () => {
      await page.reload();
      await page.goto(`${BASE}/settings`);
      await waitPath(page, '/login');
    });
    await check('Ayuda: cada categoría filtra sus preguntas y el buscador busca en las respuestas', async () => {
      await page.goto(`${BASE}/help`);
      await page.getByRole('button', { name: /Para creadores/ }).click();
      await page.getByText('¿Cuándo recibo mis pagos?').waitFor();
      expect((await page.locator('details').count()) === 4, 'la categoría no filtra');
      await page.getByRole('button', { name: /Para creadores/ }).click();
      await page.fill('input[placeholder="Buscar en la ayuda..."]', 'selfie');
      await page.getByText('¿Cómo verifico mi identidad?').waitFor();
    });
    await check('Ayuda: el formulario de reporte exige email a un visitante y se envía', async () => {
      await page.fill('input[placeholder="Buscar en la ayuda..."]', '');
      await page.fill('#report-description', 'Perfil falso que pide dinero por mensaje');
      await page.getByRole('button', { name: 'Enviar reporte' }).click();
      await page.getByText('Deja un email de contacto válido').waitFor();
      await page.fill('#report-email', 'visitante@test.com');
      await page.getByRole('button', { name: 'Enviar reporte' }).click();
      await page.getByText(/Reporte enviado/).waitFor();
    });
    await check('Ruta inexistente muestra 404', async () => {
      await page.goto(`${BASE}/no-existe`);
      await page.getByText('Página no encontrada').waitFor();
    });
    await check('Creador inexistente muestra "Creador no encontrado"', async () => {
      await page.goto(`${BASE}/creator/9999`);
      await page.getByText('Creador no encontrado').waitFor();
    });

    console.log('\nInicio de sesión, persistencia y cierre de sesión');
    await check('Login y registro ofrecen Google (Microsoft oculto por ahora); sin servidor avisan sin salir de la página', async () => {
      await page.goto(`${BASE}/login`);
      await page.getByRole('button', { name: 'Continuar con Google' }).click();
      expect((await errorText(page))?.includes('Google'), 'no avisó');
      expect((await page.getByText('Continuar con Microsoft').count()) === 0, 'sigue el botón de Microsoft');
      await waitPath(page, '/login');
      await page.goto(`${BASE}/register`);
      await page.getByRole('button', { name: 'Continuar con Google' }).click();
      expect((await errorText(page))?.includes('Google'), 'no avisó en registro');
      expect((await page.getByText('Apple').count()) === 0, 'sigue el botón de Apple');
    });
    await check('Si el usuario cancela en Google/Microsoft, la vuelta lo explica y lleva al login', async () => {
      await page.goto(`${BASE}/auth/callback?error=access_denied&error_description=cancelled`);
      await page.getByText('Cancelaste el acceso').waitFor();
      await page.getByRole('link', { name: 'Volver a iniciar sesión' }).click();
      await waitPath(page, '/login');
    });
    await check('Login ofrece Demo Fan, Demo Creator y Demo Admin sin mostrar correos antiguos', async () => {
      await page.goto(`${BASE}/login`);
      for (const label of ['Demo Fan', 'Demo Creator', 'Demo Admin']) await page.getByRole('button', { name: label }).waitFor();
      const html = await page.content();
      expect(!/@sugarfans\.com|sugar\s?fans/i.test(html), 'el login contiene la marca o los correos antiguos');
    });
    for (const [role, label] of [['fan', 'Demo Fan'], ['creator', 'Demo Creator'], ['admin', 'Demo Admin']]) {
      await check(`El botón ${label} inicia sesión con la cuenta demo`, async () => {
        await page.goto(`${BASE}/login`);
        await page.getByTestId(`demo-${role}`).click();
        await waitPath(page, '/explore');
        await page.click('button[aria-label="Menú de cuenta"]');
        await page.getByText(`Cuenta ${label}`).first().waitFor();
        expect(!/sugarfans/i.test(await page.locator('body').innerText()), 'el menú muestra el correo interno');
        await page.getByRole('button', { name: /Cerrar sesión/ }).click();
        await waitPath(page, '/');
      });
    }
    await check('Login con contraseña incorrecta muestra error', async () => {
      await login(page, 'fan@sugarfans.com', 'mala-clave');
      expect((await errorText(page))?.includes('incorrectos'), 'no apareció el error');
      expect(path(page) === '/login', 'no debería salir de /login');
    });
    await check('Login con email inexistente muestra error', async () => {
      await login(page, 'nadie@sugarfans.com', 'demo1234');
      expect((await errorText(page))?.includes('incorrectos'), 'no apareció el error');
    });
    await check('Login demo fan funciona y lleva a Explorar', async () => {
      await login(page, 'fan@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
    });
    await check('La sesión persiste tras recargar', async () => {
      await page.reload();
      await page.locator('button[aria-label="Menú de cuenta"]').waitFor();
      await page.goto(`${BASE}/profile`);
      await page.getByText('Cuenta Demo Fan').first().waitFor();
      expect(!/sugarfans/i.test(await page.locator('body').innerText()), 'el perfil muestra el correo interno de la cuenta demo');
    });
    await check('Con sesión, /login redirige a Explorar', async () => {
      await page.goto(`${BASE}/login`);
      await waitPath(page, '/explore');
    });
    await check('El menú de cuenta se cierra al navegar', async () => {
      await page.click('button[aria-label="Menú de cuenta"]');
      await page.getByRole('link', { name: /Mi perfil/ }).last().click();
      await waitPath(page, '/profile');
      expect((await page.getByRole('button', { name: /Cerrar sesión/ }).count()) === 0, 'el menú siguió abierto');
    });
    await check('El menú de cuenta se cierra al tocar fuera o con Escape', async () => {
      const menuOpen = async () => (await page.getByRole('button', { name: /Cerrar sesión/ }).count()) > 0;
      await page.click('button[aria-label="Menú de cuenta"]');
      expect(await menuOpen(), 'el menú no se abrió');
      await page.mouse.click(40, 500);
      await page.waitForTimeout(100);
      expect(!(await menuOpen()), 'el menú siguió abierto tras hacer clic fuera');
      await page.click('button[aria-label="Menú de cuenta"]');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      expect(!(await menuOpen()), 'el menú siguió abierto tras pulsar Escape');
      await page.click('button[aria-label="Menú de cuenta"]');
      await page.click('button[aria-label="Menú de cuenta"]');
      expect(!(await menuOpen()), 'el botón ya no cierra el menú');
    });
    await check('La campanita se cierra al tocar fuera o con Escape', async () => {
      const panel = page.getByTestId('notification-panel');
      await page.getByTestId('notification-bell').click();
      await panel.waitFor();
      await page.mouse.click(40, 500);
      await panel.waitFor({ state: 'detached' });
      await page.getByTestId('notification-bell').click();
      await panel.waitFor();
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'detached' });
      await page.getByTestId('notification-bell').click();
      await page.click('button[aria-label="Menú de cuenta"]');
      await panel.waitFor({ state: 'detached' });
      await page.getByRole('button', { name: /Cerrar sesión/ }).waitFor();
      await page.mouse.click(40, 500);
    });
    await check('Un fan no puede entrar al panel de creador ni al de admin', async () => {
      await page.goto(`${BASE}/creator/dashboard`);
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/admin`);
      await waitPath(page, '/explore');
    });
    await check('Con sesión de fan la portada no ofrece crear cuenta ni empezar como creador', async () => {
      await page.goto(`${BASE}/`);
      await page.locator('#hero-title').waitFor();
      expect(await page.locator('a[href^="/register"]').count() === 0, 'la portada enlaza al registro con sesión iniciada');
      expect(!(await page.locator('body').innerText()).includes('Crear cuenta gratis'), 'sigue apareciendo Crear cuenta gratis');
      await page.locator('#hero-title').locator('..').getByRole('link', { name: /Explorar creadores/ }).waitFor();
      expect(await page.locator('#creator-cta-title').count() === 0, 'un fan ve la invitación a registrarse como creador');
    });
    await check('Cerrar sesión funciona y persiste tras recargar', async () => {
      await logoutViaMenu(page);
      await page.reload();
      await page.getByRole('link', { name: 'Iniciar sesión' }).first().waitFor();
      await page.goto(`${BASE}/profile`);
      await waitPath(page, '/login');
      await page.goto(`${BASE}/`);
      await page.getByRole('link', { name: /Crear cuenta gratis/ }).waitFor();
    });
    await check('Tras login desde una página protegida vuelve a esa página', async () => {
      await page.goto(`${BASE}/settings`);
      await waitPath(page, '/login');
      await page.fill('input[type=email]', 'fan@sugarfans.com');
      await page.fill('input[type=password]', 'demo1234');
      await page.click('form button[type=submit]');
      await waitPath(page, '/settings');
      await logoutViaMenu(page);
    });

    console.log('\nApertura de cuenta (registro)');
    await check('Registro rechaza email inválido', async () => {
      await register(page, { name: 'X', email: 'no-es-email', password: 'x' });
      expect((await errorText(page))?.includes('email válido'), 'no rechazó el email');
    });
    await check('Registro rechaza contraseña corta', async () => {
      await register(page, { name: 'X', email: 'x@test.com', password: 'corta' });
      expect((await errorText(page))?.includes('8 caracteres'), 'no rechazó la contraseña');
    });
    await check('Registro rechaza contraseñas distintas', async () => {
      await register(page, { name: 'X', email: 'x@test.com', password: 'clave-segura-1', confirm: 'otra-clave-22' });
      expect((await errorText(page))?.includes('no coinciden'), 'no detectó la diferencia');
    });
    await check('Registro exige aceptar términos', async () => {
      await register(page, { name: 'X', email: 'x@test.com', password: 'clave-segura-1', terms: false });
      expect((await errorText(page))?.includes('términos'), 'no exigió términos');
    });
    await check('Registro pide país (preseleccionado) y teléfono opcional con el código del país', async () => {
      await page.goto(`${BASE}/register`);
      // The browser is es-ES: Spain comes pre-selected, with its +34 next to the phone.
      expect((await page.inputValue('[data-testid=signup-country]')) === 'ES', 'no preseleccionó el país');
      await page.getByText('+34', { exact: true }).waitFor();
      await page.selectOption('[data-testid=signup-country]', 'HN');
      await page.getByText('+504', { exact: true }).waitFor();
      await page.getByText('Nunca se muestra en tu perfil').waitFor();
    });
    await check('Registro rechaza un teléfono inválido', async () => {
      await register(page, { name: 'X', email: 'x@test.com', password: 'x', country: 'HN', phone: '12' });
      expect((await errorText(page))?.includes('teléfono'), 'no rechazó el teléfono');
    });
    await check('Registro rechaza email ya existente', async () => {
      await register(page, { name: 'Dup', email: 'FAN@sugarfans.com', password: 'clave-segura-1' });
      expect((await errorText(page))?.includes('Ya existe'), 'permitió duplicado');
    });
    await check('Registro de fan válido crea la cuenta y entra', async () => {
      await register(page, { name: 'Ana Prueba', email: fanEmail, password: 'clave-segura-1', country: 'HN', phone: '9999-8888' });
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/profile`);
      await page.getByText('Ana Prueba').first().waitFor();
      await page.getByText(fanEmail).first().waitFor();
      expect(!(await page.locator('body').innerText()).includes('9999'), 'el teléfono se muestra en el perfil');
    });
    await check('La cuenta nueva persiste tras recargar y tras cerrar/abrir sesión', async () => {
      await page.reload();
      await page.getByText('Ana Prueba').first().waitFor();
      await logoutViaMenu(page);
      await login(page, fanEmail, 'clave-segura-1');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/profile`);
      await page.getByText('Ana Prueba').first().waitFor();
    });
    await check('El país y el teléfono del registro se guardan y se pueden cambiar en Configuración', async () => {
      await page.goto(`${BASE}/settings`);
      expect((await page.inputValue('[data-testid=signup-country]')) === 'HN', 'no guardó el país');
      expect((await page.inputValue('[data-testid=signup-phone]')) === '99998888', `teléfono: ${await page.inputValue('[data-testid=signup-phone]')}`);
      await page.fill('[data-testid=signup-phone]', '3333 4444');
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      await page.getByText('Cambios guardados exitosamente').waitFor();
      await page.reload();
      expect((await page.inputValue('[data-testid=signup-phone]')) === '33334444', 'el teléfono nuevo no persistió');
    });

    console.log('\nConfiguración y guardados');
    await check('Editar nombre en Configuración se guarda y persiste', async () => {
      await page.goto(`${BASE}/settings`);
      await page.fill('input[name=name]', 'Ana Editada');
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      await page.getByText('Cambios guardados exitosamente').waitFor();
      await page.reload();
      expect((await page.inputValue('input[name=name]')) === 'Ana Editada', 'el nombre no persistió');
      await page.goto(`${BASE}/profile`);
      await page.getByText('Ana Editada').first().waitFor();
    });
    await check('No permite cambiar el email a uno de otra cuenta', async () => {
      await page.goto(`${BASE}/settings`);
      await page.fill('input[name=email]', 'creator@sugarfans.com');
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      expect((await errorText(page))?.includes('ya está en uso'), 'permitió email duplicado');
      await page.fill('input[name=email]', fanEmail);
    });
    await check('Cambiar foto de perfil se guarda', async () => {
      const before = await page.locator('img.w-20').getAttribute('src');
      await page.getByRole('button', { name: 'Cambiar foto de perfil' }).click();
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      await page.reload();
      const after = await page.locator('img.w-20').getAttribute('src');
      expect(before !== after, 'el avatar no cambió');
    });
    await check('Interruptores de notificaciones persisten', async () => {
      await page.goto(`${BASE}/settings?section=notifications`);
      const toggle = page.locator('input[aria-label="Promociones y ofertas"]');
      expect(!(await toggle.isChecked()), 'estado inicial inesperado');
      await toggle.click({ force: true });
      await page.reload();
      expect(await page.locator('input[aria-label="Promociones y ofertas"]').isChecked(), 'no persistió');
    });
    await check('Interruptores de privacidad persisten', async () => {
      await page.goto(`${BASE}/settings?section=privacy`);
      const toggle = page.locator('input[aria-label="Mostrar actividad"]');
      await toggle.click({ force: true });
      await page.reload();
      expect(await page.locator('input[aria-label="Mostrar actividad"]').isChecked(), 'no persistió');
    });
    await check('Seguridad no ofrece una doble autenticación que no existe', async () => {
      await page.goto(`${BASE}/settings?section=security`);
      await page.locator('input[placeholder="Contraseña actual"]').waitFor();
      expect(!(await page.getByText(/dos factores|2FA/).count()), 'el botón de 2FA sigue visible');
    });
    await check('Cambio de contraseña: rechaza la actual incorrecta', async () => {
      await page.fill('input[placeholder="Contraseña actual"]', 'incorrecta');
      await page.fill('input[placeholder="Nueva contraseña"]', 'nueva-clave-2');
      await page.fill('input[placeholder="Confirmar nueva contraseña"]', 'nueva-clave-2');
      await page.getByRole('button', { name: 'Actualizar contraseña' }).click();
      expect((await errorText(page))?.includes('actual no es correcta'), 'no rechazó');
    });
    await check('Cambio de contraseña funciona (la vieja deja de valer)', async () => {
      await page.fill('input[placeholder="Contraseña actual"]', 'clave-segura-1');
      await page.getByRole('button', { name: 'Actualizar contraseña' }).click();
      await page.getByText('Contraseña actualizada').waitFor();
      await logoutViaMenu(page);
      await login(page, fanEmail, 'clave-segura-1');
      expect((await errorText(page))?.includes('incorrectos'), 'la contraseña vieja aún funciona');
      await login(page, fanEmail, 'nueva-clave-2');
      await waitPath(page, '/explore');
    });

    console.log('\nSuscripciones y Reserve');
    await check('Suscribirse sin método de pago pide añadir uno y rechaza una tarjeta inválida', async () => {
      await page.goto(`${BASE}/creator/1`);
      await page.getByRole('button', { name: /Suscribirse \$/ }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByTestId('payment-method-form').waitFor();
      await addCard(dialog, '4242 4242 4242 4241');
      await dialog.getByText('El número de tarjeta no es válido').waitFor();
    });
    await check('Suscribirse con tarjeta cobra y persiste tras recargar', async () => {
      const dialog = page.getByRole('dialog');
      await addCard(dialog);
      await dialog.getByText('Visa •••• 4242').waitFor();
      await dialog.getByRole('button', { name: /Suscribirme y pagar/ }).click();
      await page.getByRole('button', { name: /Suscrito/ }).waitFor();
      await page.reload();
      await page.getByRole('button', { name: /Suscrito/ }).waitFor();
    });
    await check('El cobro aparece en el historial y la suscripción muestra su próxima renovación', async () => {
      await page.goto(`${BASE}/settings?section=payments`);
      await page.getByTestId('payment-history').getByText(/Suscripción · Valentina Rose/).waitFor();
      await page.getByTestId('payment-history').getByText('$9.99').waitFor();
      await page.getByTestId('settings-subscriptions').getByText(/Próxima renovación/).waitFor();
      await page.getByTestId('payment-methods').getByText('Principal').waitFor();
    });
    await check('La renovación mensual se cobra en la misma fecha (simulando 2 meses)', async () => {
      await page.evaluate(() => {
        const accounts = JSON.parse(localStorage.getItem('fansreserve_accounts'));
        const id = JSON.parse(localStorage.getItem('fansreserve_session'));
        const me = accounts.find((a) => a.id === id);
        const d = new Date();
        d.setMonth(d.getMonth() - 2);
        d.setDate(Math.min(d.getDate(), 28));
        me.subscriptions[0].since = d.toISOString();
        localStorage.setItem('fansreserve_accounts', JSON.stringify(accounts));
      });
      await page.reload();
      await page.getByTestId('payment-history').getByText(/Renovación · Valentina Rose/).first().waitFor();
      const renewals = await page.getByTestId('payment-history').getByText(/Renovación · Valentina Rose/).count();
      expect(renewals === 2, `se esperaban 2 renovaciones, hay ${renewals}`);
      await page.reload();
      await page.getByTestId('payment-history').getByText(/Renovación · Valentina Rose/).first().waitFor();
      const again = await page.getByTestId('payment-history').getByText(/Renovación · Valentina Rose/).count();
      expect(again === 2, 'la renovación se cobró dos veces');
    });
    await check('Métodos de pago: solo Visa/Mastercard, PayPal y Google Pay; cambiar principal y eliminar', async () => {
      const box = page.getByTestId('payment-methods');
      await box.getByRole('button', { name: /Añadir método de pago/ }).click();
      const tabs = await box.getByRole('tab').allTextContents();
      expect(tabs.join('|') === 'Visa / Mastercard|PayPal|Google Pay', `pestañas: ${tabs.join('|')}`);
      await addCard(box, '3782 822463 10005');
      await box.getByText('Solo aceptamos tarjetas Visa y Mastercard').waitFor();
      await box.getByPlaceholder('Número de tarjeta').fill('5555 5555 5555 4444');
      await box.getByRole('button', { name: 'Guardar método de pago' }).click();
      await box.getByText('Mastercard •••• 4444').waitFor();
      await box.getByRole('button', { name: /Añadir método de pago/ }).click();
      await box.getByRole('tab', { name: 'PayPal' }).click();
      await box.getByPlaceholder('Email de tu cuenta PayPal').fill('ana.paypal');
      await box.getByRole('button', { name: 'Vincular PayPal' }).click();
      await box.getByText('Escribe el email de tu cuenta de PayPal').waitFor();
      await box.getByPlaceholder('Email de tu cuenta PayPal').fill('ana.paypal@test.com');
      await box.getByRole('button', { name: 'Vincular PayPal' }).click();
      await box.getByText('PayPal · an•••@test.com').waitFor();
      await box.getByRole('button', { name: /Añadir método de pago/ }).click();
      await box.getByRole('tab', { name: 'Google Pay' }).click();
      await box.getByPlaceholder('Email de tu cuenta de Google').fill('ana.google@test.com');
      await box.getByRole('button', { name: 'Vincular Google Pay' }).click();
      await box.getByText('Google Pay · an•••@test.com').waitFor();
      await box.locator('div.border', { hasText: 'PayPal · an•••@test.com' }).getByRole('button', { name: 'Hacer principal' }).click();
      await page.reload();
      const rows = page.getByTestId('payment-methods').locator('div.border', { hasText: 'PayPal · an•••@test.com' });
      await rows.getByText('Principal').waitFor();
      await page.getByRole('button', { name: 'Eliminar Google Pay · an•••@test.com' }).click();
      await page.reload();
      expect((await page.getByText('Google Pay · an•••@test.com').count()) === 0, 'no se eliminó');
    });
    await check('Reportar una publicación desde el perfil del creador', async () => {
      await page.goto(`${BASE}/creator/1`);
      await page.getByRole('button', { name: 'Reportar publicación' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Reportar' });
      await dialog.getByRole('button', { name: 'Enviar reporte' }).click();
      await dialog.getByText(/mínimo 10 caracteres/).waitFor();
      await dialog.getByLabel('Descripción del reporte').fill('Esta publicación incumple las normas');
      await dialog.getByRole('button', { name: 'Enviar reporte' }).click();
      await dialog.getByText('Reporte enviado').waitFor();
      await dialog.getByRole('button', { name: 'Cerrar' }).click();
    });
    await check('Bloquear a un creador lo oculta, aparece en Bloqueos y se puede desbloquear', async () => {
      await page.goto(`${BASE}/creator/2`);
      await page.getByRole('button', { name: 'Más opciones' }).click();
      await page.getByRole('menuitem', { name: 'Bloquear' }).click();
      await page.getByText('Has bloqueado a Diego Torres').waitFor();
      await page.goto(`${BASE}/explore`);
      await page.getByText('Valentina Rose').first().waitFor();
      expect((await page.getByText('Diego Torres').count()) === 0, 'sigue apareciendo en Explorar');
      await page.goto(`${BASE}/settings?section=blocking`);
      await page.getByTestId('blocked-users').getByText('Diego Torres').waitFor();
      await page.getByRole('button', { name: 'Desbloquear' }).click();
      await page.getByText('No has bloqueado a ningún usuario').waitFor();
      await page.goto(`${BASE}/explore`);
      await page.getByText('Diego Torres').first().waitFor();
    });
    await check('Un fan puede solicitar la verificación y ve el estado "en revisión"', async () => {
      await submitVerification(page, { birth: '2015-01-01' });
      await page.getByText('Debes ser mayor de 18 años').waitFor();
      await page.fill('input[name=birthDate]', '1992-03-04');
      await page.getByRole('button', { name: 'Enviar para verificación' }).click();
      await page.getByText('Solicitud en revisión').waitFor();
      await page.reload();
      await page.getByText('Solicitud en revisión').waitFor();
    });
    await check('Descargar mis datos genera un archivo JSON', async () => {
      await page.goto(`${BASE}/settings?section=privacy`);
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Descargar/ }).click()]);
      expect(download.suggestedFilename().startsWith('fansreserve-mis-datos'), 'nombre de archivo inesperado');
    });
    await check('La suscripción aparece en el perfil y se puede cancelar', async () => {
      await page.goto(`${BASE}/profile`);
      const subs = page.getByTestId('subscriptions');
      await subs.getByText('Valentina Rose').waitFor();
      await subs.getByRole('button', { name: 'Cancelar' }).click();
      // Cancelling stops the renewals; the paid month stays available.
      await subs.getByText(/Cancelada: acceso hasta/).waitFor();
      await page.reload();
      await page.getByTestId('subscriptions').getByText(/Cancelada: acceso hasta/).waitFor();
      expect((await page.getByTestId('subscriptions').getByRole('button', { name: 'Cancelar' }).count()) === 0, 'se puede cancelar dos veces');
    });
    await check('Reserva VIP exige elegir día y hora', async () => {
      await openBooking(page);
      await page.getByRole('button', { name: /Enviar solicitud/ }).click();
      await page.getByText('Elige un día').waitFor();
    });
    await check('El calendario solo permite reservar hasta 3 meses', async () => {
      const cal = page.getByTestId('booking-calendar');
      let clicks = 0;
      while (await cal.getByRole('button', { name: 'Mes siguiente' }).isEnabled()) {
        await cal.getByRole('button', { name: 'Mes siguiente' }).click();
        clicks++;
        expect(clicks <= 3, 'deja avanzar más de 3 meses');
      }
      // The calendar opens on the month of the first bookable day (tomorrow),
      // so count months from there to the month of the last bookable day.
      const now = new Date();
      const minDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const maxDay = addMonths(now, 3);
      const expected = (maxDay.getFullYear() - minDay.getFullYear()) * 12 + maxDay.getMonth() - minDay.getMonth();
      expect(clicks === expected, `avanzó ${clicks} meses, se esperaban ${expected}`);
      const max = isoDate(maxDay);
      expect((await cal.locator(`button[data-date="${max}"]`).count()) === 1, 'el último mes no incluye la fecha límite');
      const late = cal.locator('button[data-date]');
      for (let i = 0; i < (await late.count()); i++) {
        const d = await late.nth(i).getAttribute('data-date');
        if (d > max) expect(await late.nth(i).isDisabled(), `el día ${d} (después del límite) se puede elegir`);
      }
      for (let i = 0; i < clicks; i++) await cal.getByRole('button', { name: 'Mes anterior' }).click();
      expect(await cal.getByRole('button', { name: 'Mes anterior' }).isDisabled(), 'deja ir a meses pasados');
    });
    await check('Solo se ofrecen los días y horas del creador', async () => {
      const cal = page.getByTestId('booking-calendar');
      const enabled = cal.locator('button[data-date]:not([disabled])');
      for (let i = 0; i < (await enabled.count()); i++) {
        const day = new Date(`${await enabled.nth(i).getAttribute('data-date')}T12:00`).getDay();
        expect(day >= 1 && day <= 5, 'ofrece un día en que el creador no trabaja');
      }
      vipDate = await pickFirstDate(page);
      const hours = await page.getByTestId('time-slots').locator('button:not([disabled])').allTextContents();
      expect(hours.join(',') === '10:00,12:00,16:00,18:00', `horas ofrecidas: ${hours}`);
    });
    await check('La reserva queda esperando la aceptación del creador', async () => {
      await page.getByTestId('time-slots').getByRole('button', { name: '12:00' }).click();
      await page.getByRole('button', { name: /Enviar solicitud/ }).click();
      await page.getByText('¡Solicitud enviada!').waitFor();
      await page.getByRole('link', { name: 'Ver mis reservas' }).click();
      await page.reload();
      const booking = page.getByTestId('booking').filter({ hasText: '12:00' });
      await booking.getByText('Solicitud pendiente').waitFor();
      expect((await booking.getByRole('button', { name: /Pagar/ }).count()) === 0, 'deja pagar antes de que el creador acepte');
      expect((await booking.getByText(/Correo de confirmación/).count()) === 0, 'envió correo antes de tiempo');
    });
    await check('Una hora ya reservada no se vuelve a ofrecer', async () => {
      await openBooking(page);
      await pickDate(page, vipDate);
      expect(await page.getByTestId('time-slots').getByRole('button', { name: '12:00' }).isDisabled(), '12:00 sigue libre');
      for (const h of ['16:00', '18:00']) {
        await openBooking(page);
        await pickDate(page, vipDate);
        await page.getByTestId('time-slots').getByRole('button', { name: h }).click();
        await page.getByRole('button', { name: /Enviar solicitud/ }).click();
        await page.getByText('¡Solicitud enviada!').waitFor();
      }
    });
    await check('Cancelar una reserva pendiente persiste', async () => {
      await page.goto(`${BASE}/profile`);
      await page.getByTestId('booking').filter({ hasText: '18:00' }).getByRole('button', { name: 'Cancelar' }).click();
      await page.reload();
      await page.getByTestId('booking').filter({ hasText: '18:00' }).getByText('Cancelada').waitFor();
    });
    await check('Sin sesión, "Reservar" lleva a login', async () => {
      await logoutViaMenu(page);
      await page.goto(`${BASE}/reserve`);
      await page.getByRole('button', { name: RESERVE_BUTTON }).first().click();
      await waitPath(page, '/login');
    });

    console.log('\nPanel de creador');
    await check('Registro como creador lleva al panel de creador', async () => {
      await register(page, { name: 'Lola Creadora', email: creatorEmail, password: 'clave-creadora-1', role: 'creator' });
      await waitPath(page, '/creator/dashboard');
    });
    await check('Un creador sin verificar no puede publicar', async () => {
      await page.getByTestId('verification-banner').waitFor();
      await page.getByRole('button', { name: /Nueva publicación/ }).click();
      await page.fill('textarea', 'Intento sin verificar');
      await page.getByRole('button', { name: 'Publicar' }).click();
      await page.getByText('Verifica tu identidad antes de publicar contenido').waitFor();
    });
    await check('Verificación: exige las fotos del documento', async () => {
      await page.goto(`${BASE}/settings?section=verification`);
      await page.fill('input[name=legalName]', 'Lola Creadora');
      await page.fill('input[name=birthDate]', '1995-07-07');
      await page.fill('input[name=country]', 'España');
      await page.fill('input[name=docNumber]', 'X1234567');
      await page.getByRole('button', { name: 'Enviar para verificación' }).click();
      await page.getByText('Sube la foto del frente de tu documento').waitFor();
      expect((await page.locator('input[type=file]').count()) === 2, 'la verificación debe pedir solo 2 fotos');
    });
    await check('Verificación: el creador envía documento y selfie', async () => {
      await submitVerification(page, { name: 'Lola Creadora' });
      await page.getByText('Solicitud en revisión').waitFor();
      await page.goto(`${BASE}/creator/dashboard`);
      await page.getByTestId('verification-banner').getByText(/en revisión/).waitFor();
    });
    await check('Admin ve los documentos, rechaza la del fan con motivo y aprueba la del creador', async () => {
      await logoutViaMenu(page);
      await login(page, 'admin@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/admin`);
      await page.getByRole('button', { name: /Verificaciones \(2\)/ }).click();
      const list = page.getByTestId('admin-verifications');
      await list.locator('div.p-4', { hasText: 'Ana Editada' }).getByRole('button', { name: /Revisar documentos/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Revisar documentos' });
      await dialog.getByRole('img', { name: 'Selfie' }).waitFor();
      await dialog.getByRole('button', { name: /Rechazar/ }).click();
      await dialog.getByText('Indica el motivo del rechazo').waitFor();
      await dialog.getByPlaceholder(/Motivo del rechazo/).fill('La foto del documento está borrosa');
      await dialog.getByRole('button', { name: /Rechazar/ }).click();
      await list.locator('div.p-4', { hasText: 'Lola Creadora' }).getByRole('button', { name: /Revisar documentos/ }).click();
      await dialog.getByText('X1234567').or(dialog.getByText('ABC123456')).first().waitFor();
      await dialog.getByRole('button', { name: /Aprobar identidad/ }).click();
      await page.getByText('Identidad de Lola Creadora aprobada').waitFor();
      await list.getByText('No hay solicitudes pendientes').waitFor();
      await list.getByText('Rechazada: La foto del documento está borrosa').waitFor();
    });
    await check('Admin crea un perfil IA sin verificación: lleva P-IA y los humanos verificados Verificado', async () => {
      await page.getByRole('button', { name: /Perfiles gestionados/ }).click();
      const box = page.getByTestId('managed-profiles');
      await box.getByRole('button', { name: /Nuevo perfil/ }).click();
      await page.fill('input[name=managedName]', 'Luna Neón');
      await page.fill('input[name=managedUsername]', 'valentina_rose');
      await page.fill('textarea[name=managedBio]', 'Personaje virtual de moda y lifestyle.');
      await page.fill('input[name=managedPrice]', '7.5');
      await page.setInputFiles('input[name=managedAvatar]', photo('luna.png'));
      await box.getByRole('button', { name: 'Guardar perfil' }).click();
      await box.getByText('Ese nombre de usuario ya existe').waitFor();
      await page.fill('input[name=managedUsername]', 'luna_neon');
      await box.getByRole('button', { name: 'Guardar perfil' }).click();
      await box.getByText('Perfil creado y publicado en Explorar').waitFor();
      await box.getByTestId('managed-row').filter({ hasText: 'Luna Neón' }).getByText('P-IA').waitFor();
      await page.goto(`${BASE}/explore`);
      const card = page.locator('a', { hasText: 'Luna Neón' });
      await card.getByTestId('managed-badge').getByText('P-IA', { exact: true }).waitFor();
      await card.click();
      await page.getByRole('heading', { name: 'Luna Neón' }).waitFor();
      await page.getByTestId('managed-badge').getByText('P-IA', { exact: true }).waitFor();
      expect((await page.getByText('Verificado', { exact: true }).count()) === 0, 'un perfil IA no debe llevar Verificado');
      await page.goto(`${BASE}/creator/1`);
      await page.getByText('Verificado', { exact: true }).waitFor();
      expect((await page.getByTestId('managed-badge').count()) === 0, 'una creadora humana no debe llevar P-IA');
    });
    await check('Admin publica una foto como el perfil IA y la puede borrar', async () => {
      await page.goto(`${BASE}/explore`);
      await page.locator('a', { hasText: 'Luna Neón' }).click();
      await page.getByRole('heading', { name: 'Luna Neón' }).waitFor();
      await page.getByRole('button', { name: 'Publicar como Luna Neón' }).click();
      await page.getByTestId('image-input').setInputFiles(photo('luna-post.png'));
      await page.getByLabel('Texto de la publicación').fill('Primer post de Luna');
      await page.getByTestId('new-post').getByRole('button', { name: 'Publicar' }).click();
      const post = page.getByTestId('post').filter({ hasText: 'Primer post de Luna' });
      await post.getByTestId('post-image').waitFor();
      expect((await post.getByText('Luna Neón').count()) > 0, 'no aparece como Luna Neón');
      await page.reload();
      const again = page.getByTestId('post').filter({ hasText: 'Primer post de Luna' });
      await again.getByRole('button', { name: 'Eliminar publicación' }).click();
      await page.getByText('Publicación eliminada.').waitFor();
      expect((await page.getByTestId('post').filter({ hasText: 'Primer post de Luna' }).count()) === 0, 'no se borró');
    });
    await check('Admin oculta y elimina un perfil gestionado', async () => {
      await page.goto(`${BASE}/admin`);
      await page.getByRole('button', { name: /Perfiles gestionados/ }).click();
      const row = page.getByTestId('managed-row').filter({ hasText: 'Luna Neón' });
      await row.getByRole('button', { name: 'Ocultar' }).click();
      await row.getByText('Oculto').waitFor();
      await page.goto(`${BASE}/explore`);
      await page.getByText('Valentina Rose').first().waitFor();
      expect((await page.getByText('Luna Neón').count()) === 0, 'el perfil oculto sigue en Explorar');
      await page.goto(`${BASE}/admin`);
      await page.getByRole('button', { name: /Perfiles gestionados/ }).click();
      await page.getByTestId('managed-row').filter({ hasText: 'Luna Neón' }).getByRole('button', { name: 'Eliminar' }).click();
      await page.getByText('Perfil eliminado').waitFor();
      expect((await page.getByTestId('managed-row').count()) === 0, 'no se eliminó');
    });
    await check('Admin ve el reporte y retira la publicación reportada', async () => {
      await page.getByRole('button', { name: /Reportes \(2\)/ }).click();
      const table = page.getByTestId('admin-reports');
      await table.getByText('Esta publicación incumple las normas').waitFor();
      await table.getByRole('button', { name: /Retirar contenido/ }).click();
      await table.getByText('Contenido retirado').waitFor();
      await page.goto(`${BASE}/creator/1`);
      await page.getByRole('button', { name: 'Reportar publicación' }).first().waitFor();
      const remaining = await page.getByRole('button', { name: 'Reportar publicación' }).count();
      expect(remaining === 1, `se esperaba 1 publicación visible, hay ${remaining}`);
      await logoutViaMenu(page);
      await login(page, creatorEmail, 'clave-creadora-1');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/creator/dashboard`);
    });
    await check('Nueva publicación se guarda y persiste', async () => {
      expect((await page.getByTestId('verification-banner').count()) === 0, 'sigue el aviso de verificación');
      await page.getByRole('button', { name: /Nueva publicación/ }).click();
      await page.fill('textarea', 'Mi primera publicación de prueba');
      await page.getByRole('button', { name: /Solo suscriptores/ }).click();
      await page.getByRole('button', { name: 'Publicar' }).click();
      await page.getByTestId('created-post').getByText('Mi primera publicación de prueba').waitFor();
      await page.reload();
      await page.getByRole('button', { name: /Contenido/ }).click();
      await page.getByTestId('created-post').getByText('Exclusivo').waitFor();
    });
    await check('Eliminar publicación persiste', async () => {
      await page.getByTestId('created-post').getByRole('button', { name: /Eliminar/ }).click();
      await page.reload();
      await page.getByRole('button', { name: /Contenido/ }).click();
      expect((await page.getByTestId('created-post').count()) === 0, 'la publicación sigue');
    });
    await check('Configuración del panel (precio y bio) se guarda y persiste', async () => {
      await page.getByRole('button', { name: /Configuración/ }).last().click();
      await page.fill('input[name=price]', '14.5');
      await page.fill('textarea[name=bio]', 'Bio guardada');
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      await page.getByText('Cambios guardados exitosamente').waitFor();
      await page.reload();
      await page.getByRole('button', { name: /Configuración/ }).last().click();
      expect((await page.inputValue('input[name=price]')) === '14.5', 'el precio no persistió');
      expect((await page.inputValue('textarea[name=bio]')) === 'Bio guardada', 'la bio no persistió');
    });
    await check('Precio inválido se rechaza', async () => {
      await page.fill('input[name=price]', '0');
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      await page.getByText(/precio debe estar/).waitFor();
    });
    await check('Una creadora nueva crea su experiencia con el asistente y aparece en Reserve', async () => {
      await page.goto(`${BASE}/creator/dashboard?tab=vip`);
      await createExperience(page, { title: 'Clase privada de baile', description: 'Una clase uno a uno por videollamada.', price: 40 });
      await page.getByText('Experiencia publicada.').waitFor();
      await page.getByTestId('vip-experiences-admin').getByTestId('my-experience').filter({ hasText: 'Clase privada de baile' }).waitFor();
      await page.goto(`${BASE}/reserve`);
      await page.getByText('Clase privada de baile').waitFor();
      await page.getByText('Lola Creadora').first().waitFor();
    });
    await check('La creadora que se registra aparece en Explorar', async () => {
      await page.goto(`${BASE}/explore`);
      await page.getByText('Lola Creadora').first().waitFor();
    });

    console.log('\nIngresos y retiros del creador');
    await check('Creadora nueva: saldo 0 y no puede retirar por debajo de $50', async () => {
      await page.goto(`${BASE}/creator/dashboard?tab=earnings`);
      expect((await readAmount(page, 'available-balance')) === 0, 'saldo inicial inesperado');
      expect(await page.getByRole('button', { name: 'Retirar $0.00' }).isDisabled(), 'el botón de retiro no está bloqueado');
      await page.getByText(/Podrás retirar cuando tu saldo disponible llegue a \$50\.00/).waitFor();
      expect((await page.locator('input[name=payoutAmount]').count()) === 0, 'no debe poder elegir el monto');
    });
    await check('Creadora demo: 80% de lo que llega después de PayPal; lo de este mes se acredita el día 1', async () => {
      await logoutViaMenu(page);
      await login(page, 'creator@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/creator/dashboard?tab=earnings`);
      // 80% of the net of each $9.99 payment (minus PayPal's 5.4% + $0.30) is $7.32:
      // subscription + 2 renewals = 21.96 in total, no demo money.
      // The renewal from last month is credited; this month's payments wait for the 1st.
      const available = (await readAmount(page, 'available-balance'));
      const pending = (await readAmount(page, 'pending-balance'));
      expect(Math.abs(available + pending - 21.96) < 0.02, `total inesperado: ${available} + ${pending}`);
      expect(pending >= 7.32, 'el pago de este mes debería estar por acreditar');
      await page.getByText('+$7.32').first().waitFor();
    });
    await check('Con sesión de creadora la portada lleva a su panel en lugar del registro', async () => {
      await page.goto(`${BASE}/`);
      await page.locator('#hero-title').waitFor();
      expect(await page.locator('a[href^="/register"]').count() === 0, 'la portada enlaza al registro con sesión iniciada');
      await page.locator('#hero-title').locator('..').getByRole('link', { name: /Ir a mi panel/ }).waitFor();
      await page.locator('#creator-cta-title').locator('..').getByRole('link', { name: /Ir a mi panel/ }).waitFor();
      await page.locator('footer').getByRole('link', { name: 'Mi panel de creador' }).waitFor();
      await page.goto(`${BASE}/creator/dashboard?tab=earnings`);
    });
    const addSale = (amount, monthsAgo) =>
      page.evaluate(([amount, monthsAgo]) => {
        const data = JSON.parse(localStorage.getItem('fansreserve_platform'));
        const d = new Date();
        d.setUTCDate(10);
        d.setUTCMonth(d.getUTCMonth() - monthsAgo);
        const id = `tx-e2e-${amount}-${monthsAgo}-${data.transactions.length}`;
        data.transactions.push({
          id, key: id, payerId: null, payerName: 'Fan de prueba', creatorProfileId: '1', creatorName: 'Valentina Rose',
          kind: 'subscription', amount, methodLabel: 'Visa •••• 4242', status: 'paid', createdAt: d.toISOString(),
        });
        localStorage.setItem('fansreserve_platform', JSON.stringify(data));
      }, [amount, monthsAgo]);
    await check('Creadora demo: retira el saldo completo a su PayPal, con la comisión descontada', async () => {
      const before = (await readAmount(page, 'available-balance'));
      const pendingBefore = (await readAmount(page, 'pending-balance'));
      await addSale(100, 1); // credited on this month's 1st: +80
      await addSale(50, 0); // paid this month: waits for next 1st (+40 pending)
      await page.reload();
      const available = (await readAmount(page, 'available-balance'));
      expect(Math.abs(available - (before + 80)) < 0.001, `saldo inesperado: ${available}`);
      expect(Math.abs((await readAmount(page, 'pending-balance')) - (pendingBefore + 40)) < 0.001, 'no quedó por acreditar');
      const label = `Retirar ${money(available)}`;
      await page.getByRole('button', { name: label }).click();
      await page.getByText('Añade el email de tu cuenta PayPal para retiros').waitFor();
      await page.getByPlaceholder('Email de tu cuenta PayPal').fill('no-es-email');
      await page.getByRole('button', { name: 'Guardar cuenta' }).click();
      await page.getByText('Escribe el email de tu cuenta PayPal').waitFor();
      await page.getByPlaceholder('Email de tu cuenta PayPal').fill('Valentina.Rose@Example.com');
      await page.getByRole('button', { name: 'Guardar cuenta' }).click();
      await page.getByText('PayPal · va•••@example.com').waitFor();
      // PayPal's fee (2%, at most $20) comes out of the withdrawal.
      const fee = Math.min(Math.round(available * 2) / 100, 20);
      await page.getByText(`Recibirás ${money(available - fee)} (comisión de PayPal ${money(fee)})`).waitFor();
      await page.getByRole('button', { name: label }).click();
      await page.getByText(`Retiro pagado: ${money(available - fee)} enviados a tu cuenta PayPal`).waitFor();
      await waitAmount(page, 'available-balance', '$0.00');
      const paid = page.getByTestId('payouts');
      await paid.getByText('Pagado', { exact: true }).waitFor();
      await paid.getByText(`Retiraste ${money(available)} · PayPal · va•••@example.com`).waitFor();
      await paid.getByText(`Disponías de ${money(available)} · recibes ${money(available - fee)} (comisión de PayPal ${money(fee)})`, { exact: false }).waitFor();
      await paid.locator('i.fa-check-circle.text-green-600').first().waitFor({ state: 'attached' });
      expect(Math.abs((await readAmount(page, 'pending-balance')) - (pendingBefore + 40)) < 0.001, 'se retiró lo que aún no estaba acreditado');
    });
    await check('Los saldos no retirados se acumulan hasta el siguiente retiro', async () => {
      await addSale(40, 1);
      await addSale(40, 2);
      await page.reload();
      expect((await readAmount(page, 'available-balance')) === 64, 'no se acumularon 32 + 32');
      expect(!(await page.getByRole('button', { name: 'Retirar $64.00' }).isDisabled()), 'debería poder retirar');
    });
    await check('La creadora ve a un suscriptor real, lo bloquea y él deja de ver su perfil', async () => {
      await logoutViaMenu(page);
      await login(page, 'fan@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/creator/1`);
      await page.getByRole('button', { name: /Suscribirse \$/ }).first().click();
      await page.getByRole('dialog').getByText('Visa •••• 4242').waitFor();
      await page.getByRole('button', { name: /Suscribirme y pagar/ }).click();
      await page.getByRole('button', { name: /Suscrito/ }).waitFor();
      await logoutViaMenu(page);
      await login(page, 'creator@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/creator/dashboard`);
      await page.getByRole('button', { name: /Suscriptores/ }).click();
      await page.getByText('Carlos M.').waitFor();
      await page.getByRole('button', { name: 'Bloquear a Carlos M.' }).click();
      await page.getByRole('button', { name: 'Desbloquear' }).waitFor();
      await logoutViaMenu(page);
      await login(page, 'fan@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
      await page.getByText('Diego Torres').first().waitFor();
      expect((await page.getByText('Valentina Rose').count()) === 0, 'la creadora que lo bloqueó sigue visible');
      await page.goto(`${BASE}/creator/1`);
      await page.getByText('Perfil no disponible').waitFor();
    });

    console.log('\nPanel de administración');
    await check('Admin solo consulta los retiros: sin botones de pagar o rechazar', async () => {
      await logoutViaMenu(page);
      await login(page, 'admin@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/admin`);
      await page.getByRole('button', { name: 'Retiros', exact: true }).click();
      const box = page.getByTestId('admin-payouts');
      await box.getByText(/Valentina Rose · \$/).first().waitFor();
      await box.getByText('Pagado', { exact: true }).waitFor();
      expect((await box.getByRole('button').count()) === 0, 'el admin aún tiene acciones sobre retiros');
    });
    await check('Admin ve las cuentas reales y puede buscarlas', async () => {
      await logoutViaMenu(page);
      await login(page, 'admin@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/admin`);
      await page.getByRole('button', { name: /Usuarios/ }).click();
      await page.getByText(creatorEmail).waitFor();
      // Sign-ups per country: Ana registered from Honduras with a phone.
      const byCountry = page.getByTestId('admin-countries');
      await byCountry.getByText(/Honduras/).waitFor();
      await page.fill('input[placeholder="Buscar usuario..."]', 'lola');
      await page.getByText(creatorEmail).waitFor();
      expect((await page.getByText(fanEmail).count()) === 0, 'el filtro no funciona');
      await logoutViaMenu(page);
    });

    console.log('\nReserve: creador acepta, fan paga, correo de confirmación');
    await check('El creador configura sus horarios y persisten', async () => {
      await login(page, 'creator@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/creator/dashboard`);
      await openReserveSection(page, 'Disponibilidad');
      const panel = page.getByTestId('vip-availability');
      await panel.getByRole('button', { name: '10:00' }).click();
      await panel.getByRole('button', { name: '20:00' }).click();
      await panel.getByRole('button', { name: 'Guardar horarios' }).click();
      await page.getByText('Horarios guardados').waitFor();
      await page.reload();
      await openReserveSection(page, 'Disponibilidad');
      const saved = page.getByTestId('vip-availability');
      expect((await saved.getByRole('button', { name: '20:00' }).getAttribute('aria-pressed')) === 'true', '20:00 no se guardó');
      expect((await saved.getByRole('button', { name: '10:00' }).getAttribute('aria-pressed')) === 'false', '10:00 no se quitó');
    });
    await check('Reservas en la barra: globito rojo, aviso en la campanita, plazo y "vista" para el fan', async () => {
      await page.goto(`${BASE}/explore`);
      const menu = Number(await page.getByTestId('nav-dashboard').getByTestId('reserve-badge').textContent());
      expect(menu >= 2, `el globito de Mi panel muestra ${menu}`);
      await page.getByTestId('nav-dashboard').click();
      const link = page.getByTestId('dashboard-reservas');
      const count = Number(await link.getByTestId('reserve-badge').textContent());
      expect(count === menu, `el botón Reservas muestra ${count}`);
      const [r, n] = [await link.boundingBox(), await page.getByRole('button', { name: /Nueva publicación/ }).boundingBox()];
      expect(r.x < n.x && Math.abs(r.height - n.height) < 1, 'Reservas no está a la izquierda de Nueva publicación con el mismo alto');
      await page.getByTestId('notification-bell').click();
      await page.getByTestId('notification-panel').getByText('Nueva solicitud de Reserve').first().waitFor();
      await page.getByTestId('notification-bell').click();
      await link.click();
      await page.waitForURL(/tab=vip/);
      const requests = page.getByTestId('vip-requests');
      await requests.getByTestId('vip-request').filter({ hasText: '12:00' }).getByTestId('request-deadline').getByText(/Responde antes del .*quedan \d+ h/).waitFor();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('fansreserve_vip_bookings') || '[]').some((b) => b.time === '12:00' && b.seenAt));
    });
    await check('El creador ve las solicitudes y acepta o rechaza', async () => {
      await openReserveSection(page, 'Solicitudes');
      const requests = page.getByTestId('vip-requests');
      await requests.getByTestId('vip-request').filter({ hasText: '12:00' }).getByRole('button', { name: 'Aceptar' }).click();
      await requests.getByTestId('vip-request').filter({ hasText: '16:00' }).getByRole('button', { name: 'Rechazar' }).click();
      await page.reload();
      await openReserveSection(page, 'Próximas');
      await page.getByTestId('vip-request').filter({ hasText: '12:00' }).getByText('Aceptada · pendiente de pago').waitFor();
      await openReserveSection(page, 'Historial');
      await page.getByTestId('vip-request').filter({ hasText: '16:00' }).getByText('Rechazada', { exact: true }).waitFor();
      await logoutViaMenu(page);
    });
    await check('El fan paga y solo entonces recibe el correo de confirmación', async () => {
      await login(page, fanEmail, 'nueva-clave-2');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/profile`);
      const booking = page.getByTestId('booking').filter({ hasText: '12:00' });
      await booking.getByText('Aceptada · pendiente de pago').waitFor();
      expect((await booking.getByText(/Correo de confirmación/).count()) === 0, 'envió correo antes del pago');
      await payBooking(page, booking);
      await page.reload();
      const paid = page.getByTestId('booking').filter({ hasText: '12:00' });
      await paid.getByText('Confirmada').waitFor();
      await paid.getByText(`Correo de confirmación enviado a ${fanEmail}`).waitFor();
      await page.getByTestId('booking').filter({ hasText: '16:00' }).getByText('Rechazada', { exact: true }).waitFor();
    });
    await check('El fan ve si su solicitud fue vista, cuánto tiene el creador y cuándo expira', async () => {
      // Two copies of a booking: one waiting (seen by the creator), one past its deadline.
      await page.evaluate(() => {
        const key = 'fansreserve_vip_bookings';
        const all = JSON.parse(localStorage.getItem(key) || '[]');
        const base = all.find((b) => b.time === '12:00');
        const soon = new Date(Date.now() + 30 * 3600_000).toISOString();
        all.push({ ...base, id: 'seen-1', time: '14:00', status: 'pending', seenAt: new Date().toISOString(), respondBy: soon, paidAt: undefined, emailSentAt: undefined });
        all.push({ ...base, id: 'late-1', time: '15:00', status: 'pending', seenAt: undefined, respondBy: new Date(Date.now() - 60_000).toISOString(), paidAt: undefined, emailSentAt: undefined });
        localStorage.setItem(key, JSON.stringify(all));
      });
      await page.reload();
      const seen = page.getByTestId('booking').filter({ hasText: '14:00' });
      await seen.getByTestId('request-receipt').getByText(/^Vista por Valentina/).waitFor();
      await seen.getByText(/Valentina tiene hasta el .* para responder/).waitFor();
      const late = page.getByTestId('booking').filter({ hasText: '15:00' });
      await late.getByText('Expirada · sin respuesta').waitFor();
      await late.getByText(/No se te cobró nada/).waitFor();
      expect((await late.getByRole('button', { name: 'Cancelar' }).count()) === 0, 'una solicitud expirada aún se puede cancelar');
      await page.getByTestId('notification-bell').click();
      await page.getByTestId('notification-panel').getByText('Tu solicitud expiró sin respuesta').waitFor();
      await page.getByTestId('notification-bell').click();
      // Leave the store as it was for the next flows.
      await page.evaluate(() => {
        const key = 'fansreserve_vip_bookings';
        localStorage.setItem(key, JSON.stringify(JSON.parse(localStorage.getItem(key)).filter((b) => b.id !== 'seen-1' && b.id !== 'late-1')));
      });
    });
    await check('El pago VIP queda en el historial del fan como cualquier otro pago', async () => {
      await page.goto(`${BASE}/settings?section=payments`);
      await page.getByTestId('payment-history').getByText(/Reserve/).first().waitFor();
    });
    await check('Los nuevos horarios del creador se reflejan al reservar', async () => {
      await openBooking(page);
      await pickFirstDate(page);
      const hours = await page.getByTestId('time-slots').locator('button').allTextContents();
      expect(hours.includes('20:00') && !hours.includes('10:00'), `horas: ${hours}`);
      await page.keyboard.press('Escape');
      await logoutViaMenu(page);
    });

    await check('Olvidé mi contraseña: el enlace del correo permite crear una nueva', async () => {
      const resetTo = async (password) => {
        await page.goto(`${BASE}/login`);
        await page.getByRole('link', { name: /Olvidaste/ }).click();
        await waitPath(page, '/forgot-password');
        await page.fill('input[type=email]', fanEmail);
        await page.getByRole('button', { name: 'Enviar enlace' }).click();
        await page.getByText(/te enviamos un enlace/).waitFor();
        const link = await page.evaluate(() => {
          const mails = JSON.parse(localStorage.getItem('fansreserve_email_outbox'));
          return mails.filter((m) => m.subject === 'Crea una nueva contraseña').pop().body.match(/https?:\/\/\S+/)[0];
        });
        await page.goto(link);
        await page.fill('input[name=newPassword]', password);
        await page.fill('input[name=confirmPassword]', password);
        await page.getByRole('button', { name: 'Guardar contraseña' }).click();
        await page.getByText('Tu contraseña se cambió correctamente.').waitFor();
      };
      await resetTo('clave-recuperada-3');
      await login(page, fanEmail, 'clave-recuperada-3');
      await waitPath(page, '/explore');
      await logoutViaMenu(page);
      await resetTo('nueva-clave-2');
    });
    console.log('\nCierre (eliminación) de cuenta');
    await check('Eliminar cuenta exige contraseña correcta', async () => {
      await login(page, fanEmail, 'nueva-clave-2');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/settings?section=privacy`);
      await page.getByRole('button', { name: 'Eliminar mi cuenta' }).click();
      await page.fill('input[placeholder="Tu contraseña"]', 'incorrecta');
      await page.fill('input[placeholder="Escribe ELIMINAR para confirmar"]', 'ELIMINAR');
      await page.getByRole('button', { name: 'Eliminar definitivamente' }).click();
      expect((await errorText(page))?.includes('no es correcta'), 'no pidió contraseña');
    });
    await check('Eliminar cuenta cierra sesión y borra la cuenta', async () => {
      await page.fill('input[placeholder="Tu contraseña"]', 'nueva-clave-2');
      await page.getByRole('button', { name: 'Eliminar definitivamente' }).click();
      await waitPath(page, '/');
      await page.getByRole('link', { name: 'Iniciar sesión' }).first().waitFor();
      await login(page, fanEmail, 'nueva-clave-2');
      expect((await errorText(page))?.includes('incorrectos'), 'la cuenta borrada aún entra');
    });
    await check('Eliminar la cuenta borra sus métodos de pago y documentos', async () => {
      const data = await platformData(page);
      expect(!data.paymentMethods.some((m) => m.label === 'PayPal · an•••@test.com'), 'quedaron métodos de pago');
      expect(!data.verifications.some((v) => v.userName === 'Ana Editada'), 'quedaron documentos de verificación');
      expect(data.transactions.some((t) => t.payerName === 'Cuenta eliminada'), 'los pagos no se anonimizaron');
    });
    await check('Se puede volver a registrar con el email de la cuenta eliminada', async () => {
      await register(page, { name: 'Ana Vuelve', email: fanEmail, password: 'clave-segura-9' });
      await waitPath(page, '/explore');
    });

    console.log('\nPestañas, "Recordarme", idioma y móvil');
    await check('Cerrar sesión en una pestaña cierra sesión en la otra', async () => {
      const other = await newPage(context);
      await other.goto(`${BASE}/profile`);
      await other.getByText('Ana Vuelve').first().waitFor();
      await logoutViaMenu(page);
      // The other tab was on a protected page, so it must bounce to /login.
      await waitPath(other, '/login');
      await other.close();
    });
    await check('Sin "Recordarme" la sesión no sobrevive a una pestaña nueva', async () => {
      await login(page, 'fan@sugarfans.com', 'demo1234', { remember: false });
      await waitPath(page, '/explore');
      await page.reload();
      await page.locator('button[aria-label="Menú de cuenta"]').waitFor();
      const other = await newPage(context);
      await other.goto(`${BASE}/profile`);
      await waitPath(other, '/login');
      await other.close();
      await logoutViaMenu(page);
    });
    await check('La web se muestra solo en español (sin selector de idioma a medio traducir)', async () => {
      await page.goto(BASE);
      await page.getByRole('link', { name: 'Iniciar sesión' }).first().waitFor();
      expect((await page.locator('button[aria-label="Seleccionar idioma"]').count()) === 0, 'sigue el selector de idioma');
    });
    await context.close();

    // ------------------------------------------------------------------
    const social = await newContext(browser, { locale: 'es-ES', permissions: ['camera', 'microphone'] });
    const cp = await newPage(social);
    const fp = await newPage(social);
    // Both tabs share this browser profile; without "Recordarme" each keeps its own session.
    for (const pg of [cp, fp]) {
      await pg.goto(`${BASE}/age-verification`);
      await pg.getByRole('button', { name: /Soy mayor|18/ }).first().click();
    }
    await login(cp, 'creator@sugarfans.com', 'demo1234', { remember: false });
    await waitPath(cp, '/explore');
    await login(fp, 'fan@sugarfans.com', 'demo1234', { remember: false });
    await waitPath(fp, '/explore');
    const firstPost = (pg) => pg.getByTestId('post').first();

    console.log('\nPublicaciones: fotos, videos, me gusta, comentarios y propinas');
    await check('El creador sube una foto desde "Nueva publicación" y la ve en su panel', async () => {
      await cp.goto(`${BASE}/creator/dashboard`);
      await cp.getByRole('button', { name: /Nueva publicación/ }).click();
      await cp.getByTestId('image-input').setInputFiles(photo('playa.png'));
      await cp.getByTestId('media-preview').locator('img').waitFor();
      await cp.getByLabel('Texto de la publicación').fill('Foto nueva desde la playa');
      await cp.getByRole('button', { name: 'Publicar' }).click();
      await cp.getByText('Publicación creada').waitFor();
      const card = cp.getByTestId('created-post').filter({ hasText: 'Foto nueva desde la playa' });
      await card.locator('img').waitFor();
      expect(await card.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0), 'la foto no carga');
    });
    await check('El creador sube un video exclusivo para suscriptores', async () => {
      const webm = Buffer.from(await recordWebm(cp), 'base64');
      await cp.getByRole('button', { name: /Subir foto o video/ }).click();
      await cp.getByTestId('video-input').setInputFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: webm });
      await cp.getByTestId('media-preview').locator('video').waitFor();
      await cp.getByLabel('Texto de la publicación').fill('Video solo para suscriptores');
      await cp.getByRole('button', { name: /Solo suscriptores/ }).click();
      await cp.getByRole('button', { name: 'Publicar' }).click();
      await cp.getByText('Publicación creada').waitFor();
      const card = cp.getByTestId('created-post').filter({ hasText: 'Video solo para suscriptores' });
      await card.getByText('Exclusivo').waitFor();
      await cp.waitForFunction(() => [...document.querySelectorAll('[data-testid=created-post] video')].some((v) => v.readyState >= 1));
    });
    await check('Un archivo que no es foto ni video se rechaza con un mensaje claro', async () => {
      await cp.getByRole('button', { name: /Subir foto o video/ }).click();
      await cp.getByTestId('image-input').setInputFiles({ name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') });
      await cp.getByText(/Formato no permitido/).waitFor();
      await cp.getByRole('button', { name: 'Cancelar' }).click();
    });
    await check('Lo publicado aparece en el perfil público del creador (foto y video)', async () => {
      await cp.goto(`${BASE}/creator/1`);
      await cp.getByTestId('post').filter({ hasText: 'Foto nueva desde la playa' }).getByTestId('post-image').waitFor();
      await cp.getByTestId('post').filter({ hasText: 'Video solo para suscriptores' }).getByTestId('post-video').waitFor();
      expect((await cp.getByRole('button', { name: 'Más opciones' }).count()) === 0, 'el creador puede darse propina');
    });
    await check('Un fan sin suscripción ve la foto pero no el video exclusivo', async () => {
      await fp.goto(`${BASE}/creator/1`);
      await fp.getByTestId('post').filter({ hasText: 'Foto nueva desde la playa' }).getByTestId('post-image').waitFor();
      const locked = fp.getByTestId('post').filter({ hasText: 'Video solo para suscriptores' });
      await locked.getByText('Contenido exclusivo para suscriptores').waitFor();
      expect((await locked.getByTestId('post-video').count()) === 0, 'el video exclusivo se ve sin suscripción');
    });
    await check('Me gusta (corazón) suma, se guarda y se puede quitar', async () => {
      const post = fp.getByTestId('post').filter({ hasText: 'Foto nueva desde la playa' });
      expect((await post.getByTestId('like-count').textContent()) === '0', 'contador inicial');
      await post.getByRole('button', { name: 'Me gusta' }).click();
      await post.getByRole('button', { name: 'Quitar me gusta' }).waitFor();
      expect((await post.getByTestId('like-count').textContent()) === '1', 'no sumó el me gusta');
      await fp.reload();
      const again = fp.getByTestId('post').filter({ hasText: 'Foto nueva desde la playa' });
      await again.getByRole('button', { name: 'Quitar me gusta' }).click();
      await again.getByRole('button', { name: 'Me gusta' }).waitFor();
      expect((await again.getByTestId('like-count').textContent()) === '0', 'no quitó el me gusta');
      // A demo post: 342 likes shipped + mine.
      const demo = fp.getByTestId('post').filter({ hasText: 'Nuevo set de fotos desde la playa' });
      await demo.getByRole('button', { name: 'Me gusta' }).click();
      await demo.getByText('343').waitFor();
    });
    await check('Me gusta en contenido bloqueado pide suscribirse', async () => {
      const locked = fp.getByTestId('post').filter({ hasText: 'Video solo para suscriptores' });
      await locked.getByRole('button', { name: 'Me gusta' }).click();
      await locked.getByText('Suscríbete para interactuar con este contenido').waitFor();
    });
    await check('Comentarios: el fan comenta y el comentario persiste', async () => {
      const post = fp.getByTestId('post').filter({ hasText: 'Foto nueva desde la playa' });
      await post.getByRole('button', { name: 'Comentarios' }).click();
      await post.getByText('Sé el primero en comentar.').waitFor();
      await post.getByLabel('Escribe un comentario').fill('¡Qué linda foto!');
      await post.getByRole('button', { name: 'Comentar', exact: true }).click();
      await post.getByTestId('comment').filter({ hasText: '¡Qué linda foto!' }).getByText('Carlos M.').waitFor();
      await fp.reload();
      const again = fp.getByTestId('post').filter({ hasText: 'Foto nueva desde la playa' });
      expect((await again.getByTestId('comment-count').textContent()) === '1', 'el contador no subió');
      await again.getByRole('button', { name: 'Comentarios' }).click();
      await again.getByTestId('comment').filter({ hasText: '¡Qué linda foto!' }).waitFor();
    });
    await check('Propina: el fan elige monto, paga y el creador la recibe', async () => {
      const post = fp.getByTestId('post').filter({ hasText: 'Foto nueva desde la playa' });
      await post.getByRole('button', { name: 'Propina' }).click();
      const dialog = fp.getByRole('dialog', { name: /Propina para/ });
      await dialog.getByRole('button', { name: '$10' }).click();
      await dialog.getByRole('button', { name: /Continuar/ }).click();
      await fp.getByRole('button', { name: /Enviar propina \$10\.00/ }).click();
      await fp.getByText('¡Gracias! Tu propina de $10.00 llegó a Valentina Rose.').waitFor();
      const tips = (await platformData(fp)).transactions.filter((t) => t.kind === 'tip');
      expect(tips.length === 1 && tips[0].amount === 10 && tips[0].creatorProfileId === '1', 'la propina no se registró');
    });
    await check('Propina con monto inválido se rechaza', async () => {
      await fp.getByRole('button', { name: 'Más opciones' }).click();
      await fp.getByRole('menuitem', { name: 'Enviar propina' }).click();
      const dialog = fp.getByRole('dialog', { name: /Propina para/ });
      await dialog.getByLabel('Otro monto (USD)').fill('2');
      await dialog.getByRole('button', { name: /Continuar/ }).click();
      await dialog.getByText('La propina debe estar entre $3 y $500').waitFor();
      await dialog.getByRole('button', { name: 'Cerrar' }).click();
    });
    await check('El creador ve la propina en su panel y puede borrar comentarios', async () => {
      await cp.goto(`${BASE}/creator/dashboard`);
      await cp.getByText('Propina - Carlos M.').waitFor();
      await cp.goto(`${BASE}/creator/1`);
      const post = cp.getByTestId('post').filter({ hasText: 'Foto nueva desde la playa' });
      await post.getByRole('button', { name: 'Comentarios' }).click();
      await post.getByTestId('comment').filter({ hasText: '¡Qué linda foto!' }).getByRole('button', { name: 'Eliminar comentario' }).click();
      await post.getByText('Sé el primero en comentar.').waitFor();
    });
    await check('Eliminar una publicación la quita del perfil público', async () => {
      await cp.goto(`${BASE}/creator/dashboard?tab=content`);
      await cp.getByTestId('created-post').filter({ hasText: 'Foto nueva desde la playa' }).getByRole('button', { name: /Eliminar/ }).click();
      await cp.getByText('Publicación eliminada').waitFor();
      await fp.goto(`${BASE}/creator/1`);
      await firstPost(fp).waitFor();
      expect((await fp.getByTestId('post').filter({ hasText: 'Foto nueva desde la playa' }).count()) === 0, 'la publicación sigue visible');
    });

    console.log('\nSesiones VIP en vivo');
    let liveDate = '';
    await check('Una reserva confirmada muestra cuándo se abre la sala en vivo', async () => {
      await openBooking(fp);
      liveDate = await pickFirstDate(fp);
      await fp.getByTestId('time-slots').getByRole('button', { name: '12:00' }).click();
      await fp.getByRole('button', { name: /Enviar solicitud/ }).click();
      await fp.getByText('¡Solicitud enviada!').waitFor();
      await cp.goto(`${BASE}/creator/dashboard?tab=vip`);
      await openReserveSection(cp, 'Solicitudes');
      await cp.getByTestId('vip-request').filter({ hasText: '12:00' }).getByRole('button', { name: 'Aceptar' }).click();
      await fp.goto(`${BASE}/profile`);
      const booking = fp.getByTestId('booking').filter({ hasText: '12:00' });
      await payBooking(fp, booking);
      await booking.getByText('Confirmada').waitFor();
      await booking.getByTestId('live-later').waitFor();
      expect((await booking.getByTestId('join-live').count()) === 0, 'la sala se abre antes de tiempo');
    });
    await check('Antes de la hora la sala no deja entrar', async () => {
      const href = await fp.evaluate(() => JSON.parse(localStorage.getItem('fansreserve_vip_bookings')).find((b) => b.time === '12:00' && b.status === 'confirmed').id);
      await fp.goto(`${BASE}/live/${href}`);
      await fp.getByTestId('live-unavailable').getByText(/La sala se abre el/).waitFor();
    });
    // The video itself goes through LiveKit: npm run e2e:live tests it against a real server.
    await check('A la hora reservada se entra a la sala; sin servidor de video avisa en vez de colgarse', async () => {
      const at = new Date(`${liveDate}T12:05:00`);
      await fp.clock.setFixedTime(at);
      await fp.goto(`${BASE}/profile`);
      await fp.getByTestId('booking').filter({ hasText: '12:00' }).getByTestId('join-live').click();
      await fp.getByTestId('live-lobby').getByText(/con Valentina Rose/).waitFor();
      await fp.getByRole('button', { name: 'Entrar a la sala' }).click();
      await fp.getByTestId('live-lobby').getByRole('alert').getByText('La videollamada solo funciona en la web publicada.').waitFor();
    });
    await social.close();

    // ------------------------------------------------------------------
    const giftsCtx = await newContext(browser, { locale: 'es-ES' });
    const gc = await newPage(giftsCtx);
    const gf = await newPage(giftsCtx);
    for (const pg of [gc, gf]) {
      await pg.goto(`${BASE}/age-verification`);
      await pg.getByRole('button', { name: /Soy mayor|18/ }).first().click();
    }
    await login(gc, 'creator@sugarfans.com', 'demo1234', { remember: false });
    await waitPath(gc, '/explore');
    await login(gf, 'fan@sugarfans.com', 'demo1234', { remember: false });
    await waitPath(gf, '/explore');
    const giftsData = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('fansreserve_gifts') || '{}'));
    const balanceText = (page) => page.getByTestId('wallet-balance').textContent();
    const buyPack = async (page, name, price) => {
      await page.getByRole('button', { name: 'Comprar créditos' }).first().click();
      await page.getByRole('dialog', { name: 'Comprar créditos' }).getByTestId('coin-pack').filter({ hasText: name }).click();
      await page.getByRole('button', { name: `Comprar créditos ${price}` }).click();
    };
    const openGift = async (page) => {
      await page.goto(`${BASE}/creator/1`);
      await page.getByRole('button', { name: 'Enviar regalo' }).click();
      return page.getByRole('dialog', { name: /Regalo para Valentina Rose/ });
    };
    // Coins bought on another day (keeps the daily limit out of the way).
    const grantCoins = (page, coins) =>
      page.evaluate((c) => {
        const s = JSON.parse(localStorage.getItem('fansreserve_gifts') || '{}');
        const old = new Date(Date.now() - 3 * 86400000).toISOString();
        s.purchases = [...(s.purchases || []), { id: 'seed-' + c, userId: 'demo-fan', packId: 'tesoro', coins: c, price: c / 100, methodLabel: 'Visa •••• 4242', createdAt: old }];
        localStorage.setItem('fansreserve_gifts', JSON.stringify(s));
      }, coins);

    console.log('\nRegalos: créditos y apoyo, sin Círculo ni Bóveda');
    await check('Créditos: el fan compra un paquete neto y recibe el valor completo', async () => {
      await gf.goto(`${BASE}/settings?section=wallet`);
      expect((await balanceText(gf)).includes('0'), 'el saldo inicial no es 0');
      await buyPack(gf, 'Básico', '$9.99');
      await gf.getByText('Compra completada: 1,000 créditos añadidos').waitFor();
      expect((await balanceText(gf)).includes('1,000'), 'no se acreditaron 1,000 créditos');
      await gf.getByTestId('coin-purchase').filter({ hasText: '$9.99' }).waitFor();
    });
    await check('El fan encuentra sus Créditos en Mi perfil y en el menú de su cuenta', async () => {
      await gf.goto(`${BASE}/profile`);
      const link = gf.getByTestId('profile-wallet');
      await link.getByText('Créditos: 1,000').waitFor();
      await link.click();
      await gf.getByTestId('wallet-balance').waitFor();
      await gf.goto(`${BASE}/`);
      await gf.getByRole('button', { name: 'Menú de cuenta' }).click();
      await gf.getByRole('link', { name: 'Créditos', exact: true }).click();
      await gf.getByTestId('wallet-balance').waitFor();
    });
    await check('Regalos: nombres y categorías Identity V1, completos y en créditos', async () => {
      const dialog = await openGift(gf);
      for (const cat of ['Reacciones', 'Celebración', 'Especiales', 'Prestige', 'Leyenda']) await dialog.getByText(cat, { exact: true }).waitFor();
      for (const name of ['Abrazo', 'Estreno', 'Sorpresa', 'Rosas', 'Flor de Cerezo', 'Corazón de Cristal', 'Medalla de Oro', 'Jet Privado'])
        await dialog.getByRole('button', { name: new RegExp(`^${name}, `) }).waitFor();
      const cut = await dialog.locator('.gift-tile span[title]').evaluateAll((els) =>
        els.filter((e) => e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
      expect(cut.length === 0, `nombres de regalos cortados: ${cut.join(', ')}`);
      const text = await dialog.innerText();
      expect(/créditos/.test(text) && !/terrones|coins|tokens/i.test(text), 'el regalo no habla en créditos');
      await dialog.getByRole('button', { name: 'Cerrar' }).click();
      await gf.goto(`${BASE}/settings?section=wallet`);
    });
    await check('Sin verificar su identidad, el fan no puede comprar más de $300 al día', async () => {
      await buyPack(gf, 'Premium', '$249.99');
      await gf.getByText('Compra completada: 25,000 créditos añadidos').waitFor();
      await buyPack(gf, 'Pro', '$49.99');
      await gf.getByRole('alert').getByText(/puedes comprar hasta \$300 al día/).waitFor();
      await gf.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();
      expect((await balanceText(gf)).includes('26,000'), 'el saldo no es 26,000');
    });
    await check('El panel de regalos explica que no desbloquean nada (sin Círculo, Bóveda ni video)', async () => {
      await gc.goto(`${BASE}/creator/dashboard?tab=gifts`);
      await gc.getByTestId('gift-perks-retired').getByText(/no desbloquean acceso, videos ni videollamadas/).waitFor();
      expect(!/Círculo|Bóveda/.test(await gc.getByTestId('creator-gifts').innerText()), 'el panel de regalos aún habla del Círculo o la Bóveda');
      expect((await gc.locator('input[name=circleMin]').count()) === 0, 'el creador aún configura una entrada al Círculo por regalos');
      expect((await gc.getByLabel(/Ofrezco video personalizado/).count()) === 0, 'el creador aún ofrece video por regalos');
      expect((await gc.getByTestId('perk-request').count()) === 0, 'hay pedidos de regalos sin regalos anteriores');
    });
    await check('El perfil del creador ya no tiene Círculo', async () => {
      await gf.goto(`${BASE}/creator/1`);
      await gf.getByRole('button', { name: /Publicaciones/ }).waitFor();
      expect((await gf.getByRole('button', { name: /Círculo/ }).count()) === 0, 'el perfil aún muestra la pestaña Círculo');
      await gf.goto(`${BASE}/creator/1?tab=circle`);
      await gf.getByRole('button', { name: /Publicaciones/ }).waitFor();
      expect((await gf.getByTestId('circle-section').count()) === 0, '?tab=circle aún abre el Círculo');
    });
    await check('El fan envía una Corona: es apoyo y no promete nada', async () => {
      const dialog = await openGift(gf);
      await dialog.getByRole('button', { name: /Corona/ }).click();
      await dialog.getByRole('button', { name: /Enviar Corona/ }).waitFor();
      expect((await dialog.getByTestId('notice-gift').count()) === 0, 'la ventana de regalo aún muestra la leyenda de apoyo voluntario');
      expect((await dialog.getByTestId('gift-perks').count()) === 0, 'el regalo promete beneficios');
      expect((await dialog.getByLabel('Qué quieres en tu video').count()) === 0, 'el regalo pide un video personalizado');
      await dialog.getByLabel('Mensaje del regalo').fill('¡Para mi reina!');
      expect(!/\d+\s*%/.test(await dialog.innerText()), 'el fan ve el porcentaje que recibe el creador');
      const art = dialog.getByRole('button', { name: /Corona/ }).locator('img.gift-art');
      expect(await art.evaluate((img) => img.complete && img.naturalWidth > 0), 'la ilustración 3D del regalo no cargó');
      await dialog.getByRole('button', { name: /Enviar Corona/ }).click();
      await gf.getByTestId('gift-celebration').getByText('¡Corona para Valentina Rose!').waitFor();
      await gf.getByText('¡👑 Corona enviado a Valentina Rose!').waitFor();
      const gifts = (await platformData(gf)).transactions.filter((t) => t.kind === 'gift');
      expect(gifts.length === 1 && gifts[0].amount === 100 && gifts[0].share === 0.6, 'el regalo no se registró con 60%');
      expect(((await giftsData(gf)).perks || []).length === 0, 'el regalo creó un beneficio');
    });
    await check('Sin créditos suficientes el regalo pide comprar más', async () => {
      const dialog = await openGift(gf);
      await dialog.getByRole('button', { name: /Castillo/ }).click();
      await dialog.getByRole('button', { name: 'Te faltan 84,000 créditos · Comprar' }).waitFor();
      await dialog.getByRole('button', { name: 'Cerrar' }).click();
    });
    await check('Un regalo grande (Castillo) tampoco da video ni videollamada', async () => {
      await grantCoins(gf, 150000);
      const dialog = await openGift(gf);
      await dialog.getByRole('button', { name: /Castillo/ }).click();
      await dialog.getByRole('button', { name: /Enviar Castillo/ }).waitFor();
      expect((await dialog.getByText(/Video personalizado|Videollamada|Bóveda/).count()) === 0, 'el regalo promete video, videollamada o Bóveda');
      await dialog.getByRole('button', { name: /Enviar Castillo/ }).click();
      await gf.getByText(/Castillo enviado/).waitFor();
      expect(((await giftsData(gf)).perks || []).length === 0, 'el Castillo creó un beneficio');
    });
    await check('Un video ganado con un regalo anterior al cambio se sigue entregando', async () => {
      // Seeds a perk from before gift perks were retired.
      await gc.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('fansreserve_gifts') || '{}');
        const tx = JSON.parse(localStorage.getItem('fansreserve_platform')).transactions.find((t) => t.giftId === 'castillo');
        s.perks = [...(s.perks || []), {
          id: 'legacy-video', transactionId: tx.id, fanId: tx.payerId, fanName: tx.payerName, creatorProfileId: '1', creatorName: 'Valentina Rose',
          kind: 'video', request: 'Un saludo para mi hermano', status: 'pending',
          dueAt: new Date(Date.now() + 5 * 86400000).toISOString(), createdAt: '2026-10-01T12:00:00.000Z',
        }];
        localStorage.setItem('fansreserve_gifts', JSON.stringify(s));
      });
      await gc.goto(`${BASE}/creator/dashboard?tab=gifts`);
      const video = gc.getByTestId('perk-request').filter({ hasText: 'Video personalizado' }).filter({ hasText: 'Pendiente' });
      await video.getByText('“Un saludo para mi hermano”').waitFor();
      const webm = Buffer.from(await recordWebm(gc), 'base64');
      await video.locator('input[name=perkVideo]').setInputFiles({ name: 'saludo.webm', mimeType: 'video/webm', buffer: webm });
      await gc.getByText('Video entregado a Carlos M.').waitFor();
      await gf.goto(`${BASE}/settings?section=wallet`);
      await gf.getByTestId('my-perk').filter({ hasText: 'Video entregado' }).locator('video').waitFor();
    });
    await check('El creador cobra el 60% de los regalos', async () => {
      await gc.goto(`${BASE}/creator/dashboard?tab=gifts`);
      await gc.getByTestId('gift-earnings').getByText('$660.00').waitFor();
      await gc.goto(`${BASE}/creator/dashboard?tab=earnings`);
      await gc.getByText(/Corona · “¡Para mi reina!”/).waitFor();
    });
    await check('Notas antiguas de regalos (Corona de azúcar, Castillo de azúcar...) se muestran con el nombre actual', async () => {
      await gc.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('fansreserve_platform'));
        for (const t of s.transactions) {
          if (t.giftId === 'corona') t.note = t.note.replace(/^Corona/, 'Corona de azúcar');
          if (t.giftId === 'castillo') t.note = 'Castillo de azúcar';
        }
        localStorage.setItem('fansreserve_platform', JSON.stringify(s));
      });
      await gc.goto(`${BASE}/creator/dashboard?tab=earnings`);
      await gc.getByText(/Corona · “¡Para mi reina!”/).waitFor();
      await gc.goto(`${BASE}/creator/dashboard?tab=gifts`);
      await gc.getByTestId('gift-received').first().waitFor();
      const text = await gc.locator('body').innerText();
      expect(!/de azúcar|de caramelo|terrones/i.test(text), 'se ven nombres antiguos de regalos o de la moneda');
    });
    await giftsCtx.close();

    // ------------------------------------------------------------------
    const rewardsCtx = await newContext(browser, { locale: 'es-ES' });
    const rc = await newPage(rewardsCtx);
    const rf = await newPage(rewardsCtx);
    for (const pg of [rc, rf]) {
      await pg.goto(`${BASE}/age-verification`);
      await pg.getByRole('button', { name: /Soy mayor|18/ }).first().click();
    }
    await login(rc, 'creator@sugarfans.com', 'demo1234', { remember: false });
    await waitPath(rc, '/explore');
    // Paid fans for creator profile 1: `count` payers on `at`, optionally joined through the link.
    const seedFans = (page, count, at, referred) =>
      page.evaluate(({ count, at, referred }) => {
        const p = JSON.parse(localStorage.getItem('fansreserve_platform') || '{}');
        const refs = JSON.parse(localStorage.getItem('fansreserve_referrals') || '[]');
        for (let i = 0; i < count; i++) {
          const fanId = `seed-${at}-${i}`;
          p.transactions = [...(p.transactions || []), {
            id: fanId, key: fanId, payerId: fanId, payerName: `Fan ${i}`, creatorProfileId: '1', creatorName: 'Valentina Rose',
            kind: 'subscription', amount: 9.99, share: 0.8, methodLabel: 'Visa •••• 4242', status: 'paid', createdAt: at,
          }];
          if (referred) refs.push({ fanId, creatorProfileId: '1', joinedAt: at });
        }
        localStorage.setItem('fansreserve_platform', JSON.stringify(p));
        localStorage.setItem('fansreserve_referrals', JSON.stringify(refs));
      }, { count, at, referred });
    const openRewards = async () => {
      await rc.goto(`${BASE}/creator/dashboard?tab=rewards`);
      return rc.getByTestId('rewards-panel');
    };
    const openGoals = async () => {
      await rc.goto(`${BASE}/creator/dashboard?tab=goals`);
      return rc.getByTestId('goals-panel');
    };

    console.log('\nRecompensas para creadores: niveles, medallas, enlace, invitaciones y Meta de experiencia');
    const W = await loadRewardRules();
    await check('El creador ve su nivel, su parte, lo que desbloquea cada nivel, sus medallas y su enlace', async () => {
      const panel = await openRewards();
      await panel.getByTestId('rewards-level').getByText('Bronce').waitFor();
      await panel.getByTestId('rewards-share').getByText('80%').waitFor();
      await panel.getByText(/después de la comisión de PayPal/).first().waitFor();
      expect((await panel.getByTestId('level-card').count()) === 4, 'no se ven los 4 niveles');
      await panel.getByTestId('level-card').filter({ hasText: 'Oro' }).getByText(/Retiras desde \$25/).waitFor();
      await panel.getByTestId('level-next').getByText(/Para Plata: 10 fans activos más/).waitFor();
      expect((await panel.getByTestId('referral-link').inputValue()).endsWith('/r/1'), 'el enlace no apunta a /r/1');
      await panel.getByText(/85% de lo que te pague durante 60 días/).waitFor();
      const goals = await openGoals();
      await goals.getByTestId('next-goal').getByText('Llegar a Plata').waitFor();
      await goals.getByRole('progressbar', { name: 'Fans activos' }).waitFor();
      for (const m of ['primer-reserve', 'iman', 'puntual', 'constante', 'embajador']) await goals.getByTestId(`medal-${m}`).waitFor();
      expect((await goals.getByTestId('medal-iman').getAttribute('data-earned')) === 'false', 'Imán ganado sin fans');
    });
    await check('Un fan que llega con el enlace queda invitado y el creador cobra el 85% del neto de su suscripción', async () => {
      await rf.goto(`${BASE}/r/1`);
      await waitPath(rf, '/creator/1');
      await register(rf, { name: 'Lucía Invitada', email: 'lucia.invitada@test.com', password: 'password123' });
      await waitPath(rf, '/explore');
      await rf.goto(`${BASE}/creator/1`);
      await rf.getByRole('button', { name: /Suscribirse \$/ }).first().click();
      const dialog = rf.getByRole('dialog');
      await addCard(dialog);
      await dialog.getByText('Visa •••• 4242').waitFor();
      await dialog.getByRole('button', { name: /Suscribirme y pagar/ }).click();
      await rf.getByRole('button', { name: /Suscrito/ }).waitFor();
      const sub = (await platformData(rf)).transactions.find((t) => t.payerName === 'Lucía Invitada');
      const want = W.netShare(0.85, sub.amount);
      expect(sub?.share === want && sub.gatewayFee === W.processorFee(sub.amount), `la suscripción del invitado no paga 85% del neto (${sub?.share} ≠ ${want})`);
      const panel = await openRewards();
      await panel.getByTestId('referred-fan').filter({ hasText: 'Lucía Invitada' }).getByText(/85% hasta el/).waitFor();
      await panel.getByTestId('rewards-attracted').getByText('1', { exact: true }).waitFor();
    });
    await check('Un fan que se registra sin enlace no cuenta como invitado', async () => {
      // Lucía's sign-up used up the link: signing up again from this browser counts nobody.
      await logoutViaMenu(rf);
      await register(rf, { name: 'Pedro Directo', email: 'pedro.directo@test.com', password: 'password123' });
      await waitPath(rf, '/explore');
      const refs = await rf.evaluate(() => JSON.parse(localStorage.getItem('fansreserve_referrals') || '[]'));
      expect(refs.length === 1, `se registró un invitado de más (${refs.length})`);
      await logoutViaMenu(rf);
    });
    await check('Los fans del enlace cuentan doble: con 5 sube a Plata, insignia y "En ascenso" en Explorar, sin subir el porcentaje', async () => {
      await seedFans(rc, 4, new Date(Date.now() - 86400000).toISOString(), true);
      const panel = await openRewards();
      await panel.getByTestId('rewards-level').getByText('Plata').waitFor();
      await panel.getByTestId('rewards-share').getByText('80%').waitFor();
      await rf.goto(`${BASE}/creator/1`);
      await rf.getByTestId('level-badge').getByText('Plata').waitFor();
      await rc.goto(`${BASE}/explore`);
      const card = rc.locator('a[href="/creator/1"]').filter({ has: rc.getByTestId('featured-tag') }).first();
      await card.getByTestId('featured-tag').getByText('En ascenso').waitFor();
    });
    await check('Con 10 fans nuevos del enlace en el mes gana la medalla Imán y sale destacado', async () => {
      await seedFans(rc, 5, new Date(Date.now() - 3600000).toISOString(), true);
      const panel = await openGoals();
      await panel.locator('[data-testid=medal-iman][data-earned=true]').waitFor();
      await panel.getByTestId('medal-boost').waitFor();
      await rc.goto(`${BASE}/explore`);
      const card = rc.locator('a[href="/creator/1"]').filter({ has: rc.getByTestId('featured-tag') }).first();
      await card.getByTestId('featured-tag').getByText('Destacado').waitFor();
    });
    await check('Un fan sin enlace paga el 80% del neto aunque el creador sea Plata', async () => {
      await login(rf, 'fan@sugarfans.com', 'demo1234');
      await waitPath(rf, '/explore');
      await rf.goto(`${BASE}/creator/1`);
      await rf.getByRole('button', { name: /Suscribirse \$/ }).first().click();
      await rf.getByRole('dialog').getByText('Visa •••• 4242').waitFor();
      await rf.getByRole('button', { name: /Suscribirme y pagar/ }).click();
      await rf.getByRole('button', { name: /Suscrito/ }).waitFor();
      const sub = (await platformData(rf)).transactions.find((t) => t.payerId === 'demo-fan' && t.kind === 'subscription');
      expect(sub?.share === W.netShare(0.8, sub.amount), `la suscripción no se registró al 80% del neto (${sub?.share})`);
    });
    // Signs a creator up through Valentina's creator link and returns their profile id.
    const inviteCreator = async (name, email) => {
      await logoutViaMenu(rf);
      await rf.goto(`${BASE}/r/1?as=creator`);
      await waitPath(rf, '/register');
      await register(rf, { name, email, password: 'password123', role: 'creator' });
      await waitPath(rf, '/creator/dashboard');
      return rf.evaluate((e) => JSON.parse(localStorage.getItem('fansreserve_accounts')).find((a) => a.email === e).creatorProfileId, email);
    };
    // The invited creator is verified and has sold their first $100.
    const qualify = (creatorId) =>
      rf.evaluate((id) => {
        const accounts = JSON.parse(localStorage.getItem('fansreserve_accounts'));
        accounts.find((a) => a.creatorProfileId === id).isVerified = true;
        localStorage.setItem('fansreserve_accounts', JSON.stringify(accounts));
        const p = JSON.parse(localStorage.getItem('fansreserve_platform') || '{}');
        const at = new Date(Date.now() - 86400000).toISOString();
        p.transactions = [...(p.transactions || []), {
          id: `sale-${id}`, key: `sale-${id}`, payerId: `buyer-${id}`, payerName: 'Comprador', creatorProfileId: id, creatorName: 'Invitado',
          kind: 'tip', amount: 100, share: 0.75, methodLabel: 'Visa •••• 4242', status: 'paid', createdAt: at,
        }];
        localStorage.setItem('fansreserve_platform', JSON.stringify(p));
      }, creatorId);
    const tipAsDemoFan = async (creatorId, name) => {
      await logoutViaMenu(rf);
      await login(rf, 'fan@sugarfans.com', 'demo1234');
      await waitPath(rf, '/explore');
      await rf.goto(`${BASE}/creator/${creatorId}`);
      await rf.getByRole('button', { name: 'Más opciones' }).click();
      await rf.getByRole('menuitem', { name: 'Enviar propina' }).click();
      const dialog = rf.getByRole('dialog', { name: /Propina para/ });
      await dialog.getByRole('button', { name: '$10' }).click();
      await dialog.getByRole('button', { name: /Continuar/ }).click();
      await rf.getByRole('button', { name: /Enviar propina \$10\.00/ }).click();
      await rf.getByText(new RegExp(`Tu propina de \\$10\\.00 llegó a ${name}`)).waitFor();
      const txs = (await platformData(rf)).transactions;
      const tip = txs.filter((t) => t.kind === 'tip' && t.creatorProfileId === creatorId).pop();
      return { tip, bonus: txs.find((t) => t.kind === 'referral' && t.key === `bonus:${tip?.id}`) };
    };
    let maraId = '';
    let nicoId = '';
    await check('Un creador invitado sin verificar ni vender sus primeros $100 todavía no da bono', async () => {
      const panel = await openRewards();
      expect((await panel.getByTestId('creator-invite-link').inputValue()).endsWith('/r/1?as=creator'), 'el enlace de creadores no es /r/1?as=creator');
      maraId = await inviteCreator('Mara Invitada', 'mara.invitada@test.com');
      nicoId = await inviteCreator('Nico Invitado', 'nico.invitado@test.com');
      const { tip, bonus } = await tipAsDemoFan(maraId, 'Mara Invitada');
      expect(tip?.share === W.netShare(0.8, 10), `a la creadora invitada se le descontó (${tip?.share})`);
      expect(!bonus, 'hubo bono con creadores sin verificar ni vender');
    });
    await check('Con 2 invitados verificados y $100 vendidos, quien invita gana 5% del neto un mes, sin descontarles nada', async () => {
      await qualify(maraId);
      await qualify(nicoId);
      const nico = await tipAsDemoFan(nicoId, 'Nico Invitado');
      expect(nico.tip?.share === W.netShare(0.8, 10), `al creador invitado se le descontó (${nico.tip?.share})`);
      const want = W.inviteBonusFor(nico.tip);
      expect(nico.bonus?.creatorProfileId === '1' && nico.bonus.amount === want && nico.bonus.share === 1, `no se generó el bono de $${want} por Nico (${JSON.stringify(nico.bonus)})`);
      // Local mode can also credit sales made after qualifying but before this tip: show what was paid.
      const earned = (await platformData(rf)).transactions
        .filter((t) => t.kind === 'referral' && t.creatorProfileId === '1' && t.note === 'Por Nico Invitado')
        .reduce((sum, t) => sum + t.amount, 0);
      const panel = await openRewards();
      await panel.getByTestId('invited-creator').filter({ hasText: 'Nico Invitado' }).getByText(`$${earned.toFixed(2)} ganados`).waitFor();
      await panel.getByTestId('invited-creator').filter({ hasText: 'Mara Invitada' }).getByText(/bono hasta el/).waitFor();
      await (await openGoals()).locator('[data-testid=medal-embajador][data-earned=true]').waitFor();
    });
    await check('Las propinas de menos de $3 no se aceptan', async () => {
      await rf.goto(`${BASE}/creator/1`);
      await rf.getByRole('button', { name: 'Más opciones' }).click();
      await rf.getByRole('menuitem', { name: 'Enviar propina' }).click();
      const dialog = rf.getByRole('dialog', { name: /Propina para/ });
      expect(!(await dialog.getByRole('button', { name: '$2', exact: true }).count()), 'sigue el botón de $2');
      await dialog.getByRole('button', { name: '$3', exact: true }).waitFor();
      await rf.keyboard.press('Escape');
    });

    console.log('\nMeta de experiencia: regalos y propinas, ruleta y ticket');
    await check('El creador activa su Meta de experiencia con una de sus experiencias', async () => {
      const panel = await openGoals();
      const goal = panel.getByTestId('goal-settings');
      await goal.getByTestId('goal-enabled').check();
      await goal.getByTestId('goal-target').fill('20');
      await goal.locator('label').filter({ hasText: 'Videollamada 1:1' }).getByTestId('goal-experience').check();
      await goal.getByTestId('goal-save').click();
      await goal.getByTestId('goal-saved').waitFor();
    });
    await check('El fan ve su meta en el perfil y la llena con propinas', async () => {
      await rf.goto(`${BASE}/creator/1`);
      const card = rf.getByTestId('goal-card');
      await card.getByTestId('goal-progress').getByText('$0.00 de $20.00').waitFor();
      await card.getByText(/Videollamada 1:1/).waitFor();
      await tipAsDemoFan('1', 'Valentina Rose');
      await tipAsDemoFan('1', 'Valentina Rose');
      await rf.goto(`${BASE}/creator/1`);
      await rf.getByTestId('goal-progress').getByText('$20.00 de $20.00').waitFor();
    });
    await check('Al llenarla elige la experiencia, gira la ruleta (siempre gana un extra) y recibe su ticket', async () => {
      await rf.getByTestId('goal-claim').click();
      const dialog = rf.getByTestId('goal-dialog');
      await dialog.locator('label').filter({ hasText: 'Videollamada 1:1' }).getByTestId('goal-choice').check();
      await dialog.getByTestId('goal-spin').click();
      await dialog.getByTestId('goal-wheel').waitFor();
      const won = dialog.getByTestId('goal-won');
      await won.waitFor({ timeout: 10000 });
      await won.getByText(/10 minutos más|Saludo en su próximo Live|Mensaje de agradecimiento|Foto de recuerdo/).first().waitFor();
      await won.getByText(/vence el/).waitFor();
      await won.getByTestId('goal-won-book').click();
    });
    await check('Reserva con el ticket eligiendo solo día y hora, sin pagar', async () => {
      const dialog = rf.getByTestId('reserve-dialog');
      await dialog.getByTestId('ticket-summary').getByText('Sin costo').waitFor();
      await pickFirstDate(rf);
      await rf.getByTestId('time-slots').locator('button:not([disabled])').first().click();
      await dialog.getByRole('button', { name: 'Reservar con mi ticket' }).click();
      await rf.getByText('¡Solicitud enviada!').waitFor();
      await rf.keyboard.press('Escape');
      await rf.getByTestId('goal-ticket').getByText('Reserva enviada').waitFor();
      await rf.getByTestId('goal-progress').getByText('$0.00 de $20.00').waitFor();
    });
    await check('El creador ve el ticket y el extra en la solicitud, y al aceptarla queda confirmada sin pago', async () => {
      await rc.goto(`${BASE}/creator/dashboard?tab=vip`);
      await openReserveSection(rc, 'Solicitudes');
      const req = rc.getByTestId('vip-requests').getByTestId('vip-request').filter({ has: rc.getByTestId('booking-ticket') });
      await req.getByTestId('booking-ticket-bonus').waitFor();
      expect(!(await req.getByRole('button', { name: 'Contraoferta' }).count()), 'deja hacer contraoferta a un ticket');
      await req.getByRole('button', { name: 'Aceptar' }).click();
      await rf.goto(`${BASE}/profile`);
      await rf.getByTestId('bookings').getByTestId('booking').filter({ has: rf.getByTestId('booking-ticket') }).getByText('Confirmada').waitFor();
      await rf.getByTestId('my-tickets').getByText(/usado/).waitFor();
    });
    await rewardsCtx.close();

    const priceCtx = await newContext(browser, { locale: 'es-ES' });
    const pp = await newPage(priceCtx);
    await check('El precio que la creadora demo pone en su panel es el que ven y pagan los fans', async () => {
      await login(pp, 'creator@sugarfans.com', 'demo1234');
      await waitPath(pp, '/explore');
      await pp.goto(`${BASE}/creator/dashboard`);
      await pp.getByRole('button', { name: /Configuración/ }).last().click();
      await pp.fill('input[name=price]', '12.5');
      await pp.getByRole('button', { name: 'Guardar cambios' }).click();
      await pp.getByText('Cambios guardados exitosamente').waitFor();
      await logoutViaMenu(pp);
      await login(pp, 'fan@sugarfans.com', 'demo1234');
      await waitPath(pp, '/explore');
      await pp.getByText('$12.50/mes').first().waitFor();
      await pp.goto(`${BASE}/creator/1`);
      await pp.getByRole('button', { name: /Suscribirse \$12\.5\/mes|Suscrito/ }).first().waitFor();
    });
    await priceCtx.close();

    const visitor = await newContext(browser, { locale: 'es-ES' });
    const vp = await newPage(visitor);
    await check('La antigua página de precios lleva al registro de creador con sus beneficios', async () => {
      await vp.goto(`${BASE}/age-verification`);
      await vp.getByRole('button', { name: /Soy mayor|18/ }).first().click();
      await vp.goto(`${BASE}/pricing`);
      await waitPath(vp, '/register');
      await vp.fill('input[type=text]', 'Nueva Creadora');
      await vp.fill('input[type=email]', 'nueva.creadora@test.com');
      await vp.getByRole('button', { name: 'Continuar', exact: true }).click();
      const pw = vp.locator('input[type=password]');
      await pw.nth(0).fill('password123');
      await pw.nth(1).fill('password123');
      await vp.getByRole('button', { name: 'Continuar', exact: true }).click();
      await vp.getByTestId('creator-benefits').getByText(/60% de los regalos/).waitFor();
      await vp.getByTestId('creator-benefits').getByText(/Tu enlace de invitación/).waitFor();
    });
    await visitor.close();

    // ------------------------------------------------------------------
    console.log('\nCuentas especiales: links del admin con Reserve al neto y visibilidad');
    const specialCtx = await newContext(browser, { locale: 'es-ES' });
    const sa = await newPage(specialCtx); // admin
    const sc = await newPage(specialCtx); // the invited creator
    for (const pg of [sa, sc]) {
      await pg.goto(`${BASE}/age-verification`);
      await pg.getByRole('button', { name: /Soy mayor|18/ }).first().click();
    }
    let specialUrl = '';
    await check('El admin crea un link de cuenta especial y lo puede copiar', async () => {
      await login(sa, 'admin@sugarfans.com', 'demo1234', { remember: false });
      await waitPath(sa, '/explore');
      await sa.goto(`${BASE}/admin`);
      await sa.getByRole('button', { name: 'Cuentas especiales' }).click();
      const box = sa.getByTestId('special-admin');
      await box.locator('input[name=label]').fill('Gimnasio de Juan');
      await box.locator('input[name=tax]').fill('10');
      await box.getByRole('button', { name: 'Crear link' }).click();
      await box.getByText('Link creado. Cópialo y envíaselo.').waitFor();
      const row = box.getByTestId('special-invite-row').filter({ hasText: 'Gimnasio de Juan' });
      await row.getByText('Activo', { exact: true }).waitFor();
      await row.getByText(/Reserve al neto \(−10% impuesto\) · Visibilidad extra · usado 0 de 1/).waitFor();
      specialUrl = await row.getByTestId('special-invite-url').inputValue();
      expect(/\/especial\/[0-9a-f]{16}$/.test(specialUrl), `link raro: ${specialUrl}`);
    });
    await check('Quien abre el link se registra como creador y el plan se activa solo', async () => {
      await sc.goto(specialUrl);
      await sc.getByText('Te invitaron con un plan especial').waitFor();
      await sc.getByRole('link', { name: 'Crear mi cuenta de creador' }).click();
      await waitPath(sc, '/register');
      await register(sc, { name: 'Juan Gimnasio', email: `juan.gym.${stamp}@test.com`, password: 'password123', role: 'creator' });
      await waitPath(sc, '/creator/dashboard');
      await sc.getByTestId('special-claim-notice').getByText('Tu cuenta ya tiene el plan especial «Gimnasio de Juan».').waitFor();
      await sc.goto(`${BASE}/creator/dashboard?tab=rewards`);
      const plan = sc.getByTestId('special-plan');
      await plan.getByText(/menos la comisión que cobra PayPal por ese pago, el 5% de servicio de Fans Reserve y el 10% de impuesto/).waitFor();
      await plan.getByText(/apareces primero entre los creadores destacados/).waitFor();
    });
    await check('El link de un solo uso ya no sirve para otra cuenta', async () => {
      await logoutViaMenu(sc);
      await register(sc, { name: 'Otra Creadora', email: `otra.${stamp}@test.com`, password: 'password123', role: 'creator' });
      await waitPath(sc, '/creator/dashboard');
      await sc.goto(specialUrl);
      await sc.getByTestId('special-invite-result').getByText('Este link ya se usó todas las veces permitidas').waitFor();
      await sc.goto(`${BASE}/creator/dashboard?tab=rewards`);
      await sc.getByTestId('rewards-panel').waitFor();
      expect((await sc.getByTestId('special-plan').count()) === 0, 'la otra cuenta tiene plan especial');
    });
    await check('La cuenta especial con visibilidad sale primero en destacados', async () => {
      await sc.goto(`${BASE}/explore`);
      const first = sc.locator('a[href^="/creator/"]').filter({ has: sc.getByTestId('featured-tag') }).first();
      await first.waitFor();
      expect((await first.innerText()).includes('Juan Gimnasio'), `el primero destacado es otro: ${(await first.innerText()).split('\n')[0]}`);
    });
    await check('El admin ve la cuenta, y al quitar el plan el creador deja de tenerlo', async () => {
      await sa.reload();
      await sa.getByRole('button', { name: 'Cuentas especiales' }).click();
      const acc = sa.getByTestId('special-account-row').filter({ hasText: 'Juan Gimnasio' });
      await acc.getByText('Plan activo').waitFor();
      await sa.getByTestId('special-invite-row').filter({ hasText: 'Gimnasio de Juan' }).getByText('Usado', { exact: true }).waitFor();
      await acc.getByRole('button', { name: 'Quitar plan' }).click();
      await acc.getByText('Plan quitado').waitFor();
      await logoutViaMenu(sc);
      await login(sc, `juan.gym.${stamp}@test.com`, 'password123', { remember: false });
      await waitPath(sc, '/explore');
      await sc.goto(`${BASE}/creator/dashboard?tab=rewards`);
      await sc.getByTestId('rewards-panel').waitFor();
      expect((await sc.getByTestId('special-plan').count()) === 0, 'sigue mostrando el plan');
    });
    await check('Reserve al neto: monto menos comisión real (o estimada), 5% de servicio e impuesto', async () => {
      const S = await loadSpecialRules();
      const real = S.netReserve(100, 0.15, 5.7);
      expect(real.share === 0.743 && real.gatewayFee === 5.7 && real.service === 5 && real.tax === 15, JSON.stringify(real));
      const est = S.netReserve(50, 0);
      expect(est.share === 0.89 && est.gatewayFee === 3 && est.service === 2.5, JSON.stringify(est));
    });
    await specialCtx.close();

    // ------------------------------------------------------------------
    console.log('\nExplorar por país');
    const countryCtx = await newContext(browser, { locale: 'es-ES' });
    const countryPage = await newPage(countryCtx);
    await check('Explorar filtra creadores por país', async () => {
      await countryPage.goto(`${BASE}/explore`);
      await countryPage.selectOption('[data-testid=explore-country]', 'HN');
      await countryPage.getByRole('heading', { name: 'Andrés Vega' }).first().waitFor();
      await countryPage.getByRole('heading', { name: 'Isabela Cruz' }).first().waitFor();
      expect((await countryPage.getByRole('heading', { name: 'Valentina Rose' }).count()) === 0, 'muestra creadores de otro país');
      await countryPage.goto(`${BASE}/explore?country=MX`);
      await countryPage.getByRole('heading', { name: 'Diego Torres' }).first().waitFor();
      expect((await countryPage.getByRole('heading', { name: 'Andrés Vega' }).count()) === 0, '?country=MX no filtra');
    });
    await countryCtx.close();

    console.log('\nReserve: categorías, experiencias permitidas y seguridad');
    // The product rules themselves (config + moderation), bundled from the sources.
    const R = await loadReserveRules();
    const forbidden = /adult|\+\s?18|sexy|er[oó]tic|xxx/i;
    const notOffered = /encuentro privado|\bcita\b|\bdate\b|hotel|escort|pasar tiempo|acompañ|noche/i;
    await check('No existen categorías "Adultos", "+18" ni similares', async () => {
      const names = R.CREATOR_CATEGORIES.flatMap((c) => [c.name, ...c.aliases]);
      expect(!names.some((n) => forbidden.test(n)), `categorías: ${names.join(', ')}`);
    });
    await check('La verificación de edad no habla de contenido para adultos', async () => {
      const src = readFileSync('src/context/LanguageContext.tsx', 'utf8');
      const texts = [...src.matchAll(/'age\.description': '([^']*)'/g)].map((m) => m[1]);
      expect(texts.length >= 5, `textos: ${texts.length}`);
      const bad = texts.filter((t) => /adult|para adultos|pour adultes|per adulti|explicit/i.test(t));
      expect(!bad.length, `dice: ${bad.join(' | ')}`);
    });
    await check('Los 5 idiomas tienen los mismos textos y el mismo marco de marca', async () => {
      const src = readFileSync('src/context/LanguageContext.tsx', 'utf8');
      const body = src.slice(src.indexOf('const translations'), src.indexOf('export const LanguageProvider'));
      const blocks = Object.fromEntries(
        [...body.matchAll(/\n  (es|en|pt|fr|it): \{([\s\S]*?)\n  \},/g)].map((m) => [m[1], m[2]]),
      );
      expect(Object.keys(blocks).length === 5, `idiomas: ${Object.keys(blocks).join(', ')}`);
      const keysOf = (b) => [...b.matchAll(/'([\w.]+)':/g)].map((m) => m[1]).sort().join(',');
      for (const lang of ['en', 'pt', 'fr', 'it']) {
        expect(keysOf(blocks[lang]) === keysOf(blocks.es), `${lang} no tiene los mismos textos que es`);
      }
      const offBrand = /adult|explicit|xxx|sexy|er[oó]tic|onlyfans|escort|terron|coins?\b|tokens?\b|moedas|pi[eè]ces|monete/i;
      const values = [...body.matchAll(/'[\w.]+': '((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]).filter((v) => !v.includes('@sugarfans.com'));
      const bad = values.filter((v) => offBrand.test(v));
      expect(!bad.length, `fuera de marca: ${bad.join(' | ')}`);
    });
    await check('Tu gente (antes Modelos) existe y marca la línea de contenido', async () => {
      const mg = R.CREATOR_CATEGORIES.find((c) => c.name === 'Tu gente');
      expect(!!mg, 'falta Tu gente');
      expect(R.categoryFor('Modelos').id === 'modelaje-glamour', 'Modelos ya no resuelve a Tu gente');
      expect(!R.CREATOR_CATEGORIES.some((c) => c.id === 'premium-stars'), 'PREMIUM STARS debería seguir oculta');
      expect(mg.contentLine === 'Glamour permitido. Contenido sexual explícito no permitido.', `línea: ${mg.contentLine}`);
      expect(R.categoryFor('Modelaje').id === 'modelaje-glamour', 'el nombre antiguo "Modelaje" no se reconoce');
      expect(R.categoryFor('Modelaje & Glamour').id === 'modelaje-glamour', 'el nombre antiguo "Modelaje & Glamour" no se reconoce');
    });
    await check('Modelos no ofrece citas, compañía, hotel ni escort', async () => {
      const types = R.experienceTypesFor(R.categoryFor('Modelos'));
      const bad = types.filter((t) => notOffered.test(`${t.name} ${t.description}`));
      expect(bad.length === 0, `tipos prohibidos: ${bad.map((t) => t.name).join(', ')}`);
      const locs = R.CREATOR_CATEGORIES.find((c) => c.id === 'modelaje-glamour').locations;
      expect(!locs.some((l) => R.PROHIBITED_LOCATIONS.some((p) => p.id === l)), `ubicaciones: ${locs}`);
    });
    await check('Ningún tipo de experiencia es un servicio prohibido, y la BD acepta exactamente los mismos tipos', async () => {
      const bad = R.RESERVE_EXPERIENCE_TYPES.filter((t) => notOffered.test(`${t.name} ${t.description}`));
      expect(bad.length === 0, `tipos prohibidos: ${bad.map((t) => t.name).join(', ')}`);
      const sql = readFileSync(new URL('../supabase/migrations/20261002000001_reserve.sql', import.meta.url), 'utf8');
      const list = sql.match(/vip_experiences_type_check check \(type in \(([^)]*)\)\)/);
      expect(!!list, 'no se encontró la lista de tipos en la migración');
      const dbIds = [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
      const ids = R.RESERVE_EXPERIENCE_TYPES.map((t) => t.id).sort();
      expect(JSON.stringify(dbIds) === JSON.stringify(ids), `config y BD difieren: ${ids.filter((i) => !dbIds.includes(i))} / ${dbIds.filter((i) => !ids.includes(i))}`);
    });
    await check('Las opciones dependen de la categoría', async () => {
      const cocina = R.experienceTypesFor(R.categoryFor('Cocina')).map((t) => t.id);
      const glamour = R.experienceTypesFor(R.categoryFor('Modelos')).map((t) => t.id);
      const fitness = R.experienceTypesFor(R.categoryFor('Fitness')).map((t) => t.id);
      expect(cocina.includes('cooking-class') && !glamour.includes('cooking-class'), 'clase de cocina mal asignada');
      expect(glamour.includes('photo-session') && !fitness.includes('photo-session'), 'sesión de fotos mal asignada');
      expect(R.locationsFor(R.categoryFor('Fitness'), R.experienceTypeById('training-1-1'), 'presencial').includes('gym'), 'fitness sin gimnasio');
      expect(!R.locationsFor(R.categoryFor('Modelos'), null, 'presencial').includes('restaurant'), 'glamour permite restaurantes');
      expect(R.locationsFor(R.categoryFor('Cocina'), R.experienceTypeById('cooking-class'), 'presencial').includes('fan-place'), 'cocina sin domicilio');
      expect(!R.locationsFor(R.categoryFor('Modelos'), null, 'presencial').some((l) => R.HOME_SERVICE_LOCATIONS.includes(l)), 'Modelos permite domicilio');
      expect(R.locationsFor(R.categoryFor('Arte & Creatividad'), R.experienceTypeById('art-class'), 'presencial').includes('creator-place'), 'arte sin lugar del creator');
      expect(R.locationsFor(R.categoryFor('Educación'), null, 'presencial').includes('fan-place'), 'educación sin lugar del fan en la propuesta');
      expect(!R.locationsFor(R.categoryFor('Modelos'), R.experienceTypeById('photo-session'), 'profesional').some((l) => R.HOME_SERVICE_LOCATIONS.includes(l)), 'sesión de fotos de Modelos a domicilio');
      const home = { title: 'Clase de cocina en tu casa', description: 'Cocinamos pasta fresca.', type: 'cooking-class', price: 80, durationMinutes: 90, image: '', active: true };
      const hd = { ...R.defaultDetails(), modality: 'presencial', locationTypes: ['fan-place'], city: 'CDMX', approval: 'manual' };
      expect(R.validateExperience({ ...home, details: hd }, 'Cocina').ok, 'rechaza cocina a domicilio');
      expect(!R.validateExperience({ ...home, details: { ...hd, approval: 'automatic' } }, 'Cocina').ok, 'acepta domicilio con aprobación automática');
      const shoot = { title: 'Sesión de fotos', description: 'Sesión profesional.', type: 'photo-session', price: 120, durationMinutes: 60, image: '', active: true };
      expect(!R.validateExperience({ ...shoot, details: { ...hd, modality: 'profesional' } }, 'Modelos').ok, 'Modelos acepta domicilio');
    });
    await check('Una experiencia necesita estar definida y moderada para publicarse', async () => {
      const base = { title: 'Sesión de fotos', description: 'Sesión profesional en estudio.', type: 'photo-session', price: 120, durationMinutes: 60, image: '', active: true };
      const d = { ...R.defaultDetails(), modality: 'profesional', locationTypes: ['studio'], city: 'Miami' };
      expect(R.validateExperience({ ...base, details: d }, 'Modelos').ok, 'rechaza una experiencia válida');
      expect(!R.validateExperience({ ...base, type: 'cita' }, 'Modelos').ok, 'acepta un tipo inexistente');
      expect(!R.validateExperience({ ...base, details: { ...d, locationTypes: ['hotel-room'] } }, 'Modelos').ok, 'acepta hotel');
      expect(!R.validateExperience({ ...base, details: d, title: 'Encuentro privado conmigo' }, 'Modelos').ok, 'acepta "encuentro privado"');
      expect(!R.validateExperience({ ...base, details: d, type: 'cooking-class' }, 'Modelos').ok, 'acepta un tipo de otra categoría');
      expect(R.validateExperience({ ...base, details: { ...d, excludes: ['Sin contacto fuera de la app'] }, description: 'Sin contenido sexual: solo moda.' }, 'Modelos').ok, 'las negaciones se bloquean');
      expect(!R.moderate('¿Nos vemos en tu casa? Escríbeme al whatsapp', 'request').ok, 'la solicitud con casa/whatsapp pasa');
    });

    const reserveCtx = await newContext(browser, { locale: 'es-ES' });
    const resC = await newPage(reserveCtx);
    const resF = await newPage(reserveCtx);
    for (const pg of [resC, resF]) {
      await pg.goto(`${BASE}/age-verification`);
      await pg.getByRole('button', { name: /Soy mayor|18/ }).first().click();
    }
    await login(resC, 'creator@sugarfans.com', 'demo1234', { remember: false });
    await waitPath(resC, '/explore');
    await login(resF, 'fan@sugarfans.com', 'demo1234', { remember: false });
    await waitPath(resF, '/explore');

    await check('Explorar y la portada muestran Tu gente y ninguna categoría +18', async () => {
      await resF.goto(`${BASE}/explore`);
      await resF.getByRole('button', { name: /Tu gente/ }).waitFor();
      const chips = (await resF.locator('button[aria-pressed]').allTextContents()).join(' | ');
      expect(!forbidden.test(chips), `categorías visibles: ${chips}`);
      await resF.getByRole('button', { name: /Tu gente/ }).click();
      await resF.getByTestId('creator-card').filter({ hasText: 'Valentina Rose' }).waitFor();
      await resF.goto(`${BASE}/`);
      await resF.getByText('Suscríbete a tus creadores y reserva eventos y sesiones privadas con fecha, precio y reglas claras.').waitFor();
      await resF.locator('#categories-title').getByText('influencers y creadores').waitFor();
      await resF.locator('#comunidades').getByRole('link', { name: /Tu gente/ }).waitFor();
      const how = resF.locator('section[aria-labelledby=how-title]');
      for (const p of ['Seguir', 'Suscribirse', 'Reserve Event', 'Reserve 1:1']) await how.getByText(p, { exact: true }).first().waitFor();
      await resF.locator('#reserve video').first().waitFor({ state: 'attached' });
    });
    await check('Jerarquía: el menú no tiene un pilar Live y el Open Live está oculto', async () => {
      await resF.goto(`${BASE}/`);
      const nav = resF.getByRole('navigation').first();
      for (const l of ['Explorar', 'Reserve', 'Cómo funciona']) await nav.getByRole('link', { name: l, exact: true }).first().waitFor();
      expect((await nav.getByRole('link', { name: 'Live', exact: true }).count()) === 0, 'el menú tiene un pilar Live');
      // Subscribing is explained in "Cómo funciona"; the menu doesn't repeat it.
      expect((await nav.getByRole('link', { name: 'Suscribirse', exact: true }).count()) === 0, 'el menú repite Suscribirse');
      expect((await resF.getByText('Live gratis').count()) === 0, 'la portada ofrece "Live gratis"');
      // The old "only creators live now" filter of Explore no longer applies.
      await resF.goto(`${BASE}/explore?live=1`);
      await resF.getByTestId('creator-card').filter({ hasText: 'Valentina Rose' }).waitFor();
    });
    await check('Perfil: Seguir → Suscribirse → Reserve, y seguir persiste', async () => {
      await resF.goto(`${BASE}/creator/1`);
      const ladder = resF.getByTestId('access-ladder');
      for (const s of ['1 · Seguir', '2 · Suscribirse', '3 · Reserve']) await ladder.getByText(s).waitFor();
      expect((await ladder.getByText(/· Live$/).count()) === 0, 'el perfil tiene un paso Live');
      await resF.getByTestId('creator-reserve').getByRole('heading', { name: 'Reserve con Valentina' }).waitFor();
      await resF.getByTestId('follow-button').click();
      await resF.getByTestId('follow-button').getByText('Siguiendo').waitFor();
      await resF.reload();
      // The follow state loads after the first render: wait for it instead of reading it once.
      await resF.getByTestId('follow-button').and(resF.locator('[aria-pressed="true"]')).waitFor();
    });
    await check('Campanita: seguir activa los avisos de Live y se pueden apagar', async () => {
      const toggle = resF.getByTestId('live-alerts');
      await toggle.and(resF.locator('[aria-pressed="true"]')).getByText('Te avisaremos cuando esté en Live').waitFor();
      await toggle.click();
      await toggle.getByText('Avisos de Live desactivados').waitFor();
      await toggle.click();
      await toggle.getByText('Te avisaremos cuando esté en Live').waitFor();
    });
    await check('Subscriber Live: un seguidor sin suscripción no recibe aviso ni puede entrar', async () => {
      await resC.goto(`${BASE}/creator/dashboard`);
      const panel = resC.getByTestId('creator-live-panel');
      await panel.getByText('Live para suscriptores').first().waitFor();
      await panel.getByLabel('Título del Live').fill('Backstage para suscriptores');
      await panel.getByRole('button', { name: 'Iniciar Live' }).click();
      await waitPath(resC, '/en-vivo/1');
      await resC.getByRole('button', { name: 'Encender cámara y empezar' }).waitFor();
      await resF.goto(`${BASE}/creator/1`);
      await resF.getByTestId('live-now').getByText('Live para suscriptores · ahora').waitFor();
      await resF.getByTestId('subscriber-live-locked').getByText('Exclusivo para suscriptores').waitFor();
      expect((await resF.getByTestId('access-ladder').getByRole('link', { name: 'Entrar al Live' }).count()) === 0, 'ofrece entrar sin suscripción');
      expect((await resF.getByTestId('notification-count').count()) === 0, 'avisó a un seguidor sin suscripción');
      await resF.goto(`${BASE}/en-vivo/1`);
      await resF.getByTestId('subscriber-live-gate').getByText('Live exclusivo para suscriptores').waitFor();
      expect((await resF.getByRole('button', { name: 'Entrar al Live' }).count()) === 0, 'la sala deja entrar sin suscripción');
    });
    await check('Subscriber Live: al suscribirse se puede entrar; la suscripción no crea reservas', async () => {
      await resF.goto(`${BASE}/creator/1`);
      await resF.getByRole('button', { name: /Suscribirse \$/ }).first().click();
      const dialog = resF.getByRole('dialog');
      await dialog.getByRole('button', { name: /Suscribirme y pagar|Guardar método de pago/ }).first().waitFor();
      if (await dialog.getByTestId('payment-method-form').count()) {
        await addCard(dialog);
        await dialog.getByText('Visa •••• 4242').waitFor();
      }
      await dialog.getByRole('button', { name: /Suscribirme y pagar/ }).click();
      await resF.getByRole('button', { name: /Suscrito/ }).first().waitFor();
      await resF.getByTestId('access-ladder').getByRole('link', { name: 'Entrar al Live' }).click();
      await waitPath(resF, '/en-vivo/1');
      await resF.getByRole('button', { name: 'Entrar al Live' }).click();
      await resF.getByTestId('live-problem').getByText(/solo funciona en la web publicada/).waitFor();
      const bookings = await resF.evaluate(() => JSON.parse(localStorage.getItem('fansreserve_vip_bookings') || '[]'));
      expect(!bookings.some((b) => b.creatorProfileId === '1' && b.fanEmail === 'fan@sugarfans.com' && b.status !== 'cancelled'), 'la suscripción creó una reserva');
    });
    await check('Subscriber Live: al terminarlo el perfil deja de mostrarlo', async () => {
      await resC.goto(`${BASE}/creator/dashboard`);
      await resC.getByTestId('creator-live-panel').getByRole('button', { name: 'Terminar Live' }).click();
      await resC.getByTestId('creator-live-panel').getByRole('button', { name: 'Iniciar Live' }).waitFor();
      await resF.goto(`${BASE}/creator/1`);
      await resF.getByTestId('access-ladder').waitFor();
      expect((await resF.getByTestId('live-now').count()) === 0, 'sigue en Live');
      await resF.goto(`${BASE}/en-vivo/1`);
      await resF.getByText('Este creador no está en Live ahora').waitFor();
    });
    await check('Subscriber Live: el suscriptor recibe el aviso; Salir no lo cierra; Terminar Live pide confirmar', async () => {
      // The first Live was minutes ago: age it so this one isn't held back by the anti-spam window.
      await resC.evaluate(() => {
        const st = JSON.parse(localStorage.getItem('fansreserve_live') || '{}');
        st.broadcasts = (st.broadcasts ?? []).map((b) => ({ ...b, startedAt: new Date(Date.now() - 86400000).toISOString() }));
        localStorage.setItem('fansreserve_live', JSON.stringify(st));
      });
      await resC.goto(`${BASE}/creator/dashboard`);
      const panel = resC.getByTestId('creator-live-panel');
      await panel.getByLabel('Título del Live').fill('Segundo Live');
      await panel.getByRole('button', { name: 'Iniciar Live' }).click();
      await waitPath(resC, '/en-vivo/1');
      await resF.goto(`${BASE}/explore`);
      await resF.getByTestId('notification-count').getByText('1').waitFor();
      await resF.getByTestId('notification-bell').click();
      const item = resF.getByTestId('notification-panel').getByRole('link', { name: /Live para suscriptores/ });
      await item.getByText('Segundo Live').waitFor();
      await item.click();
      await waitPath(resF, '/en-vivo/1');
      await resF.getByRole('button', { name: 'Salir' }).click();
      await waitPath(resF, '/creator/1');
      await resF.getByTestId('live-now').waitFor();
      await resC.getByRole('button', { name: 'Terminar Live' }).click();
      const dialog = resC.getByTestId('leave-live-dialog');
      await dialog.getByText('Estás abandonando el Live y se cerrará. ¿Estás de acuerdo?').waitFor();
      await dialog.getByRole('button', { name: 'No, continuar en el Live' }).click();
      await dialog.waitFor({ state: 'detached' });
      expect(new URL(resC.url()).pathname === '/en-vivo/1', 'salió del Live al decir que no');
      await resC.getByRole('button', { name: 'Terminar Live' }).click();
      await dialog.getByRole('button', { name: 'Sí, cerrar el Live' }).click();
      await waitPath(resC, '/creator/dashboard');
      await panel.getByRole('button', { name: 'Iniciar Live' }).waitFor();
      await resF.goto(`${BASE}/creator/1`);
      await resF.getByTestId('access-ladder').waitFor();
      expect((await resF.getByTestId('live-now').count()) === 0, 'sigue en Live');
    });
    await check('Reserve Event: el fan reserva su plaza y la sala de grupo no es la de una sesión privada', async () => {
      await resF.goto(`${BASE}/creator/1`);
      const group = resF.getByTestId('reserve-group-event');
      const card = group.getByTestId('reserve-card').filter({ hasText: 'Beauty Q&A con Valentina' });
      await card.getByTestId('event-facts').waitFor();
      await card.getByRole('button', { name: /^Reservar plaza: / }).click();
      const dialog = resF.getByRole('dialog');
      await dialog.getByRole('button', { name: /Reservar plaza/ }).waitFor();
      expect((await resF.getByTestId('booking-calendar').count()) === 0, 'un evento pide elegir día y hora');
      await dialog.getByRole('button', { name: /Reservar plaza/ }).click();
      await resF.getByText('¡Plaza reservada!').waitFor();
      const bookings = await resF.evaluate(() => JSON.parse(localStorage.getItem('fansreserve_vip_bookings') || '[]'));
      const seat = bookings.find((b) => b.experienceId === 'ev-1' && b.fanEmail === 'fan@sugarfans.com');
      expect(seat?.details?.kind === 'event', `la plaza no quedó como Reserve Event (${JSON.stringify(seat?.details)})`);
      expect(['accepted', 'pending'].includes(seat.status), `estado inesperado ${seat.status}`);
    });
    await check('La suscripción y los regalos dicen que no incluyen Reserve', async () => {
      await resF.keyboard.press('Escape');
      await resF.goto(`${BASE}/creator/1`);
      const section = resF.getByTestId('creator-reserve');
      await section.getByTestId('notice-subscription').getByText(/No incluye Reserve Events, sesiones privadas ni otras experiencias de Reserve/).waitFor();
      await section.getByTestId('notice-gift').getByText(/No garantizan respuesta, conversación ni acceso\. Si el creador tiene una Meta de experiencia/).waitFor();
      await resF.getByRole('button', { name: 'Enviar regalo' }).click();
      const dialog = resF.getByRole('dialog', { name: /Regalo para Valentina Rose/ });
      await dialog.getByRole('button', { name: /Corona/ }).first().click();
      await dialog.getByLabel('Mensaje del regalo').waitFor();
      expect((await dialog.getByText(/videollamada/i).count()) === 0, 'el regalo menciona una videollamada');
    });
    await check('Cada experiencia muestra modalidad, duración, lugar, reglas y quién aprueba', async () => {
      await resF.goto(`${BASE}/creator/1`);
      const card = resF.getByTestId('reserve-card').filter({ hasText: 'Meet & Greet en Miami' });
      await card.getByText('Presencial').waitFor();
      await card.getByRole('button', { name: 'Ver detalles' }).click();
      const dialog = resF.getByTestId('reserve-dialog');
      for (const t of ['Incluye', 'No incluye', /Cancelación/, 'Solo fans verificados', 'El creador aprueba cada solicitud', /Reserva con 72 horas de anticipación/]) await dialog.getByText(t).first().waitFor();
      await dialog.getByTestId('notice-reserve').waitFor();
      await resF.keyboard.press('Escape');
    });
    await check('Solicitar experiencia personalizada: 5 pasos estructurados y moderados', async () => {
      await resF.getByRole('button', { name: /Solicitar experiencia personalizada/ }).click();
      const dlg = resF.getByTestId('custom-request');
      const step = (n, name) => dlg.getByTestId('custom-step').getByText(`Paso ${n} de 5 · ${name}`).waitFor();
      await step(1, 'Modalidad');
      await dlg.getByRole('button', { name: /^Virtual/ }).click();
      await dlg.getByRole('button', { name: 'Siguiente', exact: true }).click();
      await step(2, 'Propósito');
      await dlg.getByRole('button', { name: 'Siguiente', exact: true }).click();
      await step(3, 'Fecha y lugar');
      await dlg.getByRole('button', { name: 'Siguiente', exact: true }).click();
      await dlg.getByText('Elige un día en el calendario').waitFor();
      await pickFirstDate(resF);
      await dlg.getByTestId('time-slots').locator('button:not([disabled])').filter({ hasText: '16:00' }).click();
      await dlg.getByRole('button', { name: 'Siguiente', exact: true }).click();
      await step(4, 'Presupuesto');
      await dlg.locator('input[name=budget]').fill('180');
      await dlg.getByRole('button', { name: 'Siguiente', exact: true }).click();
      await step(5, 'Mensaje');
      await dlg.locator('textarea[name=message]').fill('Mejor nos vemos en tu casa');
      await dlg.getByRole('button', { name: 'Enviar solicitud' }).click();
      await dlg.getByRole('alert').waitFor();
      await dlg.locator('textarea[name=message]').fill('Quiero preparar mi primer book de fotos: poses y estilo.');
      await dlg.getByTestId('custom-summary').getByText('$180.00').waitFor();
      await dlg.getByRole('button', { name: 'Enviar solicitud' }).click();
      await resF.getByText('¡Solicitud enviada!').waitFor();
      await resF.keyboard.press('Escape');
    });
    await check('El creator envía una contraoferta y el fan la acepta', async () => {
      await resC.goto(`${BASE}/creator/dashboard?tab=vip`);
      await openReserveSection(resC, 'Solicitudes');
      const req = resC.getByTestId('vip-request').filter({ hasText: 'Experiencia personalizada' });
      await req.getByText('Quiero preparar mi primer book').waitFor();
      await req.getByRole('button', { name: 'Contraoferta' }).click();
      await req.locator('input[name=counterPrice]').fill('220');
      await req.locator('input[name=counterNote]').fill('Incluye revisión de 10 fotos');
      await req.getByRole('button', { name: 'Enviar contraoferta' }).click();
      await req.getByText('Contraoferta del creador').waitFor();
      await resF.goto(`${BASE}/profile`);
      const mine = resF.getByTestId('booking').filter({ hasText: 'Experiencia personalizada' });
      await mine.getByTestId('counter-offer').getByText('$220.00').waitFor();
      await mine.getByRole('button', { name: 'Aceptar contraoferta' }).click();
      await mine.getByText('Aceptada · pendiente de pago').waitFor();
      await mine.getByRole('button', { name: 'Pagar $220.00' }).waitFor();
    });
    await check('Al crear una experiencia el creador puede cambiar de categoría ahí mismo', async () => {
      await resC.goto(`${BASE}/creator/dashboard?tab=vip`);
      await resC.getByRole('button', { name: /Crear experiencia/ }).click();
      const form = resC.getByTestId('experience-form');
      const cats = form.getByTestId('wizard-categories');
      const types = form.getByTestId('allowed-types');
      await types.locator('[data-type=photo-session]').waitFor();
      await cats.getByRole('radio', { name: 'Cocina' }).click();
      await types.locator('[data-type=cooking-class]').waitFor();
      expect((await cats.getByRole('radio', { name: 'Cocina' }).getAttribute('aria-checked')) === 'true', 'Cocina no quedó elegida');
      await cats.getByRole('radio', { name: 'Tu gente' }).click();
      await types.locator('[data-type=photo-session]').waitFor();
      await form.getByRole('button', { name: 'Cancelar' }).first().click();
    });
    await check('El creator solo puede crear experiencias permitidas para su categoría', async () => {
      await resC.goto(`${BASE}/creator/dashboard?tab=vip`);
      await resC.getByRole('button', { name: /Crear experiencia/ }).click();
      const form = resC.getByTestId('experience-form');
      const types = form.getByTestId('allowed-types');
      await types.locator('[data-type=photo-session]').waitFor();
      expect((await types.locator('[data-type=cooking-class]').count()) === 0, 'Modelos ofrece clase de cocina');
      const text = await types.innerText();
      expect(!notOffered.test(text), `tipos visibles: ${text}`);
      await form.getByText('Glamour permitido. Contenido sexual explícito no permitido.').waitFor();
      await types.locator('[data-type=photo-session]').click();
      const next = () => form.getByRole('button', { name: 'Siguiente' }).click();
      await next();
      await form.locator('input[name=expTitle]').fill('Encuentro privado conmigo');
      await next();
      await form.getByRole('alert').waitFor();
      await form.locator('input[name=expTitle]').fill('Sesión de fotos en estudio');
      await next();
      await form.locator('textarea[name=expDescription]').fill('Sesión profesional de 60 minutos para tu portafolio.');
      await next();
      await form.getByRole('radio', { name: /Profesional/ }).click();
      await next(); // → duración
      await next(); // → precio
      await next(); // → disponibilidad
      await next(); // → ubicación
      await form.getByText('Fans Reserve no ofrece domicilios, hoteles ni lugares privados o discretos como ubicación.').waitFor();
      expect((await form.getByText(/Habitación|Hotel/).count()) === 0, 'se ofrece hotel como lugar');
      await next();
      await form.getByText('Elige el tipo de lugar e indica la ciudad').waitFor();
      await form.locator('input[name=expCity]').fill('Miami');
      for (let i = 7; i < 12; i++) await next();
      await form.getByTestId('experience-preview').waitFor();
      await next();
      await form.getByRole('button', { name: 'Publicar experiencia' }).click();
      await resC.getByText('Experiencia publicada.').waitFor();
      await resC.getByTestId('my-experience').filter({ hasText: 'Sesión de fotos en estudio' }).waitFor();
      await resF.goto(`${BASE}/creator/1`);
      await resF.getByTestId('reserve-card').filter({ hasText: 'Sesión de fotos en estudio' }).getByText(/Estudio profesional/).waitFor();
    });
    await check('Políticas de Reserve publicadas como borrador con revisión legal', async () => {
      for (const doc of ['reserve-agreement', 'reserve-policy', 'acceptable-experiences', 'prohibited-services', 'cancellation', 'community']) {
        await resF.goto(`${BASE}/legal?doc=${doc}`);
        await resF.getByTestId('reserve-policy-doc').getByText('Requires legal review before production launch.').waitFor();
      }
    });
    await check('Reserve, perfil y políticas no muestran SugarFans ni Terrones', async () => {
      for (const p of ['/reserve', '/creator/1', '/legal?doc=prohibited-services', '/creator/dashboard?tab=vip']) {
        const pg = p.startsWith('/creator/dashboard') ? resC : resF;
        await pg.goto(`${BASE}${p}`);
        await pg.locator('main, #root').first().waitFor();
        await pg.waitForTimeout(150);
        const text = await pg.locator('body').innerText();
        expect(!/sugar\s?fans|terrones/i.test(text), `${p} muestra SugarFans o Terrones`);
      }
    });
    await reserveCtx.close();

    const narrow = await newContext(browser, { viewport: { width: 360, height: 760 }, locale: 'es-ES' });
    const n = await newPage(narrow);
    await check('Móvil 360px: Reserve, perfil y solicitud sin desbordar', async () => {
      await n.goto(`${BASE}/age-verification`);
      await n.getByRole('button', { name: /Soy mayor|18/ }).first().click();
      await login(n, 'fan@sugarfans.com', 'demo1234');
      await waitPath(n, '/explore');
      const overflow = () => n.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      for (const p of ['/', '/reserve', '/creator/1', '/profile']) {
        await n.goto(`${BASE}${p}`);
        await n.waitForTimeout(200);
        expect((await overflow()) <= 0, `${p} desborda ${await overflow()}px`);
      }
      await n.goto(`${BASE}/creator/1`);
      await n.getByRole('button', { name: /Solicitar experiencia personalizada/ }).click();
      await n.getByTestId('custom-step').waitFor();
      expect((await overflow()) <= 0, 'la solicitud desborda');
      const box = await n.getByTestId('custom-request').boundingBox();
      expect(box && box.width <= 360, 'el diálogo es más ancho que la pantalla');
      await n.keyboard.press('Escape');
      await n.goto(`${BASE}/reserve`);
      await n.getByRole('button', { name: RESERVE_BUTTON }).first().click();
      await n.getByTestId('booking-calendar').waitFor();
      expect((await overflow()) <= 0, 'la reserva desborda');
    });
    await narrow.close();

    const mobile = await newContext(browser, { viewport: { width: 390, height: 844 }, locale: 'es-ES', hasTouch: true });
    const m = await newPage(mobile);
    await check('Móvil: login, perfil y cerrar sesión desde el menú móvil', async () => {
      await m.goto(`${BASE}/age-verification`);
      await m.getByRole('button', { name: /Soy mayor|18/ }).first().click();
      await login(m, 'creator@sugarfans.com', 'demo1234');
      await waitPath(m, '/explore');
      await m.locator('button[aria-label="Menú de cuenta"]').tap();
      await m.getByRole('button', { name: /Cerrar sesión/ }).first().waitFor();
      await m.touchscreen.tap(195, 600);
      await m.waitForTimeout(100);
      expect((await m.getByRole('button', { name: /Cerrar sesión/ }).count()) === 0, 'el menú de cuenta siguió abierto al tocar fuera');
      await m.locator('button[aria-label="Menú"]').tap();
      await m.getByRole('link', { name: /Panel/ }).waitFor();
      await m.touchscreen.tap(195, 780);
      await m.getByRole('link', { name: /Panel/ }).waitFor({ state: 'detached' });
      await m.locator('button[aria-label="Menú"]').click();
      await m.getByRole('link', { name: /Panel/ }).click();
      await waitPath(m, '/creator/dashboard');
      await m.locator('button[aria-label="Menú"]').click();
      await m.locator('nav').getByRole('button', { name: /Cerrar sesión/ }).click();
      await waitPath(m, '/');
      await m.locator('button[aria-label="Menú"]').click();
      await m.getByRole('link', { name: /Iniciar sesión/ }).last().waitFor();
    });
    await check('Móvil: barra de pestañas tipo app con Inicio, Explorar, Reserve y Entrar (sin Live)', async () => {
      const tabs = m.getByTestId('tab-bar');
      for (const name of ['Inicio', 'Explorar', 'Reserve', 'Entrar']) await tabs.getByRole('link', { name, exact: true }).waitFor();
      expect((await tabs.getByRole('link', { name: 'Live', exact: true }).count()) === 0, 'la barra tiene una pestaña Live');
      await tabs.getByRole('link', { name: 'Explorar', exact: true }).tap();
      await waitPath(m, '/explore');
      await m.getByTestId('live-rail').waitFor();
      await m.getByTestId('reserve-rail').waitFor();
      expect((await tabs.getByRole('link', { name: 'Explorar', exact: true }).getAttribute('aria-current')) === 'page', 'Explorar no queda marcada');
      await tabs.getByRole('link', { name: 'Reserve', exact: true }).tap();
      await waitPath(m, '/reserve');
      await m.goto(`${BASE}/`);
      await m.locator('#comunidades').waitFor();
      expect((await m.getByTestId('happening-now').count()) === 0, '"Está pasando ahora" sigue en la portada');
      expect((await m.getByText('Está pasando ahora').count()) === 0, '"Está pasando ahora" sigue en la portada');
      expect(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'la portada desborda en móvil');
    });
    await check('Móvil: cada pestaña abre su página desde arriba', async () => {
      const tabs = m.getByTestId('tab-bar');
      const scrolled = () => m.evaluate(() => window.scrollY);
      const bottom = async () => {
        await m.waitForFunction(() => {
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
          return window.scrollY > 200;
        });
      };
      await m.goto(`${BASE}/explore`);
      await m.getByTestId('reserve-rail').waitFor();
      await bottom();
      await tabs.getByRole('link', { name: 'Inicio', exact: true }).tap();
      await waitPath(m, '/');
      expect((await scrolled()) === 0, 'Inicio no abrió desde arriba');
      await bottom();
      await tabs.getByRole('link', { name: 'Explorar', exact: true }).tap();
      await waitPath(m, '/explore');
      expect((await scrolled()) === 0, 'Explorar no abrió desde arriba');
      await m.getByTestId('reserve-rail').waitFor();
      await m.goto(`${BASE}/reserve`);
      await bottom();
      await tabs.getByRole('link', { name: 'Reserve', exact: true }).tap();
      await m.waitForFunction(() => window.scrollY === 0);
    });
    await check('Escritorio no muestra la barra de pestañas', async () => {
      const desk = await newContext(browser, { viewport: { width: 1280, height: 800 }, locale: 'es-ES' });
      const d = await newPage(desk);
      await d.goto(`${BASE}/explore`);
      await d.getByTestId('live-rail').waitFor();
      expect(!(await d.getByTestId('tab-bar').isVisible()), 'la barra de pestañas se ve en escritorio');
      await desk.close();
    });
    await mobile.close();
  } finally {
    await browser.close();
    server?.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} flujos OK`);
  const errors = consoleErrors.filter((e) => !e.includes('net::ERR_FAILED'));
  if (errors.length) {
    console.log(`\nErrores de consola (${errors.length}):`);
    [...new Set(errors)].slice(0, 20).forEach((e) => console.log('  - ' + e));
  }
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
