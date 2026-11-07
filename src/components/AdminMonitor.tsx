import React, { useEffect, useMemo, useState } from 'react';
import { backend } from '../lib/backend';
import { usePlatformQuery } from '../lib/platform';
import AdminDataState from './AdminDataState';
import { adminDate } from '../lib/adminWorkspace';
import {
  PROBLEM_SECTION, ago, nextReport, sortProblems, usd,
  type MonitorData, type MonitorDay, type MonitorHour, type MonitorMoney, type MonitorProblem, type MonitorReport,
} from '../lib/adminMonitor';
import { SPLIT_COLORS, monitorReportEmail, moneySplit, overallStatus } from '../lib/monitorReportEmail';

// Validated categorical slot 1 (single series: money collected per hour).
const BAR = SPLIT_COLORS.creadores;

const LEVEL = {
  alta: { text: 'Urgente', pill: 'bg-red-50 text-red-700', dot: 'bg-red-500', icon: 'fa-circle-exclamation' },
  media: { text: 'Revisar', pill: 'bg-amber-100 text-amber-800', dot: 'bg-amber-400', icon: 'fa-triangle-exclamation' },
  baja: { text: 'Info', pill: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400', icon: 'fa-circle-info' },
} as const;

const TONE = {
  ok: { band: 'from-emerald-600 to-emerald-700', icon: 'fa-circle-check', title: 'Todo en orden' },
  media: { band: 'from-amber-500 to-amber-600', icon: 'fa-triangle-exclamation', title: 'Hay cosas por revisar' },
  alta: { band: 'from-red-600 to-red-700', icon: 'fa-circle-exclamation', title: 'Necesita tu atención' },
} as const;

const hnHour = (iso: string) => {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Tegucigalpa', hour: 'numeric', hourCycle: 'h23' }).format(new Date(iso))) % 24;
  return `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
};
const hnHourMin = (iso: string) => new Intl.DateTimeFormat('es-HN', { timeZone: 'America/Tegucigalpa', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const dayLabel = (day: string) => new Intl.DateTimeFormat('es-HN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${day}T00:00:00Z`));
const inMinutes = (min: number) => (min < 60 ? `en ${min} min` : `en ${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`);

const Card = ({ title, hint, children, testId, right }: { title: string; hint?: string; children: React.ReactNode; testId?: string; right?: React.ReactNode }) => (
  <section className="bg-white rounded-2xl shadow-sm p-4 sm:p-6" data-testid={testId}>
    <div className="flex items-start justify-between gap-3 mb-4">
      <div>
        <h3 className="font-bold text-gray-900">{title}</h3>
        {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
      </div>
      {right}
    </div>
    {children}
  </section>
);

// Status band: overall state, live indicator, last check, next report and refresh.
const StatusHero = ({ problems, latest, refreshing, onRefresh, now }: {
  problems: MonitorProblem[]; latest?: MonitorHour; refreshing: boolean; onRefresh: () => void; now: number;
}) => {
  const status = overallStatus(problems);
  const tone = TONE[status.tone];
  const next = nextReport(new Date(now));
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${tone.band} text-white p-5 sm:p-6 shadow-sm`} data-testid="monitor-status">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="w-11 h-11 shrink-0 rounded-xl bg-white/15 flex items-center justify-center text-xl">
            <i aria-hidden="true" className={`fas ${tone.icon}`}></i>
          </span>
          <div>
            <p className="text-xs uppercase tracking-wider text-white/75">Mano derecha</p>
            <h2 className="text-xl sm:text-2xl font-bold leading-tight">{latest ? (status.tone === 'ok' ? tone.title : status.text) : 'Preparando la primera revisión'}</h2>
            <p className="text-sm text-white/85 mt-1 flex items-center gap-2" data-testid="monitor-updated">
              <span className="relative flex w-2 h-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 motion-safe:animate-ping"></span>
                <span className="relative inline-flex w-2 h-2 rounded-full bg-white"></span>
              </span>
              {latest ? `En vivo · revisado ${ago(latest.takenAt, now)}` : 'La primera revisión llega en la próxima hora'}
            </p>
          </div>
        </div>
        <button type="button" onClick={onRefresh} disabled={refreshing}
          className="self-start sm:self-center px-4 py-2 rounded-full text-sm font-semibold bg-white text-gray-900 hover:bg-white/90 disabled:opacity-70" data-testid="monitor-refresh">
          <i aria-hidden="true" className={`fas fa-rotate mr-1.5 ${refreshing ? 'animate-spin' : ''}`}></i>{refreshing ? 'Revisando…' : 'Actualizar ahora'}
        </button>
      </div>
      <div className="mt-4 pt-4 border-t border-white/20 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
        <p><i aria-hidden="true" className={`fas ${next.kind === 'midday' ? 'fa-sun' : 'fa-moon'} mr-1.5 text-white/80`}></i>
          Próximo reporte: <strong>{next.kind === 'midday' ? '12:00 p. m.' : '12:00 a. m.'}</strong> {inMinutes(next.minutes)}</p>
        <p><i aria-hidden="true" className="fas fa-clock mr-1.5 text-white/80"></i>Revisa sola cada hora, en el minuto 5</p>
        <p><i aria-hidden="true" className="fas fa-lock mr-1.5 text-white/80"></i>Solo lee: no mueve dinero</p>
      </div>
    </div>
  );
};

const Attention = ({ problems, onOpen }: { problems: MonitorProblem[]; onOpen?: (section: string) => void }) =>
  problems.length === 0 ? (
    <p className="text-sm text-emerald-800 bg-emerald-50 rounded-xl p-4" data-testid="monitor-ok">
      <i aria-hidden="true" className="fas fa-circle-check mr-1.5"></i>Sin disputas, retiros fallidos, incidentes ni errores del servidor.
    </p>
  ) : (
    <ul className="divide-y divide-gray-100 -my-2" data-testid="monitor-problems">
      {sortProblems(problems).map((p) => {
        const l = LEVEL[p.nivel];
        const section = PROBLEM_SECTION[p.code];
        return (
          <li key={p.code} className="py-3 flex items-start gap-3">
            <span className={`shrink-0 mt-0.5 text-[11px] font-bold px-2 py-0.5 rounded-full ${l.pill}`}>
              <i aria-hidden="true" className={`fas ${l.icon} mr-1`}></i>{l.text}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">{p.titulo}</p>
              {(p.donde || p.detalle) && <p className="text-xs text-gray-500 mt-0.5">{[p.donde, p.detalle].filter(Boolean).join(' · ')}</p>}
            </div>
            {section && onOpen && (
              <button type="button" onClick={() => onOpen(section)} className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50">
                Abrir
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );

// Where the money went: one stacked bar with 2px gaps, legend with values.
const SplitBar = ({ m }: { m: MonitorMoney }) => {
  const split = moneySplit(m);
  return (
    <div>
      <div className="flex gap-0.5 h-3 rounded-full overflow-hidden bg-gray-100" role="img"
        aria-label={split.parts.map((p) => `${p.label} ${usd(p.value)}`).join(', ')}>
        {split.total > 0 && split.parts.filter((p) => p.pct > 0).map((p) => (
          <span key={p.key} title={`${p.label}: ${usd(p.value)} (${p.pct.toFixed(0)}%)`} className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${p.pct}%`, background: SPLIT_COLORS[p.key] }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-3 gap-2">
        {split.parts.map((p) => (
          <li key={p.key} className="text-xs text-gray-500">
            <span className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle" style={{ background: SPLIT_COLORS[p.key] }} aria-hidden="true" />{p.label}
            <span className="block text-sm font-semibold text-gray-900">{usd(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const Tile = ({ icon, label, value, hint, tone = 'bg-gray-100 text-gray-600' }: { icon: string; label: string; value: string; hint?: string; tone?: string }) => (
  <div className="rounded-xl border border-gray-100 p-3 sm:p-4">
    <span className={`w-8 h-8 rounded-lg inline-flex items-center justify-center text-sm ${tone}`}><i aria-hidden="true" className={`fas ${icon}`}></i></span>
    <p className="text-lg sm:text-xl font-bold text-gray-900 mt-2">{value}</p>
    <p className="text-xs font-medium text-gray-700">{label}</p>
    {hint && <p className="text-[11px] text-gray-500">{hint}</p>}
  </div>
);

const Today = ({ m, month }: { m: MonitorMoney; month: MonitorMoney }) => (
  <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
    <div className="lg:col-span-2 rounded-xl bg-gray-900 text-white p-5" data-testid="monitor-profit">
      <p className="text-xs uppercase tracking-wider text-gray-400">Ganancia de Fans Reserve hoy</p>
      <p className="text-3xl sm:text-4xl font-bold mt-1">{usd(m.fr_con_isv)} <span className="text-sm font-normal text-gray-400">con ISV</span></p>
      <p className="text-sm text-gray-300 mt-1">{usd(m.fr_sin_isv)} sin ISV · ISV 15%: {usd(m.isv)}</p>
      <div className="mt-5 pt-4 border-t border-white/10 text-sm text-gray-300">
        Mes: <strong className="text-white">{usd(month.fr_con_isv)}</strong> con ISV · {usd(month.fr_sin_isv)} sin ISV
        <span className="block text-xs text-gray-400 mt-0.5">Cobrado en el mes: {usd(month.cobrado)}</span>
      </div>
    </div>
    <div className="lg:col-span-3 space-y-4">
      <div>
        <p className="text-sm text-gray-600 mb-2">Así se repartieron <strong className="text-gray-900">{usd(m.cobrado)}</strong> cobrados hoy</p>
        <SplitBar m={m} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile icon="fa-arrow-down" tone="bg-blue-50 text-blue-600" label="Cobrado" value={usd(m.cobrado)} hint={`${m.pagos} pagos · ${m.fans_que_pagaron} fans`} />
        <Tile icon="fa-money-bill-transfer" tone="bg-purple-50 text-purple-600" label="Retiros pagados" value={usd(m.retiros_pagados.monto)} hint={`${m.retiros_pagados.n} retiros`} />
        <Tile icon="fa-rotate-left" label="Devuelto" value={usd(m.devuelto)} />
        <Tile icon="fa-scale-balanced" tone={m.en_disputa > 0 ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600'} label="En disputa" value={usd(m.en_disputa)} />
      </div>
    </div>
  </div>
);

// Money collected in each of the last 24 hourly checks (one series, one hue).
const HourlyChart = ({ hours, now }: { hours: MonitorHour[]; now: number }) => {
  const points = useMemo(() => hours.filter((h) => h.kind === 'hourly' && now - new Date(h.takenAt).getTime() < 24 * 3600 * 1000).slice(0, 24).reverse(), [hours, now]);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...points.map((p) => p.data.ultima_hora.cobrado), 0);
  if (points.length === 0) return <p className="text-sm text-gray-500">Aquí verás cada hora en cuanto lleguen las primeras revisiones.</p>;
  const active = hover == null ? null : points[hover];
  return (
    <div>
      <div className="h-6 text-xs text-gray-600" aria-live="polite">
        {active
          ? <><strong className="text-gray-900">{hnHourMin(active.takenAt)}</strong> · {usd(active.data.ultima_hora.cobrado)} en {active.data.ultima_hora.pagos} pagos · hoy acumulado {usd(active.data.hoy.cobrado)}</>
          : max === 0 ? 'Sin cobros en las últimas 24 horas.' : `Máximo en una hora: ${usd(max)}`}
      </div>
      <div className="relative h-36 flex items-end gap-0.5 border-b border-gray-200" role="img" aria-label="Cobrado por hora en las últimas 24 horas" onMouseLeave={() => setHover(null)}>
        {points.map((p, i) => {
          const v = p.data.ultima_hora.cobrado;
          const pct = max > 0 ? Math.max(v > 0 ? 4 : 0, (v / max) * 100) : 0;
          return (
            <button key={p.takenAt} type="button" className="flex-1 h-full flex items-end focus:outline-none group"
              onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              aria-label={`${hnHourMin(p.takenAt)}: ${usd(v)}`}>
              <span className={`w-full rounded-t ${v > 0 ? '' : 'bg-gray-100'} ${hover === i ? 'opacity-100' : hover == null ? 'opacity-100' : 'opacity-60'}`}
                style={{ height: v > 0 ? `${pct}%` : '2px', background: v > 0 ? BAR : undefined }} />
            </button>
          );
        })}
      </div>
      <div className="flex gap-0.5 mt-1.5" aria-hidden="true">
        {points.map((p, i) => (
          <span key={p.takenAt} className="flex-1 text-center text-[10px] text-gray-400 whitespace-nowrap">{i % 4 === 0 ? hnHour(p.takenAt) : ''}</span>
        ))}
      </div>
    </div>
  );
};

const ByType = ({ m }: { m: MonitorMoney }) => {
  const rows = [
    { label: 'Reserve', icon: 'fa-ticket', v: m.por_tipo.reserve },
    { label: 'Suscripciones', icon: 'fa-star', v: m.por_tipo.suscripciones },
    { label: 'Créditos comprados', icon: 'fa-coins', v: m.por_tipo.creditos },
    { label: 'Propinas', icon: 'fa-hand-holding-heart', v: m.por_tipo.propinas },
    { label: 'Regalos (con Créditos)', icon: 'fa-gift', v: m.por_tipo.regalos },
  ];
  const max = Math.max(...rows.map((r) => r.v.monto), 0);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-700"><i aria-hidden="true" className={`fas ${r.icon} w-5 text-gray-400`}></i>{r.label}</span>
            <span className="font-semibold text-gray-900">{usd(r.v.monto)} <span className="text-xs font-normal text-gray-500">· {r.v.n}</span></span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-gray-100">
            <div className="h-full rounded-full" style={{ width: max > 0 ? `${(r.v.monto / max) * 100}%` : 0, background: BAR }} />
          </div>
        </li>
      ))}
    </ul>
  );
};

const Movement = ({ m, pending }: { m: MonitorMoney; pending: { retiros_enviandose: number; reserve_por_responder: number; reserve_confirmadas_proximas: number } }) => {
  const rows = [
    { icon: 'fa-user-plus', label: 'Personas nuevas hoy', v: m.personas_nuevas },
    { icon: 'fa-user-check', label: 'Creadores verificados hoy', v: m.creadores_verificados },
    { icon: 'fa-calendar-plus', label: 'Reserve nuevas / pagadas hoy', v: `${m.reservas_nuevas} / ${m.reservas_pagadas}` },
    { icon: 'fa-hourglass-half', label: 'Reserve por responder', v: pending.reserve_por_responder },
    { icon: 'fa-calendar-check', label: 'Reserve confirmadas próximas', v: pending.reserve_confirmadas_proximas },
    { icon: 'fa-paper-plane', label: 'Retiros enviándose', v: pending.retiros_enviandose },
    { icon: 'fa-bug', label: 'Errores registrados hoy', v: m.errores_pagina },
  ];
  return (
    <ul className="divide-y divide-gray-100 -my-1.5">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center justify-between py-2 text-sm">
          <span className="text-gray-600"><i aria-hidden="true" className={`fas ${r.icon} w-5 text-gray-400`}></i>{r.label}</span>
          <span className="font-semibold text-gray-900">{r.v}</span>
        </li>
      ))}
    </ul>
  );
};

const Reports = ({ reports }: { reports: MonitorReport[] }) => {
  const [open, setOpen] = useState('');
  if (reports.length === 0) return <p className="text-sm text-gray-500">El primero llega a las próximas 12 (mediodía o medianoche, hora Honduras).</p>;
  return (
    <ul className="space-y-2" data-testid="monitor-reports">
      {reports.map((r) => {
        const status = overallStatus(r.data?.problemas ?? []);
        const pill = status.tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : status.tone === 'alta' ? 'bg-red-50 text-red-700' : 'bg-amber-100 text-amber-800';
        const isOpen = open === r.id;
        return (
          <li key={r.id} className="rounded-xl border border-gray-100 overflow-hidden">
            <button type="button" onClick={() => setOpen(isOpen ? '' : r.id)} aria-expanded={isOpen} className="w-full text-left p-3 sm:p-4 flex items-center gap-3 hover:bg-gray-50">
              <span className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${r.kind === 'midday' ? 'bg-amber-50 text-amber-500' : 'bg-indigo-50 text-indigo-500'}`}>
                <i aria-hidden="true" className={`fas ${r.kind === 'midday' ? 'fa-sun' : 'fa-moon'}`}></i>
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-gray-900">{r.title}</span>
                <span className="block text-xs text-gray-500">
                  Fans Reserve {usd(r.data?.dinero?.fr_con_isv)} con ISV · {r.emailedAt ? 'Enviado a tu correo' : r.emailError ? 'No llegó al correo' : 'Correo en camino'}
                </span>
              </span>
              <span className={`hidden sm:inline text-[11px] font-bold px-2 py-0.5 rounded-full ${pill}`}>{status.text}</span>
              <i aria-hidden="true" className={`fas fa-chevron-down text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}></i>
            </button>
            {isOpen && r.data?.dinero && (
              <iframe title={r.title} className="w-full h-[900px] border-t border-gray-100 bg-[#efefec]" sandbox=""
                srcDoc={monitorReportEmail({ id: r.id, kind: r.kind, title: r.title, body: r.body, window_from: r.windowFrom, window_to: r.windowTo, data: r.data }).html} />
            )}
          </li>
        );
      })}
    </ul>
  );
};

const Ledger = ({ days }: { days: MonitorDay[] }) => {
  if (days.length === 0) return <p className="text-sm text-gray-500">Se llena solo cada hora.</p>;
  const sum = (k: 'cobrado' | 'fr_con_isv' | 'fr_sin_isv' | 'creadores' | 'comision_paypal' | 'devuelto') =>
    Math.round(days.reduce((s, d) => s + (d.data.dinero?.[k] ?? 0), 0) * 100) / 100;
  const cols = [
    ['cobrado', 'Cobrado'], ['fr_con_isv', 'FR con ISV'], ['fr_sin_isv', 'FR sin ISV'],
    ['creadores', 'Creadores'], ['comision_paypal', 'PayPal'], ['devuelto', 'Devuelto'],
  ] as const;
  return (
    <>
      <ul className="sm:hidden space-y-2" data-testid="monitor-days-mobile">
        {days.map((d) => (
          <li key={d.day} className="rounded-xl border border-gray-100 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold capitalize">{dayLabel(d.day)}</span>
              {!d.closed && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">En curso</span>}
            </div>
            <p className="text-lg font-bold mt-1">{usd(d.data.dinero.fr_con_isv)} <span className="text-xs font-normal text-gray-500">con ISV · {usd(d.data.dinero.fr_sin_isv)} sin ISV</span></p>
            <p className="text-xs text-gray-500">Cobrado {usd(d.data.dinero.cobrado)} · Creadores {usd(d.data.dinero.creadores)} · PayPal {usd(d.data.dinero.comision_paypal)}</p>
          </li>
        ))}
      </ul>
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm" data-testid="monitor-days">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="py-2 pr-3 font-medium">Día</th>
              {cols.map(([, label]) => <th key={label} className="py-2 pr-3 font-medium text-right">{label}</th>)}
              <th className="py-2 font-medium text-right">Avisos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {days.map((d) => (
              <tr key={d.day} className="hover:bg-gray-50">
                <td className="py-2 pr-3 whitespace-nowrap capitalize">{dayLabel(d.day)}{!d.closed && <span className="ml-2 text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 normal-case">En curso</span>}</td>
                {cols.map(([k]) => <td key={k} className={`py-2 pr-3 text-right tabular-nums ${k === 'fr_con_isv' ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{usd(d.data.dinero?.[k])}</td>)}
                <td className="py-2 text-right tabular-nums">{(d.data.problemas ?? []).filter((p) => p.nivel !== 'baja').length}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 font-semibold">
              <td className="py-2 pr-3">Total {days.length} días</td>
              {cols.map(([k]) => <td key={k} className="py-2 pr-3 text-right tabular-nums">{usd(sum(k))}</td>)}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
};

// Admin tab "Mano derecha": what the database watches every hour (money and
// problems), the daily ledger and the 12 AM / 12 PM Honduras reports. It only
// reads; nothing here moves money. Reloads by itself every minute while open.
const AdminMonitor: React.FC<{ onOpen?: (section: string) => void }> = ({ onOpen }) => {
  const { data, reload, loading, error } = usePlatformQuery(() => backend.monitor(), [], { hours: [], days: [], reports: [] } as MonitorData);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => { setNow(Date.now()); void reload(); }, 60_000);
    return () => window.clearInterval(id);
  }, [reload]);

  const refresh = async () => {
    setRefreshing(true); setNotice('');
    try {
      await backend.monitorRefresh();
      await reload();
      setNow(Date.now());
    } catch {
      setNotice('No pudimos actualizar ahora. Vuelve a intentarlo en un minuto.');
    } finally {
      setRefreshing(false);
    }
  };

  const latest = data.hours[0];
  const snap = latest?.data;

  return (
    <div className="space-y-4 sm:space-y-6" data-testid="admin-monitor">
      <StatusHero problems={snap?.problemas ?? []} latest={latest} refreshing={refreshing} onRefresh={refresh} now={now} />
      {notice && <p role="alert" className="text-sm text-red-600">{notice}</p>}

      <AdminDataState loading={loading && !latest} error={error} onRetry={reload}>
        <div className="space-y-4 sm:space-y-6">
          {snap && (
            <>
              <Card title="Necesita atención" hint="Lo urgente también te llega a la campana y al celular en cuanto aparece." testId="monitor-attention">
                <Attention problems={snap.problemas ?? []} onOpen={onOpen} />
              </Card>

              <Card title="Hoy" hint={`Desde las 12:00 a. m. hora Honduras · última revisión ${adminDate(latest.takenAt)}`} testId="monitor-today">
                <Today m={snap.hoy} month={snap.mes} />
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                <div className="lg:col-span-2">
                  <Card title="Cobrado cada hora" hint="Últimas 24 horas. Pasa el dedo o el cursor por una barra para ver el detalle." testId="monitor-hours">
                    <HourlyChart hours={data.hours} now={now} />
                  </Card>
                </div>
                <Card title="Movimiento" testId="monitor-movement">
                  <Movement m={snap.hoy} pending={snap.pendiente} />
                </Card>
              </div>

              <Card title="Hoy por tipo" testId="monitor-types">
                <ByType m={snap.hoy} />
              </Card>
            </>
          )}

          <Card title="Reportes de las 12" hint="Mediodía y medianoche, hora Honduras. Llegan a la campana y a tu correo." testId="monitor-reports-card">
            <Reports reports={data.reports} />
          </Card>

          <Card title="Registro financiero diario" hint='Se actualiza cada hora; a medianoche el día queda cerrado. "Con ISV" incluye el 15% sobre la parte de Fans Reserve.' testId="monitor-ledger">
            <Ledger days={data.days} />
          </Card>
        </div>
      </AdminDataState>
    </div>
  );
};

export default AdminMonitor;
