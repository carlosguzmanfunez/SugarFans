// Phone gestures on the full-screen viewers (offline app, no remote services):
// pulling a photo down closes it like the back button, and the profile photo /
// cover open in the same zoomable viewer as the post photos.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ mode: 'offline', preview: { host: '127.0.0.1', port: 0, open: false } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
// A real-sized image so zoom has something to enlarge.
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const errors = [];
let browser;

const login = async (page, email) => {
  await page.goto(`${origin}/age-verification`);
  await page.getByRole('button', { name: /Soy mayor|18/ }).first().click();
  await page.goto(`${origin}/login`);
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill('demo1234');
  await page.locator('form input[type=checkbox]').uncheck();
  await page.locator('form button[type=submit]').click();
  await page.waitForURL((url) => url.pathname === '/');
};

// One finger dragging from (x, y) by (dx, dy), like a real phone.
const drag = async (page, x, y, dx, dy, steps = 12, delay = 20) => {
  const cdp = await page.context().newCDPSession(page);
  const point = (px, py) => [{ x: px, y: py, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(x, y) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(x + (dx * i) / steps, y + (dy * i) / steps) });
    await page.waitForTimeout(delay);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
};

try {
  browser = await chromium.launch({ headless: true, ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'es-HN' });
  context.setDefaultTimeout(10000);
  await context.route('**/*', (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));

  await login(page, 'creator@sugarfans.com');
  await page.goto(`${origin}/creator/dashboard`);
  await page.getByRole('button', { name: /Nueva publicación/ }).click();
  await page.getByTestId('image-input').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: image });
  await page.getByTestId('media-preview').locator('img').waitFor();
  await page.getByLabel('Texto de la publicación').fill('Foto para deslizar');
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.getByText('Publicación creada').waitFor();

  await page.goto(`${origin}/creator/1`);
  const path = new URL(page.url()).pathname;
  const post = page.getByTestId('post').filter({ hasText: 'Foto para deslizar' });
  await post.getByTestId('open-media').click();
  const viewer = page.getByTestId('media-viewer');
  await viewer.getByTestId('media-viewer-image').waitFor();

  // A short pull springs back; a long one closes.
  await drag(page, 195, 400, 0, 60, 6, 60);
  await page.waitForTimeout(300);
  assert.equal(await viewer.count(), 1, 'un tirón corto cerró el visor');
  await drag(page, 195, 300, 0, 260);
  await viewer.waitFor({ state: 'detached' });
  await page.waitForTimeout(300);
  assert.equal(new URL(page.url()).pathname, path, 'deslizar hacia abajo cambió de página');
  assert.equal(await page.getByTestId('profile-image-viewer').count(), 0);

  // Sideways swipes still move between posts instead of closing.
  await post.getByTestId('open-media').click();
  await viewer.getByTestId('media-viewer-image').waitFor();
  await drag(page, 300, 400, -220, 10);
  await page.waitForTimeout(400);
  assert.equal(await viewer.count(), 1, 'deslizar de lado cerró el visor');
  await drag(page, 195, 300, 0, 260);
  await viewer.waitFor({ state: 'detached' });

  // Profile photo (the cover opens in the same viewer; the demo profile keeps a
  // generated cover, so only the photo is checked here): zoom, then pull down.
  for (const kind of ['avatar']) {
    await page.getByTestId(`${kind}-open`).click();
    const big = page.getByTestId('profile-image-viewer');
    await big.getByTestId('profile-image-full').waitFor();
    const zoom = big.getByTestId('post-photo-zoom');
    await zoom.dblclick();
    assert.equal(await zoom.getAttribute('data-zoom'), '2.00', `no se puede hacer zoom en ${kind}`);
    await zoom.dblclick();
    assert.equal(await zoom.getAttribute('data-zoom'), '1.00');
    await drag(page, 195, 350, 0, 260);
    await big.waitFor({ state: 'detached' });
    await page.waitForTimeout(300);
    assert.equal(new URL(page.url()).pathname, path, `cerrar ${kind} cambió de página`);
  }

  assert.deepEqual(errors, []);
  console.log('OK: deslizar hacia abajo cierra el visor de publicaciones y el de foto de perfil, y la foto de perfil tiene zoom.');
} finally {
  await browser?.close();
  await new Promise((r) => server.httpServer.close(r));
}
