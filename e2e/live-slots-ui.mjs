// Cupos en vivo: the creator opens today's slots from the Reserve panel and gets the
// short link + QR; a visitor opens fansreserve.com/@usuario/ahora, signs in, comes
// back to the page with the slot they ticked on the board and pays it; the creator sees the call order.
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
    // The board: one box per slot, all free. "Llamada ya" has a single slot, already ticked.
    const slot = (n) => page.getByTestId(`live-slot-${n}`);
    assert.equal(await page.getByTestId('live-slots-board').getByRole('radio').count(), now ? 1 : 3);
    assert.match(await page.getByTestId('live-slots-hint').innerText(), /recarga la página para ver cuáles están disponibles/);
    const mySlot = now ? 1 : 2;
    if (now) {
      assert.equal(await slot(1).getAttribute('aria-checked'), 'true');
    } else {
      // Another fan (another tab) takes slot 3: the box changes here without reloading.
      const other = await context.newPage();
      await other.goto(`${origin}/legal`);
      const takenByOther = (n) => other.evaluate((n) => {
        const dropsKey = Object.keys(localStorage).find((k) => k.endsWith('live_drops_v1'));
        const bookingsKey = `${dropsKey.slice(0, -'live_drops_v1'.length)}vip_bookings`;
        const drop = JSON.parse(localStorage.getItem(dropsKey)).at(-1);
        const start = new Date(new Date(drop.firstStartAt).getTime() + (n - 1) * drop.minutes * 60_000).toISOString();
        const at = new Date().toISOString();
        const list = JSON.parse(localStorage.getItem(bookingsKey) || '[]');
        list.push({ id: `otro-${n}`, experienceId: `live-${drop.id}`, creatorProfileId: drop.creatorProfileId, title: 'Cupo en vivo', creatorName: drop.creatorName,
          price: drop.price, durationMinutes: drop.minutes, date: start.slice(0, 10), time: start.slice(11, 16), timeZone: 'UTC', message: '',
          fanId: 'otro-fan', fanName: 'Otro fan', fanEmail: 'otro@example.invalid', status: 'accepted', createdAt: at, updatedAt: at,
          details: { kind: 'experience', typeId: 'video-call', modality: 'virtual', participants: 1, liveDropId: drop.id, liveSlot: n } });
        localStorage.setItem(bookingsKey, JSON.stringify(list));
      }, n);
      await takenByOther(3);
      await page.locator('[data-testid=live-slot-3][data-state=held]').waitFor({ timeout: 3000 });
      assert.match(await slot(3).innerText(), /Pagando/);
      assert.ok(await slot(3).isDisabled(), 'a held slot can be ticked');
      assert.match(await page.getByTestId('live-slots-left').innerText(), /Quedan 2 de 3 cupos/);
      // The visitor ticks slot 1 and it is taken meanwhile: a notice, and the box unticks.
      await slot(1).click();
      assert.equal(await slot(1).getAttribute('aria-checked'), 'true');
      await takenByOther(1);
      await page.getByTestId('live-slots-gone').waitFor({ timeout: 3000 });
      assert.match(await page.getByTestId('live-slots-gone').innerText(), /se acaba de ocupar/);
      await other.close();
      await slot(2).click();
      assert.equal(await page.getByTestId('live-slots-gone').count(), 0);
      assert.match(await visitorView.innerText(), /Entra para reservar el cupo de las/);
      if (shots) await page.screenshot({ path: `${shots}/${device}-3b-tablero.png`, fullPage: true });
    }
    await visitorView.getByRole('button', { name: 'Entrar con correo' }).click();
    await page.waitForURL((url) => url.pathname === '/login');
    await login(page, 'fan@sugarfans.com');
    await page.waitForURL((url) => url.pathname === path);

    // Back from the login, the ticked slot is taken and the payment opens by itself.
    await page.getByText(`Cupo en vivo #${mySlot}`).waitFor();
    assert.equal(new URL(page.url()).search, '', 'the ?pagar=1 flag stays in the address');
    if (shots) await page.screenshot({ path: `${shots}/${device}-4-pagar.png` });
    assert.equal(await slot(mySlot).getAttribute('data-state'), 'mine');
    assert.match(await slot(mySlot).innerText(), /Tu cupo/);
    // Closing the payment without paying gives the slot back at once.
    await page.getByRole('button', { name: 'Cerrar' }).click();
    await page.locator(`[data-testid=live-slot-${mySlot}][data-state=free]`).waitFor({ timeout: 3000 });
    assert.equal(await page.getByTestId('live-slots-held').count(), 0);
    if (shots) await page.screenshot({ path: `${shots}/${device}-5-liberado.png`, fullPage: true });
    if (now) {
      // Paid: the call room is already open, so after 10 seconds the fan goes in.
      await page.getByTestId('live-slots-take').click();
      await page.getByText('Cupo en vivo #1').waitFor();
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
