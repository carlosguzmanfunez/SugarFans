// Reserve hours across time zones: a creator's "18:00" is the same instant for
// everyone, and a fan elsewhere reads it in their own clock.
// Run: npm run test:time-zones (runs itself with the viewer in Madrid).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

if (process.env.TZ !== 'Europe/Madrid') {
  const r = spawnSync(process.execPath, [process.argv[1]], { stdio: 'inherit', env: { ...process.env, TZ: 'Europe/Madrid' } });
  process.exit(r.status ?? 1);
}

const out = join(mkdtempSync(join(tmpdir(), 'tz-')), 'tz.mjs');
await build({ entryPoints: ['src/lib/timeZones.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const tz = await import(pathToFileURL(out).href);

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };

console.log('\nZonas horarias de Reserve (fan en Madrid)');
check('18:00 en Tegucigalpa es la 01:00 del día siguiente en Madrid', () => {
  const at = tz.zonedDate('2026-11-02', '18:00', 'America/Tegucigalpa');
  assert.equal(at.toISOString(), '2026-11-03T00:00:00.000Z');
  assert.match(tz.viewerSlotLabel('2026-11-02', '18:00', 'America/Tegucigalpa'), /^01:00 · mar 3 nov$/);
});
check('El mismo día solo muestra la hora', () => {
  assert.equal(tz.viewerSlotLabel('2026-11-02', '10:00', 'America/Tegucigalpa'), '17:00');
});
check('Respeta el cambio de horario (verano en Madrid, sin cambio en Honduras)', () => {
  assert.equal(tz.zonedDate('2026-07-01', '18:00', 'America/Tegucigalpa').toISOString(), '2026-07-02T00:00:00.000Z');
  assert.equal(tz.viewerSlotLabel('2026-07-01', '10:00', 'America/Tegucigalpa'), '18:00');
  assert.equal(tz.zonedDate('2026-03-29', '03:30', 'Europe/Madrid').toISOString(), '2026-03-29T01:30:00.000Z');
});
check('En la misma zona no repite la hora', () => {
  assert.equal(tz.viewerSlotLabel('2026-11-02', '18:00', 'Europe/Madrid'), null);
  assert.equal(tz.viewerSlotLabel('2026-11-02', '18:00', 'Europe/Paris'), null);
});
check('Sin zona guardada se lee en el reloj de quien mira, como antes', () => {
  assert.equal(tz.zonedDate('2026-11-02', '18:00').toISOString(), '2026-11-02T17:00:00.000Z');
  assert.equal(tz.viewerSlotLabel('2026-11-02', '18:00', undefined), null);
  assert.equal(tz.zonedDate('2026-11-02', '18:00', 'Marte/Olympus').toISOString(), '2026-11-02T17:00:00.000Z');
});
check('Nombra la ciudad en español', () => {
  assert.equal(tz.zoneCity('America/Tegucigalpa'), 'Tegucigalpa');
  assert.equal(tz.zoneCity('America/Mexico_City'), 'Ciudad de México');
  assert.equal(tz.zoneCity('America/Argentina/Buenos_Aires'), 'Buenos Aires');
});
console.log(`\n${passed}/${passed} comprobaciones de zonas horarias`);
