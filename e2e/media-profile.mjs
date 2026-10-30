// The actual offline application, with a creator and a fan in separate sessions.
// Only browser storage is written; external requests are blocked.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const out = resolve(process.env.MEDIA_DELIVERY_OUTPUT || join(tmpdir(), 'fansreserve-media-results'));
mkdirSync(out, { recursive: true });
const server = await preview({ mode: 'offline', preview: { host: '127.0.0.1', port: 0, open: false } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const video = readFileSync('public/reserve-clips/artista.webm');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const results = [];
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

try {
  browser = await chromium.launch({ headless: true });
  for (const [device, viewport] of [['escritorio', { width: 1366, height: 900 }], ['movil', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, hasTouch: device === 'movil', locale: 'es-HN' });
    context.setDefaultTimeout(10000);
    await context.route('**/*', (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const creator = await context.newPage();
    const fan = await context.newPage();
    for (const page of [creator, fan]) page.on('pageerror', (error) => errors.push(error.message));
    await login(creator, 'creator@sugarfans.com');
    await login(fan, 'fan@sugarfans.com');
    await creator.goto(`${origin}/creator/dashboard`);
    await creator.getByRole('button', { name: /Nueva publicación/ }).click();
    await creator.getByTestId('image-input').setInputFiles({ name: 'foto-prueba.png', mimeType: 'image/png', buffer: image });
    await creator.getByTestId('media-preview').locator('img').waitFor();
    await creator.getByLabel('Texto de la publicación').fill('Foto del ensayo de descargas');
    await creator.getByRole('button', { name: 'Publicar', exact: true }).click();
    await creator.getByText('Publicación creada').waitFor();
    await creator.getByRole('button', { name: /Subir foto o video/ }).click();
    await creator.getByTestId('video-input').setInputFiles({ name: 'video-prueba.webm', mimeType: 'video/webm', buffer: video });
    await creator.getByTestId('media-preview').locator('video').waitFor();
    await creator.getByLabel('Texto de la publicación').fill('Video exclusivo del ensayo de descargas');
    await creator.getByRole('button', { name: /Solo suscriptores/ }).click();
    await creator.getByRole('button', { name: 'Publicar', exact: true }).click();
    await creator.getByText('Publicación creada').waitFor();

    await creator.goto(`${origin}/creator/1`);
    const ownVideo = creator.getByTestId('post').filter({ hasText: 'Video exclusivo del ensayo de descargas' });
    await ownVideo.getByTestId('post-video').waitFor();
    assert.equal(await ownVideo.locator('video').count(), 0);
    const videoId = (await ownVideo.getAttribute('id')).slice('post-'.length);
    await ownVideo.getByTestId('open-media').click();
    const viewer = creator.getByTestId('media-viewer');
    await viewer.getByRole('button', { name: 'Reproducir video' }).waitFor();
    assert.equal(await viewer.locator('video').count(), 0);
    await viewer.getByRole('button', { name: 'Reproducir video' }).click();
    await creator.waitForFunction(() => { const v = document.querySelector('[data-testid="media-viewer-video"]'); return v && v.readyState >= 2 && !v.paused; });
    await creator.screenshot({ path: join(out, `perfil-reproduciendo-${device}.png`), animations: 'disabled' });
    await viewer.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await viewer.waitFor({ state: 'detached' });

    await creator.getByRole('button', { name: 'Media', exact: true }).click();
    // The tile itself is the anchor; its exact reference identifies the new post.
    const ownTile = creator.locator(`[data-testid="media-tile"][href="#post-${videoId}"]`);
    await ownTile.waitFor();
    assert.equal(await creator.getByTestId('media-tile').locator('video').count(), 0);
    await ownTile.scrollIntoViewIfNeeded();
    await creator.screenshot({ path: join(out, `perfil-galeria-${device}.png`), animations: 'disabled' });
    await ownTile.click();
    await viewer.getByTestId('media-viewer-caption').getByText('Video exclusivo del ensayo de descargas').waitFor();
    assert.equal(await viewer.locator('video').count(), 0);
    await viewer.getByRole('button', { name: 'Cerrar', exact: true }).click();

    await fan.goto(`${origin}/creator/1`);
    const locked = fan.getByTestId('post').filter({ hasText: 'Video exclusivo del ensayo de descargas' });
    await locked.getByText('Contenido exclusivo para suscriptores').waitFor();
    assert.equal(await locked.getByTestId('post-video').count(), 0);
    assert.equal(await locked.locator('video').count(), 0);
    const publicPhoto = fan.getByTestId('post').filter({ hasText: 'Foto del ensayo de descargas' });
    await publicPhoto.getByTestId('post-image').scrollIntoViewIfNeeded();
    await fan.waitForFunction((img) => img.complete && img.naturalWidth > 0, await publicPhoto.getByTestId('post-image').elementHandle());
    await publicPhoto.getByTestId('post-image').evaluate((img) => img.decode());
    await publicPhoto.getByTestId('open-media').click();
    const fanViewer = fan.getByTestId('media-viewer');
    await fanViewer.getByTestId('media-viewer-image').waitFor();
    assert.equal(await fanViewer.getByText('Video exclusivo del ensayo de descargas').count(), 0);
    assert.equal(await fanViewer.locator('video').count(), 0);
    await fanViewer.getByRole('button', { name: 'Cerrar', exact: true }).click();
    assert.ok(await fan.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    results.push({ device, publication: true, creatorPlayback: true, galleryWithoutVideoRequests: true, fanPublicPhoto: true, exclusiveVideoBlocked: true });
    await context.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(out, 'PERFIL-RESULTADO.json'), JSON.stringify({ date: new Date().toISOString(), results, errors, environment: 'Offline; no remote database or payment services.' }, null, 2));
  console.log('OK: perfil real en móvil y escritorio; publicación, galería, reproducción y exclusión de contenido privado.');
} finally {
  await browser?.close();
  await new Promise((r) => server.httpServer.close(r));
}
