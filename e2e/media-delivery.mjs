// Real components, local media and HTTP request counts. No Supabase, billing,
// PayPal, credentials or changes to a remote environment.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'fansreserve-media-'));
const out = resolve(process.env.MEDIA_DELIVERY_OUTPUT || join(tmpdir(), 'fansreserve-media-results'));
mkdirSync(out, { recursive: true });
const assets = resolve('dist/assets');
const css = readdirSync(assets).find((name) => /^index-.*\.css$/.test(name));
assert.ok(css, 'Run the offline build first.');
const fixture = resolve('e2e/media-delivery-fixture.tsx');
const baseRef = process.env.MEDIA_DELIVERY_BASELINE_REF;
const options = { entryPoints: [fixture], bundle: true, format: 'esm', define: { 'import.meta.env': JSON.stringify({ MODE: 'offline' }) }, logLevel: 'silent' };
await build({ ...options, outfile: join(temp, 'app.js') });
if (baseRef) {
  // Optional comparison against the actual pre-change PostCard, not a recreated mock.
  const previous = execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, 'show', `${baseRef}:src/components/PostCard.tsx`], { encoding: 'utf8' });
  await build({ ...options, outfile: join(temp, 'before.js'), plugins: [{ name: 'previous-post-card', setup(api) {
    api.onLoad({ filter: /[\\/]src[\\/]components[\\/]PostCard\.tsx$/ }, () => ({ contents: previous, loader: 'tsx', resolveDir: resolve('src/components') }));
  } }] });
}
const photo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#705182"/><text x="60" y="280" fill="white" font-size="36">Foto de prueba sin modificar</text></svg>');
const video = readFileSync('public/reserve-clips/artista.webm');
const requests = [];
const errors = [];
const external = [];
const cases = [];
const benchmark = [];
let browser;
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'");
  if (url.pathname.startsWith('/media/')) {
    const isVideo = url.pathname.endsWith('.webm');
    const bytes = isVideo ? video : photo;
    requests.push({ path: url.pathname, bytes: bytes.length, range: req.headers.range || null });
    res.setHeader('Content-Type', isVideo ? 'video/webm' : 'image/svg+xml');
    res.setHeader('Cache-Control', url.pathname.startsWith('/media/public-') ? 'public, max-age=3600' : 'no-store');
    res.setHeader('Content-Length', bytes.length);
    res.end(bytes);
  } else if (url.pathname === '/app.js' || url.pathname === '/before.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(readFileSync(join(temp, basename(url.pathname))));
  } else if (url.pathname.startsWith('/assets/')) {
    const file = basename(url.pathname);
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'font/woff2');
    try { res.end(readFileSync(join(assets, file))); } catch { res.writeHead(404).end(); }
  } else if (url.pathname === '/favicon.ico') {
    res.writeHead(204).end();
  } else {
    const app = url.searchParams.has('baseline') ? 'before.js' : 'app.js';
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/${css}"><body><div id="root"></div><script type="module" src="/${app}"></script></body></html>`);
  }
});
const waitFor = async (fn, message) => {
  for (let i = 0; i < 80; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(message);
};

try {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  for (const [device, viewport] of [['escritorio', { width: 1366, height: 900 }], ['movil', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, hasTouch: device === 'movil', locale: 'es-HN' });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (!request.url().startsWith(origin)) external.push(request.url()); });
    const load = async (scenario, baseline = false) => {
      requests.length = 0;
      await page.goto(`${origin}/?scenario=${scenario}${baseline ? '&baseline=1' : ''}`);
      await page.getByRole('heading').waitFor();
      await page.waitForTimeout(350);
    };
    const videosRequested = () => requests.filter((r) => r.path.endsWith('.webm'));

    let originalPhotos;
    let originalVideos;
    if (baseRef) {
      await load('photos', true);
      await waitFor(() => requests.filter((r) => r.path.startsWith('/media/photo-')).length === 20, 'The baseline did not load its 20 images.');
      originalPhotos = requests.length;
      await load('feed', true);
      await waitFor(() => videosRequested().length === 20, 'The baseline did not request metadata for its 20 videos.');
      originalVideos = videosRequested().length;
    }

    await load('photos');
    const initialPhotos = requests.filter((r) => r.path.startsWith('/media/photo-')).length;
    assert.ok(initialPhotos >= 1 && initialPhotos <= 4, `${device}: requested ${initialPhotos} photos before scrolling.`);
    assert.equal(await page.getByTestId('post-image').last().getAttribute('src'), null);
    assert.equal(await page.getByTestId('post-image').first().evaluate((img) => img.naturalWidth), 800);
    await page.screenshot({ path: join(out, `fotos-${device}.png`), animations: 'disabled' });
    await page.getByTestId('post-image').last().scrollIntoViewIfNeeded();
    await waitFor(() => requests.some((r) => r.path === '/media/photo-19.svg'), 'The last photo did not load when reached.');
    cases.push({ device, check: '20 fotos: solo se descargan las cercanas a la pantalla', initialPhotos, lastPhotoOnScroll: true, originalDimensions: '800x600' });

    await load('feed');
    assert.equal(videosRequested().length, 0);
    await page.getByTestId('post').last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    assert.equal(videosRequested().length, 0);
    await page.getByTestId('post').last().getByTestId('open-media').click();
    const viewer = page.getByTestId('media-viewer');
    await viewer.waitFor();
    assert.equal(videosRequested().length, 0);
    await page.screenshot({ path: join(out, `video-listo-${device}.png`), animations: 'disabled' });
    await viewer.getByRole('button', { name: 'Reproducir video' }).click();
    await waitFor(() => videosRequested().length > 0, 'The chosen video did not download.');
    await page.waitForFunction(() => { const video = document.querySelector('[data-testid="media-viewer-video"]'); return video && video.readyState >= 2 && !video.paused; });
    const oldPlayer = await viewer.locator('video').elementHandle();
    await page.screenshot({ path: join(out, `video-reproduciendo-${device}.png`), animations: 'disabled' });
    assert.ok(videosRequested().every((r) => r.path === '/media/video-19.webm'));
    if (device === 'movil') {
      const frame = viewer.locator('.touch-pan-y');
      await frame.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 80, clientY: 300 });
      await frame.dispatchEvent('pointermove', { pointerType: 'touch', clientX: 300, clientY: 300 });
      await frame.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 300, clientY: 300 });
    } else {
      await viewer.getByRole('button', { name: 'Publicación anterior' }).click();
    }
    assert.equal(await viewer.locator('video').count(), 0);
    assert.equal(await oldPlayer.evaluate((video) => video.paused && !video.getAttribute('src')), true);
    assert.equal(videosRequested().some((r) => r.path === '/media/video-18.webm'), false);
    await viewer.getByRole('button', { name: 'Reproducir video' }).click();
    await waitFor(() => videosRequested().some((r) => r.path === '/media/video-18.webm'), 'The next video did not download on demand.');
    if (device === 'movil') await viewer.getByRole('button', { name: 'Cerrar' }).click();
    else await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'detached' });
    assert.equal(await page.locator('video').count(), 0);
    cases.push({ device, check: '20 videos: cero solicitudes hasta reproducir; solo se reproduce el elegido; cerrar o cambiar lo detiene', initialVideoRequests: 0 });

    await load('gallery');
    assert.equal(videosRequested().length, 0);
    await page.getByRole('button', { name: 'Abrir video-0', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(videosRequested().length, 0);
    await page.getByRole('dialog').getByRole('button', { name: 'Reproducir video' }).click();
    await waitFor(() => videosRequested().length > 0, 'The gallery selection did not play.');
    cases.push({ device, check: 'Galería: no solicita los videos para crear miniaturas' });

    await load('viewer');
    await page.getByRole('button', { name: 'Abrir visor' }).click();
    await page.getByTestId('media-viewer-image').waitFor();
    assert.equal(videosRequested().length, 0);
    await page.keyboard.press('ArrowRight');
    await page.getByRole('dialog').getByRole('button', { name: 'Reproducir video' }).waitFor();
    assert.equal(videosRequested().length, 0);
    cases.push({ device, check: 'Abrir una foto no descarga el video vecino' });

    await load('locked');
    assert.equal(requests.length, 0, 'Locked content made a media request.');
    await page.getByRole('button', { name: 'Autorizar acceso' }).click();
    await page.getByRole('button', { name: 'Reproducir video' }).click();
    await waitFor(() => videosRequested().length > 0, 'The authorized video did not load.');
    await page.getByRole('button', { name: 'Retirar acceso' }).click();
    assert.equal(await page.locator('video').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Reproducir video' }).count(), 0);
    await page.getByRole('button', { name: 'Autorizar acceso' }).click();
    assert.equal(await page.locator('video').count(), 0);
    await page.getByRole('button', { name: 'Reproducir video' }).waitFor();
    cases.push({ device, check: 'Contenido cerrado: no se solicita; retirar permiso desmonta el reproductor; recuperar permiso exige pulsar otra vez' });

    await load('inline');
    assert.equal(videosRequested().length, 0);
    await page.getByRole('button', { name: 'Reproducir video' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid="direct-video"]')?.readyState >= 2);
    assert.equal(await page.locator('video').evaluate((video) => document.activeElement === video), true);
    await page.getByRole('button', { name: 'Cambiar video' }).click();
    assert.equal(await page.locator('video').count(), 0);
    assert.equal(videosRequested().some((r) => r.path === '/media/direct-2.webm'), false);
    cases.push({ device, check: 'Reproducción por teclado; cambiar el archivo espera otra confirmación' });

    await load('public');
    await waitFor(() => requests.some((r) => r.path === '/media/public-1.svg'), 'Public photo did not load.');
    await page.getByRole('button', { name: 'Ocultar foto' }).click();
    await page.getByRole('button', { name: 'Mostrar foto' }).click();
    await page.waitForFunction(() => document.querySelector('img')?.naturalWidth === 800);
    assert.equal(requests.filter((r) => r.path === '/media/public-1.svg').length, 1, 'A public image was fetched twice.');
    await page.getByRole('button', { name: 'Cambiar foto' }).click();
    await waitFor(() => requests.some((r) => r.path === '/media/public-2.svg'), 'The replacement public image did not load.');
    cases.push({ device, check: 'Foto pública: reutiliza la copia del navegador; una URL nueva muestra la foto nueva', samePhotoServerRequests: 1 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow.');
    await page.screenshot({ path: join(out, `publica-${device}.png`), animations: 'disabled' });
    benchmark.push({ device, photosBefore: originalPhotos, photosAfter: initialPhotos, videosBefore: originalVideos, videosAfter: 0 });
    await context.close();
  }

  const fallbackContext = await browser.newContext();
  await fallbackContext.addInitScript(() => { Object.defineProperty(window, 'IntersectionObserver', { value: undefined }); });
  const fallback = await fallbackContext.newPage();
  await fallback.goto(`http://127.0.0.1:${server.address().port}/?scenario=fallback`);
  await fallback.waitForFunction(() => document.querySelector('img')?.naturalWidth === 800);
  cases.push({ device: 'compatibilidad', check: 'Las fotos siguen funcionando sin IntersectionObserver' });
  await fallbackContext.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  writeFileSync(join(out, 'RESULTADO.json'), JSON.stringify({ date: new Date().toISOString(), baseRef, cases, benchmark, errors, external, limits: ['Ensayo local: no demuestra una tarifa CDN ni el consumo real de Supabase.', 'Los permisos del servidor y los enlaces privados no se han cambiado.'] }, null, 2));
  console.log(`OK: ${cases.length} comprobaciones de descarga, reproducción, acceso y compatibilidad. Evidencia: ${out}`);
  console.log(JSON.stringify(benchmark));
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
