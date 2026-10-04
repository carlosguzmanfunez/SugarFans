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
import { mkdtempSync, readFileSync } from 'node:fs';
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
// E2E_SHOTS=<folder> saves screenshots of the camera filter screens.
const shot = (p, name) => process.env.E2E_SHOTS && p.screenshot({ path: join(process.env.E2E_SHOTS, `${name}.png`) });
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
// profile, an open Live for creator '1' and a confirmed Reserve call booked for
// right now between the demo fan and creator '1' (row security: only those two see it).
const LIVE_KEY = 'fansreserve_live'; // local Live store (src/lib/backend/localLive.ts)
const PROFILES = {
  'demo-creator': { name: 'Valentina Rose', creator_profile_id: '1' },
  'demo-fan': { name: 'Carlos M.', creator_profile_id: null },
  intruso: { name: 'Otra persona', creator_profile_id: null },
};
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const CALL = {
  id: 'e2e-call',
  status: 'confirmed',
  date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  duration_minutes: 30,
  fan_id: 'demo-fan',
  creator_profile_id: '1',
  details: null,
};
const BOOKINGS = { [CALL.id]: CALL, 'e2e-pending': { ...CALL, id: 'e2e-pending', status: 'accepted' } };
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
      if (url.pathname === '/rest/v1/vip_bookings') {
        const b = BOOKINGS[url.searchParams.get('id').replace('eq.', '')];
        return send(200, b && (b.fan_id === token || PROFILES[token].creator_profile_id === b.creator_profile_id) ? [b] : []);
      }
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
  // Software WebGL so the camera filters run in headless Chromium.
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'] });

  try {
    const ctx = await browser.newContext({ locale: 'es-ES', permissions: ['camera', 'microphone'] });
    ctx.setDefaultTimeout(15000);
    await ctx.route('**/api/live-token', async (route) => {
      const req = route.request();
      const res = await POST(new Request(req.url(), { method: 'POST', headers: req.headers(), body: req.postData() }));
      await route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
    });
    // Background Blur's MediaPipe runtime comes from jsDelivr: serve the installed copy.
    await ctx.route('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@*/wasm/*', (route) => {
      const name = route.request().url().split('/').pop();
      route.fulfill({ body: readFileSync(`node_modules/@mediapipe/tasks-vision/wasm/${name}`), contentType: name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
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
    // How warm the picture looks (mean red minus mean blue) on a video element.
    const warmth = (loc) =>
      loc.evaluate((v) => {
        const k = document.createElement('canvas');
        k.width = 64;
        k.height = 36;
        const g = k.getContext('2d');
        g.drawImage(v, 0, 0, 64, 36);
        const d = g.getImageData(0, 0, 64, 36).data;
        let rb = 0;
        for (let i = 0; i < d.length; i += 4) rb += d[i] - d[i + 2];
        return rb / (d.length / 4);
      });
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
      await c.getByRole('radio', { name: /Warm/ }).click();
      await shot(c, 'live-antes-de-empezar');
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
    await check('El fan recibe el video con el filtro que eligió la creator, y cambia en vivo', async () => {
      const fanVideo = f.locator('[data-testid=live-broadcast] video');
      await f.waitForTimeout(1500);
      const warm = await warmth(fanVideo);
      await c.getByTestId('looks-button').click();
      await c.getByRole('radio', { name: /Natural/ }).click();
      await waitFor(async () => (await warmth(fanVideo)) < warm - 8, `el video del fan no cambió al quitar Warm (antes ${warm.toFixed(1)})`);
      await c.getByRole('radio', { name: /Background Blur/ }).click();
      await c.getByTestId('enhance-toggle').click();
      await c.waitForTimeout(3000);
      await shot(c, 'live-filtros-en-vivo');
      expect((await c.getByRole('radio', { name: /Background Blur/ }).getAttribute('aria-checked')) === 'true', 'Background Blur volvió a Natural');
      expect((await c.getByTestId('enhance-toggle').getAttribute('aria-pressed')) === 'true', 'Mejorar apariencia no quedó activado');
      await waitFor(() => playing(f), 'el fan dejó de recibir video con Background Blur');
      await c.getByRole('radio', { name: /Natural/ }).click();
      await c.getByTestId('enhance-toggle').click();
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
    await check('Salir del Live (botón, atrás u otro enlace) pide confirmar; con "No" sigue emitiendo', async () => {
      const dialog = c.getByTestId('leave-live-dialog');
      const stay = async () => {
        await dialog.getByText('Estás abandonando el Live y se cerrará. ¿Estás de acuerdo?').waitFor();
        await dialog.getByRole('button', { name: 'No, continuar en el Live' }).click();
        await dialog.waitFor({ state: 'detached' });
        expect(new URL(c.url()).pathname === '/en-vivo/1', `salió del Live: ${c.url()}`);
      };
      await c.getByRole('button', { name: 'Terminar Live' }).click();
      await stay();
      await c.goBack();
      await stay();
      await c.evaluate(() => {
        const a = Object.assign(document.createElement('a'), { href: '/explore', textContent: 'otra página' });
        document.body.append(a);
        a.click();
      });
      await stay();
      expect((await participants()).some((p) => p.identity === 'demo-creator' && p.tracks.length === 2), 'la creator dejó de emitir');
    });
    await check('Al terminar el Live, el fan ve que terminó y el perfil deja de estar en Live', async () => {
      await c.getByRole('button', { name: 'Terminar Live' }).click();
      await c.getByTestId('leave-live-dialog').getByRole('button', { name: 'Sí, cerrar el Live' }).click();
      await c.waitForURL(`${BASE}/creator/dashboard`);
      await f.getByText('El Live terminó.').waitFor();
      await waitFor(async () => !(await participants()).some((p) => p.identity === 'demo-creator'), 'la creator sigue en la sala');
      await f.goto(`${BASE}/creator/1`);
      await f.getByTestId('ladder-live').getByText('En vivo', { exact: true }).waitFor();
    });

    await check('Si la creator cierra la pestaña en pleno Live, el Live se cierra', async () => {
      const c2 = await page();
      await login(c2, 'creator@sugarfans.com');
      await c2.goto(`${BASE}/creator/dashboard`);
      await c2.getByLabel('Título del Live').fill('Live que se cierra solo');
      await c2.getByRole('button', { name: 'Iniciar Live' }).click();
      await c2.waitForURL(`${BASE}/en-vivo/1`);
      await c2.getByRole('button', { name: 'Encender cámara y empezar' }).click();
      await waitFor(() => playing(c2), 'la creator no emite');
      await c2.close({ runBeforeUnload: true });
      await f.goto(`${BASE}/en-vivo/1`);
      await f.getByText('Este creator no está en Live ahora').waitFor();
    });

    await check('Si a la creator se le apaga el celular en pleno Live, el Live se cierra solo', async () => {
      const c3 = await page();
      await login(c3, 'creator@sugarfans.com');
      await c3.goto(`${BASE}/creator/dashboard`);
      await c3.getByLabel('Título del Live').fill('Live que se apaga');
      await c3.getByRole('button', { name: 'Iniciar Live' }).click();
      await c3.waitForURL(`${BASE}/en-vivo/1`);
      await c3.getByRole('button', { name: 'Encender cámara y empezar' }).click();
      await waitFor(() => playing(c3), 'la creator no emite');
      const openLive = (p) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').broadcasts?.find((b) => !b.endedAt), LIVE_KEY);
      await waitFor(async () => !!(await openLive(f))?.lastSeenAt, 'la página de la creator no reporta que sigue en Live');
      // A phone that dies: the page stops running, with no pagehide or any other goodbye.
      const cdp = await c3.context().newCDPSession(c3);
      await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
      await f.goto(`${BASE}/creator/1`);
      await f.getByTestId('live-now').waitFor();
      // Two minutes and a half later with no check-in…
      await f.evaluate((key) => {
        const st = JSON.parse(localStorage.getItem(key));
        const ago = new Date(Date.now() - 150_000).toISOString();
        st.broadcasts = st.broadcasts.map((b) => (b.endedAt ? b : { ...b, lastSeenAt: ago }));
        localStorage.setItem(key, JSON.stringify(st));
      }, LIVE_KEY);
      await f.goto(`${BASE}/en-vivo/1`);
      await f.getByText('Este creator no está en Live ahora').waitFor();
    });

    console.log('\nVideollamada privada de Reserve');
    const askCall = async (who, bookingId) => {
      const res = await POST(new Request(`${BASE}/api/live-token`, { method: 'POST', headers: { authorization: `Bearer ${who}` }, body: JSON.stringify({ bookingId }) }));
      return { status: res.status, body: await res.json() };
    };
    await check('Solo el fan y la creator de la reserva confirmada reciben acceso a la sala', async () => {
      const fan = await askCall('demo-fan', CALL.id);
      const creator = await askCall('demo-creator', CALL.id);
      expect(fan.status === 200 && fan.body.token && fan.body.host === false, `fan: ${JSON.stringify(fan)}`);
      expect(creator.status === 200 && creator.body.host === true, `creator: ${JSON.stringify(creator)}`);
      const outsider = await askCall('intruso', CALL.id);
      expect(outsider.status === 404 && !outsider.body.token, `intruso: ${JSON.stringify(outsider)}`);
      const pending = await askCall('demo-fan', 'e2e-pending');
      expect(pending.status === 403 && !pending.body.token, `sin pagar: ${JSON.stringify(pending)}`);
    });
    const callBooking = {
      id: CALL.id,
      experienceId: 'e2e-exp',
      creatorProfileId: '1',
      title: 'Videollamada de prueba',
      creatorName: 'Valentina Rose',
      price: 50,
      fanId: 'demo-fan',
      fanName: 'Carlos M.',
      fanEmail: 'fan@sugarfans.com',
      date: CALL.date,
      time: CALL.time,
      message: '',
      status: 'confirmed',
      durationMinutes: 30,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await f.evaluate((b) => {
      const key = 'fansreserve_vip_bookings';
      localStorage.setItem(key, JSON.stringify([...JSON.parse(localStorage.getItem(key) || '[]'), b]));
    }, callBooking);
    const remotePlaying = (p) => p.getByTestId('remote-video').evaluate((v) => v.videoWidth > 0 && !v.paused && v.readyState >= 2);
    await check('Fan y creator entran a la videollamada y se ven por LiveKit', async () => {
      await f.goto(`${BASE}/live/${CALL.id}`);
      await f.getByRole('button', { name: 'Ver cómo me veo' }).click();
      await f.getByRole('radio', { name: /Studio/ }).click();
      await waitFor(() => f.getByTestId('camera-preview').locator('video').evaluate((v) => v.videoWidth > 0 && !v.paused), 'la vista previa con filtro no se ve');
      await shot(f, 'reserve-sala-de-espera');
      await f.getByRole('button', { name: 'Entrar a la sala' }).click();
      await f.getByTestId('live-room').getByText(/Esperando a Valentina Rose/).waitFor();
      await c.goto(`${BASE}/live/${CALL.id}`);
      await c.getByRole('button', { name: 'Entrar a la sala' }).click();
      for (const p of [f, c]) {
        await p.getByTestId('live-status').getByText('Conectado').waitFor();
        await waitFor(() => remotePlaying(p), 'no llega el video del otro lado');
      }
      const ps = await rooms.listParticipants(`booking-${CALL.id}`);
      expect(ps.length === 2 && ps.every((p) => p.tracks.length === 2), `participantes: ${ps.map((p) => `${p.identity}:${p.tracks.length}`)}`);
    });
    await check('El chat de la videollamada llega a los dos lados', async () => {
      await f.getByLabel('Mensaje').fill('¡Hola Valentina!');
      await f.getByRole('button', { name: 'Enviar' }).click();
      await c.getByTestId('chat-line').filter({ hasText: '¡Hola Valentina!' }).waitFor();
      await c.getByLabel('Mensaje').fill('¡Hola Carlos!');
      await c.getByRole('button', { name: 'Enviar' }).click();
      await f.getByTestId('chat-line').filter({ hasText: '¡Hola Carlos!' }).waitFor();
    });
    await check('Apagar la cámara y el micrófono funciona', async () => {
      await f.getByRole('button', { name: 'Apagar cámara' }).click();
      await f.getByRole('button', { name: 'Silenciar micrófono' }).click();
      await waitFor(async () => {
        const fan = (await rooms.listParticipants(`booking-${CALL.id}`)).find((p) => p.identity === 'demo-fan');
        return fan && fan.tracks.every((t) => t.muted);
      }, 'las pistas del fan siguen activas');
      await f.getByRole('button', { name: 'Encender cámara' }).click();
      await f.getByRole('button', { name: 'Activar micrófono' }).click();
    });
    await check('Cuando uno sale, el otro lo ve y puede volver a entrar', async () => {
      await f.getByRole('button', { name: 'Salir de la llamada' }).click();
      await f.waitForURL(`${BASE}/profile`);
      await c.getByText(/Carlos M\. salió de la sala/).waitFor();
      await c.getByTestId('live-status').getByText('Sin conexión').waitFor();
      await f.goto(`${BASE}/live/${CALL.id}`);
      await f.getByRole('button', { name: 'Entrar a la sala' }).click();
      await c.getByTestId('live-status').getByText('Conectado').waitFor();
      await waitFor(() => remotePlaying(c), 'no vuelve el video del fan');
    });
  } finally {
    await browser.close();
    // Empty the rooms and stop LiveKit at once: a server left draining keeps the
    // port and its participants, and the next run would find them in the call.
    await Promise.all((await rooms.listRooms().catch(() => [])).map((r) => rooms.deleteRoom(r.name).catch(() => {})));
    preview.kill();
    lk.kill('SIGKILL');
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
