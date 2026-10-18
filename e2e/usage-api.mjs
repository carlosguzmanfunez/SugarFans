// Tests api/usage.ts (the daily provider check) with Supabase and Resend replaced
// by fakes (no network): without CRON_SECRET it only reports its setup, a wrong
// secret is refused, below 70% nothing is sent, at 70% and 90% one email goes to
// the alert address once per level and month, and the plan picked in the admin
// changes the limits. Run: node e2e/usage-api.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'usage-api-'));
await build({ entryPoints: ['api/usage.ts'], outfile: join(dir, 'usage.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const api = await import(pathToFileURL(join(dir, 'usage.mjs')).href);
rmSync(dir, { recursive: true, force: true });

const GB = 1024 ** 3;
let usage;
const reset = (patch = {}) => {
  usage = {
    month: '2026-10', measured_at: '2026-10-18T14:00:00Z', db_bytes: 0.1 * GB, storage_bytes: 0.2 * GB, mau: 40, users_total: 50,
    emails_month: 100, emails_today: 5, scans_month: 50, kyc_month: 3, video_minutes_month: 100, plans: {}, fund_pct: 10, ...patch,
  };
};
let alerts = [];
let emails = [];
let errors = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : undefined;
  if (u === 'https://api.resend.com/emails') {
    emails.push(body);
    return new Response(JSON.stringify({ id: 'r1' }), { status: 200 });
  }
  if (init.headers.apikey !== 'sb_secret_test') return new Response('{}', { status: 401 });
  if (u.endsWith('/rest/v1/rpc/infra_usage')) return new Response(JSON.stringify(usage), { status: 200 });
  if (u.includes('/rest/v1/usage_alerts?select=')) return new Response(JSON.stringify(alerts), { status: 200 });
  if (u.includes('/rest/v1/usage_alerts?on_conflict=')) {
    for (const a of body) if (!alerts.some((x) => x.month === a.month && x.metric === a.metric && x.level === a.level)) alerts.push(a);
    return new Response(null, { status: 201 });
  }
  if (u.endsWith('/rest/v1/rpc/log_app_error')) {
    errors.push(body);
    return new Response(null, { status: 204 });
  }
  return new Response('{}', { status: 404 });
};

let failed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
};
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const run = (auth = 'Bearer cron-123') => api.GET(new Request('https://fansreserve.com/api/usage', { headers: auth ? { authorization: auth } : {} }));

console.log('\nRevisión diaria de consumo');
await check('Sin CRON_SECRET solo dice qué falta y no revisa nada', async () => {
  delete process.env.CRON_SECRET;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  process.env.RESEND_API_KEY = 're_test';
  reset({ db_bytes: 0.49 * GB });
  const r = await run();
  const data = await r.json();
  expect(r.status === 200 && data.checks.cronSecret === 'FALTA' && !data.enabled, JSON.stringify(data));
  expect(emails.length === 0, 'mandó un correo');
});
process.env.CRON_SECRET = 'cron-123';
await check('Con una clave equivocada no revisa', async () => {
  const r = await run('Bearer otra');
  expect(r.status === 401 && emails.length === 0, `status ${r.status}`);
});
await check('Sin auth es solo el chequeo de salud', async () => {
  const data = await (await run('')).json();
  expect(data.enabled === true && data.checks.cronSecret === 'OK', JSON.stringify(data));
});
await check('Por debajo del 70% no manda nada', async () => {
  reset();
  const data = await (await run()).json();
  expect(data.alerts === 0 && emails.length === 0, JSON.stringify(data));
});
await check('Al pasar el 70% manda un correo a Carlos con el siguiente plan', async () => {
  reset({ video_minutes_month: 3_600 }); // LiveKit Build: 5,000
  const data = await (await run()).json();
  expect(data.alerts === 1 && emails.length === 1, JSON.stringify(data));
  const e = emails[0];
  expect(e.to[0] === 'carlos@fansreserve.com', e.to[0]);
  expect(/70%/.test(e.subject), e.subject);
  expect(e.text.includes('LiveKit') && e.text.includes('72%') && e.text.includes('Ship ($50/mes)'), e.text);
});
await check('Al día siguiente no repite el mismo aviso', async () => {
  const data = await (await run()).json();
  expect(data.alerts === 0 && emails.length === 1, JSON.stringify(data));
});
await check('Al llegar al 90% manda el aviso urgente', async () => {
  reset({ video_minutes_month: 4_600 });
  await run();
  expect(emails.length === 2 && /Urgente/.test(emails[1].subject), emails[1]?.subject);
});
await check('Si el plan ya es Ship, 4,600 minutos no avisan', async () => {
  reset({ video_minutes_month: 4_600, plans: { livekit: 'ship' }, month: '2026-11' });
  alerts = [];
  const data = await (await run()).json();
  expect(data.alerts === 0, JSON.stringify(data));
});
await check('El tope diario de correos de Resend Free avisa por día', async () => {
  reset({ emails_today: 95 });
  alerts = [];
  emails = [];
  await run();
  expect(emails.length === 1 && emails[0].text.includes('Correos hoy'), emails[0]?.text);
  expect(alerts.some((a) => /^\d{4}-\d{2}-\d{2}$/.test(a.month) && a.metric === 'resend_day'), JSON.stringify(alerts));
});
await check('ALERT_EMAIL cambia el destino', async () => {
  process.env.ALERT_EMAIL = 'otro@fansreserve.com';
  reset({ db_bytes: 0.46 * GB, month: '2026-12' });
  emails = [];
  await run();
  expect(emails[0]?.to[0] === 'otro@fansreserve.com' && emails[0].text.includes('Supabase'), JSON.stringify(emails[0]?.to));
  delete process.env.ALERT_EMAIL;
});
await check('Si Resend falla, no marca el aviso como enviado y lo registra en Errores', async () => {
  delete process.env.RESEND_API_KEY;
  reset({ scans_month: 1_900, month: '2027-01' });
  const r = await run();
  expect(r.status === 502, `status ${r.status}`);
  expect(!alerts.some((a) => a.month === '2027-01'), 'lo marcó');
  expect(errors.some((e) => /aviso de consumo/.test(e.p_message)), 'no registró el error');
});

console.log(failed ? `\n${failed} fallaron` : '\nTodo bien');
process.exit(failed ? 1 : 0);
