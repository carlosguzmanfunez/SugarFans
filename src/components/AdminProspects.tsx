import React, { useEffect, useMemo, useState } from 'react';
import { backend } from '../lib/backend';
import { useBackendData } from '../lib/useBackendData';
import type { ProspectFilter, ProspectInsights, ProspectServerStatus, ProspectSummary } from '../lib/backend/prospectTypes';
import {
  CAMPAIGN_DAYS, EVENTS, GOALS, NETWORKS, PILOT_COUNTRIES, STATUSES, compact, contactsNeeded, countryLabel, countryProgress,
  emptyProgress, followUpDue, measuredRates, prospectsCsv, scoreReasons, scoreTone, sumProgress,
  type CountryProgress, type Prospect, type ProspectInput, type ProspectNetwork, type ProspectStatus,
} from '../lib/prospects';
import AdminDataState from './AdminDataState';
import { BatchDmDialog, BatchEmailDialog, ImportDialog, MessageDialog, TemplatesDialog, VariantResult, download, flag } from './AdminProspectDialogs';

const PAGE = 25;
const SAFE_DAILY = 150; // first messages a day from the team's accounts before the risk of blocks grows
const pct = (part: number, of: number) => (of > 0 ? Math.min(100, Math.round((part / of) * 100)) : 0);
const n = (v: number) => v.toLocaleString('es-HN');
const daysAgo = (iso?: string) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : undefined);
const card = 'bg-white rounded-2xl border border-gray-200';
const button = 'min-h-11 rounded-lg px-4 py-2 text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50';

const SIZES = [
  { id: '', label: 'Cualquier tamaño' },
  { id: 'ideal', label: '10 mil a 150 mil (ideal)', min: 10000, max: 150000 },
  { id: 'small', label: '3 mil a 10 mil', min: 3000, max: 9999 },
  { id: 'big', label: 'Más de 150 mil', min: 150001 },
] as const;

const emptySummary: ProspectSummary = { byCountry: [], contactedToday: 0, followUpsDue: 0, toEnrich: 0, last24h: {}, emailsToday: 0, measuredAt: '' };
const emptyInsights: ProspectInsights = { variants: [], creatorInvites: { total: 0, verified: 0, selling: 0, last30Days: 0 }, topInviters: [] };
const unknownServer: ProspectServerStatus = { instagram: 'unknown', email: 'unknown', emailLimit: 0 };
const hour = (iso: string) => new Date(iso).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa', weekday: 'short', hour: 'numeric', minute: '2-digit' });

// What moved in the last 24 hours (invite links, sign-ups) and when the automatic check last ran.
function Last24h({ s }: { s: ProspectSummary }) {
  const any = EVENTS.some((e) => s.last24h[e.id]);
  return <div className="rounded-xl border border-gray-200 p-3" data-testid="prospects-last24h">
    <p className="text-sm font-medium text-gray-900">Últimas 24 horas</p>
    {any ? <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
      {EVENTS.filter((e) => s.last24h[e.id]).map((e) => <li key={e.id} className="flex items-baseline justify-between gap-2 text-xs text-gray-700">
        <span>{e.label}</span><span className="font-bold tabular-nums text-gray-900">{n(s.last24h[e.id] ?? 0)}</span></li>)}
    </ul> : <p className="mt-1 text-xs text-gray-500">Todavía nada. Aquí verás quién abrió su link, quién quiere participar y quién se registró.</p>}
    <p className="mt-2 border-t border-gray-100 pt-2 text-[11px] leading-snug text-gray-500">
      <i aria-hidden="true" className="fas fa-rotate mr-1" />Revisión automática todos los días a las 6:00 a. m.{s.lastAutoSync ? ` Última: ${hour(s.lastAutoSync)}.` : ''}</p>
  </div>;
}

function Bar({ value, goal, tone = 'bg-pink-600' }: { value: number; goal: number; tone?: string }) {
  return <div className="h-2 rounded-full bg-gray-100 overflow-hidden" role="presentation">
    <div className={`h-full rounded-full ${tone} transition-[width] duration-500`} style={{ width: `${Math.max(value > 0 ? 3 : 0, pct(value, goal))}%` }} />
  </div>;
}

function Funnel({ p, label, countries = 1, needed }: { p: CountryProgress; label: string; countries?: number; needed: number }) {
  const rates = measuredRates(p);
  const goals = { contacts: GOALS.contacts * countries, registered: GOALS.registered * countries, active: GOALS.active * countries };
  const steps = [
    { title: 'Contactados', value: p.contacted, goal: Math.max(goals.contacts, p.contacted + needed), from: undefined, tone: 'bg-sky-500' },
    { title: 'Respondieron', value: p.replied, from: p.contacted, tone: 'bg-violet-500' },
    { title: 'Registrados', value: p.registered, goal: goals.registered, from: p.replied, tone: 'bg-amber-500' },
    { title: 'Verificados', value: p.verified, from: p.registered, tone: 'bg-emerald-500' },
    { title: 'Activos', value: p.active, goal: goals.active, from: p.verified, tone: 'bg-emerald-700' },
  ];
  const done = p.registered >= goals.registered && p.active >= goals.active;
  return <section className={`${card} p-4 sm:p-6`} aria-labelledby="funnel-title">
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
      <div>
        <h3 id="funnel-title" className="text-lg font-bold text-gray-900">{label}</h3>
        <p className="text-sm text-gray-600">Meta del piloto: <b>{n(GOALS.registered)} registrados</b> y <b>{n(GOALS.active)} activos</b>{countries > 1 ? ` en cada país (${n(goals.registered)} y ${n(goals.active)} en total)` : ''}.</p>
      </div>
      <p className="text-xs text-gray-500">{n(p.total)} en la lista{p.optedOut ? ` · ${n(p.optedOut)} pidieron no ser contactados` : ''}</p>
    </div>
    <ol className="mt-5 grid grid-cols-2 lg:grid-cols-5 gap-3">
      {steps.map((s, i) => <li key={s.title} className={`rounded-xl bg-gray-50 p-3 sm:p-4 ${i === 4 ? 'col-span-2 lg:col-span-1' : ''}`}>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{s.title}</p>
        <p className="mt-1 text-2xl sm:text-3xl font-bold tabular-nums text-gray-900">{n(s.value)}</p>
        {s.goal ? <><div className="mt-2"><Bar value={s.value} goal={s.goal} tone={s.tone} /></div>
          <p className="mt-1 text-xs text-gray-600 tabular-nums">de {n(s.goal)} · {pct(s.value, s.goal)}%</p></>
          : <p className="mt-2 text-xs text-gray-600 tabular-nums">{s.from ? `${pct(s.value, s.from)}% de los anteriores` : '—'}</p>}
      </li>)}
    </ol>
    <div className={`mt-4 rounded-xl p-3 sm:p-4 text-sm ${done ? 'bg-emerald-50 text-emerald-900' : 'bg-pink-50 text-pink-950'}`}>
      {done ? <p><b>Meta cumplida.</b> Ya están los registrados y activos de la meta.</p> : <p>
        Para llegar a {n(goals.registered)} registrados faltan unos <b>{n(needed)} contactos</b>{countries > 1 ? ' entre todos los países' : ''}: <b>{n(Math.ceil(needed / CAMPAIGN_DAYS))} por día</b> durante {CAMPAIGN_DAYS} días hábiles.{' '}
        {countries > 1 ? 'Cada país usa su propia tasa cuando ya tiene 30 contactados.' : rates.measured ? `Calculado con lo que ya pasó: ${(rates.register * 100).toFixed(1)}% de los contactados se registró.` : 'Usamos la tasa esperada (6% se registra) hasta tener 30 contactados.'}
      </p>}
    </div>
  </section>;
}

function Countries({ list, onPick }: { list: CountryProgress[]; onPick: (c: string) => void }) {
  return <section className={`${card} overflow-hidden`} aria-labelledby="countries-title">
    <h3 id="countries-title" className="px-4 sm:px-6 pt-5 text-base font-bold text-gray-900">Avance por país</h3>
    <ul className="mt-3 divide-y divide-gray-100">
      {list.map((p) => <li key={p.country}>
        <button type="button" onClick={() => onPick(p.country)} className="w-full text-left px-4 sm:px-6 py-3 hover:bg-gray-50 grid grid-cols-2 sm:grid-cols-[minmax(10rem,1fr)_minmax(9rem,1.3fr)_minmax(9rem,1.3fr)] items-center gap-x-4 gap-y-2">
          <span className="col-span-2 sm:col-span-1 flex items-baseline justify-between gap-2">
            <span className="font-medium text-gray-900"><span aria-hidden="true" className="mr-2">{flag(p.country)}</span>{countryLabel(p.country)}</span>
            <span className="text-xs text-gray-500 tabular-nums">{n(p.total)} en lista</span>
          </span>
          <span><span className="flex justify-between text-xs text-gray-600 mb-1"><span>Registrados</span><span className="tabular-nums">{n(p.registered)}/{n(GOALS.registered)}</span></span><Bar value={p.registered} goal={GOALS.registered} tone="bg-amber-500" /></span>
          <span><span className="flex justify-between text-xs text-gray-600 mb-1"><span>Activos</span><span className="tabular-nums">{n(p.active)}/{n(GOALS.active)}</span></span><Bar value={p.active} goal={GOALS.active} tone="bg-emerald-700" /></span>
        </button>
      </li>)}
    </ul>
  </section>;
}

// "Metas": which message answers better and the creators other creators brought.
function Insights({ data, onTemplates }: { data: ProspectInsights; onTemplates: () => void }) {
  const ci = data.creatorInvites;
  return <div className="grid gap-5 lg:grid-cols-2">
    <section className={`${card} p-4 sm:p-6 space-y-4`} aria-labelledby="variants-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="variants-title" className="text-base font-bold text-gray-900">Qué mensaje funciona mejor</h3>
          <p className="text-sm text-gray-600 mt-1">Con una versión B, la mitad recibe cada una. Cuenta quién respondió, quiso participar o se registró.</p>
        </div>
        <button type="button" onClick={onTemplates} className={`${button} shrink-0 border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>Editar mensajes</button>
      </div>
      <div><p className="text-sm font-medium text-gray-900 mb-1.5">DM</p><VariantResult stats={data.variants} channel="dm" /></div>
      <div><p className="text-sm font-medium text-gray-900 mb-1.5">Correo</p><VariantResult stats={data.variants} channel="email" /></div>
    </section>
    <section className={`${card} p-4 sm:p-6`} aria-labelledby="creator-invites-title" data-testid="creator-invites">
      <h3 id="creator-invites-title" className="text-base font-bold text-gray-900">Invitados por otros creadores</h3>
      <p className="text-sm text-gray-600 mt-1">Cada creador tiene su link en Panel → Dinero → Recompensas. Gana un bono cuando 2 de sus invitados se verifican y venden sus primeros $100.</p>
      <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[['Llegaron', ci.total], ['Verificados', ci.verified], ['Ya venden', ci.selling], ['Últimos 30 días', ci.last30Days]].map(([k, v]) => <div key={k} className="rounded-xl bg-gray-50 p-3">
          <dt className="text-xs text-gray-500">{k}</dt><dd className="text-2xl font-bold tabular-nums text-gray-900">{n(Number(v))}</dd></div>)}
      </dl>
      {data.topInviters.length > 0 && <div className="mt-4">
        <p className="text-sm font-medium text-gray-900">Quién invita más</p>
        <ol className="mt-1.5 space-y-1 text-sm text-gray-700">{data.topInviters.map((t, i) => <li key={t.name} className="flex justify-between gap-3"><span>{i + 1}. {t.name}</span><span className="tabular-nums font-medium">{n(t.count)}</span></li>)}</ol>
      </div>}
    </section>
  </div>;
}

function Row({ p, onWrite }: { p: Prospect; onWrite: () => void }) {
  const network = NETWORKS[p.network];
  const last = daysAgo(p.lastPostAt);
  const due = followUpDue(p);
  const reasons = scoreReasons(p);
  const action = p.status === 'nuevo' ? 'Escribir' : due ? 'Seguimiento' : 'Abrir';
  return <li className="px-4 sm:px-5 py-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_14rem_20rem] lg:items-center hover:bg-gray-50/70">
    <div className="flex items-start gap-3 min-w-0">
      <span className={`shrink-0 mt-0.5 h-10 w-10 rounded-full grid place-items-center text-white ${p.network === 'instagram' ? 'bg-gradient-to-br from-amber-400 via-pink-600 to-violet-700' : p.network === 'tiktok' ? 'bg-gray-900' : p.network === 'facebook' ? 'bg-blue-600' : 'bg-red-600'}`}>
        <i aria-hidden="true" className={network.icon} /><span className="sr-only">{network.label}</span>
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-gray-900 truncate">
          <a href={network.url(p.handle)} target="_blank" rel="noopener noreferrer" className="hover:underline underline-offset-4">@{p.handle}</a>
          {p.displayName && <span className="ml-2 font-normal text-gray-500">{p.displayName}</span>}
        </p>
        <p className="text-xs text-gray-600 mt-0.5 truncate">
          {flag(p.country)} {countryLabel(p.country)}{p.category ? ` · ${p.category}` : ''}{p.email ? ' · ' : ''}{p.email && <span className="text-gray-800">{p.email}</span>}
        </p>
        {(p.interestedAt || p.openedAt || due || p.enrichNote) && <p className="mt-1.5 flex flex-wrap gap-1">
          {p.interestedAt && <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-900"><i aria-hidden="true" className="fas fa-hand mr-1" />Quiere participar</span>}
          {p.openedAt && <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-900" title={`Primera vez: ${hour(p.openedAt)}`}>
            <i aria-hidden="true" className="fas fa-link mr-1" />Abrió su link{(p.openCount ?? 0) > 1 ? ` · ${p.openCount} veces` : ''}</span>}
          {due && <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">Toca seguimiento</span>}
          {p.enrichNote && <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-900">{p.enrichNote}</span>}
        </p>}
        {p.notes && <p className="mt-1.5 text-xs text-gray-700 italic line-clamp-2">“{p.notes}”</p>}
      </div>
    </div>
    <dl className="grid grid-cols-3 gap-2 rounded-xl bg-gray-50 px-2 py-1.5 text-center lg:bg-transparent lg:p-0 lg:text-left">
      <div><dt className="text-[11px] text-gray-500">Seguidores</dt><dd className="font-semibold tabular-nums text-gray-900">{compact(p.followers)}</dd></div>
      <div><dt className="text-[11px] text-gray-500">Interacción</dt><dd className="font-semibold tabular-nums text-gray-900">{p.engagement != null ? `${p.engagement.toFixed(1)}%` : '—'}</dd></div>
      <div><dt className="text-[11px] text-gray-500">Último post</dt><dd className="font-semibold tabular-nums text-gray-900">{last == null ? '—' : last === 0 ? 'Hoy' : `${last} d`}</dd></div>
    </dl>
    <div className="flex items-center gap-2 justify-between lg:justify-end">
      <span className="flex items-center gap-2">
        <span title={`Puntaje ${p.score} de 100${reasons.length ? `: ${reasons.join(', ')}` : ''}`} className={`shrink-0 rounded-lg px-2 py-1 text-sm font-bold tabular-nums ${scoreTone(p.score)}`}>{p.score}<span className="sr-only"> de 100 puntos</span></span>
        <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUSES[p.status].tone}`} title={STATUSES[p.status].hint}>{STATUSES[p.status].label}{p.status === 'contactado' && p.channel ? ` · ${p.channel === 'dm' ? 'DM' : 'correo'}` : ''}</span>
      </span>
      <button type="button" onClick={onWrite} className={`${button} min-w-[7.5rem] ${action !== 'Abrir' ? 'bg-gray-900 text-white hover:bg-gray-800' : 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'}`}>{action}</button>
    </div>
  </li>;
}

type Tab = 'today' | 'creators' | 'goals';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Hoy', icon: 'fa-list-check' },
  { id: 'creators', label: 'Creadores', icon: 'fa-users' },
  { id: 'goals', label: 'Metas', icon: 'fa-flag-checkered' },
];

// The quick filters of the list, in the order the work happens.
const CHIPS: { id: NonNullable<ProspectFilter['status']>; label: string }[] = [
  { id: 'open', label: 'Todos' },
  { id: 'nuevo', label: 'Por contactar' },
  { id: 'contactado', label: 'Esperando respuesta' },
  { id: 'follow_up', label: 'Toca seguimiento' },
  { id: 'respondio', label: 'Interesados' },
  { id: 'joined', label: 'Ya en Fans Reserve' },
  { id: 'descartado', label: 'Descartados' },
];

// One thing to do today: how many, why, and the button that does it.
function Task({ icon, tone, title, count, text, done, children }: {
  icon: string; tone: string; title: string; count: number; text: string; done: string; children?: React.ReactNode;
}) {
  const empty = count === 0;
  return <li className={`${card} p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4`}>
    <span className={`shrink-0 h-11 w-11 rounded-xl grid place-items-center ${empty ? 'bg-gray-100 text-gray-400' : tone}`}><i aria-hidden="true" className={`fas ${empty ? 'fa-check' : icon}`} /></span>
    <div className="min-w-0 flex-1">
      <p className="font-semibold text-gray-900"><span className="tabular-nums">{n(count)}</span> · {title}</p>
      <p className="text-sm text-gray-600 mt-0.5">{empty ? done : text}</p>
    </div>
    {!empty && <div className="flex flex-wrap gap-2 sm:justify-end">{children}</div>}
  </li>;
}

// Admin tab "Captar creadores": what to do today, the list of creators and the pilot's goals.
export default function AdminProspects() {
  const [tab, setTab] = useState<Tab>('today');
  const [country, setCountry] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<NonNullable<ProspectFilter['status']>>('open');
  const [network, setNetwork] = useState<ProspectNetwork | ''>('');
  const [size, setSize] = useState<(typeof SIZES)[number]['id']>('');
  const [withEmail, setWithEmail] = useState(false);
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState('');
  const [typed, setTyped] = useState('');
  const [sort, setSort] = useState<NonNullable<ProspectFilter['sort']>>('score');
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState<'import' | 'templates' | 'batchDm' | 'batchEmail' | null>(null);
  const [writing, setWriting] = useState<Prospect | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [working, setWorking] = useState('');

  useEffect(() => { const t = setTimeout(() => setQuery(typed), 300); return () => clearTimeout(t); }, [typed]);
  useEffect(() => { setPage(0); }, [country, status, network, size, withEmail, query, sort]);

  const range = SIZES.find((s) => s.id === size)!;
  const filter: ProspectFilter = {
    country, status, network: network || undefined, withEmail: withEmail || undefined, query: query || undefined, sort,
    minFollowers: 'min' in range ? range.min : undefined, maxFollowers: 'max' in range ? range.max : undefined,
  };
  const key = JSON.stringify(filter);
  // From "Hoy" the batches take only the country; from "Creadores" they also take the list's filters.
  const batchBase: ProspectFilter = tab === 'today' ? { country } : filter;
  const summary = useBackendData(() => backend.prospects.summary(), [], emptySummary);
  const list = useBackendData(() => backend.prospects.list(filter, page, PAGE), [key, page], { rows: [] as Prospect[], total: 0 });
  const server = useBackendData(() => backend.prospects.serverStatus(), [], unknownServer);
  const insights = useBackendData(() => backend.prospects.insights(), [], emptyInsights);
  const instagram = server.data.instagram;
  const reload = () => { void summary.reload(); void list.reload(); void insights.reload(); };

  const progress = useMemo(() => countryProgress(summary.data.byCountry), [summary.data]);
  const pilot = PILOT_COUNTRIES.map((c) => progress.find((p) => p.country === c) ?? emptyProgress(c));
  const others = progress.filter((p) => !(PILOT_COUNTRIES as readonly string[]).includes(p.country));
  const shown = country === undefined ? sumProgress(pilot) : progress.find((p) => p.country === country) ?? emptyProgress(country);
  const label = country === undefined ? 'Los 10 países' : `${flag(country)} ${countryLabel(country)}`;
  const count = (s: ProspectStatus) => summary.data.byCountry.filter((r) => r.status === s && (country === undefined || r.country === country)).reduce((t, r) => t + r.count, 0);
  const hasList = summary.data.byCountry.length > 0;

  const done = (text: string, ok = true) => { setNotice({ ok, text }); setDialog(null); setWriting(null); reload(); };
  const show = (s: NonNullable<ProspectFilter['status']>) => { setStatus(s); setTab('creators'); };

  const sync = async () => {
    setWorking('sync');
    const r = await backend.prospects.sync();
    setWorking('');
    done(r.ok ? (r.moved ? `Encontramos ${r.moved} ${r.moved === 1 ? 'creador que ya se registró' : 'creadores que ya se registraron'} o avanzaron.` : 'Nadie nuevo se registró desde la última revisión.') : r.error, r.ok);
  };

  const exportCsv = async () => {
    setWorking('export');
    try {
      const rows = await backend.prospects.exportRows(filter);
      download(`creadores-${country ?? 'todos'}-${new Date().toISOString().slice(0, 10)}.csv`, prospectsCsv(rows));
    } catch { setNotice({ ok: false, text: 'No pudimos preparar el archivo.' }); }
    setWorking('');
  };

  // Up to 100 Instagram accounts per run (Meta allows about 200 a hour).
  const enrich = async () => {
    setWorking('instagram');
    setNotice(null);
    try {
      const pending = (await backend.prospects.exportRows({ ...filter, network: 'instagram', status: 'open', query: undefined }))
        .filter((p) => !p.enrichedAt).slice(0, 100);
      if (!pending.length) { setWorking(''); setNotice({ ok: true, text: 'No quedan cuentas de Instagram por revisar con estos filtros.' }); return; }
      let read = 0, failed = 0, warning = '';
      for (let i = 0; i < pending.length && !warning; i += 25) {
        setWorking(`instagram:${i}/${pending.length}`);
        const r = await backend.prospects.lookupInstagram(pending.slice(i, i + 25).map((p) => p.handle));
        if (!r.ok) { warning = r.error; break; }
        warning = r.warning ?? '';
        const rows: ProspectInput[] = r.results
          .filter((x) => x.ok || /personal|válido/.test(x.note ?? ''))
          .map((x) => ({ network: 'instagram', handle: x.handle, enriched: true, enrich_note: x.ok ? '' : x.note, ...(x.data ?? {}) }));
        read += r.results.filter((x) => x.ok).length;
        failed += r.results.filter((x) => !x.ok).length;
        if (rows.length) await backend.prospects.importRows(rows, 'manual');
      }
      setWorking('');
      done([read || failed ? `Revisamos ${read} ${read === 1 ? 'cuenta' : 'cuentas'} con la API oficial de Instagram${failed ? ` (${failed} no se pudieron leer: cuentas personales o que no existen)` : ''}.` : '', warning].filter(Boolean).join(' '), !warning || read > 0);
    } catch {
      setWorking('');
      setNotice({ ok: false, text: 'No pudimos terminar la revisión. Lo que ya se leyó quedó guardado.' });
    }
  };

  const today = summary.data.contactedToday;
  const emailLimit = server.data.email === 'ok' ? server.data.emailLimit : 0;
  const pages = Math.max(1, Math.ceil(list.data.total / PAGE));
  const select = 'min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm';
  const primary = `${button} bg-gray-900 text-white hover:bg-gray-800`;
  const secondary = `${button} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
  const extraFilters = (network ? 1 : 0) + (size ? 1 : 0) + (withEmail ? 1 : 0) + (sort !== 'score' ? 1 : 0);

  return <div className="space-y-5" data-testid="admin-prospects">
    <header className={`${card} p-4 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4`}>
      <div className="max-w-2xl">
        <h2 className="text-xl font-bold text-gray-900">Captar creadores</h2>
        <p className="text-sm text-gray-600 mt-1">Importa listas de creadores, invítalos con su link personal y aquí ves quién lo abre, quién quiere participar y quién ya se registró.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} onClick={() => setDialog('import')}><i aria-hidden="true" className="fas fa-file-import" />Importar lista</button>
        <button type="button" className={secondary} onClick={() => setDialog('templates')}><i aria-hidden="true" className="fas fa-pen" />Mensajes</button>
      </div>
    </header>

    {notice && <div role={notice.ok ? 'status' : 'alert'} className={`rounded-xl border px-4 py-3 text-sm flex justify-between gap-3 ${notice.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-800'}`}>
      <span>{notice.text}</span><button type="button" aria-label="Cerrar aviso" onClick={() => setNotice(null)} className="shrink-0 min-h-0 px-1"><i aria-hidden="true" className="fas fa-times" /></button>
    </div>}

    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div role="tablist" aria-label="Secciones de captar creadores" className="grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1 sm:inline-grid">
        {TABS.map((t) => <button key={t.id} type="button" role="tab" id={`prospects-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`prospects-panel-${t.id}`} onClick={() => setTab(t.id)}
          className={`min-h-11 rounded-lg px-2 sm:px-6 text-sm font-medium inline-flex items-center justify-center gap-2 ${tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
          <i aria-hidden="true" className={`fas ${t.icon} text-xs hidden sm:inline`} />{t.label}</button>)}
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <span className="shrink-0">País</span>
        <select aria-label="País" value={country ?? 'all'} onChange={(e) => setCountry(e.target.value === 'all' ? undefined : e.target.value)} className={`${select} w-full sm:w-56`}>
          <option value="all">Los 10 países</option>
          {[...PILOT_COUNTRIES, ...others.map((o) => o.country)].map((c) => {
            const p = progress.find((x) => x.country === c);
            return <option key={c} value={c}>{flag(c || undefined)} {c ? countryLabel(c) : 'Sin país'}{p?.total ? ` (${compact(p.total)})` : ''}</option>;
          })}
        </select>
      </label>
    </div>

    {tab === 'today' && <div role="tabpanel" id="prospects-panel-today" aria-labelledby="prospects-tab-today">
      <AdminDataState loading={summary.loading && !summary.data.measuredAt} error={summary.error} onRetry={summary.reload}>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)] lg:items-start">
          <section aria-labelledby="todo-title">
            <h3 id="todo-title" className="sr-only">Qué hacer hoy</h3>
            {!hasList ? <div className={`${card} p-6 sm:p-8`}>
              <p className="font-semibold text-gray-900 text-lg">Todavía no hay creadores en la lista</p>
              <ol className="mt-3 space-y-2 text-sm text-gray-700 list-decimal pl-5">
                <li>Junta creadores: una exportación de Heepsy o Modash, o una lista hecha a mano (usuario, seguidores, país, correo).</li>
                <li>Impórtala aquí. Cada creador recibe su link personal de invitación.</li>
                <li>Vuelve a esta pestaña: cada día te dice a quién escribir.</li>
              </ol>
              <button type="button" className={`${primary} mt-5`} onClick={() => setDialog('import')}>Importar la primera lista</button>
            </div> : <ol className="space-y-3">
              <Task icon="fa-hand" tone="bg-violet-100 text-violet-800" title="Interesados" count={count('respondio')}
                text="Respondieron o apartaron su lugar. Escríbeles para ayudarlos a crear su cuenta." done="Nadie esperando respuesta tuya.">
                <button type="button" className={primary} onClick={() => show('respondio')}>Ver interesados</button>
              </Task>
              <Task icon="fa-rotate-right" tone="bg-amber-100 text-amber-900" title="Seguimientos pendientes" count={summary.data.followUpsDue}
                text="Les escribiste hace 5 días o más y no respondieron. Se les escribe una sola vez más." done="No hay seguimientos pendientes.">
                <button type="button" className={primary} onClick={() => show('follow_up')}>Hacer seguimientos</button>
              </Task>
              <Task icon="fa-paper-plane" tone="bg-sky-100 text-sky-800" title="Por contactar" count={count('nuevo')}
                text="Creadores a los que todavía no les escribimos. Mejor de a poco y con calma." done="Ya les escribiste a todos. Importa otra lista para seguir.">
                <button type="button" className={primary} onClick={() => setDialog('batchDm')}><i aria-hidden="true" className="fas fa-paper-plane" />Lote de DMs</button>
                <button type="button" className={secondary} onClick={() => setDialog('batchEmail')}><i aria-hidden="true" className="fas fa-envelope" />Lote de correos</button>
              </Task>
              {instagram === 'ok' && summary.data.toEnrich > 0 && <Task icon="fa-magnifying-glass-chart" tone="bg-pink-100 text-pink-800" title="Por revisar con Instagram" count={summary.data.toEnrich}
                text="La API oficial trae seguidores, interacción y último post. Hasta 100 por vez." done="">
                <button type="button" className={secondary} disabled={!!working} onClick={() => void enrich()}>
                  <i aria-hidden="true" className="fab fa-instagram" />{working.startsWith('instagram') ? `Revisando ${working.split(':')[1] ?? ''}…` : 'Revisar con Instagram'}</button>
              </Task>}
            </ol>}
          </section>

          <aside className={`${card} p-4 sm:p-5 space-y-4`} aria-labelledby="today-title">
            <h3 id="today-title" className="text-base font-bold text-gray-900">Ritmo de hoy</h3>
            <div>
              <div className="flex items-baseline justify-between"><span className="text-sm text-gray-600">Primeros mensajes</span><span className="text-xl font-bold tabular-nums">{n(today)}</span></div>
              <div className="mt-1.5"><Bar value={today} goal={SAFE_DAILY} tone={today > SAFE_DAILY ? 'bg-red-500' : 'bg-sky-500'} /></div>
              <p className={`mt-1 text-xs ${today > SAFE_DAILY ? 'text-red-700 font-medium' : 'text-gray-500'}`}>{today > SAFE_DAILY ? `Pasaste de ${SAFE_DAILY}: frena por hoy para que no bloqueen las cuentas.` : `Ritmo seguro: hasta ${SAFE_DAILY} al día.`}</p>
            </div>
            {emailLimit > 0 && <div>
              <div className="flex items-baseline justify-between"><span className="text-sm text-gray-600">Correos desde Zoho</span><span className="text-xl font-bold tabular-nums">{n(summary.data.emailsToday)}<span className="text-sm font-normal text-gray-500"> de {n(emailLimit)}</span></span></div>
              <div className="mt-1.5"><Bar value={summary.data.emailsToday} goal={emailLimit} tone="bg-emerald-600" /></div>
            </div>}
            <Last24h s={summary.data} />
            <p className="text-xs text-gray-500"><i aria-hidden="true" className="fas fa-envelope mr-1" />Cada mañana a las 7 te llega este resumen a tu correo, con nombres.</p>
            <button type="button" className={`${secondary} w-full`} onClick={() => void sync()} disabled={!!working}>
              <i aria-hidden="true" className={`fas fa-user-check ${working === 'sync' ? 'animate-pulse' : ''}`} />{working === 'sync' ? 'Buscando…' : 'Buscar registrados ahora'}</button>
            {instagram === 'missing' && <p className="text-xs text-gray-500">Falta conectar la API oficial de Instagram en Vercel (INSTAGRAM_BUSINESS_ID e INSTAGRAM_ACCESS_TOKEN). La lista funciona igual con los datos importados.</p>}
          </aside>
        </div>
      </AdminDataState>
    </div>}

    {tab === 'goals' && <div role="tabpanel" id="prospects-panel-goals" aria-labelledby="prospects-tab-goals" className="space-y-5">
      <AdminDataState loading={summary.loading && !summary.data.measuredAt} error={summary.error} onRetry={summary.reload}>
        <Funnel p={shown} label={label} countries={country === undefined ? PILOT_COUNTRIES.length : 1}
          needed={country === undefined ? pilot.reduce((s, p) => s + contactsNeeded(p), 0) : contactsNeeded(shown)} />
        {country === undefined && <div className="mt-5"><Countries list={pilot} onPick={setCountry} /></div>}
      </AdminDataState>
      <Insights data={insights.data} onTemplates={() => setDialog('templates')} />
    </div>}

    {tab === 'creators' && <section role="tabpanel" id="prospects-panel-creators" aria-labelledby="prospects-tab-creators" className={card}>
      <div className="p-4 sm:p-5 border-b border-gray-100 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-gray-900">Creadores {country !== undefined ? `de ${countryLabel(country)}` : 'de todos los países'}
            <span className="ml-2 text-sm font-normal text-gray-500 tabular-nums">{n(list.data.total)}</span></h3>
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" className={primary} disabled={!hasList} onClick={() => setDialog('batchDm')}><i aria-hidden="true" className="fas fa-paper-plane" />Lote de DMs</button>
            <button type="button" className={secondary} disabled={!hasList} onClick={() => setDialog('batchEmail')}><i aria-hidden="true" className="fas fa-envelope" />Lote de correos</button>
          </span>
        </div>
        <div className="relative">
          <i aria-hidden="true" className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
          <input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Buscar @usuario, nombre o categoría" aria-label="Buscar" className={`${select} w-full pl-9`} />
        </div>
        <div role="group" aria-label="Estado" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {CHIPS.map((c) => <button key={c.id} type="button" aria-pressed={status === c.id} onClick={() => setStatus(c.id)}
            className={`shrink-0 min-h-11 rounded-full border px-4 text-sm font-medium whitespace-nowrap ${status === c.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'}`}>{c.label}</button>)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" aria-expanded={more} aria-controls="prospects-more" onClick={() => setMore(!more)} className="min-h-11 text-sm font-medium text-gray-700 inline-flex items-center gap-2">
            <i aria-hidden="true" className={`fas fa-sliders`} />Más filtros{extraFilters ? ` (${extraFilters})` : ''}<i aria-hidden="true" className={`fas fa-chevron-${more ? 'up' : 'down'} text-xs`} /></button>
          <button type="button" className="min-h-11 px-2 text-sm text-pink-800 underline underline-offset-4 disabled:opacity-50" disabled={working === 'export' || !list.data.total} onClick={() => void exportCsv()}>
            {working === 'export' ? 'Preparando…' : 'Descargar CSV'}</button>
        </div>
        {more && <div id="prospects-more" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <select aria-label="Red" value={network} onChange={(e) => setNetwork(e.target.value as ProspectNetwork | '')} className={`${select} w-full`}>
            <option value="">Todas las redes</option>
            {(Object.keys(NETWORKS) as ProspectNetwork[]).map((k) => <option key={k} value={k}>{NETWORKS[k].label}</option>)}
          </select>
          <select aria-label="Seguidores" value={size} onChange={(e) => setSize(e.target.value as typeof size)} className={`${select} w-full`}>
            {SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select aria-label="Orden" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={`${select} w-full`}>
            <option value="score">Mejor puntaje primero</option><option value="followers">Más seguidores primero</option><option value="recent">Agregados recientemente</option>
          </select>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 min-h-11"><input type="checkbox" checked={withEmail} onChange={(e) => setWithEmail(e.target.checked)} className="h-4 w-4 accent-gray-900" />Solo con correo público</label>
        </div>}
      </div>

      <AdminDataState loading={list.loading && !list.data.rows.length && !list.data.total} error={list.error} onRetry={list.reload}>
        {list.data.rows.length === 0
          ? <div className="p-10 text-center">
            <p className="text-3xl" aria-hidden="true">🔎</p>
            <p className="mt-2 font-semibold text-gray-900">{hasList ? 'Nadie coincide con estos filtros' : 'Todavía no hay creadores en la lista'}</p>
            <p className="mt-1 text-sm text-gray-600">{hasList ? 'Prueba con otro país o estado.' : 'Importa la exportación de Heepsy o Modash, o pega una lista de usuarios.'}</p>
            {!hasList && <button type="button" className={`${primary} mt-4`} onClick={() => setDialog('import')}>Importar la primera lista</button>}
          </div>
          : <ul className={`divide-y divide-gray-100 ${list.loading ? 'opacity-60' : ''}`} aria-busy={list.loading}>{list.data.rows.map((p) => <Row key={p.id} p={p} onWrite={() => setWriting(p)} />)}</ul>}
        {list.data.total > PAGE && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 p-4 text-sm">
          <span className="text-gray-600 tabular-nums">{n(page * PAGE + 1)}–{n(Math.min(list.data.total, (page + 1) * PAGE))} de {n(list.data.total)}</span>
          <span className="flex gap-2">
            <button type="button" className={secondary} disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
            <button type="button" className={secondary} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Siguiente</button>
          </span>
        </div>}
      </AdminDataState>
    </section>}

    <p className="text-xs text-gray-500 px-1">Solo guardamos datos que los creadores publican en sus perfiles. Quien pida no ser contactado queda marcado y se borran sus datos de contacto; quien pida que borremos todo se elimina de la lista.</p>

    {dialog === 'import' && <ImportDialog country={country || undefined} onClose={() => setDialog(null)} onDone={(text) => done(text)} />}
    {dialog === 'templates' && <TemplatesDialog onClose={() => setDialog(null)} />}
    {dialog === 'batchDm' && <BatchDmDialog filter={batchBase} sentToday={today} safeDaily={SAFE_DAILY} onClose={() => setDialog(null)} onDone={(text) => done(text)} />}
    {dialog === 'batchEmail' && <BatchEmailDialog filter={batchBase} server={server.data} emailsToday={summary.data.emailsToday} onClose={() => setDialog(null)} onDone={(text) => done(text)} />}
    {writing && <MessageDialog prospect={writing} server={server.data} emailsToday={summary.data.emailsToday} onClose={() => setWriting(null)} onChanged={(text) => done(text)} />}
  </div>;
}
