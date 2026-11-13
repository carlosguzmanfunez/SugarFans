// "Instala Fans Reserve": the sheet on a phone's browser until the app is
// installed, then never again (this phone or any other, via the account). Also
// checks the top pill has no "?" Cómo funciona button any more.
// Offline build (demo accounts): npm run test:how-it-works
// SHOTS=/dir saves screenshots. CHROME=/path/to/chromium uses a preinstalled browser.
import { chromium, devices } from 'playwright';

const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOTS;
const { preview } = await import('vite');
const server = await preview({ mode: 'offline', preview: { host: '127.0.0.1', port: PORT, strictPort: true, open: false } });
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

let failed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${err.message.split('\n')[0]}`);
  }
};
const expect = (ok, msg) => {
  if (!ok) throw new Error(msg);
};
const shot = (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });

const session = async (device, email, { androidOffer = false, standalone = false, storageState } = {}) => {
  const context = await browser.newContext({ ...device, ...(storageState ? { storageState } : {}) });
  if (standalone)
    // Opened from the home-screen icon.
    await context.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => (q.includes('display-mode: standalone') ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : real(q));
    });
  await context.addInitScript(() => localStorage.setItem('fansreserve_age_verified', 'true'));
  if (androidOffer)
    // Chrome's install offer, as Android sends it.
    await context.addInitScript(() => {
      window.addEventListener('load', () => {
        const e = new Event('beforeinstallprompt');
        e.prompt = async () => {};
        e.userChoice = Promise.resolve({ outcome: 'accepted' });
        window.dispatchEvent(e);
      });
    });
  const page = await context.newPage();
  page.on('pageerror', (e) => {
    failed++;
    console.log(`    error de página: ${e.message}`);
  });
  if (email && !storageState) {
    await page.goto(`${BASE}/login`);
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', 'demo1234');
    await page.click('form button[type=submit]');
    await page.waitForURL((u) => new URL(u).pathname !== '/login');
  }
  return page;
};

const LS = 'fansreserve_';
const accountFlag = (page, email) =>
  page.evaluate(([k, e]) => (JSON.parse(localStorage.getItem(k) || '[]').find((a) => a.email === e) || {}).appInstalled === true, [`${LS}accounts`, email]);
// Same browser data in a fresh tab, minus this phone's own "installed" memory:
// only the account can stop the sheet there.
const storageWithoutSheet = async (page) => {
  const state = await page.context().storageState();
  for (const o of state.origins) o.localStorage = o.localStorage.filter((i) => i.name !== `${LS}installSheet`);
  return state;
};

const iphone = { ...devices['iPhone 13'] };
const android = { ...devices['Pixel 7'] };
const desktop = { viewport: { width: 1280, height: 860 }, deviceScaleFactor: SHOTS ? 2 : 1 };

try {
  console.log('\nInstalar app (teléfono)');
  const fan = await session(iphone, 'fan@sugarfans.com');
  await check('iPhone: aparece la hoja con los pasos de Safari', async () => {
    const sheet = fan.getByTestId('install-sheet');
    await sheet.waitFor({ timeout: 8000 });
    expect((await sheet.getAttribute('data-platform')) === 'ios', 'no es la versión de iPhone');
    await fan.getByTestId('install-steps-ios').waitFor();
    await shot(fan, '3-instalar-app-iphone');
  });
  await check('"Ahora no" la cierra y no vuelve al recargar', async () => {
    await fan.getByTestId('install-later').click();
    await fan.reload();
    await fan.waitForTimeout(2600);
    expect((await fan.getByTestId('install-sheet').count()) === 0, 'volvió a salir');
  });

  await check('"Ahora no" vuelve a salir otro día', async () => {
    await fan.evaluate((k) => localStorage.setItem(k, JSON.stringify({ until: Date.now() - 1000 })), `${LS}installSheet`);
    await fan.reload();
    await fan.getByTestId('install-sheet').waitFor({ timeout: 8000 });
  });
  await check('"Listo, ya la instalé" la esconde unos días, no para siempre', async () => {
    await fan.getByTestId('install-done').click();
    const saved = await fan.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), `${LS}installSheet`);
    expect(!saved.installed && saved.until > Date.now() + 2 * 86400000, `guardó ${JSON.stringify(saved)}`);
  });

  const fanAndroid = await session(android, 'fan@sugarfans.com', { androidOffer: true });
  await check('Android: botón "Instalar app" de Chrome', async () => {
    await fanAndroid.getByTestId('install-now').waitFor({ timeout: 8000 });
    await shot(fanAndroid, '4-instalar-app-android');
    await fanAndroid.getByTestId('install-now').click();
    await fanAndroid.getByTestId('install-sheet').waitFor({ state: 'detached' });
  });

  await check('Android: al instalarla queda guardado en la cuenta y no vuelve a salir', async () => {
    await fanAndroid.waitForFunction(([k, e]) => (JSON.parse(localStorage.getItem(k) || '[]').find((a) => a.email === e) || {}).appInstalled === true, [`${LS}accounts`, 'fan@sugarfans.com'], { timeout: 5000 });
    const again = await session(android, 'fan@sugarfans.com', { androidOffer: true, storageState: await storageWithoutSheet(fanAndroid) });
    await again.goto(`${BASE}/explore`);
    await again.waitForTimeout(2600);
    expect((await again.getByTestId('install-sheet').count()) === 0, 'volvió a salir');
  });

  await check('iPhone: abrirla desde el ícono la marca como instalada; en Safari ya no sale', async () => {
    const app = await session(iphone, 'creator@sugarfans.com', { standalone: true });
    await app.waitForFunction(([k, e]) => (JSON.parse(localStorage.getItem(k) || '[]').find((a) => a.email === e) || {}).appInstalled === true, [`${LS}accounts`, 'creator@sugarfans.com'], { timeout: 5000 });
    expect((await app.getByTestId('install-sheet').count()) === 0, 'salió dentro de la app');
    const safari = await session(iphone, 'creator@sugarfans.com', { storageState: await storageWithoutSheet(app) });
    await safari.goto(`${BASE}/explore`);
    await safari.waitForTimeout(2600);
    expect(await accountFlag(safari, 'creator@sugarfans.com'), 'la cuenta perdió la marca');
    expect((await safari.getByTestId('install-sheet').count()) === 0, 'salió en Safari');
  });

  const visitor = await session(iphone, null);
  await check('Sin sesión no aparece', async () => {
    await visitor.goto(`${BASE}/explore`);
    await visitor.waitForTimeout(2600);
    expect((await visitor.getByTestId('install-sheet').count()) === 0, 'salió sin sesión');
  });

  await check('Sin botón "?" de Cómo funciona en la cápsula (visitante, fan y creador)', async () => {
    expect((await visitor.getByTestId('how-it-works-button').count()) === 0, 'el visitante ve el botón');
    expect((await fan.getByTestId('how-it-works-button').count()) === 0, 'el fan ve el botón');
    const creator = await session(desktop, 'creator@sugarfans.com');
    await creator.goto(`${BASE}/explore`);
    await creator.getByRole('navigation').first().waitFor();
    expect((await creator.getByTestId('how-it-works-button').count()) === 0, 'el creador ve el botón');
    expect((await creator.getByTestId('install-sheet').count()) === 0, 'la hoja de instalar salió en computadora');
  });
  await check('La cápsula no se desborda en un teléfono de 360 px', async () => {
    const small = await session({ ...devices['Galaxy S9+'], viewport: { width: 360, height: 740 } }, 'creator@sugarfans.com');
    await small.goto(`${BASE}/explore`);
    const overflow = await small.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow <= 0, `se desborda ${overflow}px`);
  });
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
if (failed) {
  console.log(`\n${failed} fallo(s)`);
  process.exit(1);
}
console.log('\nTodo bien');
