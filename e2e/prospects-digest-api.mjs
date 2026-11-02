// The morning email of "Captar creadores" (GET /api/prospects from Vercel Cron),
// with Supabase and Resend replaced by fakes (no network): only the cron secret
// starts it, it reads prospects_digest() with the service role, it sends one email
// a day (idempotency key per Honduras day) and skips days with nothing to say.
// Run: node e2e/prospects-digest-api.mjs
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'prospects-digest-'));
await build({ entryPoints: ['api/prospects.ts'], outfile: join(dir, 'prospects.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const api = await import(pathToFileURL(join(dir, 'prospects.mjs')).href);

const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let digest = {};
const sent = [];
const rpc = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const h = init.headers ?? {};
  if (u.endsWith('/rest/v1/rpc/prospects_digest')) {
    rpc.push(h.apikey);
    return res(200, digest);
  }
  if (u.endsWith('/rest/v1/rpc/log_app_error')) return res(200, null);
  if (u === 'https://api.resend.com/emails') {
    sent.push({ ...JSON.parse(init.body), key: h['idempotency-key'], auth: h.authorization });
    return res(200, { id: 'm1' });
  }
  throw new Error(`Llamada inesperada: ${u}`);
};

const cron = (secret) => new Request('https://fansreserve.com/api/prospects', { headers: secret ? { authorization: `Bearer ${secret}` } : {} });
let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`); };

process.env.CRON_SECRET = 'cron-123';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_x';
process.env.RESEND_API_KEY = 're_x';

await ok('Sin el secreto del cron no manda nada; la consulta de salud dice si está listo', async () => {
  const health = await (await api.GET(cron())).json();
  assert.equal(health.checks.digest, 'OK');
  assert.equal((await api.GET(cron('otro'))).status, 401);
  assert.equal(rpc.length + sent.length, 0);
});

await ok('Con el secreto lee el resumen con la llave de servidor y manda un correo con nombres y pendientes', async () => {
  digest = {
    last_24h: { abrio: 3, interesado: 1, registrado: 1, correo: 5 },
    people: { interesado: [{ handle: 'ana.fit', network: 'instagram', name: 'Ana Pérez' }], registrado: [{ handle: 'beto', network: 'tiktok' }] },
    interested: 4, follow_ups_due: 2, to_contact: 120, creators_invited_24h: 1,
  };
  const r = await (await api.GET(cron('cron-123'))).json();
  assert.deepEqual(r, { ok: true, sent: true });
  assert.equal(rpc.at(-1), 'sb_secret_x');
  const mail = sent.at(-1);
  assert.deepEqual(mail.to, ['carlos@fansreserve.com']);
  assert.equal(mail.subject, 'Captación: 1 se registró, 1 quiere participar');
  assert.match(mail.text, /Abrieron su link: 3/);
  assert.match(mail.text, /Quieren participar: 1\. @ana\.fit \(Ana Pérez\)/);
  assert.match(mail.text, /Se registraron: 1\. @beto/);
  assert.match(mail.text, /Llegaron invitados por otros creadores: 1/);
  assert.match(mail.text, /Interesados por atender: 4\n- Seguimientos pendientes: 2\n- Por contactar: 120/);
  assert.match(mail.text, /https:\/\/fansreserve\.com\/admin\?section=prospects/);
  assert.match(mail.key, /^outbox-prospects-digest-\d{4}-\d{2}-\d{2}$/);
});

await ok('Otro destinatario con PROSPECTS_DIGEST_TO', async () => {
  process.env.PROSPECTS_DIGEST_TO = ' "equipo@fansreserve.com" ';
  await api.GET(cron('cron-123'));
  assert.deepEqual(sent.at(-1).to, ['equipo@fansreserve.com']);
  delete process.env.PROSPECTS_DIGEST_TO;
});

await ok('Sin movimiento ni pendientes no manda correo', async () => {
  const before = sent.length;
  digest = { last_24h: {}, people: {}, interested: 0, follow_ups_due: 0, to_contact: 0, creators_invited_24h: 0 };
  assert.deepEqual(await (await api.GET(cron('cron-123'))).json(), { ok: true, sent: false });
  assert.equal(sent.length, before);
});

await ok('Sin movimiento pero con pendientes, el asunto habla de lo pendiente', async () => {
  digest = { last_24h: {}, people: {}, interested: 2, follow_ups_due: 1, to_contact: 0, creators_invited_24h: 0 };
  await api.GET(cron('cron-123'));
  assert.equal(sent.at(-1).subject, 'Captación de hoy: 2 interesados y 1 seguimiento');
  assert.match(sent.at(-1).text, /Nadie abrió su link ni se registró ayer/);
});

console.log(`\n${passed}/5 comprobaciones del resumen diario`);
