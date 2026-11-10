// "Mano derecha": the hourly money/problem snapshots, the daily ledger and the
// 12 AM / 12 PM Honduras reports the database writes (20261107210000_monitor_mano_derecha.sql).
// Read-only: nothing here moves money.

export interface MonitorMoney {
  cobrado: number; comision_paypal: number; creadores: number;
  fr_con_isv: number; isv: number; fr_sin_isv: number;
  pagos: number; fans_que_pagaron: number; devuelto: number; en_disputa: number;
  por_tipo: Record<'reserve' | 'suscripciones' | 'propinas' | 'creditos' | 'regalos', { n: number; monto: number }>;
  retiros_pagados: { n: number; monto: number };
  personas_nuevas: number; creadores_verificados: number;
  reservas_nuevas: number; reservas_pagadas: number; errores_pagina: number;
}

export interface MonitorProblem {
  code: string; nivel: 'alta' | 'media' | 'baja'; n: number; titulo: string; donde?: string; detalle?: string;
}

export interface MonitorSnapshot {
  at: string; dia: string;
  ultima_hora: MonitorMoney; hoy: MonitorMoney; mes: MonitorMoney;
  problemas: MonitorProblem[];
  pendiente: { retiros_enviandose: number; reserve_por_responder: number; reserve_confirmadas_proximas: number };
}

export interface MonitorHour { takenAt: string; kind: 'hourly' | 'manual' | 'report'; data: MonitorSnapshot }
export interface MonitorDay { day: string; closed: boolean; updatedAt: string; data: { dinero: MonitorMoney; problemas: MonitorProblem[] } }
export interface MonitorReport {
  id: string; kind: 'midday' | 'midnight'; day: string; title: string; body: string; createdAt: string;
  windowFrom: string; windowTo: string; emailedAt: string | null; emailError: string | null;
  data: { dinero: MonitorMoney; mes?: MonitorMoney; problemas: MonitorProblem[] };
}

// Private keys for the phone control page (/control). The key itself is shown once.
export interface MonitorKey { id: string; label: string; createdAt: string; lastUsedAt: string | null; uses: number }
export interface MonitorNewKey { id: string; label: string; key: string }

// Link that opens the phone page with the key already in place. The key travels after
// "#", so it never reaches any server, and the page removes it from the address bar.
export const controlLink = (key: string, origin = location.origin) => `${origin}/control#k=${encodeURIComponent(key)}`;

export interface MonitorData {
  hours: MonitorHour[];
  days: MonitorDay[];
  reports: MonitorReport[];
}

export const usd = (n: number | undefined) =>
  `${(n ?? 0) < 0 ? '-' : ''}$${Math.abs(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const LEVEL_ORDER = { alta: 0, media: 1, baja: 2 } as const;
export const sortProblems = (list: MonitorProblem[] = []) => [...list].sort((a, b) => LEVEL_ORDER[a.nivel] - LEVEL_ORDER[b.nivel]);

// Which admin section solves each problem ("Abrir" button).
export const PROBLEM_SECTION: Record<string, string> = {
  disputas: 'finance', incidentes: 'finance', avisos_finanzas: 'finance',
  reserve_disputa: 'attendance', reserve_sin_respuesta: 'attendance',
  retiros_fallidos: 'payouts', retiros_atascados: 'payouts', devoluciones: 'payouts',
  pagos_fallidos: 'errors', correos: 'errors', errores_servidor: 'errors', errores_web: 'errors', pagos_sin_terminar: 'errors',
  denuncias: 'reports', verificaciones: 'verifications',
};

// Next 12:00 (a. m. or p. m.) in Honduras (UTC-6 all year).
export const nextReport = (now = new Date()) => {
  const hn = new Date(now.getTime() - 6 * 3600 * 1000);
  const h = hn.getUTCHours();
  const next = new Date(Date.UTC(hn.getUTCFullYear(), hn.getUTCMonth(), hn.getUTCDate(), h < 12 ? 12 : 24) + 6 * 3600 * 1000);
  return { at: next, kind: h < 12 ? 'midday' as const : 'midnight' as const, minutes: Math.max(0, Math.round((next.getTime() - now.getTime()) / 60000)) };
};

export const ago = (iso: string, now = Date.now()) => {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'hace un momento';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `hace ${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `hace ${Math.floor(h / 24)} d`;
};
