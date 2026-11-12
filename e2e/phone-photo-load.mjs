// Photos edited on the phone (Samsung "Remasterizar", filters...) or sent without a
// type must open for the profile photo, the cover and posts (src/lib/profileImage.ts).
// Runs the real code in Chromium. Usage: node e2e/phone-photo-load.mjs [extra.jpg ...]
// (extra photos are optional: real phone photos to try, never committed).
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({
  stdin: {
    contents: `export * from './src/lib/profileImage'; export { shrinkPostImage } from './src/lib/postImage';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'photo',
  external: ['heic2any'],
  logLevel: 'silent',
});

const extras = process.argv.slice(2).map((p) => ({ name: p.split('/').pop(), b64: readFileSync(p).toString('base64') }));

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
await page.addScriptTag({ content: bundle.outputFiles[0].text });

const results = await page.evaluate(async (extras) => {
  const { loadImage, shrinkPostImage, sniffImage, cleanJpeg, checkProfileImage, prepareCover, coverFrameTag, parseCoverFrame } = window.photo;
  const out = [];
  const check = (name, ok, detail = '') => out.push({ name, ok: !!ok, detail });

  const c = document.createElement('canvas');
  c.width = 3000;
  c.height = 2000;
  const x = c.getContext('2d');
  x.fillStyle = '#5d7fa6';
  x.fillRect(0, 0, 3000, 2000);
  x.fillStyle = '#e9b48a';
  x.fillRect(400, 300, 1200, 900);
  const jpeg = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());

  // Like a Samsung edit: maker blocks (APP4/APP5) after SOI and a trailer after the end marker.
  const seg = (marker, body) => {
    const len = body.length + 2;
    return new Uint8Array([0xff, marker, len >> 8, len & 255, ...body]);
  };
  const app4 = seg(0xe4, new Uint8Array(600).fill(0));
  const app5 = seg(0xe5, new TextEncoder().encode('debuginfo'));
  const trailer = new TextEncoder().encode('Image_UTC_Data1700000000000SEFHSEFT');
  const edited = new Uint8Array([...jpeg.subarray(0, 2), ...app4, ...app5, ...jpeg.subarray(2), ...trailer]);

  const file = (bytes, name, type) => new File([bytes], name, { type });

  check('sniff jpeg', sniffImage(edited) === 'image/jpeg');
  check('sniff heic', sniffImage(new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypheic')])) === 'image/heic');
  const clean = cleanJpeg(edited);
  check('clean drops maker blocks and trailer', clean && clean.length === jpeg.length, `${clean?.length} vs ${jpeg.length}`);
  const cleanImg = await loadImage(new File([clean], 'c.jpg', { type: 'image/jpeg' }));
  check('cleaned jpeg still opens', cleanImg.naturalWidth === 3000);

  for (const [label, f] of [
    ['edited jpeg', file(edited, 'remaster.jpg', 'image/jpeg')],
    ['no type, no extension', file(edited, 'image', '')],
    ['octet-stream', file(edited, 'IMG_0001', 'application/octet-stream')],
    ['jpeg named .heic', file(edited, 'IMG_0002.HEIC', 'image/heic')],
  ]) {
    const problem = checkProfileImage(f);
    let size = '';
    try {
      const img = await loadImage(f);
      size = `${img.naturalWidth}x${img.naturalHeight}`;
    } catch (e) {
      size = 'ERROR ' + e.message;
    }
    check(`opens: ${label}`, !problem && size === '3000x2000', problem || size);
    const post = await shrinkPostImage(f).catch((e) => ({ type: 'ERROR ' + e.message }));
    check(`post becomes jpeg: ${label}`, post.type === 'image/jpeg', `${post.type} ${post.size ?? ''}`);
  }

  // Cover: the whole photo is saved; the chosen band travels in the file name.
  const coverImg = await loadImage(file(edited, 'c.jpg', 'image/jpeg'));
  const { blob: coverBlob, frame } = await prepareCover(coverImg, 0, 1000, 3000, 1000);
  const back = await loadImage(new File([coverBlob], 'x.jpg', { type: 'image/jpeg' }));
  check('cover keeps the whole photo', back.naturalWidth === 1920 && back.naturalHeight === 1280, `${back.naturalWidth}x${back.naturalHeight}`);
  const url = `https://x.supabase.co/storage/v1/object/public/profile-images/u/cover-1700000000000-${coverFrameTag(frame)}.jpg`;
  const parsed = parseCoverFrame(url);
  check('cover band read back from the link', JSON.stringify(parsed) === JSON.stringify({ x: 0, y: 640, w: 1920, h: 640, W: 1920, H: 1280 }), JSON.stringify(parsed));
  check('old covers have no band', parseCoverFrame('https://x/profile-images/u/cover-1700000000000.jpg') === null);
  check('offline data link keeps the band', !!parseCoverFrame('data:image/jpeg;base64,AAAA#' + coverFrameTag(frame)));

  let err = '';
  try {
    await loadImage(file(new TextEncoder().encode('not a photo at all'), 'x.jpg', 'image/jpeg'));
  } catch (e) {
    err = e.message;
  }
  check('broken file gives the translated error key', err === 'photo.unreadable', err);
  check('a PDF is refused before opening', !!checkProfileImage(file(new Uint8Array([1]), 'doc.pdf', 'application/pdf')));

  for (const ex of extras) {
    const bytes = Uint8Array.from(atob(ex.b64), (ch) => ch.charCodeAt(0));
    const img = await loadImage(file(bytes, ex.name, 'image/jpeg')).catch((e) => ({ naturalWidth: 'ERROR ' + e.message }));
    check(`real photo ${ex.name}`, typeof img.naturalWidth === 'number', `${img.naturalWidth}x${img.naturalHeight}`);
  }
  return out;
}, extras);

await browser.close();
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(failed ? `\n${failed} failed` : `\nall ${results.length} passed`);
process.exit(failed ? 1 : 0);
