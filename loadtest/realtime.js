// Prueba de conexiones en vivo (Supabase Realtime): la campanita y los cupos en vivo
// usan una conexión abierta por cada persona con sesión iniciada.
//
// El plan GRATIS de Supabase permite 200 conexiones Realtime a la vez. Esta prueba
// abre N conexiones a un canal de prueba (no lee ni escribe datos, no toca tablas)
// y mide cuántas acepta. Por defecto se queda en 150 para no tumbar la campanita del
// equipo; súbelo a 250 solo si quieres ver dónde está el tope.
//
// Uso: SUPABASE_URL=... SUPABASE_ANON_KEY=... CONEXIONES=150 k6 run loadtest/realtime.js

import ws from 'k6/ws';
import { check } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';

const SB = (__ENV.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const KEY = (__ENV.SUPABASE_ANON_KEY || '').trim();
const N = Number(__ENV.CONEXIONES || 150);
const HOLD_MS = Number(__ENV.MANTENER_SEGUNDOS || 120) * 1000;

if (!SB || !KEY) throw new Error('Faltan SUPABASE_URL / SUPABASE_ANON_KEY.');
if (!(N > 0 && N <= 400)) throw new Error('CONEXIONES debe estar entre 1 y 400.');

const unidas = new Rate('realtime_conexion_ok');
const rechazadas = new Counter('realtime_rechazadas');
const tiempoUnion = new Trend('realtime_tiempo_union', true);

export const options = {
  scenarios: {
    conexiones: { executor: 'per-vu-iterations', vus: N, iterations: 1, maxDuration: `${Math.ceil(HOLD_MS / 1000) + 90}s` },
  },
  thresholds: { realtime_conexion_ok: ['rate>0.98'] },
  userAgent: 'FansReserve-LoadTest/1.0 (k6)',
};

const url = `${SB.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(KEY)}&vsn=1.0.0`;

export default function () {
  const topic = `realtime:prueba-carga-${__VU % 20}`;
  const started = Date.now();
  let joined = false;
  let ref = 1;

  const res = ws.connect(url, {}, (socket) => {
    socket.on('open', () => {
      socket.send(JSON.stringify({
        topic,
        event: 'phx_join',
        payload: { config: { broadcast: { ack: false, self: false }, presence: { key: '' }, postgres_changes: [], private: false } },
        ref: String(ref),
        join_ref: String(ref),
      }));
      // Latido igual que supabase-js (cada 25 s) para que no cierre la conexión.
      socket.setInterval(() => {
        ref += 1;
        socket.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(ref) }));
      }, 25000);
      socket.setTimeout(() => socket.close(), HOLD_MS);
    });
    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }
      if (msg.topic === topic && msg.event === 'phx_reply' && !joined) {
        joined = msg.payload && msg.payload.status === 'ok';
        if (joined) tiempoUnion.add(Date.now() - started);
        else {
          rechazadas.add(1);
          console.warn(`Conexión ${__VU} rechazada: ${JSON.stringify(msg.payload).slice(0, 200)}`);
          socket.close();
        }
      }
      if (msg.event === 'system' && msg.payload && msg.payload.status === 'error') {
        console.warn(`Aviso Realtime (${__VU}): ${JSON.stringify(msg.payload).slice(0, 200)}`);
      }
    });
    socket.on('error', (e) => console.warn(`Error de conexión ${__VU}: ${e.error ? e.error() : e}`));
  });

  if (!joined && res && res.status !== 101) rechazadas.add(1);
  unidas.add(joined);
  check(joined, { 'conexión en vivo aceptada': (j) => j });
}

export function handleSummary(data) {
  const m = data.metrics;
  const okRate = m.realtime_conexion_ok ? m.realtime_conexion_ok.values.rate : 0;
  const rej = m.realtime_rechazadas ? m.realtime_rechazadas.values.count : 0;
  const t = m.realtime_tiempo_union ? m.realtime_tiempo_union.values['p(95)'] : undefined;
  const md = [
    `## Conexiones en vivo (Supabase Realtime): ${N} a la vez`,
    '',
    okRate >= 0.98 ? '**Resultado: aguantó ✅**' : '**Resultado: llegó al tope ❌**',
    '',
    '| Qué | Valor |',
    '|---|---|',
    `| Conexiones intentadas | ${N} |`,
    `| Aceptadas | ${Math.round(okRate * N)} (${(okRate * 100).toFixed(1)} %) |`,
    `| Rechazadas | ${rej} |`,
    `| 95 % se conectó en | ${t === undefined ? '—' : `${Math.round(t)} ms`} |`,
    '',
    'Plan gratis = 200 conexiones a la vez. Pro = 500 (se puede subir).',
    '',
  ].join('\n');
  return { stdout: `\n${md}\n`, 'loadtest/resultado-realtime.md': md };
}
