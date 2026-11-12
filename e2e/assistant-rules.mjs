// "Mano derecha" free mode: the fixed rules of the manual per kind of case ($0, no AI).
import { build } from 'esbuild';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const out = join('node_modules', '.cache', 'fr-assistant-rules.mjs');
await build({ entryPoints: ['src/lib/assistantRules.ts'], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { rulesPlan, moneyPlan, isMoneyQuestion, isCasesQuestion } = await import(pathToFileURL(resolve(out)).href + '?' + Date.now());

const cases = [
  { id: 'E1', kind: 'error', title: 'Error web: TypeError: Failed to fetch dynamically imported module: https://fansreserve.com/assets/A.js' },
  { id: 'E2', kind: 'error', title: 'Error api: PayPal 500' },
  { id: 'R1', kind: 'report', title: 'Denuncia (post): contenido con un menor' },
  { id: 'F1', kind: 'refund', title: 'Devolución', amount: 25 },
  { id: 'F2', kind: 'refund', title: 'Devolución', amount: 25 },
  { id: 'P1', kind: 'payout', title: 'Retiro', amount: 80 },
  { id: 'D1', kind: 'dispute', title: 'Disputa', amount: 25 },
];
const refs = {
  E1: { kind: 'error', meta: { count: '40' } }, E2: { kind: 'error', meta: { count: '12' } }, R1: { kind: 'report', meta: { text: 'menor' } },
  F1: { kind: 'refund', meta: { reason: 'voluntary', state: 'pending' } }, F2: { kind: 'refund', meta: { reason: 'withdrawal', state: 'pending' } },
  P1: { kind: 'payout', meta: { status: 'failed', creator: 'Ana' } }, D1: { kind: 'dispute' },
};
const plan = rulesPlan(cases, refs, 'es');
const sol = Object.fromEntries(plan.solutions.map((s) => [s.case_id, s]));
const lvl = Object.fromEntries(plan.problems.map((p) => [p.case_id, p.level]));
assert.equal(sol.E1.action, 'none'); assert.equal(lvl.E1, 'baja'); assert.match(sol.E1.solution, /recarga sola/);
assert.equal(sol.E2.action, 'open'); assert.equal(lvl.E2, 'media');
assert.equal(lvl.R1, 'alta'); assert.equal(sol.R1.action, 'open');
assert.equal(sol.F1.action, 'refund_approve'); assert.match(sol.F1.solution, /\$20\.85/);
assert.equal(sol.F2.action, 'refund_legal');
assert.equal(lvl.P1, 'alta'); assert.match(sol.P1.solution, /No reenviar/);
assert.deepEqual(plan.problems.slice(0, 3).map((p) => p.level), ['alta', 'alta', 'alta']);
assert.match(rulesPlan([], {}, 'es').reply, /Todo en orden/);
assert.match(moneyPlan({ hoy: { cobrado: 25, pagos: 1, creadores: 16.35, fr_con_isv: 7, fr_sin_isv: 5.95 }, mes: {} }, 'es').reply, /\$7\.00 con ISV, \$5\.95 sin ISV/);
assert.ok(isMoneyQuestion('¿Cuánto llevamos hoy?') && !isCasesQuestion('¿Cuánto llevamos hoy?'));
assert.ok(isCasesQuestion('Resuelve los casos abiertos'));
assert.match(rulesPlan(cases, refs, 'en').reply, /You have 7 cases/);
console.log('OK reglas gratis: versión vieja tras publicar, denuncias graves primero, devoluciones, retiros, dinero con y sin ISV, inglés');
