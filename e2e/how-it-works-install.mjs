// "Cómo funciona" in the top pill (fan and creator in three steps) and the
// "Instala Fans Reserve" sheet shown once after signing in on a phone.
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

const session = async (device, email, { androidOffer = false } = {}) => {
  const context = await browser.newContext({ ...device });
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
  if (email) {
    await page.goto(`${BASE}/login`);
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', 'demo1234');
    await page.click('form button[type=submit]');
    await page.waitForURL((u) => new URL(u).pathname !== '/login');
  }
  return page;
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

  const fanAndroid = await session(android, 'fan@sugarfans.com', { androidOffer: true });
  await check('Android: botón "Instalar app" de Chrome', async () => {
    await fanAndroid.getByTestId('install-now').waitFor({ timeout: 8000 });
    await shot(fanAndroid, '4-instalar-app-android');
    await fanAndroid.getByTestId('install-now').click();
    await fanAndroid.getByTestId('install-sheet').waitFor({ state: 'detached' });
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
