// Tests api/_mail.ts with Resend and Supabase replaced by fakes (no network):
// pending outbox emails go out once through Resend and are marked delivered, a
// failed send is retried later and shows in the admin's "Errores" tab, and
// without RESEND_API_KEY nothing is touched. Run: node e2e/mail-api.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'mail-api-'));
await build({ entryPoints: ['api/_mail.ts'], outfile: join(dir, 'mail.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const mail = await import(pathToFileURL(join(dir, 'mail.mjs')).href);
rmSync(dir, { recursive: true, force: true });

const outbox = [
  { id: 'e1', to_email: 'fan@test.com', subject: 'Reserva confirmada', body: 'Hola <Luz>\nTu reserva está lista', attempts: 0, delivered_at: null, last_error: '' },
  { id: 'e2', to_email: 'rebota@test.com', subject: 'Otra', body: 'x', attempts: 0, delivered_at: null, last_error: '' },
];
const sent = [];
const errors = [];
let resendCalls = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : undefined;
  if (u === 'https://api.resend.com/emails') {
    resendCalls += 1;
    if (body.to[0] === 'rebota@test.com') return new Response(JSON.stringify({ message: 'domain not verified' }), { status: 422 });
    sent.push({ body, h: init.headers });
    return new Response(JSON.stringify({ id: 'r1' }), { status: 200 });
  }
  if (init.headers.apikey !== 'sb_secret_test') return new Response('{}', { status: 401 });
  if (u.includes('/rest/v1/email_outbox?delivered_at=is.null')) return new Response(JSON.stringify(outbox.filter((r) => !r.delivered_at && r.attempts < 5)), { status: 200 });
  if (u.includes('/rest/v1/email_outbox?id=eq.')) {
    Object.assign(outbox.find((r) => r.id === u.split('eq.')[1]), body);
    return new Response(null, { status: 204 });
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

console.log('\nCorreos de la web por Resend');
await check('Sin RESEND_API_KEY no envía ni marca nada', async () => {
  delete process.env.RESEND_API_KEY;
  expect((await mail.deliverOutbox('sb_secret_test')) === 0 && resendCalls === 0, 'envió sin clave');
});
await check('Envía lo pendiente desde noreply@fansreserve.com y lo marca enviado', async () => {
  process.env.RESEND_API_KEY = 're_test';
  expect((await mail.deliverOutbox('sb_secret_test')) === 1, 'no envió 1');
  const [m] = sent;
  expect(m.body.from === 'Fans Reserve <noreply@fansreserve.com>' && m.body.to[0] === 'fan@test.com', JSON.stringify(m.body));
  expect(m.body.reply_to === 'support@fansreserve.com', 'sin responder a soporte');
  expect(m.h['idempotency-key'] === 'outbox-e1', 'sin clave de idempotencia');
  expect(m.body.html.includes('Hola &lt;Luz&gt;<br>Tu reserva'), 'HTML sin escapar');
  expect(outbox[0].delivered_at && outbox[0].attempts === 1, 'no quedó marcado');
});
await check('Un envío fallido queda pendiente y aparece en Errores', async () => {
  expect(!outbox[1].delivered_at && outbox[1].attempts === 1 && /422/.test(outbox[1].last_error), JSON.stringify(outbox[1]));
  expect(errors.some((e) => e.p_source === 'email' && e.p_message.includes('Otra')), 'no se registró el error');
});
await check('No reenvía lo ya enviado y deja de intentar tras 5 fallos', async () => {
  for (let i = 0; i < 6; i += 1) await mail.deliverOutbox('sb_secret_test');
  expect(sent.length === 1, `reenvió: ${sent.length}`);
  expect(outbox[1].attempts === 5, `intentos: ${outbox[1].attempts}`);
});

if (failed) {
  console.log(`\n${failed} prueba(s) fallaron`);
  process.exit(1);
}
console.log('\nTodas las pruebas de correo pasaron');
