// Counts the Supabase requests each signed-in page makes when it opens, on a
// phone and on a computer, and fails if the same request goes out twice.
// Every Supabase call is answered by this script (empty lists), so it runs offline
// against a production build (built here, or pass a built folder):
//   npm run test:request-count            (or: node e2e/request-count.mjs /tmp/fr-dist)
// FILES=1 lists the code and media files each page downloads; JSON=1 prints raw counts.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';

let dist = process.argv[2];
if (!dist) {
  // Production build with the launch gate open (what visitors get after "lanzamos").
  dist = '/tmp/fr-request-count';
  process.env.VITE_LAUNCHED = 'true';
  const { build } = await import('vite');
  await build({ logLevel: 'error', build: { outDir: dist, emptyOutDir: true } });
}
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(dist, path);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
  res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
}).listen(0);
const base = `http://localhost:${server.address().port}`;

const UID = '11111111-1111-4111-8111-111111111111';
const CREATOR = '22222222-2222-4222-8222-222222222222';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, exp, role: 'authenticated', aud: 'authenticated', email: 'perf@example.com' })}.sig`;
const authUser = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'perf@example.com', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' };
const profile = {
  id: UID, name: 'Perf Creator', email: 'perf@example.com', role: 'creator', avatar: '', cover: null, bio: '', is_verified: true,
  subscription_price: 9.99, followers: 0, following: 0, posts: 0, age_verified: true, settings: {}, creator_profile_id: CREATOR,
  created_at: '2026-10-01T00:00:00Z', signup_completed: true, country: 'HN', gender: 'female', username: 'perf',
};

const pages = [
  ['Inicio', '/'],
  ['Panel', '/creator/dashboard'],
  ['Mi perfil', '/profile'],
  ['Explorar', '/explore'],
  ['Reserve', '/reserve'],
  ['Visitante', '/', true],
];
const viewports = [
  ['Celular', { width: 390, height: 844, isMobile: true, hasTouch: true }],
  ['Computadora', { width: 1440, height: 900 }],
];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const report = [];
let worst = 0;
let worstReturn = 0;
const returns = [];
for (const [vpName, vp] of viewports) {
  for (const [name, path, visitor] of pages) {
    if (process.env.PAGES && !process.env.PAGES.split(',').includes(name)) continue;
    const { isMobile, hasTouch, ...size } = vp;
    const ctx = await browser.newContext({ viewport: size, isMobile, hasTouch });
    await ctx.addInitScript(({ jwt, authUser, exp, UID, visitor }) => {
      if (sessionStorage.getItem('perf-init')) return;
      sessionStorage.setItem('perf-init', '1');
      if (!visitor) localStorage.setItem('sb-odugxvqwuvewsvifwmwb-auth-token', JSON.stringify({ access_token: jwt, refresh_token: 'r', expires_at: exp, expires_in: 3600, token_type: 'bearer', user: authUser }));
      localStorage.setItem('fansreserve_age_verified', 'true');
      localStorage.setItem(`fansreserve_first_steps_done_${UID}`, '1');
    }, { jwt, authUser, exp, UID, visitor });
    const seen = new Map();
    const files = new Set();
    const media = new Set();
    ctx.on('request', (r) => {
      const u = new URL(r.url());
      if (u.origin === base && /\.(js|css)$/.test(u.pathname)) files.add(u.pathname);
      if (u.origin === base && /\.(jpe?g|png|webp|avif|mp4|webm)$/.test(u.pathname)) media.add(u.pathname);
    });
    await ctx.route(/supabase\.co|fansreserve\.com\/api|\/api\//, async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      // Same table or function with the same filters = the same request.
      const key = `${req.method()} ${u.pathname.replace('/rest/v1/', '').replace('/storage/v1/', 'storage:')}${u.search} ${req.postData() ?? ''}`.trim();
      seen.set(key, (seen.get(key) ?? 0) + 1);
      const accept = req.headers()['accept'] ?? '';
      if (u.pathname === '/auth/v1/user') return route.fulfill({ json: authUser });
      if (u.pathname.startsWith('/auth/')) return route.fulfill({ json: {} });
      if (u.pathname === '/rest/v1/profiles' && u.searchParams.get('id') === `eq.${UID}`) return route.fulfill({ json: accept.includes('vnd.pgrst.object') ? profile : [profile] });
      if (accept.includes('vnd.pgrst.object')) return route.fulfill({ status: 406, json: { code: 'PGRST116', message: 'none' } });
      if (u.pathname.includes('/rpc/')) return route.fulfill({ json: null });
      if (u.pathname.startsWith('/rest/v1/')) return route.fulfill({ json: [], headers: { 'content-range': '0-0/0' } });
      return route.fulfill({ json: {} });
    });
    const page = await ctx.newPage();
    if (process.env.DEBUG) page.on('console', (m) => console.log('  [page]', m.text()));
    await page.goto(base + path, { waitUntil: 'load' });
    await page.waitForTimeout(4000);
    const total = [...seen.values()].reduce((a, b) => a + b, 0);
    const repeats = [...seen.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
    worst = Math.max(worst, ...repeats.map(([, n]) => n), 1);
    // What a phone downloads (compressed), from the built files.
    const js = [...files].reduce((sum, f) => sum + gzipSync(readFileSync(join(dist, f))).length, 0);
    const mediaBytes = [...media].reduce((sum, f) => sum + (existsSync(join(dist, f)) ? statSync(join(dist, f)).size : 0), 0);
    report.push({ vp: vpName, name, url: page.url().replace(base, ''), total, js, mediaBytes, files: [...files, ...media], repeats, all: Object.fromEntries(seen) });

    // Switching to another app and back: a quick switch asks nothing again; after
    // more than a minute away the screens reload once (no repeats).
    if (name === 'Inicio') {
      const away = async (ms) => {
        seen.clear();
        await page.evaluate((ms) => {
          const set = (v) => Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
          set('hidden');
          document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
          if (ms) {
            const real = Date.now.bind(Date);
            const skew = (window.__skew ?? 0) + ms;
            window.__skew = skew;
            Date.now = () => real() + ms;
          }
          set('visible');
          document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
        }, ms);
        await page.waitForTimeout(3000);
        // Sign-in check and the light Reserve call check (our own /api) are expected.
        return [...seen.entries()].filter(([k]) => !k.includes('/auth/v1/') && !k.includes(' /api/'));
      };
      const quick = await away(0);
      returns.push(`${vpName}: vuelta rápida ${quick.reduce((a, [, n]) => a + n, 0)} consultas`);
      if (quick.length) worstReturn = Math.max(worstReturn, 1);
      const long = await away(120_000);
      const longTotal = long.reduce((a, [, n]) => a + n, 0);
      returns.push(`${vpName}: vuelta tras 2 min ${longTotal} consultas `);
      if (!longTotal) worstReturn = Math.max(worstReturn, 1);
      worst = Math.max(worst, ...long.map(([, n]) => n));
    }
    await ctx.close();
  }
}
await browser.close();
server.close();

for (const r of report) {
  console.log(`${r.vp.padEnd(11)} ${r.name.padEnd(10)} ${String(r.total).padStart(3)} consultas  código ${(r.js / 1024).toFixed(0)} KB  imágenes/video ${(r.mediaBytes / 1024).toFixed(0)} KB  (${r.url})`);
  if (process.env.FILES) console.log('      ' + r.files.map((f) => f.split('/').pop()).join(' '));
  for (const [k, n] of r.repeats) console.log(`      x${n} ${k}`);
  if (process.env.JSON) console.log(JSON.stringify(r.all));
}
for (const line of returns) console.log(line);
if (worstReturn) {
  console.error('FALLA: al volver a la app, una vuelta rápida no debe pedir nada y una tras 2 min debe actualizar');
  process.exit(1);
}
if (worst > 1) {
  console.error(`FALLA: una consulta sale ${worst} veces al abrir la misma página`);
  process.exit(1);
}
console.log('OK: ninguna consulta se repite al abrir cada página.');
