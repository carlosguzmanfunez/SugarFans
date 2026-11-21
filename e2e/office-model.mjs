// Oficina de la Mano derecha (/oficina): cómo se convierte monitor_live en agentes,
// casos con código y una sola decisión. Código puro, sin red ni base.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const out = join('node_modules', '.cache', 'fr-office-model.mjs');
await build({ entryPoints: ['src/lib/officeModel.ts'], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { buildOffice, FICHAS, calendario, cuadra } = await import(pathToFileURL(resolve(out)).href + '?' + Date.now());

const checks = [];
// 21 nov 2026, 12:20 a. m. en Honduras (06:20 UTC).
const NOW = Date.parse('2026-11-21T06:20:00Z');
const money = (cobrado, pagos) => {
  const fee = Math.round((cobrado * 0.054 + pagos * 0.3) * 100) / 100;
  const creadores = Math.round((cobrado - fee) * 0.7 * 100) / 100;
  const fr = Math.round((cobrado - fee - creadores) * 100) / 100;
  const isv = Math.round(fr * 0.15 * 100) / 100;
  return { cobrado, comision_paypal: fee, creadores, fr_con_isv: fr, isv, fr_sin_isv: Math.round((fr - isv) * 100) / 100, pagos,
    personas_nuevas: 3, creadores_verificados: 1, reservas_pagadas: 2, reservas_nuevas: 4, errores_pagina: 1, devuelto: 0, en_disputa: 0 };
};
const base = (problemas = [], extra = {}) => ({
  ahora: { at: new Date(NOW).toISOString(), dia: '2026-11-21', ultima_hora: money(0, 0), hoy: money(100, 4), mes: money(2000, 80), problemas,
    pendiente: { retiros_enviandose: 0, reserve_por_responder: 1, reserve_confirmadas_proximas: 6 } },
  horas: Array.from({ length: 24 }, (_, i) => ({ at: new Date(NOW - i * 36e5).toISOString(), cobrado: 0 })),
  dias: ['2026-11-21', '2026-11-20', '2026-11-19', '2026-11-17'].map((day, i) => ({ day, closed: i > 0, dinero: money(100 + i * 25, 4) })),
  reportes: [], ultima_revision: new Date(NOW - 15 * 60e3).toISOString(), ...extra,
});
const ag = (o, id) => o.agentes.find((a) => a.id === id);

// 1) Todo en orden.
{
  const o = buildOffice(base(), NOW);
  assert.equal(o.estado, 'ok');
  assert.equal(o.decision, null);
  assert.equal(o.casos.length, 0);
  assert.equal(ag(o, 'legal').estado, 'idle', 'Legal no tiene alertas: luces apagadas');
  assert.equal(o.agentes.length, 9);
  assert.match(ag(o, 'mano').dice, /^Buenas noches, Carlos\. Hoy no necesito ninguna decisión tuya/);
  assert.match(ag(o, 'dinero').dice, /Todo cuadra al centavo/);
  assert.equal(o.foto.minutos, 15); assert.equal(o.foto.vieja, false);
  checks.push('sin alertas: verde, sin decisión y Legal con la luz apagada');
}

// 2) Una sola decisión: la más urgente que necesita el sí de Carlos; el resto espera en cola.
{
  const o = buildOffice(base([
    { code: 'errores_web', nivel: 'baja', n: 3, titulo: '3 fallos al navegar' },
    { code: 'devoluciones', nivel: 'media', n: 1, titulo: '1 devolución por terminar ($25.00)', donde: 'Dinero > Retiros y devoluciones' },
    { code: 'disputas', nivel: 'alta', n: 1, titulo: '1 disputa abierta ($25.00)', donde: 'Dinero > Pagos a creadores' },
    { code: 'reserve_disputa', nivel: 'alta', n: 1, titulo: '1 Reserve en disputa' },
    { code: 'verificaciones', nivel: 'media', n: 2, titulo: '2 identidades por verificar' },
    { code: 'retiros_atascados', nivel: 'media', n: 1, titulo: '1 retiro lleva más de 2 horas enviándose' },
  ]), NOW);
  const byCode = Object.fromEntries(o.casos.map((c) => [c.code, c]));
  assert.equal(o.decision.code, 'disputas'); assert.equal(o.decision.id, 'D1'); assert.equal(o.decision.grupo, 'tu');
  assert.equal(byCode.reserve_disputa.id, 'D2'); assert.equal(byCode.reserve_disputa.grupo, 'cola');
  assert.equal(byCode.devoluciones.id, 'F1'); assert.equal(byCode.devoluciones.grupo, 'cola');
  assert.equal(byCode.verificaciones.id, 'V1'); assert.equal(byCode.verificaciones.grupo, 'cola');
  assert.equal(byCode.retiros_atascados.id, 'P1'); assert.equal(byCode.retiros_atascados.grupo, 'proceso', 'sin pregunta: lo trabajamos sin pedir nada');
  assert.equal(byCode.errores_web.id, 'E1'); assert.equal(byCode.errores_web.grupo, 'info');
  assert.equal(o.casos.filter((c) => c.grupo === 'tu').length, 1, 'nunca más de una decisión');
  assert.equal(o.casos[0].nivel, 'alta', 'lo urgente va primero');
  assert.equal(ag(o, 'disputas').estado, 'bad'); assert.equal(ag(o, 'retiros').estado, 'warn');
  assert.equal(ag(o, 'personas').estado, 'warn'); assert.equal(ag(o, 'sistema').estado, 'ok', 'lo informativo no cambia el color');
  assert.equal(ag(o, 'mano').estado, 'bad'); assert.equal(o.estado, 'bad');
  assert.match(ag(o, 'mano').dice, /Hoy solo necesito una cosa de ti: D1/);
  assert.match(o.decision.pregunta, /Quién paga el cargo/);
  assert.equal(ag(o, 'disputas').vigila.find((v) => v.code === 'disputas').n, 1);
  assert.equal(ag(o, 'disputas').vigila.find((v) => v.code === 'incidentes').n, 0);
  checks.push('una sola decisión (D1), el resto en cola, en proceso o informativo, con su código');
}

// 3) Una media sin alta también puede ser la decisión; una baja nunca.
{
  const o = buildOffice(base([{ code: 'denuncias', nivel: 'media', n: 1, titulo: '1 denuncia o solicitud por revisar' }, { code: 'reserve_sin_respuesta', nivel: 'baja', n: 1, titulo: '1 Reserve por vencer sin respuesta del creador' }]), NOW);
  assert.equal(o.decision.id, 'R1'); assert.equal(o.estado, 'warn');
  const o2 = buildOffice(base([{ code: 'reserve_sin_respuesta', nivel: 'baja', n: 1, titulo: 'x' }]), NOW);
  assert.equal(o2.decision, null); assert.equal(o2.estado, 'ok');
  checks.push('una denuncia puede ser la decisión; lo informativo nunca');
}

// 4) La revisión automática se trabó: el Sistema se pone ámbar con su propio caso.
{
  const o = buildOffice(base([], { ultima_revision: new Date(NOW - 95 * 60e3).toISOString() }), NOW);
  assert.equal(o.foto.vieja, true);
  const c = o.casos.find((x) => x.code === 'foto_vieja');
  assert.ok(c); assert.equal(c.agent, 'sistema'); assert.equal(c.grupo, 'proceso');
  assert.equal(ag(o, 'sistema').estado, 'warn');
  assert.match(ag(o, 'sistema').dice, /hace 95 min/);
  checks.push('revisión de hace más de 70 min: Sistema en ámbar');
}

// 5) Dinero que no cuadra: Beto avisa.
{
  const live = base(); live.ahora.hoy = { ...live.ahora.hoy, creadores: live.ahora.hoy.creadores + 3 };
  const o = buildOffice(live, NOW);
  assert.equal(ag(o, 'dinero').estado, 'warn'); assert.match(ag(o, 'dinero').dice, /\$3\.00 que no cuadran/);
  assert.deepEqual(cuadra({ cobrado: 25, comision_paypal: 1.65, creadores: 16.35, fr_con_isv: 7 }), { ok: true, diferencia: 0 });
  checks.push('si el reparto no cuadra, Dinero se pone ámbar');
}

// 6) Las tiras de 7 días usan el día de Honduras y marcan los días sin registro.
{
  const s = ag(buildOffice(base(), NOW), 'dinero').serie;
  assert.equal(s.dias.length, 7); assert.equal(s.dias[6], 'Hoy'); assert.equal(s.dias[5], 'V');
  assert.deepEqual(s.valores, [null, null, 175, null, 150, 125, 100]);
  checks.push('tira de 7 días por día de Honduras, con huecos sin dato');
}

// 7) Calendario de pagos.
{
  assert.equal(calendario(NOW).fase, 0); assert.match(calendario(NOW).texto, /Faltan 5 días/);
  assert.equal(calendario(Date.parse('2026-11-27T18:00:00Z')).fase, 1);
  assert.equal(calendario(Date.parse('2026-12-01T18:00:00Z')).fase, 1);
  assert.equal(calendario(Date.parse('2026-12-02T18:00:00Z')).fase, 2);
  assert.equal(calendario(Date.parse('2026-12-03T05:30:00Z')).fase, 2, '11:30 p. m. del día 2 en Honduras sigue siendo día 2');
  checks.push('calendario 26 · 26–1 · 2 en hora Honduras');
}

// 8) Cada alerta que puede crear la base tiene su ficha del manual; una desconocida va a la Mano derecha.
{
  const sql = readFileSync('supabase/migrations/20261107210000_monitor_mano_derecha.sql', 'utf8');
  const codes = [...new Set([...sql.matchAll(/jsonb_build_object\('code','([a-z_]+)'/g)].map((m) => m[1]))];
  assert.ok(codes.length >= 15);
  for (const code of codes) assert.ok(FICHAS[code], `falta la ficha de ${code}`);
  const o = buildOffice(base([{ code: 'nueva_alerta', nivel: 'media', n: 1, titulo: 'Algo nuevo' }]), NOW);
  assert.equal(o.casos[0].agent, 'mano'); assert.equal(o.casos[0].id, 'A1');
  checks.push(`las ${codes.length} alertas de la base tienen ficha; una nueva cae en la Mano derecha`);
}

for (const c of checks) console.log('OK', c);
console.log(`${checks.length} comprobaciones del modelo de la oficina. Sin red.`);
