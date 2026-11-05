// Tests api/push.ts with Supabase replaced by a fake and a local HTTPS server as
// the browser's push service (no network): the push keys are created once and
// kept, a fresh notification reaches every device of its owner exactly once
// (encrypted, signed with the keys), a device the push service dropped is
// forgotten, and the test alert needs a session.
// Run: node e2e/push-api.mjs
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'push-api-'));
await build({ entryPoints: ['api/push.ts'], outfile: join(process.cwd(), 'e2e', '.push-api.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent' });
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // the fake push service's own certificate
const api = await import(pathToFileURL(join(process.cwd(), 'e2e', '.push-api.mjs')).href);

// --- fake push service ------------------------------------------------------------
execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1', '-subj', '/CN=localhost',
  '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')], { stdio: 'ignore' });
const received = [];
let pushFailure=false;
const server = createServer({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }, (req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    received.push({ path: req.url, auth: req.headers.authorization ?? '', encoding: req.headers['content-encoding'], bytes: Buffer.concat(chunks).length,ttl:Number(req.headers.ttl) });
    res.statusCode = pushFailure?503:req.url.startsWith('/gone') ? 410 : 201;
    res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `https://127.0.0.1:${server.address().port}`;
const device = (path) => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { endpoint: `${base}${path}`, p256dh: ecdh.getPublicKey('base64url'), auth: randomBytes(16).toString('base64url') };
};

// --- fake Supabase -----------------------------------------------------------------
const db = {
  reminder:null,
  secrets: [],
  subs: [{ user_id: 'creator-1', ...device('/phone') }, { user_id: 'creator-1', ...device('/gone/old-phone') }, { user_id: 'fan-1', ...device('/fan') }],
  notifications: [
    { id: '11111111-1111-1111-1111-111111111111', user_id: 'creator-1', title: 'Nueva solicitud de Reserve', body: 'Ana · Clase · 10/10 · 10:00', link: '/creator/dashboard?tab=vip', created_at: new Date().toISOString(), pushed_at: null },
    { id: '22222222-2222-2222-2222-222222222222', user_id: 'creator-1', title: 'Vieja', body: '', link: '', created_at: new Date(Date.now() - 3600_000).toISOString(), pushed_at: null },
  ],
};
const res = (status, body) => (status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (!u.hostname.endsWith('supabase.co')) return realFetch(url, init);
  const h = init.headers ?? {};
  if (u.pathname === '/auth/v1/user') return h.authorization === 'Bearer creator-token' ? res(200, { id: 'creator-1' }) : res(401, {});
  if (h.apikey !== 'sb_secret_test') return res(401, { message: 'sin service role' });
  if(u.pathname==='/rest/v1/rpc/reserve_reminder_delivery_context')return res(200,db.reminder);
  if(u.pathname==='/rest/v1/reserve_session_reminders'){
    if(init.method==='PATCH')Object.assign(db.reminder,JSON.parse(init.body));
    return res(200,[db.reminder]);
  }
  const q = u.searchParams;
  const body = init.body ? JSON.parse(init.body) : undefined;
  if (u.pathname === '/rest/v1/app_secrets') {
    if (init.method === 'POST') {
      for (const row of body) if (!db.secrets.some((s) => s.name === row.name)) db.secrets.push(row);
      return res(201, null);
    }
    return res(200, db.secrets);
  }
  if (u.pathname === '/rest/v1/push_subscriptions') {
    if (init.method === 'DELETE') {
      db.subs = db.subs.filter((s) => s.endpoint !== q.get('endpoint').slice(3));
      return res(204, null);
    }
    return res(200, db.subs.filter((s) => s.user_id === q.get('user_id').slice(3)));
  }
  if (u.pathname === '/rest/v1/notifications' && init.method === 'PATCH') {
    const since = q.get('created_at').slice(4);
    const rows = db.notifications.filter((n) => n.id === q.get('id').slice(3) && n.pushed_at === null && n.created_at >= since);
    rows.forEach((n) => (n.pushed_at = body.pushed_at));
    return res(200, rows);
  }
  return res(404, { message: `sin fake para ${u.pathname}` });
};

// --- checks ------------------------------------------------------------------------
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(true);
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
};
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const post = (body, headers = {}) => api.POST(new Request('https://x/api/push', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));

await check('GET crea las claves la primera vez y después devuelve siempre la misma', async () => {
  const a = await (await api.GET()).json();
  const b = await (await api.GET()).json();
  expect(typeof a.publicKey === 'string' && a.publicKey.length > 80, 'sin clave pública');
  expect(a.publicKey === b.publicKey && db.secrets.length === 2, 'las claves cambiaron');
});
await check('Una solicitud nueva llega cifrada y firmada a cada dispositivo del creador', async () => {
  const r = await (await post({ id: db.notifications[0].id })).json();
  expect(r.devices === 2 && r.sent === 1, `respuesta ${JSON.stringify(r)}`);
  const phone = received.find((x) => x.path === '/phone');
  expect(phone && phone.encoding === 'aes128gcm' && phone.bytes > 0, 'no llegó cifrada');
  expect(/^vapid t=.+, k=/.test(phone.auth), `sin firma VAPID: ${phone.auth}`);
  expect(!received.some((x) => x.path === '/fan'), 'le llegó a otra persona');
});
await check('El dispositivo que ya no existe se olvida', async () => {
  expect(!db.subs.some((s) => s.endpoint.includes('/gone/')), 'sigue guardado');
});
await check('Cada aviso sale una sola vez; uno viejo o inventado no sale', async () => {
  const before = received.length;
  expect((await (await post({ id: db.notifications[0].id })).json()).sent === 0, 'se repitió');
  expect((await (await post({ id: db.notifications[1].id })).json()).sent === 0, 'salió uno viejo');
  expect((await (await post({ id: '33333333-3333-3333-3333-333333333333' })).json()).sent === 0, 'salió uno inventado');
  expect((await post({ id: 'x; drop' })).status === 400, 'aceptó un id raro');
  expect(received.length === before, 'llegaron avisos de más');
});
await check('El aviso de prueba necesita sesión y llega solo a quien lo pide', async () => {
  expect((await post({ test: true })).status === 401, 'sin sesión no debía');
  const r = await (await post({ test: true }, { authorization: 'Bearer creator-token' })).json();
  expect(r.sent === 1, `respuesta ${JSON.stringify(r)}`);
});

const reminderNotice=()=>{
 const id='44444444-4444-4444-4444-'+String(db.notifications.length).padStart(12,'0');
 const n={id,user_id:'creator-1',title:'Tu Reserve está por comenzar',body:'Celular desbloqueado y pantalla visible',link:'/live/qa?reserveReminder=qa',created_at:new Date().toISOString(),pushed_at:null};
 db.notifications.push(n);db.reminder={id:'test-reminder',valid:true,start_at:new Date(Date.now()+45000).toISOString(),minutes_before:1,push_attempts:0};return n;
};
await check('Aviso de un minuto con vencimiento y constancia de aceptación del proveedor, sin inventar lectura',async()=>{
 const n=reminderNotice();const r=await(await post({id:n.id})).json();
 expect(r.sent===1,'no llegó al proveedor');expect(received.at(-1).ttl>0&&received.at(-1).ttl<=45,'vencimiento incorrecto');
 expect(!!db.reminder.push_accepted_at&&!db.reminder.opened_at,'confundió envío con lectura');
});
await check('Una reserva cancelada o reprogramada ya no genera un aviso al celular',async()=>{
 const n=reminderNotice();db.reminder.valid=false;const before=received.length;const r=await(await post({id:n.id})).json();expect(r.expired&&r.sent===0,'no descartó aviso');expect(received.length===before,'envió aviso inválido');
});
await check('Un fallo temporal no se presenta como entrega y permite recuperar el aviso',async()=>{
 const n=reminderNotice();pushFailure=true;const first=await(await post({id:n.id})).json();pushFailure=false;
 expect(first.sent===0&&!db.reminder.push_accepted_at,'inventó entrega');
 n.pushed_at=null;const second=await(await post({id:n.id})).json();expect(second.sent===1&&db.reminder.push_attempts===2,'no recuperó el envío');
});
server.close();
if(!resolve(dir).startsWith(resolve(tmpdir())+sep))throw new Error('Unsafe temporary test directory');
rmSync(dir, { recursive: true, force: true });
rmSync(join(process.cwd(), 'e2e', '.push-api.mjs'), { force: true });
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} comprobaciones de avisos al celular`);
process.exit(failed ? 1 : 0);
