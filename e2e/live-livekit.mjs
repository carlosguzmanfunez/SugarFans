// Free Live against a real LiveKit server, in a real Chromium with a fake camera.
// Usage: LIVEKIT_SERVER=/path/to/livekit-server npm run e2e:live
//
// Runs `livekit-server --dev` (keys devkey/secret) on localhost, builds the app
// in offline mode with VITE_LIVE_LOCAL_API so the local store asks
// /api/live-token for a token, and answers that route with the real handler in
// api/live-token.ts. Supabase is replaced by a tiny stub that knows the two demo
// accounts (the session token is the local user id).
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { RoomServiceClient } from 'livekit-server-sdk';

const PORT = 4174;
const BASE = `http://localhost:${PORT}`;
const LK_HTTP = 'http://127.0.0.1:7880';
const STUB_PORT = 54329;
const results = [];
const consoleErrors = [];
const pages = [];

const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false });
    if (process.env.E2E_DEBUG)
      for (const [i, p] of pages.entries()) {
        await p.screenshot({ path: join(tmpdir(), `live-${results.length}-${i}.png`) }).catch(() => {});
        console.log(`    page ${i} ${p.url()}: ${(await p.locator('main, body').first().innerText().catch(() => '')).slice(0, 300).replace(/\n/g, ' | ')}`);
      }
    console.log(`  ✗ ${name}\n      ${String(err.message || err).split('\n').slice(0, 3).join('\n      ')}`);
  }
};
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const waitFor = async (fn, msg, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(msg);
};
const waitUp = async (url) => {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`${url} no arrancó`);
};

// Supabase stand-in for api/live-token.ts: who the token belongs to, their
// profile, and an open Live for creator '1'.
const PROFILES = {
  'demo-creator': { name: 'Valentina Rose', creator_profile_id: '1' },
  'demo-fan': { name: 'Carlos M.', creator_profile_id: null },
};
const startStub = () =>
  new Promise((resolve) => {
    const server = createServer((req, res) => {
      const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      const url = new URL(req.url, 'http://x');
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (!PROFILES[token]) return send(401, { message: 'invalid token' });
      if (url.pathname === '/auth/v1/user') return send(200, { id: token });
      if (url.pathname === '/rest/v1/profiles') return send(200, [PROFILES[url.searchParams.get('id').replace('eq.', '')]]);
      if (url.pathname === '/rest/v1/live_broadcasts')
        return send(200, url.searchParams.get('creator_profile_id') === 'eq.1' ? [{ id: 'e2e', title: 'Live de prueba' }] : []);
      send(404, {});
    });
    server.listen(STUB_PORT, () => resolve(server));
  });

const loadTokenHandler = async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'live-token-')), 'live-token.mjs');
  await build({ entryPoints: [new URL('../api/live-token.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
  return (await import(pathToFileURL(out).href)).POST;
};

const run = async () => {
  const lkBin = process.env.LIVEKIT_SERVER;
  if (!lkBin) throw new Error('Falta LIVEKIT_SERVER (ruta a livekit-server)');

  const built = spawnSync('npx', ['vite', 'build', '--mode', 'offline'], { stdio: 'inherit', env: { ...process.env, VITE_LIVE_LOCAL_API: '1' } });
  if (built.status !== 0) throw new Error('vite build falló');

  Object.assign(process.env, {
    LIVEKIT_URL: 'ws://127.0.0.1:7880',
    LIVEKIT_API_KEY: 'devkey',
    LIVEKIT_API_SECRET: 'secret',
    SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
    SUPABASE_ANON_KEY: 'stub',
  });
  const POST = await loadTokenHandler();
  const lk = spawn(lkBin, ['--dev', '--bind', '127.0.0.1', '--node-ip', '127.0.0.1'], { stdio: process.env.E2E_DEBUG ? 'inherit' : 'ignore' });
  const stub = await startStub();
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
  await waitUp(LK_HTTP);
  await waitUp(BASE);
  const rooms = new RoomServiceClient(LK_HTTP, 'devkey', 'secret');
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

  try {
    const ctx = await browser.newContext({ locale: 'es-ES', permissions: ['camera', 'microphone'] });
    ctx.setDefaultTimeout(15000);
    await ctx.route('**/api/live-token', async (route) => {
      const req = route.request();
      const res = await POST(new Request(req.url(), { method: 'POST', headers: req.headers(), body: req.postData() }));
      await route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
    });
    const page = async () => {
      const p = await ctx.newPage();
      pages.push(p);
      p.on('pageerror', (e) => consoleErrors.push(e.message));
      if (process.env.E2E_DEBUG) p.on('console', (m) => console.log(`    [${m.type()}] ${m.text()}`));
      p.on('dialog', (d) => d.accept());
      return p;
    };
    const c = await page();
    const f = await page();
    const login = async (p, email) => {
      await p.goto(`${BASE}/age-verification`);
      await p.getByRole('button', { name: /Soy mayor|18/ }).first().click();
      await p.goto(`${BASE}/login`);
      await p.fill('input[type=email]', email);
      await p.fill('input[type=password]', 'demo1234');
      const box = p.locator('form input[type=checkbox]');
      if (await box.isChecked()) await box.click();
      await p.click('form button[type=submit]');
      await p.waitForURL((u) => new URL(u).pathname === '/explore');
    };
    await login(c, 'creator@sugarfans.com');
    await login(f, 'fan@sugarfans.com');
    const playing = (p) => p.locator('[data-testid=live-broadcast] video').evaluate((v) => v.videoWidth > 0 && !v.paused && v.readyState >= 2);
    const participants = async () => (await rooms.listRooms()).length ? rooms.listParticipants((await rooms.listRooms())[0].name) : [];

    await check('El fan sigue a la creator con la campanita activada', async () => {
      await f.goto(`${BASE}/creator/1`);
      await f.getByTestId('follow-button').click();
      await f.getByTestId('live-alerts').getByText('Te avisaremos cuando esté en Live').waitFor();
    });
    await check('La creator inicia el Live y emite cámara y micrófono por LiveKit', async () => {
      await c.goto(`${BASE}/creator/dashboard`);
      await c.getByLabel('Título del Live').fill('Live de prueba');
      await c.getByRole('button', { name: 'Iniciar Live' }).click();
      await c.waitForURL(`${BASE}/en-vivo/1`);
      await c.getByRole('button', { name: 'Encender cámara y empezar' }).click();
      await c.getByRole('button', { name: 'Terminar Live' }).waitFor();
      await waitFor(() => playing(c), 'la vista previa de la creator no se reproduce');
      await waitFor(async () => (await participants()).some((p) => p.identity === 'demo-creator' && p.tracks.length === 2), 'la creator no publica audio y video');
    });
    await check('La campanita avisa al fan y lo lleva al Live', async () => {
      await f.goto(`${BASE}/explore`);
      await f.getByTestId('notification-count').getByText('1').waitFor();
      await f.getByTestId('notification-bell').click();
      await f.getByTestId('notification-panel').getByRole('link', { name: /Valentina Rose está en Live/ }).click();
      await f.waitForURL(`${BASE}/en-vivo/1`);
    });
    await check('El fan entra y ve el video de la creator', async () => {
      await f.getByRole('button', { name: 'Entrar al Live' }).click();
      await waitFor(() => playing(f), 'el fan no recibe el video');
      await f.getByTestId('live-viewers').getByText('1').waitFor();
    });
    await check('Solo la creator puede publicar: el fan solo consume', async () => {
      const ps = await participants();
      const fan = ps.find((p) => p.identity === 'demo-fan');
      const creator = ps.find((p) => p.identity === 'demo-creator');
      expect(fan && creator, `participantes: ${ps.map((p) => p.identity)}`);
      expect(fan.permission.canPublish === false && fan.tracks.length === 0, 'el fan tiene permiso o pistas de publicación');
      expect(creator.permission.canPublish === true, 'la creator no puede publicar');
      expect((await f.getByRole('button', { name: /micrófono|cámara/ }).count()) === 0, 'el fan ve controles de cámara o micrófono');
    });
    await check('El chat llega a los dos lados', async () => {
      await f.getByLabel('Mensaje').fill('¡Hola desde el fan!');
      await f.getByRole('button', { name: 'Enviar' }).click();
      await c.getByTestId('broadcast-chat').getByText('¡Hola desde el fan!').waitFor();
      await c.getByLabel('Mensaje').fill('¡Bienvenido!');
      await c.getByRole('button', { name: 'Enviar' }).click();
      await f.getByTestId('broadcast-chat').getByText('¡Bienvenido!').waitFor();
    });
    await check('Al terminar el Live, el fan ve que terminó y el perfil deja de estar en Live', async () => {
      await c.getByRole('button', { name: 'Terminar Live' }).click();
      await c.waitForURL(`${BASE}/creator/dashboard`);
      await f.getByText('El Live terminó.').waitFor();
      await waitFor(async () => !(await participants()).some((p) => p.identity === 'demo-creator'), 'la creator sigue en la sala');
      await f.goto(`${BASE}/creator/1`);
      await f.getByTestId('ladder-live').getByText('En vivo', { exact: true }).waitFor();
    });
  } finally {
    await browser.close();
    preview.kill();
    lk.kill();
    stub.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} flujos de Live OK`);
  if (consoleErrors.length) console.log(`Errores de página:\n  - ${[...new Set(consoleErrors)].join('\n  - ')}`);
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
