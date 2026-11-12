// Renders the admin "Consumo" Bunny card (src/components/AdminBunnyUsage.tsx) with fake
// data: no network, no keys. Run: node e2e/admin-bunny-usage-ui.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'bunny-card-'));
const output = join(dir, 'card.mjs');
await build({
  stdin: { contents: `import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import Card from './src/components/AdminBunnyUsage';export const render=()=>renderToStaticMarkup(<Card/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  banner: { js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);" },
  plugins: [{ name: 'fakes', setup(b) {
    b.onResolve({ filter: /^\.\.\/lib\/(backend|platform)$|^\.\.\/context\/LanguageContext$/ }, (a) => ({ path: a.path.split('/').pop(), namespace: 'fake' }));
    b.onLoad({ filter: /.*/, namespace: 'fake' }, (a) => ({ contents:
      a.path === 'backend' ? 'export const backend={};'
      : a.path === 'LanguageContext' ? 'export const useLanguage=()=>({language:globalThis.__lang});'
      : 'export const usePlatformQuery=()=>globalThis.__q;' }));
  } }],
});
const { render } = await import(pathToFileURL(output));
globalThis.fetch = () => { throw Error('Sin red'); };
const q = (data, loading = false, error = '') => ({ data, loading, error, reload() {} });
const base = { enabled: true, account: true, videos: 2, storageBytes: 8 * 1024 ** 2, viewsMonth: 10, watchMinutesMonth: 15, bandwidthBytesMonth: 2 * 1024 ** 3, chargesMonth: 0.42, balance: 9.5, measuredAt: '2026-11-12T03:40:00Z' };
let passed = 0;
const ok = (n) => { passed++; console.log(`✓ ${n}`); };

globalThis.__lang = 'es';
globalThis.__q = q(base);
let html = render();
for (const t of ['Videos guardados', '8 MB', 'Vistas este mes', '15 min', '2.0 GB', '$0.420', '$9.50', 'Costo estimado del mes']) assert.ok(html.includes(t), t);
assert.ok(!html.includes('bunny-low') && !html.includes('bunny-need-key'));
ok('Con las dos llaves muestra videos, espacio, vistas, minutos, descarga, cobro, saldo y costo');

globalThis.__q = q({ ...base, balance: 1.2 });
html = render();
assert.ok(html.includes('data-testid="bunny-low"') && html.includes('Saldo bajo'));
ok('Saldo bajo de $3 se marca en rojo con aviso');

globalThis.__q = q({ ...base, account: false, bandwidthBytesMonth: null, chargesMonth: null, balance: null });
html = render();
assert.ok(html.includes('BUNNY_ACCOUNT_API_KEY') && !html.includes('Saldo disponible'));
ok('Sin la llave de la cuenta explica cómo agregarla');

globalThis.__q = q({ ...base, enabled: false });
assert.ok(render().includes('los videos salen de Supabase'));
globalThis.__q = q(null, false, 'x');
assert.ok(render().includes('role="alert"'));
ok('Sin Bunny o con error lo dice claro');

globalThis.__lang = 'en';
globalThis.__q = q(base);
assert.ok(render().includes('Stored videos'));
globalThis.__lang = 'pt';
assert.ok(render().includes('Videos guardados'));
ok('Inglés y español; otros idiomas caen al español');

console.log(`\n${passed} comprobaciones de la tarjeta de Bunny`);
