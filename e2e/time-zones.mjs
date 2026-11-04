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

check('Una hora inexistente por horario de verano no se convierte en otra hora', () => {
  assert.ok(Number.isNaN(tz.zonedDate('2027-03-28', '02:30', 'Europe/Madrid').getTime()));
});
check('Una hora repetida usa la segunda ocurrencia, igual que PostgreSQL', () => {
  assert.equal(tz.zonedDate('2026-11-01', '01:30', 'America/New_York').toISOString(), '2026-11-01T06:30:00.000Z');
  assert.equal(tz.zonedDate('2026-10-25', '02:30', 'Europe/Madrid').toISOString(), '2026-10-25T01:30:00.000Z');
});
check('Calcula el día en la zona del creador, aunque el fan ya esté en el siguiente', () => {
  const at = new Date('2026-11-04T02:00:00Z');
  assert.equal(tz.dateInZone(at, 'America/Tegucigalpa'), '2026-11-03');
  assert.equal(tz.dateInZone(at, 'Asia/Tokyo'), '2026-11-04');
});
check('El selector incluye zonas de países con más de un horario', () => {
  const zones = tz.timeZoneOptions();
  for (const zone of ['America/Tegucigalpa', 'America/New_York', 'America/Los_Angeles', 'Europe/Madrid']) assert.ok(zones.includes(zone));
});
check('El fan ve el año correcto si la conversión pasa de diciembre a enero', () => {
  assert.match(tz.viewerSlotLabel('2026-12-31', '23:00', 'America/Tegucigalpa'), /2027/);
});
console.log(`\n${passed}/${passed} comprobaciones completas`);
