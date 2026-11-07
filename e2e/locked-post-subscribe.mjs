// Tapping a locked "Suscriptores" photo opens Suscribirse: fans get the checkout,
// visitors sign in first and land back on the profile with the checkout open.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ mode: 'offline', preview: { host: '127.0.0.1', port: 0, open: false } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const shots = process.env.LOCKED_POST_SHOTS;
const errors = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  for (const [device, viewport] of [['escritorio', { width: 1366, height: 900 }], ['movil', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, hasTouch: device === 'movil', locale: 'es-HN' });
    context.setDefaultTimeout(10000);
    await context.route('**/*', (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/age-verification`);
    await page.getByRole('button', { name: /Soy mayor|18/ }).first().click();

    // Visitor: the locked photo sends to sign in, then back with the checkout open.
    await page.goto(`${origin}/creator/1`);
    const overlay = page.getByTestId('locked-post-overlay').first();
    await overlay.scrollIntoViewIfNeeded();
    await overlay.click({ position: { x: 20, y: 20 } });
    await page.waitForURL((url) => url.pathname === '/login');
    await page.locator('input[type=email]').fill('fan@sugarfans.com');
    await page.locator('input[type=password]').fill('demo1234');
    await page.locator('form input[type=checkbox]').uncheck();
    await page.locator('form button[type=submit]').click();
    await page.waitForURL((url) => url.pathname === '/creator/1');
    await page.getByText('Suscribirme y pagar').waitFor();
    assert.equal(new URL(page.url()).hash, '', 'the #suscribirse marker is cleared');
    if (shots) await page.screenshot({ path: `${shots}/${device}-tras-login.png` });
    await page.getByRole('button', { name: 'Cerrar' }).click();
    await page.getByText('Suscribirme y pagar').waitFor({ state: 'detached' });

    // Signed-in fan: tapping the locked photo opens the checkout right away.
    const again = page.getByTestId('locked-post-overlay').first();
    await again.scrollIntoViewIfNeeded();
    if (shots) await page.screenshot({ path: `${shots}/${device}-foto-bloqueada.png` });
    await again.click({ position: { x: 20, y: 20 } });
    await page.getByText('Suscribirme y pagar').waitFor();
    await page.getByRole('button', { name: 'Cerrar' }).click();

    // Fotos y videos tab: a locked tile opens it too.
    await page.getByRole('button', { name: /Fotos|Media/ }).first().click();
    const tile = page.getByTestId('media-tile').filter({ has: page.locator('.fa-lock') }).first();
    await tile.click();
    await page.getByText('Suscribirme y pagar').waitFor();
    console.log(`${device}: ok`);
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise((done) => server.httpServer.close(done));
}
