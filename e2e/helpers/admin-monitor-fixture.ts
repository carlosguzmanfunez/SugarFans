// Fictional "Mano derecha" data, bundled only by e2e/admin-monitor-ui.mjs.
import type { MonitorData, MonitorMoney, MonitorProblem, MonitorSnapshot } from '../../src/lib/adminMonitor';

const scenario = new URLSearchParams(location.search).get('s') ?? 'alert';
export const calls: string[] = [];

const money = (cobrado: number, pagos: number): MonitorMoney => {
  const fee = Math.round((cobrado * 0.054 + pagos * 0.3) * 100) / 100;
  const creadores = Math.round((cobrado - fee) * 0.7 * 100) / 100;
  const fr = Math.round((cobrado - fee - creadores) * 100) / 100;
  const isv = Math.round(fr * 0.15 * 100) / 100;
  return {
    cobrado, comision_paypal: fee, creadores, fr_con_isv: fr, isv, fr_sin_isv: Math.round((fr - isv) * 100) / 100,
    pagos, fans_que_pagaron: Math.max(0, pagos - 1), devuelto: scenario === 'alert' ? 12.5 : 0, en_disputa: scenario === 'alert' ? 25 : 0,
    por_tipo: {
      reserve: { n: Math.round(pagos * 0.4), monto: Math.round(cobrado * 0.55 * 100) / 100 },
      suscripciones: { n: Math.round(pagos * 0.3), monto: Math.round(cobrado * 0.25 * 100) / 100 },
      creditos: { n: Math.round(pagos * 0.2), monto: Math.round(cobrado * 0.15 * 100) / 100 },
      propinas: { n: Math.round(pagos * 0.1), monto: Math.round(cobrado * 0.05 * 100) / 100 },
      regalos: { n: 3, monto: 9 },
    },
    retiros_pagados: { n: 2, monto: 140 }, personas_nuevas: 14, creadores_verificados: 2,
    reservas_nuevas: 6, reservas_pagadas: 4, errores_pagina: scenario === 'alert' ? 5 : 0,
  };
};

const problems: MonitorProblem[] = scenario === 'alert' ? [
  { code: 'disputas', nivel: 'alta', n: 1, titulo: '1 disputa abierta ($25.00)', donde: 'Dinero > Pagos a creadores' },
  { code: 'devoluciones', nivel: 'media', n: 1, titulo: '1 devolución por terminar ($12.50)', donde: 'Dinero > Retiros y devoluciones' },
  { code: 'errores_web', nivel: 'baja', n: 5, titulo: '5 fallos al navegar', donde: 'Estado del servicio > Problemas de la página' },
] : [];

const now = Date.now();
const hourly = [0, 0, 0, 0, 0, 0, 25, 0, 9.99, 34.99, 0, 25, 60, 19.99, 0, 25, 49.98, 9.99, 0, 25, 34.99, 0, 15.99, 25];
let today = 0;
const snaps: MonitorSnapshot[] = hourly.map((c, i) => {
  today += c;
  return {
    at: new Date(now - (23 - i) * 3600e3).toISOString(), dia: new Date(now - 6 * 3600e3).toISOString().slice(0, 10),
    ultima_hora: money(c, c ? Math.max(1, Math.round(c / 20)) : 0), hoy: money(Math.round(today * 100) / 100, 16),
    mes: money(2481.4, 131), problemas: problems,
    pendiente: { retiros_enviandose: 1, reserve_por_responder: 3, reserve_confirmadas_proximas: 7 },
  };
});

const days = Array.from({ length: 7 }, (_, i) => {
  const day = new Date(now - 6 * 3600e3 - i * 86400e3).toISOString().slice(0, 10);
  const c = [today, 412.6, 288.3, 351.9, 199.7, 466.2, 310.4][i];
  return { day, closed: i > 0, updatedAt: new Date().toISOString(), data: { dinero: money(Math.round(c * 100) / 100, 20 + i), problemas: i === 2 ? problems : [] } };
});

const report = (kind: 'midday' | 'midnight', hoursAgo: number, title: string) => ({
  id: `r-${kind}`, kind, day: days[0].day, title, body: '', createdAt: new Date(now - hoursAgo * 3600e3).toISOString(),
  windowFrom: new Date(now - (hoursAgo + 12) * 3600e3).toISOString(), windowTo: new Date(now - hoursAgo * 3600e3).toISOString(),
  emailedAt: new Date(now - hoursAgo * 3600e3).toISOString(), emailError: null,
  data: { dinero: money(kind === 'midday' ? 186.47 : 412.6, 12), mes: money(2481.4, 131), problemas: kind === 'midday' ? problems : [] },
});

const data: MonitorData = scenario === 'empty'
  ? { hours: [], days: [], reports: [] }
  : {
      hours: snaps.map((d) => ({ takenAt: d.at, kind: 'hourly' as const, data: d })).reverse(),
      days,
      reports: [report('midday', 2, 'Reporte de mediodía · 07/11/2026'), report('midnight', 14, 'Cierre del día · 06/11/2026')],
    };

export const backend = {
  mode: 'local',
  onChange: () => () => {},
  monitor: async () => { await new Promise((r) => setTimeout(r, 50)); return data; },
  monitorRefresh: async () => { calls.push('refresh'); await new Promise((r) => setTimeout(r, 300)); return null; },
};
