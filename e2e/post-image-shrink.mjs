// Post photos are shrunk in the browser before upload (src/lib/postImage.ts).
// Runs the real code in Chromium on phone-sized photos and prints before/after sizes.
// Usage: node e2e/post-image-shrink.mjs   (CHROMIUM_PATH optional)
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({
  entryPoints: ['src/lib/postImage.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'postImage',
  external: ['heic2any'],
  logLevel: 'silent',
});

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
await page.addScriptTag({ content: bundle.outputFiles[0].text });

const results = await page.evaluate(async () => {
  const { shrinkPostImage, POST_IMAGE_PX } = window.postImage;
  // A photo-like picture: soft light, shapes and sensor grain, like a phone shot.
  const photo = (w, h, type = 'image/jpeg', quality = 0.92, alpha = false) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    if (!alpha) {
      const g = x.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#e9b48a');
      g.addColorStop(0.5, '#5d7fa6');
      g.addColorStop(1, '#2b2f3a');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
    }
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 120; i++) {
      x.fillStyle = `hsla(${rnd() * 360},55%,${30 + rnd() * 50}%,${0.25 + rnd() * 0.5})`;
      x.beginPath();
      x.arc(rnd() * w, rnd() * h, (0.02 + rnd() * 0.12) * w, 0, Math.PI * 2);
      x.fill();
    }
    if (!alpha) {
      const d = x.getImageData(0, 0, w, h);
      for (let i = 0; i < d.data.length; i += 4) {
        const n = (rnd() - 0.5) * 22;
        d.data[i] += n;
        d.data[i + 1] += n;
        d.data[i + 2] += n;
      }
      x.putImageData(d, 0, 0);
    }
    return new Promise((r) => c.toBlob((b) => r(new File([b], `prueba.${type.split('/')[1]}`, { type })), type, quality));
  };
  const size = async (f) => {
    const bmp = await createImageBitmap(f);
    return { bytes: f.size, w: bmp.width, h: bmp.height, type: f.type };
  };
  const cases = [
    ['Celular horizontal 4032×3024', await photo(4032, 3024)],
    ['Celular vertical 3024×4032', await photo(3024, 4032)],
    ['Cámara 6000×4000', await photo(6000, 4000)],
    ['Captura PNG 1290×2796', await photo(1290, 2796, 'image/png')],
    ['Foto ya liviana 1080×1350', await photo(1080, 1350, 'image/jpeg', 0.7)],
  ];
  const out = [];
  for (const [name, file] of cases) {
    const after = await shrinkPostImage(file);
    out.push({ name, before: await size(file), after: await size(after), same: after === file });
  }
  // A GIF must never be touched (it may be animated).
  const gif = new File([new Uint8Array([71, 73, 70, 56, 57, 97])], 'a.gif', { type: 'image/gif' });
  out.push({ name: 'GIF', same: (await shrinkPostImage(gif)) === gif });
  // Unreadable file: upload goes on with the original instead of failing.
  const broken = new File([new Uint8Array(2000)], 'x.jpg', { type: 'image/jpeg' });
  out.push({ name: 'Archivo dañado', same: (await shrinkPostImage(broken)) === broken });
  return { out, max: POST_IMAGE_PX };
});
await browser.close();

let failed = 0;
const fail = (msg) => {
  failed++;
  console.log(`  FALLA: ${msg}`);
};
const kb = (b) => `${Math.round(b / 1024).toLocaleString('es')} KB`;
console.log('\nFotos de publicaciones: antes → después de subir\n');
let totalBefore = 0;
let totalAfter = 0;
for (const r of results.out) {
  if (!r.before) {
    console.log(`${r.name}: ${r.same ? 'se sube tal cual ✓' : 'CAMBIÓ'}`);
    if (!r.same) fail(`${r.name} no debía cambiar`);
    continue;
  }
  const { before: b, after: a } = r;
  totalBefore += b.bytes;
  totalAfter += a.bytes;
  const pct = Math.round((1 - a.bytes / b.bytes) * 100);
  console.log(`${r.name}: ${b.w}×${b.h} ${kb(b.bytes)} → ${a.w}×${a.h} ${kb(a.bytes)} (${r.same ? 'se deja igual' : `-${pct} %`})`);
  if (Math.max(a.w, a.h) > Math.max(results.max, Math.max(b.w, b.h) <= results.max ? Math.max(b.w, b.h) : 0)) fail(`${r.name} quedó más grande que ${results.max} px`);
  if (a.bytes > b.bytes) fail(`${r.name} pesa más que antes`);
  if (Math.abs(a.w / a.h - b.w / b.h) > 0.01) fail(`${r.name} cambió de proporción`);
}
if (results.out[0].same || results.out[0].after.bytes > 900 * 1024) fail('la foto de celular no se achicó lo suficiente');
if (!results.out[4].same) fail('una foto ya liviana no debe volver a comprimirse');
console.log(`\nTotal: ${kb(totalBefore)} → ${kb(totalAfter)} (-${Math.round((1 - totalAfter / totalBefore) * 100)} %)`);
console.log(failed ? `\n${failed} fallas` : '\nOK');
process.exit(failed ? 1 : 0);
