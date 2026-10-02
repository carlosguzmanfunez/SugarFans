// Renders the raster brand assets from their sources in design/brand/:
//   public/og-fans-reserve.jpg (1200x630), public/icons/icon-{180,192,512}.png,
//   public/icons/icon-maskable-512.png, public/favicon-32.png, public/favicon.svg,
//   public/brand/coin.png (Créditos symbol) and the logo lockups in design/brand/exports/
// Usage: node scripts/brand-assets.mjs   (uses the Playwright Chromium already in devDependencies)
import { chromium } from 'playwright';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = (file, query = '') => `file://${root}/design/brand/${file}${query}`;
mkdirSync(`${root}/public/icons`, { recursive: true });
mkdirSync(`${root}/public/brand`, { recursive: true });
mkdirSync(`${root}/design/brand/exports`, { recursive: true });
copyFileSync(`${root}/design/brand/favicon.svg`, `${root}/public/favicon.svg`);

const browser = await chromium.launch();
const shot = async (url, out, size, { transparent = false, height = size, jpeg = false, dir = 'public' } = {}) => {
  const page = await browser.newPage({ viewport: { width: size, height } });
  await page.goto(url);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${root}/${dir}/${out}`, omitBackground: transparent, ...(jpeg ? { type: 'jpeg', quality: 88 } : {}) });
  await page.close();
  console.log('✓', out);
};

await shot(src('og.html'), 'og-fans-reserve.jpg', 1200, { height: 630, jpeg: true });
await shot(src('icon.html', '?touch'), 'icons/icon-180.png', 180);
for (const size of [192, 512]) await shot(src('icon.html'), `icons/icon-${size}.png`, size, { transparent: true });
await shot(src('icon.html', '?maskable'), 'icons/icon-maskable-512.png', 512);
await shot(src('icon.html', '?favicon'), 'favicon-32.png', 32, { transparent: true });
await shot(src('icon.html', '?coin'), 'brand/coin.png', 128, { transparent: true });
for (const v of ['primary', 'mono-dark', 'mono-light'])
  await shot(src('lockup.html', `?${v}`), `logo-${v}.png`, 1400, { height: 360, transparent: true, dir: 'design/brand/exports' });
await browser.close();
