// Cupos en vivo: the creator opens today's slots from the Reserve panel and gets the
// short link + QR; a visitor opens fansreserve.com/@usuario/ahora, signs in, comes
// back to the page, takes the next slot and pays it; the creator sees the call order.
// Offline build (local store), desktop and phone.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ mode: 'offline', preview: { host: '127.0.0.1', port: 0, open: false } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const shots = process.env.LIVE_SLOTS_SHOTS;
const errors = [];
let browser;
const login = async (page, email) => {
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill('demo1234');
  await page.locator('form button[type=submit]').click();
};
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  for (const [device, viewport] of [['escritorio', { width: 1366, height: 900 }], ['movil', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, hasTouch: device === 'movil', locale: 'es-HN', deviceScaleFactor: shots ? 2 : 1 });
    context.setDefaultTimeout(10000);
    await context.route('**/*', (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/age-verification`);
    await page.getByRole('button', { name: /Soy mayor|18/ }).first().click();

    // Creator opens 3 slots of 15 minutes, now.
    await page.goto(`${origin}/login`);
    await login(page, 'creator@sugarfans.com');
    await page.waitForURL((url) => url.pathname !== '/login');
    await page.goto(`${origin}/creator/dashboard?tab=vip&reserve=cupos`);
    const form = page.getByTestId('live-slots-form');
    await form.waitFor();
    await form.getByRole('button', { name: '3', exact: true }).click();
    await form.getByRole('button', { name: '15 min', exact: true }).click();
    await page.getByTestId('live-slots-price').fill('20');
    assert.match(await page.getByTestId('live-slots-summary').innerText(), /3 cupos × 15 min/);
    if (shots) await page.screenshot({ path: `${shots}/${device}-1-creador-formulario.png`, fullPage: true });
    // Desktop opens planned slots; the phone run uses "Llamada ya" (1 slot, starts in minutes).
    const now = device === 'movil';
    await page.getByTestId(now ? 'live-slots-now-open' : 'live-slots-open').click();
    await page.getByTestId('live-slots-active').waitFor();
    const link = (await page.getByTestId('live-slots-link').innerText()).trim();
    assert.match(link, /^127\.0\.0\.1:\d+\/@[a-z0-9_]+\/ahora$/, link);
    assert.equal(await page.getByTestId('live-slots-left').innerText(), now ? 'Quedan 1 de 1' : 'Quedan 3 de 3');
    assert.ok((await page.getByTestId('live-slots-qr').getAttribute('src')).startsWith('data:image/gif'), 'QR image');
    if (shots) await page.getByTestId('live-slots-active').screenshot({ path: `${shots}/${device}-2-creador-enlace-qr.png` });
    // The hidden experience never shows in "Mis experiencias".
    const path = link.replace(/^[^/]+/, '');

    // Sign out; a visitor opens the link from the live.
    await page.evaluate(() => { localStorage.removeItem('sugarfans_session'); sessionStorage.clear(); });
    await page.goto(`${origin}/settings`);
    await page.goto(`${origin}${path}`);
    await page.getByTestId('live-slots-page').waitFor();
    const visitorView = page.getByTestId('live-slots-signin');
    if (!(await visitorView.isVisible())) {
      // Still signed in as the creator: sign out through the menu.
      await page.getByText('Así ven tus fans esta página.').waitFor();
      await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.endsWith('session')) localStorage.removeItem(k); sessionStorage.clear(); });
      await page.reload();
    }
    await visitorView.waitFor();
    assert.match(await page.getByTestId('live-slots-left').innerText(), now ? /Quedan 1 de 1 cupos/ : /Quedan 3 de 3 cupos/);
    if (shots) await page.screenshot({ path: `${shots}/${device}-3-visitante.png`, fullPage: true });
    await visitorView.getByRole('button', { name: 'Entrar con correo' }).click();
    await page.waitForURL((url) => url.pathname === '/login');
    await login(page, 'fan@sugarfans.com');
    await page.waitForURL((url) => url.pathname === path);

    // Back from the login, the next slot is taken and the payment opens by itself.
    await page.getByText('Cupo en vivo #1').waitFor();
    assert.equal(new URL(page.url()).search, '', 'the ?pagar=1 flag stays in the address');
    if (shots) await page.screenshot({ path: `${shots}/${device}-4-pagar.png` });
    await page.getByRole('button', { name: 'Cerrar' }).click();
    await page.getByTestId('live-slots-held').waitFor();
    assert.match(await page.getByTestId('live-slots-held').innerText(), /Tu cupo #1 está apartado/);
    if (shots) await page.screenshot({ path: `${shots}/${device}-5-apartado.png`, fullPage: true });
    if (now) {
      // Paid: the call room is already open, so after 10 seconds the fan goes in.
      await page.getByTestId('live-slots-pay').click();
      await page.getByRole('button', { name: /Pagar ahora \$20\.00/ }).last().click();
      await page.getByTestId('live-slots-entering').waitFor({ timeout: 15000 });
      if (shots) await page.screenshot({ path: `${shots}/${device}-6-entrando.png` });
      await page.waitForURL((url) => url.pathname.startsWith('/live/'), { timeout: 15000 });
    }
    console.log(`${device}: ok`);
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise((done) => server.httpServer.close(done));
}
