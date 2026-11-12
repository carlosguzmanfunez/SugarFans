import React, { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import {
  COST_ITEMS, DEFAULT_INPUTS, GOALS, creatorsFor, creatorsForFund, growth, monthFor, monthlyCosts, perCreator, perReserve, perSub, type perPayment,
  subsPerCreatorAvg, type ProjectionInputs,
} from '../lib/profitProjection';

// Admin › Dinero › Proyección: the owner's break-even and profit projection, editable,
// remembered on this browser. Two income sources (Reserve and subscriptions), each with
// its own inputs and metrics, feeding the same goals and 12-month tables.
// Math in src/lib/profitProjection.ts; reads no data.
// Admin text: Spanish and English only (other site languages fall back to Spanish).
const TEXT = {
  es: {
    title: 'Proyección de ganancias',
    intro: 'Cuántos creadores necesitamos para cubrir proveedores y cuándo empezamos a ganar, con Reserve y suscripciones. Cambia los valores: se guardan en este navegador.',
    reset: 'Volver a los valores iniciales',
    kCost: 'Costo operativo al mes', kCostNote: 'Proveedores y otros gastos',
    kPer: 'Nos queda por creador (sin ISV)', kPerNote: (a: string, b: string) => `Reserve ${a} + suscripciones ${b}`,
    kBe: 'Punto de equilibrio', kBeNote: (r: number, s: number) => `${r} Reserve y ${s} suscriptores al mes`,
    kGoal: 'Primeros $1,000 limpios al mes', kGoalNote: (r: number, s: number, c: string) => `${r} Reserve, ${s} suscriptores, ${c} cobrados`,
    creators: 'creadores',
    mix: 'De dónde sale lo que nos queda por creador',
    sources: 'Fuentes de ingreso',
    reserve: 'Reserve', subs: 'Suscripciones',
    reserveSub: 'Videollamadas 1:1 y eventos pagados',
    subsSub: 'Contenido exclusivo, cobro mensual',
    price: 'Precio de cada Reserve (USD)', reserves: 'Reserve por creador al mes',
    subPrice: 'Precio de la suscripción (USD/mes)', subsPer: 'Suscriptores por creador', subPct: '% de creadores con suscriptores',
    eachReserve: 'Cada Reserve', eachSub: 'Cada suscripción',
    fan: 'Paga el fan', paypal: 'PayPal', creator: 'Creador', frIsv: 'Fans Reserve con ISV', isv: 'ISV', clean: 'Nos queda (sin ISV)',
    perCreatorMonth: 'Por creador al mes (sin ISV)',
    avgSubs: (n: string) => `Promedio: ${n} suscriptores por creador`,
    subsZero: 'Pon cuántos suscriptores tiene cada creador para sumarlos a la proyección.',
    general: 'Reparto e impuestos',
    creatorPct: '% del creador',
    isvPct: 'ISV (%)', isrPct: 'Reserva ISR, pagos a cuenta (%)', fundPct: 'Fondo para proveedores (% de nuestra parte)',
    costsTitle: 'Costos al mes (USD)', total: 'Total al mes',
    goalsTitle: 'De cero a los primeros $1,000 limpios',
    goalsNote: 'Limpio = después de creadores, PayPal, ISV, proveedores y la reserva del ISR. "Reserve" y "Suscripciones" son nuestra parte con ISV de cada una. La última columna es solo un chequeo, no se resta.',
    thGoal: 'Meta limpia', thCreators: 'Creadores', thReserves: 'Reserve', thSubs: 'Suscriptores', thCharged: 'Cobrado',
    thFrR: 'De Reserve', thFrS: 'De suscripciones', thIsv: 'ISV',
    thCosts: 'Costos', thRenta: 'Renta', thIsr: 'ISR', thClean: 'Limpio', thFund: '¿Fondo cubre proveedores?',
    breakEven: 'Equilibrio', yes: 'Sí', notYet: 'Aún no',
    fundNote: (n: number) => `El fondo del 15% paga a los proveedores por sí solo desde ${n} creadores. Antes, el resto sale de la ganancia.`,
    growthTitle: 'Próximos 12 meses',
    now: 'Creadores activos hoy', perMonth: 'Creadores nuevos por mes',
    thMonth: 'Mes', thAccum: 'Acumulado limpio', month: (n: number) => `Mes ${n}`,
    growthNote: 'Supone que cada creador nuevo tiene sus Reserve y suscriptores desde el primer mes y que nadie se va.',
    foot: 'Solo cuentas: no lee ni mueve dinero. Precios de los planes de src/lib/infraUsage.ts; la factura de cada proveedor es la que cuenta.',
  },
  en: {
    title: 'Profit projection',
    intro: 'How many creators we need to cover providers and when we start to earn, with Reserve and subscriptions. Change the values: they are saved in this browser.',
    reset: 'Reset to defaults',
    kCost: 'Monthly operating cost', kCostNote: 'Providers and other costs',
    kPer: 'We keep per creator (without ISV)', kPerNote: (a: string, b: string) => `Reserve ${a} + subscriptions ${b}`,
    kBe: 'Break-even', kBeNote: (r: number, s: number) => `${r} Reserve and ${s} subscribers a month`,
    kGoal: 'First $1,000 clean a month', kGoalNote: (r: number, s: number, c: string) => `${r} Reserve, ${s} subscribers, ${c} charged`,
    creators: 'creators',
    mix: 'Where what we keep per creator comes from',
    sources: 'Income sources',
    reserve: 'Reserve', subs: 'Subscriptions',
    reserveSub: '1:1 video calls and paid events',
    subsSub: 'Exclusive content, monthly charge',
    price: 'Price per Reserve (USD)', reserves: 'Reserve per creator a month',
    subPrice: 'Subscription price (USD/month)', subsPer: 'Subscribers per creator', subPct: '% of creators with subscribers',
    eachReserve: 'Each Reserve', eachSub: 'Each subscription',
    fan: 'Fan pays', paypal: 'PayPal', creator: 'Creator', frIsv: 'Fans Reserve with ISV', isv: 'ISV', clean: 'We keep (without ISV)',
    perCreatorMonth: 'Per creator a month (without ISV)',
    avgSubs: (n: string) => `Average: ${n} subscribers per creator`,
    subsZero: 'Enter how many subscribers each creator has to add them to the projection.',
    general: 'Split and taxes',
    creatorPct: 'Creator %',
    isvPct: 'ISV (%)', isrPct: 'ISR set-aside, advance payments (%)', fundPct: 'Provider fund (% of our share)',
    costsTitle: 'Monthly costs (USD)', total: 'Monthly total',
    goalsTitle: 'From zero to the first $1,000 clean',
    goalsNote: 'Clean = after creators, PayPal, ISV, providers and the ISR set-aside. "Reserve" and "Subscriptions" are our share with ISV from each. The last column is only a check, it is not subtracted.',
    thGoal: 'Clean goal', thCreators: 'Creators', thReserves: 'Reserve', thSubs: 'Subscribers', thCharged: 'Charged',
    thFrR: 'From Reserve', thFrS: 'From subscriptions', thIsv: 'ISV',
    thCosts: 'Costs', thRenta: 'Taxable', thIsr: 'ISR', thClean: 'Clean', thFund: 'Fund covers providers?',
    breakEven: 'Break-even', yes: 'Yes', notYet: 'Not yet',
    fundNote: (n: number) => `The 15% fund pays the providers on its own from ${n} creators. Before that, the rest comes out of profit.`,
    growthTitle: 'Next 12 months',
    now: 'Active creators today', perMonth: 'New creators per month',
    thMonth: 'Month', thAccum: 'Clean to date', month: (n: number) => `Month ${n}`,
    growthNote: 'Assumes each new creator has their Reserve and subscribers from the first month and nobody leaves.',
    foot: 'Math only: reads and moves no money. Plan prices from src/lib/infraUsage.ts; each provider invoice is what counts.',
  },
};

const STORE = 'fr-admin-projection';
const load = (): ProjectionInputs => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && typeof saved === 'object') return { ...DEFAULT_INPUTS, ...saved, costs: { ...DEFAULT_INPUTS.costs, ...(saved.costs || {}) } };
  } catch { /* private mode or bad data: defaults */ }
  return DEFAULT_INPUTS;
};

const RESERVE_TONE = 'bg-pink-600', SUBS_TONE = 'bg-violet-500';

const AdminProjection: React.FC = () => {
  const { language } = useLanguage();
  const tx = TEXT[language === 'en' ? 'en' : 'es'];
  const locale = language === 'en' ? 'en-US' : 'es-HN';
  const [inp, setInp] = useState<ProjectionInputs>(load);
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(inp)); } catch { /* ignore */ } }, [inp]);

  const usd = (n: number, d = 0) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  const r = perReserve(inp), s = perSub(inp), pc = perCreator(inp);
  const costs = monthlyCosts(inp);
  const be = creatorsFor(inp, 0), beM = monthFor(inp, be);
  const goal = creatorsFor(inp, 1000), goalM = monthFor(inp, goal);
  const fundN = creatorsForFund(inp);
  const rows = useMemo(() => GOALS.map((g) => ({ g, ...monthFor(inp, creatorsFor(inp, g)) })), [inp]);
  const months = useMemo(() => growth(inp), [inp]);
  const mixR = pc.total > 0 ? pc.fromReserve / pc.total * 100 : 0;

  const set = (k: keyof ProjectionInputs) => (e: React.ChangeEvent<HTMLInputElement>) => setInp((p) => ({ ...p, [k]: Math.max(0, Number(e.target.value) || 0) }));
  const setCost = (id: string) => (e: React.ChangeEvent<HTMLInputElement>) => setInp((p) => ({ ...p, costs: { ...p.costs, [id]: Math.max(0, Number(e.target.value) || 0) } }));
  const field = 'w-24 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-right tabular-nums text-sm';
  const num = (label: string, k: keyof ProjectionInputs, step = 1) => (
    <label className="flex items-center justify-between gap-3 text-sm text-gray-700">
      <span>{label}</span>
      <input type="number" min={0} step={step} value={inp[k] as number} onChange={set(k)} className={field} aria-label={label} />
    </label>
  );
  const flow = (p: ReturnType<typeof perPayment>) => (
    <div className="grid grid-cols-3 gap-1.5 text-xs">
      {[[tx.fan, usd(p.price, 2)], [tx.paypal, `-${usd(p.fee, 2)}`], [`${tx.creator} ${inp.creatorPct}%`, `-${usd(p.creator, 2)}`],
        [tx.frIsv, usd(p.frWithIsv, 2)], [`${tx.isv} ${inp.isvPct}%`, `-${usd(p.isv, 2)}`], [tx.clean, usd(p.frClean, 2)]].map(([l, v], k) => (
        <div key={l} className={`rounded-lg px-2 py-1.5 ${k === 5 ? 'bg-gray-900 text-white' : 'bg-white/70'}`}><p className="opacity-70 leading-tight">{l}</p><p className="font-bold tabular-nums text-sm">{v}</p></div>
      ))}
    </div>
  );
  const thBase = 'px-2 py-2 font-semibold text-gray-500 text-xs whitespace-nowrap';
  const th = `${thBase} text-right`, thL = `${thBase} text-left`;
  const tdBase = 'px-2 py-2 tabular-nums whitespace-nowrap';
  const td = `${tdBase} text-right`, tdL = `${tdBase} text-left`;
  const dot = (tone: string) => <span className={`inline-block w-2 h-2 rounded-full mr-1 align-middle ${tone}`} aria-hidden="true" />;

  return (
    <div className="space-y-6" data-testid="admin-projection">
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h3 className="font-bold text-gray-900">{tx.title}</h3><p className="text-sm text-gray-600 mt-1 max-w-2xl">{tx.intro}</p></div>
          <button type="button" onClick={() => setInp(DEFAULT_INPUTS)} className="min-h-11 px-3 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">{tx.reset}</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mt-5">
          {[
            [tx.kCost, usd(costs, 2), tx.kCostNote, ''],
            [tx.kPer, usd(pc.total, 2), tx.kPerNote(usd(pc.fromReserve, 2), usd(pc.fromSubs, 2)), 'per'],
            [tx.kBe, `${be} ${tx.creators}`, tx.kBeNote(beM.reserves, beM.subscribers), 'be'],
            [tx.kGoal, `${goal} ${tx.creators}`, tx.kGoalNote(goalM.reserves, goalM.subscribers, usd(goalM.charged)), 'goal'],
          ].map(([l, v, n, id]) => (
            <div key={l} className={`rounded-xl border p-4 ${id === 'be' ? 'border-green-200 bg-green-50' : id === 'goal' ? 'border-amber-200 bg-amber-50' : 'border-gray-200'}`} data-testid={id ? `projection-${id}` : undefined}>
              <p className="text-xs text-gray-600">{l}</p><p className="text-2xl font-bold tabular-nums text-gray-900">{v}</p><p className="text-xs text-gray-500">{n}</p>
            </div>
          ))}
        </div>
        <div className="mt-5" data-testid="projection-mix">
          <p className="text-xs text-gray-600 mb-1.5">{tx.mix}</p>
          <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
            <span className={RESERVE_TONE} style={{ width: `${mixR}%` }} />
            <span className={SUBS_TONE} style={{ width: `${pc.total > 0 ? 100 - mixR : 0}%` }} />
          </div>
          <p className="flex flex-wrap gap-x-4 text-xs text-gray-600 mt-1.5">
            <span>{dot(RESERVE_TONE)}{tx.reserve} {Math.round(mixR)}% · {usd(pc.fromReserve, 2)}</span>
            <span>{dot(SUBS_TONE)}{tx.subs} {pc.total > 0 ? Math.round(100 - mixR) : 0}% · {usd(pc.fromSubs, 2)}</span>
          </p>
        </div>
      </div>

      <section aria-label={tx.sources}>
        <h4 className="font-semibold text-gray-900 mb-3">{tx.sources}</h4>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl p-5 space-y-3 bg-pink-50 border border-pink-100" data-testid="projection-reserve">
            <div className="flex items-baseline justify-between gap-3">
              <div><h5 className="font-bold text-gray-900">{dot(RESERVE_TONE)}{tx.reserve}</h5><p className="text-xs text-gray-600">{tx.reserveSub}</p></div>
              <p className="text-right"><span className="block text-xs text-gray-600">{tx.perCreatorMonth}</span><span className="text-xl font-bold tabular-nums">{usd(pc.fromReserve, 2)}</span></p>
            </div>
            {num(tx.price, 'price')}{num(tx.reserves, 'reservesPerCreator')}
            <p className="text-xs font-semibold text-gray-700 pt-1">{tx.eachReserve}</p>
            {flow(r)}
          </div>
          <div className="rounded-2xl p-5 space-y-3 bg-violet-50 border border-violet-100" data-testid="projection-subs">
            <div className="flex items-baseline justify-between gap-3">
              <div><h5 className="font-bold text-gray-900">{dot(SUBS_TONE)}{tx.subs}</h5><p className="text-xs text-gray-600">{tx.subsSub}</p></div>
              <p className="text-right"><span className="block text-xs text-gray-600">{tx.perCreatorMonth}</span><span className="text-xl font-bold tabular-nums">{usd(pc.fromSubs, 2)}</span></p>
            </div>
            {num(tx.subPrice, 'subPrice', 0.01)}{num(tx.subsPer, 'subsPerCreator')}{num(tx.subPct, 'subCreatorsPct')}
            <p className="text-xs text-gray-600">{inp.subsPerCreator > 0 ? tx.avgSubs(subsPerCreatorAvg(inp).toLocaleString(locale, { maximumFractionDigits: 1 })) : tx.subsZero}</p>
            <p className="text-xs font-semibold text-gray-700 pt-1">{tx.eachSub}</p>
            {flow(s)}
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-white rounded-2xl shadow-sm p-5 space-y-3">
          <h4 className="font-semibold text-gray-900">{tx.general}</h4>
          {num(tx.creatorPct, 'creatorPct')}{num(tx.isvPct, 'isvPct', 0.5)}{num(tx.isrPct, 'isrPct')}{num(tx.fundPct, 'fundPct')}
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h4 className="font-semibold text-gray-900 mb-3">{tx.costsTitle}</h4>
          <div className="divide-y divide-gray-100">
            {COST_ITEMS.map((c) => (
              <label key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span><span className="text-gray-900">{c.name}</span><span className="block text-xs text-gray-500">{c.plan[language === 'en' ? 'en' : 'es']}</span></span>
                <input type="number" min={0} step={0.01} value={inp.costs[c.id] ?? 0} onChange={setCost(c.id)} className={field} aria-label={c.name} />
              </label>
            ))}
            <p className="flex justify-between pt-3 text-sm font-bold"><span>{tx.total}</span><span className="tabular-nums" data-testid="projection-costs">{usd(costs, 2)}</span></p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h4 className="font-semibold text-gray-900">{tx.goalsTitle}</h4>
        <p className="text-sm text-gray-600 mt-1">{tx.goalsNote}</p>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm" data-testid="projection-goals">
            <thead><tr className="border-b border-gray-200"><th className={thL}>{tx.thGoal}</th><th className={th}>{tx.thCreators}</th><th className={th}>{tx.thReserves}</th><th className={th}>{tx.thSubs}</th><th className={th}>{tx.thCharged}</th><th className={th}>{dot(RESERVE_TONE)}{tx.thFrR}</th><th className={th}>{dot(SUBS_TONE)}{tx.thFrS}</th><th className={th}>{tx.thIsv}</th><th className={th}>{tx.thCosts}</th><th className={th}>{tx.thRenta}</th><th className={th}>{tx.thIsr}</th><th className={th}>{tx.thClean}</th><th className={th}>{tx.thFund}</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.g} className={`border-b border-gray-100 ${m.g === 0 ? 'bg-green-50' : m.g === 1000 ? 'bg-amber-50' : ''}`}>
                  <td className={`${tdL} font-medium`}>{m.g === 0 ? tx.breakEven : usd(m.g)}</td>
                  <td className={`${td} font-bold`}>{m.creators}</td><td className={td}>{m.reserves}</td><td className={td}>{m.subscribers}</td><td className={td}>{usd(m.charged)}</td>
                  <td className={td}>{usd(m.frReserve)}</td><td className={td}>{usd(m.frSubs)}</td><td className={td}>-{usd(m.isv)}</td><td className={td}>-{usd(m.costs)}</td>
                  <td className={td}>{usd(m.renta)}</td><td className={td}>-{usd(m.isr)}</td><td className={`${td} font-bold`}>{usd(m.clean)}</td>
                  <td className={`${td} ${m.fundCovers ? 'text-green-700' : 'text-gray-500'}`}>{m.fundCovers ? `${tx.yes} ✓` : tx.notYet} ({usd(m.fund)})</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-2" data-testid="projection-fund">{tx.fundNote(fundN)}</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h4 className="font-semibold text-gray-900">{tx.growthTitle}</h4>
        <div className="grid gap-3 sm:grid-cols-2 mt-3 max-w-xl">{num(tx.now, 'creatorsNow')}{num(tx.perMonth, 'newCreatorsPerMonth')}</div>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm" data-testid="projection-growth">
            <thead><tr className="border-b border-gray-200"><th className={thL}>{tx.thMonth}</th><th className={th}>{tx.thCreators}</th><th className={th}>{tx.thReserves}</th><th className={th}>{tx.thSubs}</th><th className={th}>{tx.thCharged}</th><th className={th}>{dot(RESERVE_TONE)}{tx.thFrR}</th><th className={th}>{dot(SUBS_TONE)}{tx.thFrS}</th><th className={th}>{tx.thClean}</th><th className={th}>{tx.thAccum}</th></tr></thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="border-b border-gray-100">
                  <td className={tdL}>{tx.month(m.month)}</td><td className={`${td} font-bold`}>{m.creators}</td><td className={td}>{m.reserves}</td><td className={td}>{m.subscribers}</td>
                  <td className={td}>{usd(m.charged)}</td><td className={td}>{usd(m.frReserve)}</td><td className={td}>{usd(m.frSubs)}</td>
                  <td className={`${td} font-bold ${m.clean < 0 ? 'text-red-700' : 'text-green-700'}`}>{usd(m.clean)}</td><td className={td}>{usd(m.accumulated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-2">{tx.growthNote}</p>
      </div>
      <p className="text-xs text-gray-500">{tx.foot}</p>
    </div>
  );
};

export default AdminProjection;
