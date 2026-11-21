// Oficina de la Mano derecha (/oficina). Misma llave y mismos datos que /control
// (monitor_live), dibujados como una oficina pixel: un agente por área, su ficha y una
// sola decisión para Carlos. Solo lee: no hay ningún botón que mueva dinero o cambie algo.
import '@fontsource/press-start-2p/400.css';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './oficina.css';
import {
  buildOffice, cuadra, horaHN, usd,
  type AgentId, type Caso, type Estado, type MonitorLive, type Money, type Oficina, type Serie,
} from '../lib/officeModel';

const SB_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
const SB_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';
const K_STORE = 'fr-control-key'; // la misma llave que /control
const D_STORE = 'fr-oficina-last';
const ADMIN = '/admin?section=monitor';
const MANUAL = 'https://github.com/carlosguzmanfunez/SugarFans/blob/main/docs/operations/manual-operacion.md';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
};
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'hace un momento';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`;
};

const ST: Record<Estado, { c: string; t: string }> = {
  ok: { c: '#5bc86a', t: 'Verde' }, warn: { c: '#f0a63a', t: 'Ámbar' }, bad: { c: '#e5534b', t: 'Rojo' }, idle: { c: '#8a8fa3', t: 'Sin pendientes' },
};
const GLOS: Record<string, [string, string]> = {
  isv: ['Con ISV / sin ISV', 'La parte de Fans Reserve antes y después de apartar el 15% de ISV. El ISV solo se calcula sobre la parte de Fans Reserve, nunca sobre la del creador. Ejemplo: $7.00 con ISV → ISV $1.05 → $5.95 sin ISV.'],
  neto: ['Neto', 'Lo que pagó el fan menos la comisión de cobro de PayPal (la real, o 5.4% + $0.30 si PayPal no la reportó). El reparto 70/30 se calcula sobre el neto.'],
  contracargo: ['Contracargo', 'Cuando el fan le pide a su banco o tarjeta que le devuelva un pago. PayPal retira el dinero y cobra un cargo; se responde con evidencia y se decide quién paga ese cargo (contrato 6.2.4).'],
  expediente: ['Expediente', 'La carpeta de evidencia de una venta, retiro o disputa en el Admin. En disputas de Reserve va en inglés: entrada de cada uno, duración y mensajes.'],
  ciclo: ['Ciclo de pagos', 'Las ganancias del 26 al 25 se acreditan el día 26. Los creadores retiran del 26 al día 1, y el día 2 se confirma que todo quedó pagado.'],
  incierto: ['Retiro incierto', 'Un envío a PayPal del que no sabemos si salió. Nunca se reenvía “por si acaso”: primero se confirma con PayPal.'],
};
const term = (k: string, label: string) => `<button type="button" class="term" data-term="${k}">${label}</button>`;

/* ---------- Personajes (pixel art 10×14) ---------- */
type Px = [number, number, string];
interface Look { hair: string; skin: string; shirt: string; acc: string; pants: string; ex?: Px[] }
const longHair: Px[] = [[2, 3, 'hair'], [7, 3, 'hair'], [2, 4, 'hair'], [7, 4, 'hair'], [2, 5, 'hair'], [7, 5, 'hair']];
const glasses: Px[] = [[2, 3, '#151827'], [4, 3, '#151827'], [5, 3, '#151827'], [7, 3, '#151827']];
const row = (y: number, x0: number, x1: number, c: string): Px[] => Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y, c] as Px);
const LOOKS: Record<string, Look> = {
  dinero: { hair: '#5a3a22', skin: '#c98d5e', shirt: '#3f8f5a', acc: '#f2c14e', pants: '#33415c', ex: [...row(1, 2, 8, '#7fd18a'), [8, 2, '#7fd18a']] },
  mano: { hair: '#2b1d14', skin: '#e0ac7e', shirt: '#2e3f73', acc: '#f3ead8', pants: '#1f2433', ex: [...longHair, [1, 2, '#2a2e3a'], [1, 3, '#2a2e3a'], [1, 4, '#2a2e3a'], [3, 5, '#2a2e3a']] },
  disputas: { hair: '#1a1a1a', skin: '#8d5b3c', shirt: '#7a3b5a', acc: '#e8e2d0', pants: '#2b2f45', ex: [...longHair, [1, 4, '#f2c14e'], [8, 4, '#f2c14e']] },
  retiros: { hair: '#c8642c', skin: '#f0c49a', shirt: '#3a7bbf', acc: '#ffffff', pants: '#2b2f45', ex: [...row(0, 3, 6, '#f2c14e'), ...row(1, 2, 9, '#f2c14e')] },
  personas: { hair: '#7b4ea3', skin: '#d9a072', shirt: '#e07a5f', acc: '#ffd166', pants: '#33415c', ex: longHair },
  reserve: { hair: '#e8c547', skin: '#f2c9a0', shirt: '#e5679a', acc: '#ffffff', pants: '#2b2f45', ex: [...row(1, 2, 7, '#f3ead8'), [2, 3, 'hair'], [7, 3, 'hair'], [2, 4, 'hair'], [7, 4, 'hair']] },
  contenido: { hair: '#3b2a20', skin: '#f2c9a0', shirt: '#2f9e8f', acc: '#ffffff', pants: '#2b2f45', ex: glasses },
  sistema: { hair: '#9aa0a6', skin: '#b77b52', shirt: '#4a5568', acc: '#5bc86a', pants: '#1f2433', ex: row(5, 3, 6, '#9aa0a6') },
  legal: { hair: '#3b2a20', skin: '#e6b38a', shirt: '#6b5b95', acc: '#f3ead8', pants: '#2b2f45', ex: [[4, -1, 'hair'], [5, -1, 'hair'], ...glasses] },
  paypal: { hair: '#3b2a20', skin: '#e0ac7e', shirt: '#2f6db5', acc: '#9fd0ff', pants: '#1f2433' },
  supabase: { hair: '#1a1a1a', skin: '#c98d5e', shirt: '#2f9e6e', acc: '#b8f0d2', pants: '#1f2433' },
  vercel: { hair: '#e8c547', skin: '#f0c49a', shirt: '#2a2a2e', acc: '#ffffff', pants: '#1f2433' },
  resend: { hair: '#7b4ea3', skin: '#d9a072', shirt: '#d8d8e0', acc: '#2a2a2e', pants: '#1f2433' },
  didit: { hair: '#2b1d14', skin: '#8d5b3c', shirt: '#6b5bd6', acc: '#f3ead8', pants: '#1f2433' },
  livekit: { hair: '#c8642c', skin: '#f2c9a0', shirt: '#e07a5f', acc: '#ffffff', pants: '#1f2433' },
  sightengine: { hair: '#5a3a22', skin: '#e6b38a', shirt: '#c9a227', acc: '#2a2a2e', pants: '#1f2433' },
  zoho: { hair: '#9aa0a6', skin: '#c98d5e', shirt: '#d24b4b', acc: '#f3ead8', pants: '#1f2433' },
};
const TPL = ['...HHHH...', '..HHHHHH..', '..HSSSSH..', '..SESSES..', '..SSSSSS..', '...SSSS...', '..CCCCCC..', '.CCCAACCC.', '.SCCAACCS.', '..CCCCCC..', '..PPPPPP..', '..PP..PP..', '..PP..PP..', '..BB..BB..'];
function drawSprite(ctx: CanvasRenderingContext2D, x: number, y: number, id: string, blink: boolean, k = 1) {
  const p = LOOKS[id];
  const map: Record<string, string> = { H: p.hair, S: p.skin, E: blink ? p.skin : '#1b1b24', C: p.shirt, A: p.acc, P: p.pants, B: '#16161e' };
  for (let r = 0; r < TPL.length; r++) for (let c = 0; c < 10; c++) {
    const ch = TPL[r][c];
    if (ch === '.') continue;
    ctx.fillStyle = map[ch]; ctx.fillRect((x + c) * k, (y + r) * k, k, k);
  }
  for (const e of p.ex ?? []) { ctx.fillStyle = e[2] === 'hair' ? p.hair : e[2]; ctx.fillRect((x + e[0]) * k, (y + e[1]) * k, k, k); }
  if (!blink && p.ex?.some((e) => e[1] === 3 && e[2] === '#151827')) { // ojos por encima de los lentes
    ctx.fillStyle = '#1b1b24'; ctx.fillRect((x + 3) * k, (y + 3) * k, k, k); ctx.fillRect((x + 6) * k, (y + 3) * k, k, k);
  }
}
function portrait(canvas: HTMLCanvasElement, id: string, k: number) {
  canvas.width = 10 * k; canvas.height = 15 * k;
  const c = canvas.getContext('2d')!;
  c.clearRect(0, 0, canvas.width, canvas.height);
  drawSprite(c, 0, 1, id, false, k);
}

/* ---------- Proveedores (sala de abajo) ---------- */
interface Prov { id: string; nombre: string; para: string; nota: string; quien: string; check: string | null; estado: Estado; resultado: string }
const PROVS: Prov[] = [
  { id: 'paypal', nombre: 'PayPal', para: 'Cobros, suscripciones y retiros', nota: 'El lanzamiento espera la aprobación de PayPal como marketplace.', quien: 'Todo lo de PayPal Live lo haces tú.', check: '/api/paypal', estado: 'idle', resultado: 'Revisando…' },
  { id: 'supabase', nombre: 'Supabase', para: 'Base de datos, login, archivos y tareas', nota: 'Según el manual (7 nov): el plan gratis no tiene respaldos diarios; se recomienda Pro antes de abrir.', quien: 'El SQL en producción solo corre con tu sí.', check: null, estado: 'idle', resultado: '' },
  { id: 'vercel', nombre: 'Vercel', para: 'La web y las funciones api/*', nota: 'Según el manual (7 nov): el plan Hobby no permite uso comercial; se recomienda Pro antes de abrir.', quien: 'Variables y DNS los pones tú a mano.', check: null, estado: 'ok', resultado: 'En línea: esta página viene de aquí' },
  { id: 'resend', nombre: 'Resend', para: 'Correos de la app y del login', nota: 'Plan gratis: hasta 100 correos al día.', quien: 'La llave vive en Vercel; nunca se pega en el chat.', check: '/api/usage', estado: 'idle', resultado: 'Revisando…' },
  { id: 'didit', nombre: 'Didit', para: 'Verificación de identidad', nota: 'Aprobar o rechazar lo decide una persona.', quien: '', check: '/api/didit', estado: 'idle', resultado: 'Revisando…' },
  { id: 'livekit', nombre: 'LiveKit', para: 'Videollamadas de Reserve', nota: 'Se prueba con una llamada en Preview.', quien: '', check: null, estado: 'idle', resultado: 'Sin chequeo automático' },
  { id: 'sightengine', nombre: 'Sightengine', para: 'Moderación de fotos y videos', nota: 'Explícito ≥ 0.85 se rechaza; ≥ 0.5 va a revisión manual.', quien: '', check: '/api/moderate', estado: 'idle', resultado: 'Revisando…' },
  { id: 'zoho', nombre: 'Zoho Mail', para: 'Correo entrante de carlos@ y los alias support, privacy, legal, dmca, safety y minors', nota: '', quien: '', check: null, estado: 'idle', resultado: 'Sin chequeo automático' },
];
let provsChecked = false;
function checkProviders() {
  if (provsChecked) return;
  provsChecked = true;
  const set = (id: string, estado: Estado, resultado: string) => { const p = PROVS.find((x) => x.id === id)!; p.estado = estado; p.resultado = resultado; renderAll(); };
  const get = (url: string) => fetch(url, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
  get('/api/paypal').then((d) => set('paypal', d.enabled ? 'ok' : 'bad', d.enabled ? `Configurado · ${d.env === 'live' ? 'Live' : 'Sandbox'}` : 'Falta configurar'))
    .catch(() => set('paypal', 'idle', 'No se pudo revisar'));
  get('/api/usage').then((d) => set('resend', d.checks?.resend === 'OK' ? 'ok' : 'bad', d.checks?.resend === 'OK' ? 'resend: OK' : 'resend: FALTA'))
    .catch(() => set('resend', 'idle', 'No se pudo revisar'));
  get('/api/didit').then((d) => set('didit', d.enabled ? 'ok' : 'bad', d.enabled ? 'Configurado' : 'Falta configurar'))
    .catch(() => set('didit', 'idle', 'No se pudo revisar'));
  get('/api/moderate').then((d) => set('sightengine', d.enabled ? 'ok' : 'bad', d.enabled ? 'Configurado' : 'Falta configurar'))
    .catch(() => set('sightengine', 'idle', 'No se pudo revisar'));
}

/* ---------- Estado de la página ---------- */
let live: MonitorLive | null = null;
let model: Oficina | null = null;
let selected = 'mano';
let period: 'ultima_hora' | 'hoy' | 'mes' = 'hoy';
let lightMode: 'auto' | 'dia' | 'tarde' | 'noche' = (store.get('fr-oficina-luz') as 'auto' | 'dia' | 'tarde' | 'noche' | null) ?? 'auto';
const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const desktop = window.matchMedia('(min-width: 900px)');
const agent = (id: string) => model?.agentes.find((a) => a.id === id);

/* ---------- Escena pixel ---------- */
const W = 192, H = 276;
const C = [5, 67, 129], RW = [34, 90, 146], CW = 58, CH = 54, BX = [3, 50, 97, 144], BY = [214, 245];
interface Spot { id: string; x: number; y: number; w: number; h: number; off: number; kind: 'team' | 'prov' }
const ORDER: AgentId[] = ['dinero', 'mano', 'disputas', 'retiros', 'personas', 'reserve', 'contenido', 'sistema', 'legal'];
const spots: Spot[] = [
  ...ORDER.map((id, i) => ({ id, x: C[i % 3], y: RW[Math.floor(i / 3)], w: CW, h: CH, off: i * 3, kind: 'team' as const })),
  ...PROVS.map((p, i) => ({ id: p.id, x: BX[i % 4], y: BY[Math.floor(i / 4)], w: 45, h: 29, off: 30 + i * 3, kind: 'prov' as const })),
];
const low = document.createElement('canvas'); low.width = W; low.height = H;
const g = low.getContext('2d')!;
const R = (x: number, y: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
const GL: Record<Estado, string[]> = { ok: ['....#', '...#.', '#.#..', '.#...', '.....'], warn: ['.....', '.....', '#.#.#', '.....', '.....'], bad: ['..#..', '..#..', '..#..', '.....', '..#..'], idle: ['####.', '..#..', '.#...', '####.', '.....'] };
let frame = 0;
const estadoDe = (s: Spot): Estado => (s.kind === 'team' ? agent(s.id)?.estado ?? 'idle' : PROVS.find((p) => p.id === s.id)!.estado);
function bubble(x: number, y: number, st: Estado) {
  R(x, y, 9, 9, '#151827'); R(x + 1, y + 1, 7, 7, '#f6f1e6'); R(x + 1, y + 9, 2, 1, '#151827');
  g.fillStyle = ST[st].c;
  GL[st].forEach((line, r) => { for (let c = 0; c < 5; c++) if (line[c] === '#') g.fillRect(x + 2 + c, y + 2 + r, 1, 1); });
}
function phase() {
  let id = lightMode as string;
  if (id === 'auto') { const h = new Date(Date.now() - 6 * 36e5).getUTCHours(); id = h >= 6 && h < 17 ? 'dia' : h >= 17 && h < 19 ? 'tarde' : 'noche'; }
  return {
    id, sky: id === 'dia' ? ['#8fd3e8', '#bfe9f5'] : id === 'tarde' ? ['#f4a261', '#f7c59f'] : ['#1b2550', '#24306a'],
    overlay: id === 'tarde' ? 'rgba(90,40,20,0.14)' : id === 'noche' ? 'rgba(8,12,40,0.45)' : null,
  };
}
const bobOf = (s: Spot) => (!motion ? 0 : estadoDe(s) === 'bad' ? ((frame + s.off) % 2 ? 2 : 0) : ((frame + s.off) % 4) < 2 ? 1 : 0);
function bars(x: number, y: number, st: Estado, off: number) {
  for (let i = 0; i < 4; i++) { const h = motion ? 1 + ((frame + i * 2 + off) % 5) : 2 + (i % 3); R(x + i * 3, y + 5 - h, 2, h, ST[st].c); }
}
function cubicle(s: Spot) {
  const { x, y, w, h } = s, m = s.id === 'mano';
  R(x + 3, y + 4, w - 6, h - 4, m ? '#6a3f5f' : '#45507d');
  g.fillStyle = m ? '#5d3653' : '#3e4872';
  for (let yy = y + 8; yy < y + h; yy += 5) for (let xx = x + 5 + (((yy - y) / 5) % 2 ? 2 : 0); xx < x + w - 4; xx += 6) g.fillRect(xx, yy, 1, 1);
  R(x, y, w, 5, '#9aa6b8'); R(x, y, w, 1, m ? '#f2c14e' : '#cfd8e3'); R(x, y + 4, w, 1, '#6b778a');
  R(x, y, 3, h - 14, '#9aa6b8'); R(x, y, 1, h - 14, '#cfd8e3'); R(x + w - 3, y, 3, h - 14, '#9aa6b8'); R(x + w - 1, y, 1, h - 14, '#6b778a');
  R(x + 8, y + 9, 32, 10, '#946642'); R(x + 8, y + 9, 32, 1, '#ad7b52'); R(x + 8, y + 19, 32, 3, '#6b4630');
  R(x + 14, y + 6, 16, 10, '#2a2e3a'); R(x + 15, y + 7, 14, 7, '#0e141d'); R(x + 21, y + 16, 2, 2, '#2a2e3a');
  if (m) { R(x + 31, y + 7, 9, 8, '#2a2e3a'); R(x + 32, y + 8, 7, 5, '#0e141d'); }
  else { R(x + 33, y + 12, 3, 3, s.id === 'sistema' ? '#6b4630' : '#f3ead8'); R(x + 36, y + 13, 1, 1, '#f3ead8'); }
  R(x + 10, y + 12, 3, 4, '#e9e4d6'); R(x + 11, y + 11, 3, 4, '#f6f1e6');
  R(x + w - 12, y + 15, 6, 5, '#8a5a3b'); R(x + w - 13, y + 10, 8, 5, '#4f9a52'); R(x + w - 11, y + 8, 4, 3, '#67b86a');
  R(x + 15, y + 22, 14, 8, '#2f3b5c'); R(x + 15, y + 22, 14, 1, '#41507a');
  drawSprite(g, x + 17, y + 24 + bobOf(s), s.id, motion && (frame + s.off) % 17 === 0);
}
function booth(s: Spot) {
  const { x, y, w, h } = s;
  R(x, y, w, h, '#3e4766'); R(x + 1, y + 1, w - 2, h - 2, '#46507a');
  R(x + 22, y + 5, 14, 11, '#2a2e3a'); R(x + 23, y + 6, 12, 8, '#0e141d'); R(x + 28, y + 16, 2, 3, '#2a2e3a'); R(x + 26, y + 19, 6, 1, '#2a2e3a');
  drawSprite(g, x + 5, y + 3 + bobOf(s), s.id, motion && (frame + s.off) % 19 === 0);
}
function drawScene() {
  const ph = phase();
  for (let yy = 31; yy < 201; yy += 4) { const r = (yy - 31) / 4; R(0, yy, W, 4, r % 2 ? '#c08a55' : '#c8935a'); R(0, yy + 3, W, 1, '#a9784a'); for (let xx = (r * 7) % 16; xx < W; xx += 16) R(xx, yy, 1, 3, '#a9784a'); }
  R(0, 0, W, 31, '#3d5a73'); R(0, 0, W, 3, '#2c4257'); R(0, 28, W, 3, '#22324a');
  for (const x of [8, 148]) {
    R(x, 5, 36, 18, '#24364a'); R(x + 2, 7, 32, 14, ph.sky[0]); R(x + 2, 7, 32, 4, ph.sky[1]); R(x + 17, 7, 2, 14, '#24364a');
    if (ph.id === 'noche') { R(x + 6, 10, 1, 1, '#f3ead8'); R(x + 12, 14, 1, 1, '#f3ead8'); R(x + 23, 9, 1, 1, '#f3ead8'); R(x + 29, 15, 1, 1, '#f3ead8'); R(x + 26, 12, 2, 2, '#f3ead8'); }
    else R(x + 5, 9, 4, 1, '#ffffff');
    R(x - 2, 23, 40, 2, '#2c4257');
  }
  // Lempi, la gata de la oficina, duerme en la ventana.
  R(30, 19, 9, 4, '#e08a3c'); R(37, 17, 4, 4, '#e08a3c'); R(37, 16, 1, 1, '#e08a3c'); R(40, 16, 1, 1, '#e08a3c'); R(28, 21, 2, 1, '#e08a3c'); R(32, 20, 1, 1, '#c66f26'); R(35, 20, 1, 1, '#c66f26');
  R(58, 7, 76, 15, '#151827'); R(59, 8, 74, 13, '#2a2036'); R(58, 7, 76, 1, '#f2c14e'); R(58, 21, 76, 1, '#b8892f');
  const team = spots.filter((s) => s.kind === 'team'), provs = spots.filter((s) => s.kind === 'prov');
  team.forEach(cubicle);
  R(0, 201, W, H - 201, '#4d5873');
  for (let j = 0; j < 9; j++) for (let i = 0; i < 24; i++) if ((i + j) % 2) R(i * 8, 205 + j * 8, 8, 8, '#56627e');
  R(0, 201, 80, 4, '#9aa6b8'); R(112, 201, 80, 4, '#9aa6b8'); R(0, 201, 80, 1, '#cfd8e3'); R(112, 201, 80, 1, '#cfd8e3');
  provs.forEach(booth);
  if (ph.overlay) R(0, 0, W, H, ph.overlay);
  team.forEach((s) => { if (estadoDe(s) === 'idle') R(s.x + 3, s.y + 4, s.w - 6, s.h - 4, 'rgba(0,0,0,0.3)'); });
  if (ph.id === 'noche') {
    g.globalCompositeOperation = 'lighter';
    team.forEach((s) => { if (estadoDe(s) !== 'idle') { R(s.x + 8, s.y + 6, 32, 32, 'rgba(90,75,35,0.32)'); R(s.x + 12, s.y + 5, 20, 14, 'rgba(30,50,70,0.35)'); } });
    provs.forEach((s) => R(s.x + 18, s.y + 3, 22, 16, 'rgba(40,60,90,0.35)'));
    g.globalCompositeOperation = 'source-over';
    if (motion && frame % 8 < 5) { R(43, 12, 2, 1, '#f3ead8'); R(44, 13, 1, 1, '#f3ead8'); R(43, 14, 2, 1, '#f3ead8'); }
  }
  for (const s of team) {
    const st = estadoDe(s);
    if (st !== 'idle') {
      R(s.x + 15, s.y + 7, 14, 7, '#14202e'); bars(s.x + 17, s.y + 8, st, s.off);
      if (s.id === 'mano') { R(s.x + 32, s.y + 8, 7, 5, '#14202e'); R(s.x + 33, s.y + 9, 5, 1, '#f2c14e'); R(s.x + 33, s.y + 11, 3, 1, '#f2c14e'); }
    }
    bubble(s.x + 30, s.y + 21 - (st === 'bad' ? bobOf(s) : 0), st);
  }
  for (const s of provs) {
    const st = estadoDe(s), on = !(st === 'warn' && motion && frame % 4 >= 2);
    R(s.x + 23, s.y + 6, 12, 8, '#14202e'); R(s.x + 25, s.y + 8, 8, 4, on ? ST[st].c : '#3a2a14');
  }
}
const cv = $<HTMLCanvasElement>('office'), ctx = cv.getContext('2d')!;
let sc = 1;
function label(text: string, lx: number, ly: number, size: number, color: string, bold: boolean) {
  ctx.font = `${bold ? 600 : 400} ${size * sc}px "Pixelify Sans", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = sc * 1.3; ctx.strokeStyle = '#151827'; ctx.strokeText(text, lx * sc, ly * sc);
  ctx.fillStyle = color; ctx.fillText(text, lx * sc, ly * sc);
}
function draw() {
  if (!cv.width || !model) return;
  drawScene();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(low, 0, 0, cv.width, cv.height);
  ctx.font = `${3.8 * sc}px "Press Start 2P", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f2c14e';
  ctx.fillText('FANS RESERVE HQ', 96 * sc, 15 * sc);
  for (const s of spots) {
    const sel = s.id === selected;
    if (s.kind === 'team') {
      const a = agent(s.id)!;
      label(a.area.toUpperCase(), s.x + s.w / 2, s.y + 44.5, 6, sel ? '#f2c14e' : '#f3ead8', true);
      label(a.nombre, s.x + s.w / 2, s.y + 50.6, 4.6, sel ? '#f2c14e' : '#c9cde0', false);
    } else label(PROVS.find((p) => p.id === s.id)!.nombre, s.x + s.w / 2, s.y + 24.4, 4.6, sel ? '#f2c14e' : '#f3ead8', true);
  }
  label('SALA DE PROVEEDORES', 96, 208.6, 4.6, '#cfd8e3', true);
  const s = spots.find((x) => x.id === selected);
  if (s) {
    ctx.save(); ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = Math.max(2, sc * 0.9);
    ctx.setLineDash([2 * sc, 2 * sc]); ctx.lineDashOffset = motion ? -(frame % 4) * sc : 0;
    ctx.strokeRect((s.x + 0.5) * sc, (s.y + 0.5) * sc, (s.w - 1) * sc, (s.h - 1) * sc); ctx.restore();
  }
}
function resize() {
  const st = $('stage'); const aw = st.clientWidth - 16, ah = st.clientHeight - 16;
  if (aw <= 0 || ah <= 0) return;
  const cssW = Math.floor(Math.min(aw, (ah * W) / H)), cssH = Math.floor((cssW * H) / W);
  cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr); sc = cv.width / W; draw();
}
function hit(e: MouseEvent) {
  const r = cv.getBoundingClientRect();
  const lx = ((e.clientX - r.left) / r.width) * W, ly = ((e.clientY - r.top) / r.height) * H;
  return spots.find((a) => lx >= a.x && lx <= a.x + a.w && ly >= a.y && ly <= a.y + a.h) ?? null;
}
cv.addEventListener('click', (e) => { const s = hit(e); if (s) openSpot(s.id); });
cv.addEventListener('pointermove', (e) => { cv.style.cursor = hit(e) ? 'pointer' : 'default'; });

/* ---------- Piezas de HTML ---------- */
const sq = (st: Estado) => `<i class="sq" style="background:${ST[st].c}"></i>`;
const pill = (st: Estado, t?: string) => `<span class="pill">${sq(st)}${esc(t ?? ST[st].t)}</span>`;
function spark(s: Serie, color: string) {
  const vals = s.valores.map((v) => v ?? 0), mx = Math.max(...vals, 1);
  const total = vals.reduce((a, b) => a + b, 0), fmt = (v: number) => (s.dinero ? usd(v) : String(v));
  const bars = s.valores.map((v, i) => {
    const none = v === null, h = none ? 100 : v ? Math.max(8, Math.round((v / mx) * 100)) : 3;
    return `<div class="b${i === 6 ? ' last' : ''}${none ? ' none' : ''}"><i title="${esc(s.dias[i])}: ${none ? 'sin dato' : esc(fmt(v as number))}"><span style="height:${h}%;${i === 6 && !none ? 'background:' + color : ''}"></span></i><em>${esc(s.dias[i])}</em></div>`;
  }).join('');
  const hoy = s.valores[6];
  return `<h3>${esc(s.titulo.toUpperCase())}, ÚLTIMOS 7 DÍAS</h3><div class="spark" role="img" aria-label="${esc(s.titulo)} en los últimos 7 días">${bars}</div><p class="cap">Hoy: ${hoy === null ? 'sin dato' : esc(fmt(hoy))} · 7 días: ${esc(fmt(total))}</p>`;
}
function decisionBox(c: Caso) {
  return `<div class="decision" id="decision"><h3>TU DECISIÓN</h3><p class="q">${esc(c.pregunta)}</p><p>${esc(c.titulo)}.</p><p class="how">Dime tu sí o tu no en el chat con tu Mano derecha. Nada se mueve sin él.</p></div>`;
}
function caseCard(c: Caso, inSheet: boolean) {
  const a = agent(c.agent)!;
  let h = `<article class="case lvl-${c.nivel}" id="${inSheet ? 's-' : ''}case-${c.id}">`;
  h += `<div class="case-top"><span class="code">${c.id}</span><code>${esc(c.code)}</code>${inSheet ? '' : `<span>${esc(a.nombre)} · ${esc(a.area)}</span>`}</div>`;
  h += `<h4>${esc(c.titulo)}</h4>`;
  if (c.detalle) h += `<p>${esc(c.detalle)}</p>`;
  if (c.donde) h += `<p class="muted">Dónde: ${esc(c.donde)}</p>`;
  h += `<p class="hago"><b>Lo que hago:</b> ${esc(c.hago)}</p><p class="rule">${esc(c.regla)}</p>`;
  if (inSheet && model?.decision === c) h += decisionBox(c);
  else if (c.pregunta && c.grupo === 'cola') h += `<p class="muted">Te la traigo cuando resolvamos ${esc(model?.decision?.id ?? '')}.</p>`;
  h += `<div class="actions">${inSheet ? '' : `<button type="button" class="btn primary" data-open="${c.agent}" data-case="${c.id}">Ver ficha de ${esc(a.nombre)}</button>`}<a class="btn" href="${ADMIN}">Abrir en Admin ↗</a></div></article>`;
  return h;
}
function moneyBlock() {
  const m: Money = (live?.ahora?.[period] as Money | undefined) ?? {};
  const names = { ultima_hora: 'Última hora', hoy: 'Hoy', mes: 'Mes' } as const;
  let h = `<div class="seg" role="group" aria-label="Periodo">${(Object.keys(names) as (keyof typeof names)[]).map((k) => `<button type="button" data-period="${k}" aria-pressed="${k === period}">${names[k]}</button>`).join('')}</div>`;
  const pagos = Number(m.pagos) || 0;
  h += `<p class="cap">${pagos} ${pagos === 1 ? 'pago' : 'pagos'} · ${Number(m.fans_que_pagaron) || 0} fans</p>`;
  const r = (k: string, v: unknown, neg = false) => `<dt>${k}</dt><dd>${neg ? '-' : ''}${usd(v)}</dd>`;
  h += '<dl class="metrics" style="margin-top:10px">' + r('Cobrado', m.cobrado) + r('Comisión PayPal', m.comision_paypal) + r('Creadores (su parte del ' + term('neto', 'neto') + ')', m.creadores) +
    '<div class="sep"></div>' + r('Fans Reserve ' + term('isv', 'con ISV'), m.fr_con_isv) + r('ISV 15% (solo de Fans Reserve)', m.isv, true) + r('Fans Reserve ' + term('isv', 'sin ISV'), m.fr_sin_isv) +
    '<div class="sep"></div>' + r('Devuelto', m.devuelto) + r('En disputa', m.en_disputa) + r('Retiros pagados a creadores', m.retiros_pagados?.monto) + '</dl>';
  const parts: [number, string][] = [[Number(m.comision_paypal) || 0, '#8a8fa3'], [Number(m.creadores) || 0, '#3a7bbf'], [Number(m.fr_con_isv) || 0, '#f2c14e']];
  const total = parts.reduce((s, p) => s + Math.max(0, p[0]), 0);
  const pct = (v: number) => (total > 0 ? ((v / total) * 100).toFixed(1).replace('.0', '') + '%' : '—');
  h += `<div class="split" aria-hidden="true">${total > 0 ? parts.map((p) => (p[0] > 0 ? `<span style="flex:${p[0]};background:${p[1]}"></span>` : '')).join('') : ''}</div>`;
  h += `<div class="split-legend"><span>${'<i class="sq" style="background:#8a8fa3"></i>'}PayPal ${pct(parts[0][0])}</span><span><i class="sq" style="background:#3a7bbf"></i>Creadores ${pct(parts[1][0])}</span><span><i class="sq" style="background:#f2c14e"></i>Fans Reserve ${pct(parts[2][0])}</span></div>`;
  const q = cuadra(m);
  h += q.ok ? `<p class="okline">Cuadra: ${usd(m.comision_paypal)} + ${usd(m.creadores)} + ${usd(m.fr_con_isv)} = ${usd(m.cobrado)} ✓</p>`
    : `<p class="okline no">No cuadra por ${usd(Math.abs(q.diferencia))}: compáralo con Admin › Dinero › Todos los movimientos.</p>`;
  const din = agent('dinero');
  if (din?.serie) h += spark(din.serie, '#f2c14e');
  h += '<div class="rulecard"><b>La regla que hay que saberse.</b> Llamada de $25 → PayPal $1.65 → neto $23.35 → creador $16.35 → Fans Reserve $7.00 con ISV → ISV $1.05 → $5.95 sin ISV.</div>';
  return h;
}
const LINKS: Partial<Record<AgentId, [string, string][]>> = {
  dinero: [['Ver en modo lista (/control)', '/control']],
  disputas: [['Resolution Center de PayPal', 'https://www.paypal.com/resolutioncenter'], ['Manual 4 · alertas', MANUAL + '#4-qué-hacer-con-cada-alerta']],
  retiros: [['Manual 5 · ciclo y retiros', MANUAL + '#5-reglas-del-dinero']],
  personas: [['Manual 6 · cuentas', MANUAL + '#6-cuentas-abrir-verificar-suspender-y-cerrar']],
  contenido: [['Manual 7 · contenido', MANUAL + '#7-contenido-y-denuncias']],
  sistema: [['PRs en GitHub', 'https://github.com/carlosguzmanfunez/SugarFans/pulls'], ['/api/usage', '/api/usage']],
  legal: [['Manual 5 · reglas del dinero', MANUAL + '#5-reglas-del-dinero']],
  mano: [['Panel Mano derecha', ADMIN], ['Modo lista (/control)', '/control'], ['Manual de operación', MANUAL]],
};
const linksBlock = (ls?: [string, string][]) => (ls?.length ? `<div class="links">${ls.map((l) => `<a class="btn" href="${l[1]}"${l[1].startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(l[0])}${l[1].startsWith('http') ? ' ↗' : ''}</a>`).join('')}</div>` : '');

/* ---------- Ficha ---------- */
const sheet = $('sheet'), sheetBody = $('sheetBody'), backdrop = $('backdrop');
function fotoTxt() {
  const f = model?.foto;
  return f?.at ? `Revisión de las ${horaHN(f.at)} · hace ${f.minutos} min` : 'Sin revisiones guardadas';
}
function renderSheet() {
  if (!model) return;
  portrait($<HTMLCanvasElement>('sheetPt'), selected, 4);
  const prov = PROVS.find((p) => p.id === selected);
  if (prov) {
    $('sheetName').textContent = prov.nombre; $('sheetRole').textContent = 'Proveedor · ' + prov.para;
    let h = `<div class="meta">${pill(prov.estado, prov.estado === 'idle' ? 'Sin dato' : undefined)}<span>${esc(prov.resultado)}</span></div>`;
    if (prov.check) h += `<p class="note">Chequeo: <a href="${prov.check}">${prov.check}</a> (solo dice OK o FALTA; nunca muestra llaves).</p>`;
    if (prov.nota) h += `<p class="note">${esc(prov.nota)}</p>`;
    if (prov.quien) h += `<p class="note">${esc(prov.quien)}</p>`;
    sheetBody.innerHTML = h; return;
  }
  const a = agent(selected)!;
  $('sheetName').textContent = a.nombre; $('sheetRole').textContent = `${a.area} · ${a.rasgo}`;
  let h = `<p class="says">${esc(a.dice)}</p><div class="meta">${pill(a.estado)}<span>${esc(fotoTxt())}</span></div>`;
  if (a.id === 'mano') {
    const d = model.decision;
    if (d) h += decisionBox(d) + `<div class="actions" style="margin-top:8px"><button type="button" class="btn primary" data-open="${d.agent}" data-case="${d.id}">Ver ${d.id} con ${esc(agent(d.agent)!.nombre)}</button></div>`;
    h += '<h3>ASÍ ESTÁ CADA ÁREA</h3><div class="areas">' + model.agentes.filter((x) => x.id !== 'mano').map((x) =>
      `<button type="button" class="area" data-open="${x.id}">${sq(x.estado)}<b>${esc(x.area)}</b><span class="t">${esc(x.corto)}</span><span class="go">›</span></button>`).join('');
    const provAviso = PROVS.filter((p) => p.estado === 'bad' || p.estado === 'warn').length;
    h += `<button type="button" class="area" data-tab="proveedores">${sq(provAviso ? 'warn' : 'ok')}<b>Proveedores</b><span class="t">${PROVS.length} · ${provAviso ? provAviso + ' con aviso' : 'sin avisos'}</span><span class="go">›</span></button></div>`;
    for (const c of a.casos) h += caseCard(c, true);
    h += `<dl class="metrics" style="margin-top:14px">${a.numeros.map((n) => `<dt>${esc(n[0])}</dt><dd>${esc(n[1])}</dd>`).join('')}<dt>Próximo reporte</dt><dd>${esc(model.proximoReporte)}</dd></dl>`;
    const rep = live?.reportes?.[0];
    if (rep) h += `<h3>ÚLTIMO REPORTE</h3><details class="rep"><summary>${esc(rep.title)}</summary><pre>${esc(rep.body)}</pre></details>`;
    h += `<p class="note">${esc(a.nota)}</p><h3>ATAJOS</h3>${linksBlock(LINKS.mano)}`;
    sheetBody.innerHTML = h; return;
  }
  for (const c of a.casos) h += caseCard(c, true);
  if (a.id === 'dinero') h += '<h3>DINERO</h3>' + moneyBlock();
  if (a.id === 'retiros') {
    const cal = model.calendario;
    h += `<h3>CALENDARIO DE PAGOS</h3><div class="cal"><div class="${cal.fase === 0 ? 'now' : ''}"><b>26</b>Crédito</div><div class="${cal.fase === 1 ? 'now' : ''}"><b>26–1</b>Retiros</div><div class="${cal.fase === 2 ? 'now' : ''}"><b>2</b>Cierre</div></div><p class="cap">${esc(cal.texto)} Ver ${term('ciclo', 'ciclo de pagos')}. Un retiro ${term('incierto', 'incierto')} nunca se reenvía.</p>`;
  }
  if (a.vigila.length) h += `<h3>ALERTAS QUE VIGILO</h3><div class="watch">${a.vigila.map((w) => `<span class="w ${w.n ? w.nivel : ''}"><code>${esc(w.code)}</code><b>${w.n ? w.n : '✓'}</b></span>`).join('')}</div>`;
  if (a.numeros.length && a.id !== 'dinero') h += `<h3>${a.id === 'legal' ? 'REGLAS DEL MANUAL' : 'NÚMEROS'}</h3><dl class="metrics">${a.numeros.map((n) => `<dt>${esc(n[0])}</dt><dd>${esc(n[1])}</dd>`).join('')}</dl>`;
  if (a.serie && a.id !== 'dinero') h += spark(a.serie, ST[a.estado === 'idle' ? 'ok' : a.estado].c);
  if (a.id === 'disputas' && a.casos.length) h += `<p class="note">Al responder una disputa se arma el ${term('expediente', 'expediente')} y se decide quién paga el cargo del ${term('contracargo', 'contracargo')}.</p>`;
  h += `<p class="note">${esc(a.nota)}</p>`;
  if (LINKS[a.id]) h += '<h3>ENLACES</h3>' + linksBlock(LINKS[a.id]);
  sheetBody.innerHTML = h;
}
let sheetState: 'closed' | 'half' | 'full' = 'closed';
function sheetPos(st: typeof sheetState) { const h = sheet.offsetHeight, vh = window.innerHeight; return st === 'full' ? 0 : st === 'half' ? Math.max(0, h - vh * 0.56) : h + 30; }
function setSheet(st: typeof sheetState, instant = false) {
  if (desktop.matches) { sheet.style.transform = ''; sheet.setAttribute('aria-hidden', 'false'); backdrop.classList.remove('on'); sheetState = 'full'; return; }
  sheetState = st;
  sheet.style.transition = instant ? 'none' : '';
  sheet.style.transform = `translateY(${sheetPos(st)}px)`;
  sheet.setAttribute('aria-hidden', st === 'closed' ? 'true' : 'false');
  backdrop.classList.toggle('on', st === 'full');
}
function openSpot(id: string, caseId?: string) {
  selected = id; renderSheet(); draw();
  if (!desktop.matches && (sheetState === 'closed' || caseId)) setSheet(caseId ? 'full' : 'half');
  sheetBody.scrollTop = 0;
  if (caseId) {
    const el = document.getElementById('s-case-' + caseId) ?? document.getElementById('decision');
    if (el) setTimeout(() => { sheetBody.scrollTop = el.offsetTop - sheetBody.offsetTop - 8; }, desktop.matches ? 0 : 300);
  }
}
(() => {
  const grab = $('grab'); let y0 = 0, p0 = 0, t0 = 0, dragging = false, moved = false;
  grab.addEventListener('pointerdown', (e) => {
    if (desktop.matches || (e.target as HTMLElement).closest('button')) return;
    dragging = true; moved = false; y0 = e.clientY; p0 = sheetPos(sheetState); t0 = Date.now();
    grab.setPointerCapture(e.pointerId); sheet.style.transition = 'none';
  });
  grab.addEventListener('pointermove', (e) => { if (!dragging) return; const dy = e.clientY - y0; if (Math.abs(dy) > 4) moved = true; sheet.style.transform = `translateY(${Math.max(0, p0 + dy)}px)`; });
  const end = (e: PointerEvent) => {
    if (!dragging) return; dragging = false; sheet.style.transition = '';
    const dy = e.clientY - y0, v = dy / Math.max(1, Date.now() - t0);
    if (!moved) { setSheet(sheetState === 'full' ? 'half' : 'full'); return; }
    if (dy > 70 || v > 0.6) setSheet(sheetState === 'full' ? 'half' : 'closed');
    else if (dy < -50 || v < -0.6) setSheet('full');
    else setSheet(sheetState);
  };
  grab.addEventListener('pointerup', end); grab.addEventListener('pointercancel', end);
  sheetBody.addEventListener('scroll', () => { if (!desktop.matches && sheetState === 'half' && sheetBody.scrollTop > 10) setSheet('full'); });
})();

/* ---------- Vistas ---------- */
const GRUPOS: [Caso['grupo'], string][] = [['tu', 'Necesita tu sí ahora'], ['cola', 'En cola para tu sí'], ['proceso', 'Lo estamos trabajando'], ['info', 'Solo para que sepas']];
function renderPend() {
  if (!model) return;
  let h = '<div class="pad"><h2>Pendientes</h2><p class="sub">Lo urgente primero. Cada caso trae su código, lo que ya revisamos y el siguiente paso.</p>';
  if (!model.casos.length) h += '<p class="empty">Todo en orden: no hay casos abiertos ahora mismo.</p>';
  for (const [k, t] of GRUPOS) {
    const list = model.casos.filter((c) => c.grupo === k);
    if (list.length) h += `<div class="grp"><h3>${t.toUpperCase()} (${list.length})</h3>${list.map((c) => caseCard(c, false)).join('')}</div>`;
  }
  $('v-pendientes').innerHTML = h + '</div>';
}
function renderMoney() {
  $('v-dinero').innerHTML = `<div class="pad"><h2>Dinero</h2><p class="sub">Beto revisa que el reparto cuadre. Toca una palabra subrayada para ver qué significa.</p><div>${moneyBlock()}</div><div class="actions"><button type="button" class="btn" data-open="dinero">Ver ficha de Beto</button><a class="btn" href="/control">Modo lista (/control)</a></div></div>`;
}
function renderProv() {
  const sup = PROVS.find((p) => p.id === 'supabase')!;
  if (live) { sup.estado = 'ok'; sup.resultado = 'Conectado: la oficina lee de aquí'; }
  const rank: Record<Estado, number> = { bad: 0, warn: 1, ok: 2, idle: 3 };
  const list = PROVS.slice().sort((a, b) => rank[a.estado] - rank[b.estado]);
  $('v-proveedores').innerHTML = `<div class="pad"><h2>Proveedores</h2><p class="sub">Los 8 servicios de los que depende Fans Reserve, con su chequeo y quién los toca.</p>${list.map((p) =>
    `<button type="button" class="prov" data-open="${p.id}"><div class="prov-top"><b>${esc(p.nombre)}</b>${pill(p.estado, p.estado === 'idle' ? 'Sin dato' : undefined)}</div><p class="muted">${esc(p.para)}</p><p>${esc(p.resultado)}</p>${p.nota ? `<p class="warnnote">${esc(p.nota)}</p>` : ''}</button>`).join('')}</div>`;
}
function renderTop() {
  if (!model) return;
  const d = model.decision, abiertos = model.casos.filter((c) => c.grupo !== 'info').length;
  const strip = $('strip'); strip.hidden = false;
  strip.className = 'strip ' + (model.estado === 'bad' ? '' : model.estado === 'warn' ? 'warn' : 'ok');
  strip.innerHTML = `${sq(model.estado)}<span><b>${ST[model.estado].t}</b> · ${d ? `1 decisión: ${esc(d.id)} · ${esc(d.titulo)}` : abiertos ? `${abiertos} en proceso, nada que decidir` : 'Todo en orden'}<small>${esc(fotoTxt())}</small></span><span class="go">VER ›</span>`;
  const badge = $('badge'); badge.hidden = !abiertos; badge.textContent = String(abiertos);
  $('greetText').innerHTML = `<b>Sofía:</b> ${esc(agent('mano')!.dice)} Toca a cualquiera de nosotros para ver qué hizo.`;
  const n = { auto: 'Auto', dia: 'Día', tarde: 'Tarde', noche: 'Noche' } as Record<string, string>;
  const lb = $('lightBtn'); lb.hidden = false; lb.textContent = 'Luz: ' + n[lightMode] + (lightMode === 'auto' ? ` (${n[phase().id].toLowerCase()})` : '');
}
function renderAll() {
  if (!live) return;
  model = buildOffice(live);
  renderTop(); renderPend(); renderMoney(); renderProv(); renderSheet(); draw();
}
function setTab(t: string) {
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false'));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + t));
  $('main').scrollTop = 0;
  if (t === 'oficina') requestAnimationFrame(resize);
  if (t === 'proveedores') checkProviders();
  if (!desktop.matches && sheetState !== 'closed') setSheet('closed');
}

/* ---------- Llave y datos ---------- */
function setLive(on: boolean, text: string) { $('live').className = 'live' + (on ? '' : ' off'); $('liveText').textContent = text; }
function showLogin(msg?: string) {
  document.querySelector('.app')!.classList.add('locked');
  $('login').hidden = false; $('tabs').hidden = true; $('strip').hidden = true; $('lightBtn').hidden = true; sheet.hidden = true;
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('on'));
  $('loginErr').hidden = !msg; $('loginErr').textContent = msg ?? '';
  setLive(false, 'Sin conectar');
  portrait($<HTMLCanvasElement>('loginPt'), 'mano', 4);
}
let shown = false;
function showOffice() {
  document.querySelector('.app')!.classList.remove('locked');
  $('login').hidden = true; $('tabs').hidden = false; sheet.hidden = false;
  if (!shown) {
    shown = true;
    setTab('oficina');
    setSheet(desktop.matches ? 'full' : 'closed', true);
    portrait($<HTMLCanvasElement>('greetPt'), 'mano', 2);
    checkProviders();
  }
}
function keyFromLink() {
  const k = new URLSearchParams(location.hash.slice(1)).get('k');
  if (!k) return false;
  store.set(K_STORE, k.trim());
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* nada */ }
  return true;
}
function fetchLive(key: string): Promise<MonitorLive | null> {
  if (!SB_URL || !SB_KEY) return Promise.reject(new Error('config'));
  return fetch(SB_URL + '/rest/v1/rpc/monitor_live', {
    method: 'POST', cache: 'no-store',
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key: key }),
  }).then((r) => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); });
}
function load(first: boolean) {
  const key = store.get(K_STORE);
  if (!key) { showLogin(); return; }
  fetchLive(key).then((d) => {
    if (!d) { store.del(K_STORE); store.del(D_STORE); live = null; showLogin('Esa llave no sirve o fue revocada. Crea una nueva en el panel.'); return; }
    live = d; (live as MonitorLive & { _fetched?: string })._fetched = new Date().toISOString();
    store.set(D_STORE, JSON.stringify(live));
    $('offline').hidden = true; setLive(true, 'En vivo');
    showOffice(); renderAll(); if (first) requestAnimationFrame(resize);
  }).catch((e: Error) => {
    const cached = store.get(D_STORE);
    if (cached && (first || !live)) { try { live = JSON.parse(cached); } catch { /* copia dañada */ } }
    if (live) {
      showOffice(); renderAll();
      const at = (live as MonitorLive & { _fetched?: string })._fetched ?? live.ahora.at;
      $('offline').hidden = false;
      $('offline').textContent = e.message === 'config' ? 'Esta copia no tiene la dirección de la base. Abre fansreserve.com/oficina.' : `Sin conexión: mostrando lo último que se cargó (${ago(at)}).`;
      setLive(false, 'Sin conexión');
      if (first) requestAnimationFrame(resize);
    } else showLogin(e.message === 'config' ? 'Esta copia no tiene la dirección de la base. Abre fansreserve.com/oficina.' : 'No pudimos conectar. Revisa el internet y vuelve a intentar.');
  });
}

/* ---------- Eventos ---------- */
document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const tm = t.closest<HTMLElement>('[data-term]');
  if (tm) { const gl = GLOS[tm.dataset.term!]; $('popT').textContent = gl[0]; $('popD').textContent = gl[1]; $('pop').classList.add('on'); return; }
  const o = t.closest<HTMLElement>('[data-open]');
  if (o) { openSpot(o.dataset.open!, o.dataset.case); return; }
  const tb = t.closest<HTMLElement>('[data-tab]');
  if (tb) { setTab(tb.dataset.tab!); return; }
  const pr = t.closest<HTMLElement>('[data-period]');
  if (pr) { period = pr.dataset.period as typeof period; renderMoney(); if (selected === 'dinero') renderSheet(); }
});
$('strip').addEventListener('click', () => { const d = model?.decision; if (d) openSpot(d.agent, d.id); else openSpot('mano'); });
$('sheetClose').addEventListener('click', () => setSheet('closed'));
backdrop.addEventListener('click', () => setSheet('half'));
$('popClose').addEventListener('click', () => $('pop').classList.remove('on'));
$('greetClose').addEventListener('click', () => { $('greet').hidden = true; resize(); });
$('lightBtn').addEventListener('click', () => {
  const order = ['auto', 'dia', 'tarde', 'noche'] as const;
  lightMode = order[(order.indexOf(lightMode) + 1) % 4]; store.set('fr-oficina-luz', lightMode); renderTop(); draw();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('pop').classList.remove('on'); if (!desktop.matches && sheetState !== 'closed') setSheet('closed'); } });
$<HTMLFormElement>('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const k = $<HTMLInputElement>('keyInput').value.trim();
  if (!/^frc_[0-9a-f]{64}$/.test(k)) { showLogin('La llave empieza con frc_ y tiene 68 caracteres. Cópiala completa del panel.'); return; }
  store.set(K_STORE, k); $<HTMLInputElement>('keyInput').value = ''; load(true);
});
window.addEventListener('hashchange', () => { if (keyFromLink()) load(true); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(false); });
new ResizeObserver(() => { resize(); if (!desktop.matches) setSheet(sheetState, true); }).observe($('stage'));
window.addEventListener('resize', () => { resize(); setSheet(desktop.matches ? 'full' : sheetState, true); });
desktop.addEventListener('change', () => setSheet(desktop.matches ? 'full' : 'closed', true));
document.fonts?.ready.then(draw);
if (motion) setInterval(() => { if (document.hidden || !$('v-oficina').classList.contains('on')) return; frame++; draw(); }, 280);
setInterval(() => { if (!document.hidden) load(false); }, 60000);

keyFromLink();
load(true);
