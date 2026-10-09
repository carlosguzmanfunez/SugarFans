// Tests api/didit.ts with Didit and Supabase replaced by fakes (no network): a
// signed-in user gets a Didit session tied to their account, the webhook is
// believed only with a valid recent signature, and the decision recorded is the
// one Didit's API returns (not the webhook body).
// Run: node e2e/didit-api.mjs
import { build } from 'esbuild';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'didit-api-'));
await build({ entryPoints: ['api/didit.ts'], outfile: join(dir, 'didit.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const api = await import(pathToFileURL(join(dir, 'didit.mjs')).href);

const USER = '11111111-2222-3333-4444-555555555555';
const SECRET = 'whsec-test';
const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const calls = [];
const decisions = new Map();
const recorded = [];

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const h = init.headers ?? {};
  const body = init.body ? JSON.parse(init.body) : undefined;
  calls.push({ u, h, body });
  if (u.endsWith('/auth/v1/user')) return h.authorization === 'Bearer user-token' ? res(200, { id: USER }) : res(401, { msg: 'bad jwt' });
  if (u === 'https://verification.didit.me/v3/session/') {
    if (h['x-api-key'] !== 'didit-key') return res(403, { detail: 'bad key' });
    return res(201, { session_id: 'sess-1', url: 'https://verify.didit.me/session/abc' });
  }
  const m = u.match(/\/v3\/session\/([^/]+)\/decision\/$/);
  if (m) return h['x-api-key'] === 'didit-key' && decisions.has(m[1]) ? res(200, decisions.get(m[1])) : res(404, {});
  if (u.endsWith('/rest/v1/rpc/didit_record')) {
    if (h.apikey !== 'sb_secret_test') return res(401, {});
    recorded.push(body);
    return res(200, body.p_status === 'Approved' ? 'approved' : body.p_status === 'Declined' ? 'rejected' : 'pending');
  }
  return res(500, { error: `unexpected ${u}` });
};

const post = (path, body, headers = {}) =>
  api.POST(new Request(`https://fansreserve.com${path}`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const signed = (event, { secret = SECRET, ts = Math.floor(Date.now() / 1000) } = {}) => {
  const raw = JSON.stringify(event);
  return post('/api/didit?webhook', raw, { 'x-timestamp': String(ts), 'x-signature': createHmac('sha256', secret).update(raw).digest('hex') });
};

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`✓ ${name}`);
};

// Not set up: disabled, and nothing reaches Didit.
let r = await api.GET();
assert.equal((await r.json()).enabled, false);
r = await post('/api/didit', {}, { authorization: 'Bearer user-token' });
assert.equal(r.status, 503);
ok('sin configurar: desactivado');

Object.assign(process.env, { DIDIT_API_KEY: ' didit-key\n', DIDIT_WORKFLOW_ID: 'wf-1', DIDIT_WEBHOOK_SECRET: SECRET, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test' });
r = await api.GET();
const cfg = await r.json();
assert.equal(cfg.enabled, true);
assert.ok(!JSON.stringify(cfg).includes('didit-key') && !JSON.stringify(cfg).includes(SECRET));
ok('configurado: activado sin mostrar secretos');

// Session: only for a signed-in user, tied to their id, returns to Settings.
r = await post('/api/didit', {});
assert.equal(r.status, 401);
r = await post('/api/didit', {}, { authorization: 'Bearer stale' });
assert.equal(r.status, 401);
r = await post('/api/didit', {}, { authorization: 'Bearer user-token' });
assert.equal(r.status, 200);
assert.equal((await r.json()).url, 'https://verify.didit.me/session/abc');
const create = calls.find((c) => c.u.endsWith('/v3/session/'));
assert.deepEqual(create.body, { workflow_id: 'wf-1', vendor_data: USER, callback: 'https://fansreserve.com/settings?section=verification' });
ok('sesión de Didit para el usuario con sesión iniciada');

// Webhook: bad, old or missing signatures are refused.
decisions.set('sess-1', {
  session_id: 'sess-1',
  status: 'Approved',
  vendor_data: USER,
  id_verifications: [{ first_name: 'Ana', last_name: 'López', date_of_birth: '1995-04-02', document_type: 'Passport', document_number: 'p123', issuing_state_name: 'Honduras' }],
});
const event = { session_id: 'sess-1', status: 'Approved', webhook_type: 'status.updated', vendor_data: USER };
assert.equal((await signed(event, { secret: 'wrong' })).status, 401);
assert.equal((await signed(event, { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 401);
assert.equal((await post('/api/didit?webhook', JSON.stringify(event), { 'x-timestamp': String(Math.floor(Date.now() / 1000)) })).status, 401);
assert.equal(recorded.length, 0);
ok('webhook con firma mala, vieja o ausente: rechazado');

// Valid: the decision comes from Didit's API.
r = await signed(event);
assert.equal(r.status, 200);
assert.deepEqual(recorded.at(-1), {
  p_user: USER, p_session: 'sess-1', p_status: 'Approved', p_legal_name: 'Ana López', p_birth_date: '1995-04-02',
  p_country: 'Honduras', p_doc_type: 'passport', p_doc_number: 'p123', p_reason: null,
});
ok('webhook válido: guarda la decisión de Didit');

// The webhook body can't upgrade a session Didit itself declined.
decisions.set('sess-2', { session_id: 'sess-2', status: 'Declined', vendor_data: USER, id_verification: { document_type: 'Identity Card' } });
r = await signed({ ...event, session_id: 'sess-2', status: 'Approved' });
assert.equal(recorded.at(-1).p_status, 'Declined');
assert.equal(recorded.at(-1).p_doc_type, 'dni');
assert.equal(recorded.at(-1).p_birth_date, null);
ok('el estado viene de la API de Didit, no del cuerpo del webhook');

// V2 signature (sorted keys) also accepted; other webhook types ignored.
const n = recorded.length;
const ev2 = { webhook_type: 'status.updated', status: 'Approved', session_id: 'sess-1' };
const sortedRaw = JSON.stringify({ session_id: 'sess-1', status: 'Approved', webhook_type: 'status.updated' });
r = await post('/api/didit?webhook', JSON.stringify(ev2), { 'x-timestamp': String(Math.floor(Date.now() / 1000)), 'x-signature-v2': createHmac('sha256', SECRET).update(sortedRaw).digest('hex') });
assert.equal(r.status, 200);
assert.equal(recorded.length, n + 1);
r = await signed({ session_id: 'sess-1', webhook_type: 'data.updated' });
assert.equal((await r.json()).result, 'ignored');
assert.equal(recorded.length, n + 1);
ok('firma V2 aceptada; otros tipos de aviso ignorados');

rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} pruebas de Didit OK`);
