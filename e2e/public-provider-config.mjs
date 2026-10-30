// Public GETs use the real handlers, fake settings and a transport that refuses
// every request. No credentials are loaded and no provider or database is used.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(tmpdir());
const dir = mkdtempSync(join(root, 'fansreserve-public-config-'));
const originalFetch = globalThis.fetch;
const keys = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_ENV', 'PAYPAL_WEBHOOK_ID', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY'];
const originalEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const live = { LIVEKIT_URL: 'wss://private-livekit.example.invalid', LIVEKIT_API_KEY: 'API_PRIVATE_QA_ONLY', LIVEKIT_API_SECRET: 'PRIVATE_LIVEKIT_SECRET_QA_ONLY' };
const paypal = { PAYPAL_CLIENT_ID: 'public-client-qa', PAYPAL_CLIENT_SECRET: 'PRIVATE_PAYPAL_SECRET_QA_ONLY', PAYPAL_ENV: 'sandbox', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_PRIVATE_QA_ONLY', PAYPAL_WEBHOOK_ID: 'PRIVATE_WEBHOOK_QA_ONLY', RESEND_API_KEY: 're_PRIVATE_QA_ONLY' };
const requests = [];
const results = [];
const configure = (values) => {
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { SUPABASE_URL: 'https://private-db.example.invalid', SUPABASE_ANON_KEY: 'public-anon-qa', ...values });
};
const check = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log(`OK ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
};
const response = async (handler, expected) => {
  const before = requests.length;
  const reply = await handler(new Request('https://local.example.invalid/?debug=true&diagnostics=true'));
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get('cache-control'), 'no-store');
  assert.match(reply.headers.get('content-type'), /application\/json/);
  const data = await reply.json();
  assert.deepEqual(data, expected);
  assert.equal(requests.length, before, 'El GET intentó una consulta externa');
  for (const key of ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY']) {
    const value = process.env[key]?.trim();
    if (value) assert.ok(!JSON.stringify(data).includes(value), `El GET divulga ${key}`);
  }
};

try {
  configure({ ...live, ...paypal });
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    throw new Error('NETWORK_DISABLED_FOR_PUBLIC_CONFIG_TEST');
  };
  const apis = {};
  for (const name of ['live-token', 'paypal']) {
    const outfile = join(dir, `${name}.mjs`);
    await build({ entryPoints: [fileURLToPath(new URL(`../api/${name}.ts`, import.meta.url))], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
    apis[name] = await import(pathToFileURL(outfile).href);
  }
  await check('LiveKit configurado: solo devuelve configured, sin consultar salas', () => response(apis['live-token'].GET, { configured: true }));
  for (const key of ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']) {
    await check(`LiveKit sin ${key}: false sin detalles privados`, async () => {
      configure({ ...live, ...paypal }); delete process.env[key];
      await response(apis['live-token'].GET, { configured: false });
    });
    await check(`LiveKit con ${key} vacío: false`, async () => {
      configure({ ...live, ...paypal, [key]: '  \n  ' });
      await response(apis['live-token'].GET, { configured: false });
    });
  }
  await check('LiveKit admite espacios y comillas sin divulgar valores', async () => {
    configure({ ...paypal, ...Object.fromEntries(Object.entries(live).map(([key, value]) => [key, ` "${value}" \n`])) });
    await response(apis['live-token'].GET, { configured: true });
  });
  await check('PayPal Sandbox: únicamente enabled, clientId público y env', async () => {
    configure({ ...live, ...paypal });
    await response(apis.paypal.GET, { enabled: true, clientId: paypal.PAYPAL_CLIENT_ID, env: 'sandbox' });
  });
  await check('El indicador live se conserva con valores ficticios y cero red', async () => {
    configure({ ...live, ...paypal, PAYPAL_ENV: 'live' });
    await response(apis.paypal.GET, { enabled: true, clientId: paypal.PAYPAL_CLIENT_ID, env: 'live' });
  });
  for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']) {
    await check(`PayPal sin ${key}: desactivado y sin Client ID`, async () => {
      configure({ ...live, ...paypal }); delete process.env[key];
      await response(apis.paypal.GET, { enabled: false, clientId: null, env: 'sandbox' });
    });
    await check(`PayPal con ${key} vacío: desactivado`, async () => {
      configure({ ...live, ...paypal, [key]: '  \n  ' });
      await response(apis.paypal.GET, { enabled: false, clientId: null, env: 'sandbox' });
    });
  }
  await check('PayPal admite espacios y comillas en la configuración', async () => {
    configure({ ...live, ...Object.fromEntries(Object.entries(paypal).map(([key, value]) => [key, ` "${value}" \n`])) });
    await response(apis.paypal.GET, { enabled: true, clientId: paypal.PAYPAL_CLIENT_ID, env: 'sandbox' });
  });
  await check('La consulta pública no certifica el webhook ni el servicio de correo', async () => {
    configure({ ...live, ...paypal }); delete process.env.PAYPAL_WEBHOOK_ID; delete process.env.RESEND_API_KEY;
    await response(apis.paypal.GET, { enabled: true, clientId: paypal.PAYPAL_CLIENT_ID, env: 'sandbox' });
  });
  await check('Sin ninguna configuración los dos GET responden desactivados', async () => {
    configure({});
    await response(apis['live-token'].GET, { configured: false });
    await response(apis.paypal.GET, { enabled: false, clientId: null, env: 'sandbox' });
  });
  assert.equal(requests.length, 0, 'Hubo intentos de red');
} finally {
  globalThis.fetch = originalFetch;
  for (const key of keys) {
    if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  }
  // Only remove the unique directory created by this test inside the OS temp root.
  assert.equal(dirname(resolve(dir)), root);
  rmSync(dir, { recursive: true, force: true });
}

const passed = results.every((result) => result.ok);
if (process.env.E2E_RESULTS_DIR) {
  mkdirSync(process.env.E2E_RESULTS_DIR, { recursive: true });
  writeFileSync(join(process.env.E2E_RESULTS_DIR, 'public-provider-config.json'), JSON.stringify({ date: new Date().toISOString(), passed, environment: 'fake-settings-network-disabled', attemptedRequests: requests.length, results }, null, 2));
}
console.log(`${results.filter((result) => result.ok).length}/${results.length} comprobaciones; ${requests.length} intentos de red.`);
if (!passed) process.exitCode = 1;
