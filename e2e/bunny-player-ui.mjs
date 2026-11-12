// The post video player with a Bunny Stream link (src/components/OnDemandVideo.tsx):
// nothing loads before "Reproducir", then Bunny's player opens with autoplay and keeps
// the video's shape (vertical phone video tall, horizontal full width). Bunny is faked.
// Run: node e2e/bunny-player-ui.mjs   (CHROMIUM_PATH optional)
import { build } from 'esbuild';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const poster = 'https://vz-test.b-cdn.net/g1/thumbnail.jpg?token=t&expires=9';
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import OnDemandVideo from './src/components/OnDemandVideo';
const poster = ${JSON.stringify(poster)};
const vertical = 'https://player.mediadelivery.net/embed/777/g1?token=abc&expires=9#r=1080x1920&p=' + encodeURIComponent(poster);
const filled = 'https://player.mediadelivery.net/embed/777/g3?token=abc&expires=9#r=1080x1920';
const horizontal = 'https://player.mediadelivery.net/embed/777/g2?token=abc&expires=9#r=1920x1080';
const supabase = 'https://db.example.invalid/storage/v1/object/sign/post-media/x.mp4?token=t';
createRoot(document.getElementById('root')).render(
  <div style={{ width: 390 }}>
    <div id="a"><OnDemandVideo src={vertical} seed="a" testId="va" /></div>
    <div id="b"><OnDemandVideo src={horizontal} seed="b" testId="vb" /></div>
    <div id="c"><OnDemandVideo src={supabase} seed="c" testId="vc" /></div>
    <div id="d" style={{ height: 700, display: 'flex' }}><OnDemandVideo src={filled} seed="d" testId="vd" fill /></div>
  </div>
);`;
const out = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  loader: { '.svg': 'dataurl', '.png': 'dataurl', '.webp': 'dataurl', '.jpg': 'dataurl' },
  logLevel: 'silent',
});

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
const bunnyHits = [];
await page.route('https://player.mediadelivery.net/**', (r) => {
  bunnyHits.push(r.request().url());
  return r.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#222">player</body>' });
});
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
await page.route('https://vz-test.b-cdn.net/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
await page.route('https://db.example.invalid/**', (r) => r.fulfill({ status: 404, body: '' }));
await page.setContent('<div id="root"></div>');
await page.addScriptTag({ content: out.outputFiles[0].text });
await page.locator('#a [data-testid=play-video]').waitFor();

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`✓ ${name}`);
};

assert.equal(await page.locator('iframe').count(), 0);
assert.equal(bunnyHits.length, 0);
ok('No se carga nada de Bunny antes de tocar Reproducir');

const img = page.locator('#a [data-testid=video-poster]');
await img.waitFor();
assert.equal(await img.getAttribute('src'), poster);
await page.waitForFunction(() => document.querySelector('#a [data-testid=video-poster]')?.complete);
assert.ok(await img.evaluate((i) => i.naturalWidth > 0), 'la miniatura cargó');
assert.equal(await page.locator('#c [data-testid=video-poster]').count(), 0);
ok('Antes de Reproducir se ve la miniatura de Bunny (los videos aún en Supabase muestran la portada de siempre)');

await page.click('#a [data-testid=play-video]');
await page.click('#b [data-testid=play-video]');
const va = page.locator('[data-testid=va] iframe');
const vb = page.locator('[data-testid=vb] iframe');
await va.waitFor();
const src = await va.getAttribute('src');
assert.ok(src.startsWith('https://player.mediadelivery.net/embed/777/g1?token=abc&expires=9&autoplay=true'));
assert.ok(!src.includes('#r='), 'la forma del video no se manda a Bunny');
assert.ok(!(await va.getAttribute('allow')).includes('picture-in-picture'), 'sin ventana flotante (anti-filtración)');
ok('Al tocar Reproducir abre el reproductor de Bunny con su enlace firmado');

const a = await va.boundingBox();
const b = await vb.boundingBox();
assert.ok(a.height > a.width * 1.6, `vertical ${a.width}x${a.height}`);
assert.ok(Math.abs(b.width - 390) < 2 && Math.abs(b.width / b.height - 16 / 9) < 0.05, `horizontal ${b.width}x${b.height}`);
ok(`Respeta la forma: vertical ${Math.round(a.width)}×${Math.round(a.height)}, horizontal ${Math.round(b.width)}×${Math.round(b.height)}`);

await page.click('#c [data-testid=play-video]');
await page.locator('[data-testid=vc]').waitFor();
assert.equal(await page.locator('#c video').count(), 1);
assert.equal(await page.locator('#c iframe').count(), 0);
ok('Un video que aún no está en Bunny se reproduce desde Supabase como antes');

await page.click('#d [data-testid=play-video]');
const vd = page.locator('[data-testid=vd] iframe');
await vd.waitFor();
const d = await vd.boundingBox();
assert.ok(Math.abs(d.height - 700) < 2, `pantalla completa ${d.width}x${d.height}`);
ok(`En el visor a pantalla completa el video ocupa todo el alto (${Math.round(d.width)}×${Math.round(d.height)})`);

await browser.close();
console.log(`\n${passed} comprobaciones del reproductor`);
