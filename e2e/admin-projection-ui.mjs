// Admin › Dinero › Proyección de ganancias (src/components/AdminProjection.tsx) with the
// default assumptions: break-even, $1,000 clean, the 15% fund check and the 12 months.
// No network, no data. Run: node e2e/admin-projection-ui.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'projection-'));
const output = join(dir, 'p.mjs');
await build({
  stdin: { contents: `import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import P from './src/components/AdminProjection';import*as L from './src/lib/profitProjection';export const lib=L;export const render=()=>renderToStaticMarkup(<P/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  banner: { js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);" },
  plugins: [{ name: 'fakes', setup(b) {
    b.onResolve({ filter: /^\.\.\/context\/LanguageContext$/ }, () => ({ path: 'lang', namespace: 'fake' }));
    b.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: 'export const useLanguage=()=>({language:globalThis.__lang});' }));
  } }],
});
const { render, lib } = await import(pathToFileURL(output));
globalThis.fetch = () => { throw Error('Sin red'); };
let passed = 0;
const ok = (n) => { passed++; console.log(`✓ ${n}`); };
const d = lib.DEFAULT_INPUTS;

const r = lib.perReserve(d);
assert.deepEqual([r.fee, r.creator, r.frWithIsv, r.isv, r.frClean, r.fund], [1.65, 16.35, 7, 1.05, 5.95, 1.05]);
assert.equal(lib.monthlyCosts(d), 151.25);
ok('Reserve de $25: PayPal $1.65, creador $16.35, FR $7.00, ISV $1.05, quedan $5.95; proveedores $151.25');

assert.equal(lib.creatorsFor(d, 0), 9);
assert.equal(lib.creatorsFor(d, 100), 16);
assert.equal(lib.creatorsFor(d, 1000), 84);
assert.equal(lib.creatorsForFund(d), 49);
const m = lib.monthFor(d, 84);
assert.equal(Math.round(m.clean), 1011);
assert.equal(Math.round(m.renta - m.isr), Math.round(m.clean), 'el fondo no se resta');
ok('Equilibrio 9, $100 con 16, $1,000 limpios con 84; el fondo cubre desde 49 y nunca se resta');

const g = lib.growth({ ...d, creatorsNow: 5, newCreatorsPerMonth: 10 });
assert.equal(g.length, 12);
assert.equal(g[0].creators, 15);
assert.equal(g[11].creators, 125);
assert.ok(Math.abs(g[11].accumulated - g.reduce((s, x) => s + x.clean, 0)) < 1e-6);
ok('12 meses: crecen los creadores y se acumula lo limpio');

assert.equal(lib.monthFor(d, 0).isr, 0, 'sin renta no se aparta ISR');
ok('Con pérdida no se aparta ISR');

const sub = lib.perSub(d);
assert.deepEqual([sub.fee, sub.creator, sub.frWithIsv, sub.isv, sub.frClean], [0.84, 6.41, 2.74, 0.41, 2.33]);
assert.equal(lib.perCreator(d).fromSubs, 0, 'sin suscriptores no suman');
const s = { ...d, subsPerCreator: 10 }; // la mitad de los creadores con 10 suscriptores de $9.99
assert.equal(lib.perCreator(s).total, 29.5);
assert.equal(lib.creatorsFor(s, 0), 6);
assert.equal(lib.creatorsFor(s, 1000), 51);
assert.equal(lib.creatorsForFund(s), 30);
const ms = lib.monthFor(s, 51);
assert.equal(ms.subscribers, 255);
assert.equal(Math.round(ms.frSubs * 100) / 100, 698.7);
assert.ok(Math.abs(ms.frWithIsv - ms.frReserve - ms.frSubs) < 1e-9);
ok('Suscripción de $9.99: PayPal $0.84, creador $6.41, FR $2.74, ISV $0.41, quedan $2.33; con 10 suscriptores en la mitad de creadores el equilibrio baja a 6 y los $1,000 a 51');

globalThis.__lang = 'es';
let html = render();
for (const t of ['Proyección de ganancias', '9 creadores', '84 creadores', '$151.25', 'Equilibrio', 'Próximos 12 meses', 'desde 49 creadores', 'Sí ✓', 'Aún no', 'Fuentes de ingreso', 'Suscripciones', 'De suscripciones', 'Suscriptores']) assert.ok(html.includes(t), t);
ok('Pantalla en español con los números');

globalThis.__lang = 'pt';
assert.ok(render().includes('Proyección de ganancias'), 'otros idiomas caen a español');
globalThis.__lang = 'en';
html = render();
for (const t of ['Profit projection', '9 creators', '84 creators', 'Break-even', 'Next 12 months', 'Income sources', 'From subscriptions']) assert.ok(html.includes(t), t);
ok('English and fallback to Spanish');

console.log(`${passed} comprobaciones de la proyección. Sin red.`);
