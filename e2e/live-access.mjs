// Who may enter each live room, checked against the real token handler
// (api/live-token.ts) with a Supabase stand-in. No LiveKit server or browser needed:
// the handler signs the LiveKit token locally, and the test reads its grant.
// Usage: npm run test:access
//
//   Open Live      hidden and refused while ENABLE_OPEN_LIVE is off; comes back when on.
//   Subscriber Live only active subscribers (and the creator, who publishes).
//   Reserve Event  only fans with a confirmed seat (and the creator, who presents).
//   Reserve 1:1    only the booking's fan and creator.
//   Gifts and a plain subscription never open a Reserve.
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const STUB_PORT = 54331;
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name}\n      ${String(err.message || err).split('\n').slice(0, 3).join('\n      ')}`);
  }
};
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// --- Supabase stand-in --------------------------------------------------------------
// The session token is the user id. Row security is imitated: a fan only reads their
// own subscriptions; a booking is only visible to its fan and its creator.
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
const nowTime = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
const past = new Date(Date.now() - 86400_000).toISOString();
const future = new Date(Date.now() + 7 * 86400_000).toISOString();

const PROFILES = {
  'creator-1': { name: 'Valentina Rose', creator_profile_id: '1' },
  'creator-2': { name: 'Diego Torres', creator_profile_id: '2' },
  'fan-sub': { name: 'Suscriptora', creator_profile_id: null },
  'fan-cancelling': { name: 'Cancela a fin de mes', creator_profile_id: null },
  'fan-expired': { name: 'Suscripción vencida', creator_profile_id: null },
  'fan-gift': { name: 'Solo regalos', creator_profile_id: null },
  'fan-seat': { name: 'Con plaza', creator_profile_id: null },
  'fan-unpaid': { name: 'Plaza sin pagar', creator_profile_id: null },
  'fan-call': { name: 'Con videollamada', creator_profile_id: null },
  nobody: { name: 'Sin nada', creator_profile_id: null },
};
const SUBSCRIPTIONS = [
  { fan_id: 'fan-sub', creator_id: '1', cancel_at: null },
  { fan_id: 'fan-cancelling', creator_id: '1', cancel_at: future },
  { fan_id: 'fan-expired', creator_id: '1', cancel_at: past },
  // A subscriber of creator 1 never gets a Reserve by subscribing.
  { fan_id: 'fan-call', creator_id: '2', cancel_at: null },
];
// fan-gift sent gifts to creator 1: gifts are transactions, never rows here.
const LIVES = {
  1: { id: 'sub-live', title: 'Live exclusivo para suscriptores', mode: 'subscriber' },
  2: { id: 'open-live', title: 'Live abierto', mode: 'open' },
  // A Live stored before modes existed has no mode: it is an Open Live.
  3: { id: 'legacy-live', title: 'Live antiguo' },
};
const base = { date: today, time: nowTime, duration_minutes: 60, creator_profile_id: '1', details: { modality: 'virtual' } };
const BOOKINGS = {
  'seat-1': { ...base, id: 'seat-1', experience_id: 'ev-1', status: 'confirmed', fan_id: 'fan-seat', details: { modality: 'virtual', kind: 'event' } },
  'seat-unpaid': { ...base, id: 'seat-unpaid', experience_id: 'ev-1', status: 'accepted', fan_id: 'fan-unpaid', details: { modality: 'virtual', kind: 'event' } },
  'call-1': { ...base, id: 'call-1', experience_id: '1', status: 'confirmed', fan_id: 'fan-call', duration_minutes: 20, details: { modality: 'virtual', kind: 'experience' } },
};

const stub = () =>
  new Promise((resolve) => {
    const server = createServer((req, res) => {
      const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      const url = new URL(req.url, 'http://x');
      const q = (k) => (url.searchParams.get(k) ?? '').replace(/^eq\./, '');
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (!PROFILES[token]) return send(401, { message: 'invalid token' });
      if (url.pathname === '/auth/v1/user') return send(200, { id: token });
      if (url.pathname === '/rest/v1/profiles') return send(200, [PROFILES[q('id')]]);
      if (url.pathname === '/rest/v1/live_broadcasts') {
        const live = LIVES[q('creator_profile_id')];
        return send(200, live ? [{ ...live, creator_profile_id: q('creator_profile_id') }] : []);
      }
      if (url.pathname === '/rest/v1/subscriptions') {
        if (q('fan_id') !== token) return send(200, []);
        return send(200, SUBSCRIPTIONS.filter((s) => s.fan_id === token && s.creator_id === q('creator_id')).map(({ cancel_at }) => ({ cancel_at })));
      }
      if (url.pathname === '/rest/v1/vip_bookings') {
        const b = BOOKINGS[q('id')];
        const mine = b && (b.fan_id === token || PROFILES[token].creator_profile_id === b.creator_profile_id);
        return send(200, mine ? [b] : []);
      }
      send(404, {});
    });
    server.listen(STUB_PORT, () => resolve(server));
  });

const loadHandler = async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'live-access-')), 'live-token.mjs');
  await build({ entryPoints: [new URL('../api/live-token.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
  return (await import(pathToFileURL(out).href)).POST;
};

// The LiveKit grant inside a token (its payload is plain base64url JSON).
const grantOf = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).video;

const run = async () => {
  Object.assign(process.env, {
    LIVEKIT_URL: 'ws://127.0.0.1:7880',
    LIVEKIT_API_KEY: 'devkey',
    LIVEKIT_API_SECRET: 'secret-secret-secret-secret-secret-1234',
    SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
    SUPABASE_ANON_KEY: 'stub',
  });
  delete process.env.ENABLE_OPEN_LIVE;
  const POST = await loadHandler();
  const server = await stub();
  const ask = async (who, body) => {
    const r = await POST(new Request('http://x/api/live-token', { method: 'POST', headers: { authorization: `Bearer ${who}` }, body: JSON.stringify(body) }));
    const json = await r.json();
    return { status: r.status, ...json, grant: json.token ? grantOf(json.token) : null };
  };
  const allowed = (r, what) => expect(r.status === 200 && r.grant?.roomJoin, `${what}: esperaba acceso y recibió ${r.status} ${r.error ?? ''}`);
  const refused = (r, what) => expect(r.status >= 400 && !r.token, `${what}: esperaba rechazo y recibió ${r.status}`);

  try {
    console.log('Open Live (desactivado por feature flag)');
    await check('El flag central ENABLE_OPEN_LIVE existe y está apagado por defecto', async () => {
      const src = readFileSync(new URL('../src/config/features.ts', import.meta.url), 'utf8');
      expect(/export const ENABLE_OPEN_LIVE: boolean = import\.meta\.env\.VITE_ENABLE_OPEN_LIVE === 'true'/.test(src), 'el flag no está o no depende de VITE_ENABLE_OPEN_LIVE');
      const sql = readFileSync(new URL('../supabase/migrations/20261004000004_subscriber_live_reserve_events.sql', import.meta.url), 'utf8');
      expect(/function public\.open_live_enabled\(\)[\s\S]*?select false;/.test(sql), 'open_live_enabled() no devuelve false');
    });
    await check('Con el flag apagado, nadie recibe acceso a un Open Live (ni fans ni el creator)', async () => {
      refused(await ask('fan-sub', { creatorProfileId: '2' }), 'fan en Open Live');
      refused(await ask('creator-2', { creatorProfileId: '2' }), 'creator en su Open Live');
      refused(await ask('nobody', { creatorProfileId: '3' }), 'Live antiguo sin modo');
    });
    await check('La infraestructura de Open Live sigue ahí: con ENABLE_OPEN_LIVE=true vuelve a funcionar', async () => {
      for (const f of ['api/live-token.ts', 'src/pages/LiveBroadcast.tsx', 'src/components/CreatorLivePanel.tsx', 'src/components/NotificationBell.tsx',
        'src/lib/backend/supabaseLive.ts', 'src/lib/backend/localLive.ts', 'supabase/migrations/20261003000001_live_alerts.sql',
        'supabase/migrations/20261004000003_live_heartbeat.sql'])
        expect(existsSync(new URL(`../${f}`, import.meta.url)), `falta ${f}`);
      expect(/path="\/en-vivo\/:creatorId"/.test(readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')), 'falta la ruta /en-vivo/:creatorId');
      process.env.ENABLE_OPEN_LIVE = 'true';
      try {
        const fan = await ask('nobody', { creatorProfileId: '2' });
        allowed(fan, 'fan en Open Live reactivado');
        expect(fan.grant.room === 'live-open-live' && !fan.grant.canPublish, 'el fan no debería publicar');
        const host = await ask('creator-2', { creatorProfileId: '2' });
        allowed(host, 'creator en Open Live reactivado');
        expect(host.grant.canPublish && host.host, 'el creator debería publicar');
      } finally {
        delete process.env.ENABLE_OPEN_LIVE;
      }
    });

    console.log('Subscriber Live');
    await check('Bloquea a usuarios sin suscripción, con la suscripción vencida o que solo enviaron regalos', async () => {
      refused(await ask('nobody', { creatorProfileId: '1' }), 'sin suscripción');
      refused(await ask('fan-expired', { creatorProfileId: '1' }), 'suscripción vencida');
      const gift = await ask('fan-gift', { creatorProfileId: '1' });
      refused(gift, 'solo regalos');
      expect(/suscriptores/.test(gift.error), `mensaje inesperado: ${gift.error}`);
      refused(await ask('fan-call', { creatorProfileId: '1' }), 'suscriptor de otro creator');
    });
    await check('Permite a suscriptores activos (también si cancelaron y les queda mes pagado), solo para ver', async () => {
      for (const fan of ['fan-sub', 'fan-cancelling']) {
        const r = await ask(fan, { creatorProfileId: '1' });
        allowed(r, fan);
        expect(r.mode === 'subscriber' && r.grant.room === 'live-sub-live' && !r.grant.canPublish && !r.host, `${fan}: sala o permisos incorrectos`);
      }
    });
    await check('El creator entra a su Subscriber Live y es el único que publica', async () => {
      const r = await ask('creator-1', { creatorProfileId: '1' });
      allowed(r, 'creator');
      expect(r.grant.canPublish && r.host, 'el creator debería publicar');
    });

    console.log('Reserve Event');
    await check('Bloquea a quien no tiene una plaza válida (sin reserva, sin pagar, suscriptor, regalo)', async () => {
      refused(await ask('nobody', { bookingId: 'seat-1' }), 'plaza de otro fan');
      refused(await ask('fan-unpaid', { bookingId: 'seat-unpaid' }), 'plaza aceptada sin pagar');
      refused(await ask('fan-sub', { bookingId: 'seat-1' }), 'suscriptor sin plaza');
      refused(await ask('fan-gift', { bookingId: 'seat-1' }), 'regalo sin plaza');
      refused(await ask('creator-2', { bookingId: 'seat-1' }), 'otro creator');
    });
    await check('Permite al participante con plaza confirmada, en la sala del evento y sin publicar', async () => {
      const r = await ask('fan-seat', { bookingId: 'seat-1' });
      allowed(r, 'participante');
      expect(r.mode === 'reserve_event' && r.grant.room === `event-ev-1-${today}-${nowTime.replace(':', '')}`, `sala inesperada: ${r.grant.room}`);
      expect(!r.grant.canPublish && !r.host, 'el participante no debería publicar');
    });
    await check('El creator del evento entra a la misma sala y presenta', async () => {
      const r = await ask('creator-1', { bookingId: 'seat-1' });
      allowed(r, 'creator');
      expect(r.grant.room === `event-ev-1-${today}-${nowTime.replace(':', '')}` && r.grant.canPublish && r.host, 'el creator debería presentar en la sala del evento');
    });

    console.log('Reserve 1:1');
    await check('Solo el fan y el creator de la reserva entran a la Sala 1:1', async () => {
      const fan = await ask('fan-call', { bookingId: 'call-1' });
      allowed(fan, 'fan de la reserva');
      expect(fan.mode === 'reserve_1to1' && fan.grant.room === 'booking-call-1' && fan.grant.canPublish && !fan.host, 'sala o permisos del fan');
      const host = await ask('creator-1', { bookingId: 'call-1' });
      allowed(host, 'creator de la reserva');
      expect(host.grant.room === 'booking-call-1' && host.host, 'sala o permisos del creator');
    });
    await check('Nadie más entra: otro fan, otro creator, una suscriptora o quien envió regalos', async () => {
      for (const who of ['nobody', 'fan-seat', 'creator-2', 'fan-sub', 'fan-gift']) refused(await ask(who, { bookingId: 'call-1' }), who);
    });
    await check('Una suscripción simple no da acceso a un Reserve Event ni a un Reserve 1:1', async () => {
      // fan-sub is subscribed to creator 1, the creator of both bookings.
      refused(await ask('fan-sub', { bookingId: 'seat-1' }), 'suscriptora en el evento');
      refused(await ask('fan-sub', { bookingId: 'call-1' }), 'suscriptora en la llamada');
    });
    await check('Sin sesión no hay acceso a nada', async () => {
      const r = await POST(new Request('http://x/api/live-token', { method: 'POST', body: JSON.stringify({ creatorProfileId: '1' }) }));
      expect(r.status === 401, `esperaba 401 y recibió ${r.status}`);
    });
  } finally {
    server.close();
  }
};

run()
  .catch((err) => {
    console.error(err);
    results.push({ name: 'run', ok: false });
  })
  .finally(() => {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} comprobaciones de acceso`);
    process.exit(failed ? 1 : 0);
  });
