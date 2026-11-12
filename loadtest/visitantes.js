// Prueba de carga: visitantes que navegan Fans Reserve (Inicio, Explorar, perfil, Reserve).
//
// SOLO LECTURA. No inicia sesión, no crea cuentas, no reserva, no paga, no llama a
// /api (PayPal, LiveKit, Didit...). Repite exactamente lo que el navegador pide al
// abrir esas páginas: el HTML y el JS/CSS de Vercel, y las consultas públicas a
// Supabase.
//
// OJO: Preview y Producción usan EL MISMO proyecto de Supabase (plan gratis). Esta
// prueba no toca Producción en Vercel, pero sí carga la base real. Por eso:
//   - se niega a correr contra fansreserve.com,
//   - se corta sola si los errores pasan del 5 %,
//   - se sube por niveles (humo → 200 → 500 → 1000 → 2000).
//
// Uso (lo hace el workflow .github/workflows/load-test.yml):
//   BASE_URL=https://<preview>.vercel.app SUPABASE_URL=... SUPABASE_ANON_KEY=... NIVEL=humo k6 run loadtest/visitantes.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter } from 'k6/metrics';

const BASE = (__ENV.BASE_URL || '').trim().replace(/\/+$/, '');
const SB = (__ENV.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const KEY = (__ENV.SUPABASE_ANON_KEY || '').trim();
const NIVEL = (__ENV.NIVEL || 'humo').trim();
const BYPASS = (__ENV.VERCEL_BYPASS || '').trim();

// ---- Seguros: nunca contra Producción ----
const host = (BASE.match(/^https?:\/\/([^/]+)/) || [])[1] || '';
if (!host) throw new Error('Falta BASE_URL (el link del Preview de Vercel).');
if (/(^|\.)fansreserve\.com$/i.test(host)) {
  throw new Error('BASE_URL apunta a fansreserve.com (Producción). Usa el link de un Preview de Vercel.');
}
if (!SB || !KEY) throw new Error('Faltan SUPABASE_URL / SUPABASE_ANON_KEY (salen de .env.production).');

// ---- Niveles: cuántas personas simultáneas y por cuánto tiempo ----
const NIVELES = {
  humo: [{ duration: '30s', target: 20 }, { duration: '1m', target: 20 }, { duration: '15s', target: 0 }],
  200: [{ duration: '1m', target: 200 }, { duration: '3m', target: 200 }, { duration: '30s', target: 0 }],
  500: [{ duration: '1m', target: 200 }, { duration: '1m', target: 500 }, { duration: '3m', target: 500 }, { duration: '30s', target: 0 }],
  1000: [{ duration: '1m', target: 300 }, { duration: '2m', target: 1000 }, { duration: '3m', target: 1000 }, { duration: '1m', target: 0 }],
  2000: [
    { duration: '1m', target: 200 },
    { duration: '2m', target: 500 },
    { duration: '2m', target: 1000 },
    { duration: '3m', target: 2000 },
    { duration: '5m', target: 2000 },
    { duration: '1m', target: 0 },
  ],
};
if (!NIVELES[NIVEL]) throw new Error(`NIVEL "${NIVEL}" no existe. Usa: ${Object.keys(NIVELES).join(', ')}`);

const erroresSupabase = new Rate('errores_supabase');
const erroresPagina = new Rate('errores_pagina');
const vistas = new Counter('paginas_vistas');

export const options = {
  scenarios: {
    visitantes: { executor: 'ramping-vus', startVUs: 0, stages: NIVELES[NIVEL], gracefulRampDown: '20s' },
  },
  thresholds: {
    // Freno de emergencia: si más del 5 % falla, se corta la prueba para no castigar Supabase.
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' }],
    // Metas de velocidad (95 de cada 100 respuestas por debajo de esto).
    'http_req_duration{servicio:vercel}': ['p(95)<1000'],
    'http_req_duration{servicio:supabase}': ['p(95)<1500'],
    errores_supabase: ['rate<0.02'],
    errores_pagina: ['rate<0.02'],
  },
  // Solo nos interesa si respondió y cuánto tardó, no guardar los cuerpos.
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  userAgent: 'FansReserve-LoadTest/1.0 (k6)',
};

const pageHeaders = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {};
const sbHeaders = { apikey: KEY, 'Content-Type': 'application/json', Accept: 'application/json' };

const rpc = (name, body = {}) => ({
  method: 'POST',
  url: `${SB}/rest/v1/rpc/${name}`,
  body: JSON.stringify(body),
  params: { headers: sbHeaders, tags: { servicio: 'supabase', name: `rpc/${name}` } },
});
const rest = (path, name) => ({
  method: 'GET',
  url: `${SB}/rest/v1/${path}`,
  params: { headers: sbHeaders, tags: { servicio: 'supabase', name } },
});
const page = (path, name) => ({
  method: 'GET',
  url: `${BASE}${path}`,
  params: { headers: pageHeaders, tags: { servicio: 'vercel', name } },
});

// Una vez al inicio: lee el index.html del Preview para saber qué JS/CSS baja el
// navegador, y la lista pública de creadores para visitar perfiles reales.
export function setup() {
  const res = http.get(`${BASE}/`, { headers: pageHeaders, responseType: 'text' });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`El Preview pidió login (${res.status}). Agrega el secreto VERCEL_AUTOMATION_BYPASS_SECRET en GitHub.`);
  }
  if (res.status !== 200) throw new Error(`El Preview respondió ${res.status} en "/".`);
  const html = String(res.body || '');
  const found = new Set();
  const re = /(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g;
  let m;
  while ((m = re.exec(html)) !== null) found.add(m[1]);
  const assets = [...found];

  const list = http.post(`${SB}/rest/v1/rpc/public_creators`, '{}', { headers: sbHeaders, responseType: 'text' });
  const names = http.post(`${SB}/rest/v1/rpc/creator_usernames`, '{}', { headers: sbHeaders, responseType: 'text' });
  let creators = [];
  try {
    const handle = new Map((JSON.parse(names.body) || []).map((r) => [r.id, r.username]));
    creators = (JSON.parse(list.body) || []).map((r) => ({ id: r.id, username: handle.get(r.id) || '' }));
  } catch (_) {
    creators = [];
  }
  // Valentina Rose (perfil de demostración) siempre existe.
  if (!creators.length) creators = [{ id: '1', username: '' }];
  console.log(`Preview OK. ${assets.length} archivos JS/CSS, ${creators.length} creadores públicos. Nivel: ${NIVEL}.`);
  return { assets, creators };
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pause = (min, max) => sleep(min + Math.random() * (max - min));

const record = (responses) => {
  for (const r of responses) {
    const isSb = r.request.url.startsWith(SB);
    const good = r.status >= 200 && r.status < 300;
    (isSb ? erroresSupabase : erroresPagina).add(!good);
  }
  check(responses, { 'todo respondió 2xx': (rs) => rs.every((r) => r.status >= 200 && r.status < 300) });
};

// Lo que pide el navegador en cualquier página pública (Inicio/Explorar/Reserve/perfil):
// la lista de creadores y el perfil de demostración del carrusel.
const catalogo = () => [
  rpc('public_creators'),
  rpc('creator_usernames'),
  rpc('creator_covers'),
  rpc('public_creator', { p_creator_profile_id: '1' }),
  rpc('creator_category', { p_creator_profile_id: '1' }),
  rpc('creator_cover', { p_creator_profile_id: '1' }),
  rest('managed_profiles?select=*&order=created_at.desc&hidden=eq.false', 'managed_profiles'),
];

export default function (data) {
  // 1) Entra por Inicio: HTML + JS/CSS (el navegador los guarda; solo la primera vez).
  if (__ITER === 0) {
    record(http.batch([page('/', 'pagina /'), ...data.assets.map((a) => page(a, 'assets'))]));
  } else {
    record(http.batch([page('/', 'pagina /')]));
  }
  record(http.batch(catalogo()));
  vistas.add(1);
  pause(3, 8);

  // 2) Explorar (la SPA ya está cargada: solo consultas a Supabase).
  record(http.batch(catalogo()));
  vistas.add(1);
  pause(4, 10);

  // 3) 60 % abre un perfil de creador, 40 % la página Reserve.
  if (Math.random() < 0.6) {
    const c = pick(data.creators);
    record(
      http.batch([
        rpc('public_creator', { p_creator_profile_id: c.id }),
        rpc('creator_category', { p_creator_profile_id: c.id }),
        rpc('creator_cover', { p_creator_profile_id: c.id }),
        rpc('creator_links', { p_creator_profile_id: c.id }),
      ]),
    );
  } else {
    record(http.batch([rest('vip_experiences?select=*&order=created_at.asc', 'vip_experiences')]));
  }
  vistas.add(1);
  pause(5, 15);
}

export function handleSummary(data) {
  const m = data.metrics;
  const v = (name, stat) => (m[name] && m[name].values ? m[name].values[stat] : undefined);
  const ms = (x) => (x === undefined ? '—' : `${Math.round(x)} ms`);
  const pct = (x) => (x === undefined ? '—' : `${(x * 100).toFixed(2)} %`);
  const ok = (name) => (m[name] && m[name].thresholds ? Object.values(m[name].thresholds).every((t) => t.ok) : true);
  const pico = v('vus_max', 'max') || 0;
  const reqs = v('http_reqs', 'count') || 0;
  const rps = v('http_reqs', 'rate') || 0;
  const verdict = ['http_req_failed', 'errores_supabase', 'errores_pagina', 'http_req_duration{servicio:vercel}', 'http_req_duration{servicio:supabase}'].every(ok);

  const md = [
    `## Prueba de carga Fans Reserve: nivel ${NIVEL}`,
    '',
    verdict ? '**Resultado: aguantó ✅**' : '**Resultado: NO aguantó ❌** (mira qué meta falló abajo)',
    '',
    '| Qué | Valor | Meta |',
    '|---|---|---|',
    `| Personas simultáneas (pico) | ${pico} | — |`,
    `| Páginas vistas | ${v('paginas_vistas', 'count') || 0} | — |`,
    `| Peticiones totales | ${reqs} (${rps.toFixed(1)} por segundo) | — |`,
    `| Errores totales | ${pct(v('http_req_failed', 'rate'))} | < 5 % (se corta sola) |`,
    `| Errores Supabase | ${pct(v('errores_supabase', 'rate'))} | < 2 % |`,
    `| Errores página (Vercel) | ${pct(v('errores_pagina', 'rate'))} | < 2 % |`,
    `| Supabase, 95 % responde en | ${ms(v('http_req_duration{servicio:supabase}', 'p(95)'))} | < 1500 ms |`,
    `| Vercel, 95 % responde en | ${ms(v('http_req_duration{servicio:vercel}', 'p(95)'))} | < 1000 ms |`,
    `| Supabase, el más lento | ${ms(v('http_req_duration{servicio:supabase}', 'max'))} | — |`,
    '',
  ].join('\n');

  return {
    stdout: `\n${md}\n`,
    'loadtest/resultado.md': md,
    'loadtest/resultado.json': JSON.stringify(data, null, 2),
  };
}
