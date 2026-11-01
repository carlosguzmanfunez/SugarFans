// Tests the email part of api/prospects.ts against a fake Zoho (a tiny SMTP server
// on this machine) and a fake Supabase: only an admin sends, at most 5 per call,
// whoever opted out, was discarded, has no email or was already contacted is
// skipped, the unsubscribe link is always there, the daily limit holds, a bounced
// address doesn't stop the rest, a wrong password stops everything, and only what
// Zoho accepted is recorded.
// Run: node e2e/prospects-email-api.mjs
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'prospects-email-'));
await build({ entryPoints: ['api/prospects.ts'], outfile: join(dir, 'prospects.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const api = await import(pathToFileURL(join(dir, 'prospects.mjs')).href);

/* ---------- Fake Zoho ---------- */
let mails = [];
let smtpAuth = 'ok';
const smtp = net.createServer((sock) => {
  let buf = '';
  let inData = false;
  let cur = { to: [], data: '' };
  sock.write('220 fake.zoho ESMTP\r\n');
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (inData) {
        if (line === '.') { inData = false; mails.push(cur); cur = { to: [], data: '' }; sock.write('250 Ok queued\r\n'); } else cur.data += line + '\n';
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-fake.zoho\r\n250 AUTH PLAIN\r\n');
      else if (cmd === 'AUTH') sock.write(smtpAuth === 'ok' ? '235 Authentication successful\r\n' : '535 Authentication Failed\r\n');
      else if (cmd === 'MAIL') { cur.from = line; sock.write('250 Ok\r\n'); }
      else if (cmd === 'RCPT') { if (line.includes('rebota')) sock.write('550 5.1.1 User does not exist\r\n'); else { cur.to.push(line); sock.write('250 Ok\r\n'); } }
      else if (cmd === 'DATA') { inData = true; sock.write('354 End data with <CR><LF>.<CR><LF>\r\n'); }
      else if (cmd === 'QUIT') { sock.write('221 Bye\r\n'); sock.end(); }
      else sock.write('250 Ok\r\n');
    }
  });
  sock.on('error', () => {});
});
await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
const smtpPort = smtp.address().port;

/* ---------- Fake Supabase ---------- */
const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rows = [
  { id: id(1), email: 'ana@correo.com', status: 'nuevo', invite_code: 'aaaaaaaaaaaa' },
  { id: id(2), email: null, status: 'no_contactar', invite_code: 'bbbbbbbbbbbb' },
  { id: id(3), email: 'dos@correo.com', status: 'descartado', invite_code: 'cccccccccccc' },
  { id: id(4), email: null, status: 'nuevo', invite_code: 'dddddddddddd' },
  { id: id(5), email: 'ya@correo.com', status: 'contactado', invite_code: 'eeeeeeeeeeee' },
  { id: id(6), email: 'luis@correo.com', status: 'nuevo', invite_code: 'ffffffffffff' },
  { id: id(7), email: 'rebota@correo.com', status: 'nuevo', invite_code: '111111111111' },
];
let quota = 0;
let recorded = [];
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url));
  const h = init.headers ?? {};
  if (u.endsWith('/rest/v1/rpc/is_admin')) return h.authorization === 'Bearer admin' ? res(200, true) : res(200, false);
  assert.equal(h.authorization, 'Bearer admin', 'las lecturas van con la sesión del admin');
  if (u.includes('/rest/v1/creator_prospects?')) {
    const ids = u.match(/id=in\.\(([^)]*)\)/)[1].split(',');
    return res(200, rows.filter((r) => ids.includes(r.id)));
  }
  if (u.endsWith('/rest/v1/rpc/prospects_email_quota')) return res(200, quota);
  if (u.endsWith('/rest/v1/rpc/prospects_email_sent')) { recorded.push(JSON.parse(init.body)); return res(200, 1); }
  throw Error('Red no esperada: ' + u);
};

const post = (auth, body) => api.POST(new Request('https://fansreserve.com/api/prospects', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify({ action: 'email', ...body }),
}));
const email = (n, body = `Hola ${n}, mira: https://fansreserve.com/c/xyz`) => ({ id: id(n), subject: `Invitación ${n}`, body });
// Quoted-printable body → text.
const qp = (s) => Buffer.from(s.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
const reset = () => { mails = []; recorded = []; quota = 0; smtpAuth = 'ok'; };
let passed = 0;
const ok = async (name, fn) => { reset(); await fn(); passed++; console.log(`  ✓ ${name}`); };

try {
  await ok('Sin Zoho conectado dice FALTA y no envía nada', async () => {
    for (const k of ['ZOHO_SMTP_USER', 'ZOHO_SMTP_PASSWORD', 'ZOHO_SMTP_HOST', 'ZOHO_SMTP_PORT', 'ZOHO_DAILY_LIMIT']) delete process.env[k];
    const health = await (await api.GET()).json();
    assert.equal(health.checks.email, 'FALTA');
    assert.equal(health.emailLimit, 0);
    assert.equal((await post('admin', { emails: [email(1)] })).status, 503);
    assert.equal(mails.length, 0);
  });

  process.env.ZOHO_SMTP_USER = ' Carlos@FansReserve.com ';
  process.env.ZOHO_SMTP_PASSWORD = '"secreto-app"';
  process.env.ZOHO_SMTP_HOST = '127.0.0.1';
  process.env.ZOHO_SMTP_PORT = String(smtpPort);

  await ok('Con Zoho dice OK, el límite y el buzón, sin mostrar la contraseña', async () => {
    const text = await (await api.GET()).text();
    const health = JSON.parse(text);
    assert.equal(health.checks.email, 'OK');
    assert.equal(health.emailLimit, 30);
    assert.equal(health.emailFrom, 'carlos@fansreserve.com');
    assert.doesNotMatch(text, /secreto/);
  });

  await ok('Solo un admin envía, y de 1 a 5 correos distintos por vez', async () => {
    assert.equal((await post(null, { emails: [email(1)] })).status, 401);
    assert.equal((await post('fan', { emails: [email(1)] })).status, 403);
    assert.equal((await post('admin', { emails: [1, 6, 7, 1, 6, 7].map((n, i) => ({ ...email(n), id: id(i + 10) })) })).status, 400);
    assert.equal((await post('admin', { emails: [email(1), email(1)] })).status, 400);
    assert.equal((await post('admin', { emails: [{ id: 'no-es-uuid', subject: 'x', body: 'y' }] })).status, 400);
    assert.equal(mails.length, 0);
  });

  await ok('Envía a los que tocan, salta al resto y agrega el enlace de baja', async () => {
    const r = await post('admin', { emails: [email(1), email(2), email(3), email(4), email(5)], base: 'https://evil.example.com' });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.deepEqual(body.sent, [id(1)]);
    assert.deepEqual(body.skipped.map((s) => s.reason), ['Pidió que no le escribamos', 'Está descartado', 'No tiene correo', 'Ya estaba contactado']);
    assert.equal(body.remaining, 29);
    assert.equal(mails.length, 1);
    const m = mails[0];
    assert.match(m.to[0], /ana@correo\.com/);
    assert.match(m.from, /carlos@fansreserve\.com/);
    assert.match(m.data, /Subject: =\?UTF-8\?Q\?Invitaci=C3=B3n_1\?=|Subject: Invitación 1/);
    const headers = m.data.split('\n\n')[0].replace(/\n[ \t]+/g, ' '); // unfold long header lines
    assert.match(headers, /^List-Unsubscribe: <https:\/\/fansreserve\.com\/c\/aaaaaaaaaaaa\?baja=1>, <mailto:carlos@fansreserve\.com\?subject=baja>$/m, 'otro dominio en el enlace');
    assert.equal(headers.match(/^List-Unsubscribe:/gm).length, 1);
    assert.match(qp(m.data), /Si prefieres que no te escribamos más, entra aquí: https:\/\/fansreserve\.com\/c\/aaaaaaaaaaaa\?baja=1/);
    assert.deepEqual(recorded, [{ p_ids: [id(1)], p_follow_up: false }]);
  });

  await ok('Si el texto ya trae su enlace de baja no lo repite, y respeta un preview', async () => {
    const base = 'https://fans-reserve-git-x-carlos.vercel.app';
    const r = await post('admin', { emails: [email(6, `Hola Luis\n\nNo más: ${base}/c/ffffffffffff?baja=1`)], base });
    assert.deepEqual((await r.json()).sent, [id(6)]);
    const text = qp(mails[0].data.split('\n\n').slice(1).join('\n\n'));
    assert.equal(text.split('ffffffffffff?baja=1').length - 1, 1, 'enlace repetido en el cuerpo');
  });

  await ok('El límite del día: con todo usado no envía; con 1 libre envía 1 y salta el resto', async () => {
    quota = 30;
    let r = await post('admin', { emails: [email(1)] });
    assert.equal(r.status, 429);
    assert.match((await r.json()).error, /30 correos de hoy/);
    quota = 29;
    r = await post('admin', { emails: [email(1), email(6)] });
    const body = await r.json();
    assert.deepEqual(body.sent, [id(1)]);
    assert.deepEqual(body.skipped, [{ id: id(6), reason: 'Se llegó al límite de hoy' }]);
    assert.equal(body.remaining, 0);
    process.env.ZOHO_DAILY_LIMIT = '5000';
    assert.equal((await (await api.GET()).json()).emailLimit, 300, 'tope máximo');
    delete process.env.ZOHO_DAILY_LIMIT;
  });

  await ok('Un correo que rebota no frena a los demás; seguimiento queda marcado como tal', async () => {
    const r = await post('admin', { emails: [email(7), email(1)] });
    const body = await r.json();
    assert.deepEqual(body.sent, [id(1)]);
    assert.equal(body.failed.length, 1);
    assert.match(body.failed[0].error, /550/);
    reset();
    rows[0].status = 'contactado';
    const f = await (await post('admin', { emails: [email(1), email(6)], followUp: true })).json();
    assert.deepEqual(f.sent, [id(1)]);
    assert.deepEqual(f.skipped, [{ id: id(6), reason: 'No está esperando seguimiento' }]);
    assert.deepEqual(recorded, [{ p_ids: [id(1)], p_follow_up: true }]);
    rows[0].status = 'nuevo';
  });

  await ok('Contraseña equivocada: para, lo explica y no marca nada', async () => {
    smtpAuth = 'bad';
    const r = await post('admin', { emails: [email(1), email(6)] });
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /contraseña de aplicación/);
    assert.equal(mails.length, 0);
    assert.equal(recorded.length, 0);
  });

  console.log(`\n${passed}/8 comprobaciones de los correos desde Zoho`);
} finally {
  smtp.close();
}
