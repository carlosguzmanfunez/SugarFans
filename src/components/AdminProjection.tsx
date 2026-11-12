import React, { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import {
  COST_ITEMS, DEFAULT_INPUTS, GOALS, creatorsFor, creatorsForFund, growth, monthFor, monthlyCosts, perReserve,
  type ProjectionInputs,
} from '../lib/profitProjection';

// Admin › Dinero › Proyección: the owner's break-even and profit projection, editable,
// remembered on this browser. Math in src/lib/profitProjection.ts; reads no data.
// Admin text: Spanish and English only (other site languages fall back to Spanish).
const TEXT = {
  es: {
    title: 'Proyección de ganancias',
    intro: 'Cuántos creadores necesitamos para cubrir proveedores y cuándo empezamos a ganar. Cambia los supuestos: se guardan en este navegador.',
    reset: 'Volver a los valores iniciales',
    kCost: 'Costo operativo al mes', kCostNote: 'Proveedores y otros gastos',
    kPer: 'Nos queda por creador (sin ISV)', kPerNote: (n: number, v: string, w: string) => `${n} Reserve × ${v} (con ISV ${w})`,
    kBe: 'Punto de equilibrio', kBeNote: (r: number) => `${r} Reserve al mes`,
    kGoal: 'Primeros $1,000 limpios al mes', kGoalNote: (r: number, c: string) => `${r} Reserve, ${c} cobrados a fans`,
    creators: 'creadores',
    flowTitle: 'Lo que deja cada Reserve',
    fan: 'Paga el fan', paypal: 'PayPal', creator: 'Creador', frIsv: 'Fans Reserve con ISV', isv: 'ISV', clean: 'Nos queda (sin ISV)',
    assumptions: 'Supuestos',
    price: 'Precio de cada Reserve (USD)', reserves: 'Reserve por creador al mes', creatorPct: '% del creador',
    isvPct: 'ISV (%)', isrPct: 'Reserva ISR, pagos a cuenta (%)', fundPct: 'Fondo para proveedores (% de nuestra parte)',
    costsTitle: 'Costos al mes (USD)', total: 'Total al mes',
    goalsTitle: 'De cero a los primeros $1,000 limpios',
    goalsNote: 'Limpio = después de creadores, PayPal, ISV, proveedores y la reserva del ISR. La última columna es solo un chequeo, no se resta.',
    thGoal: 'Meta limpia', thCreators: 'Creadores', thReserves: 'Reserve', thCharged: 'Cobrado', thFr: 'FR con ISV', thIsv: 'ISV',
    thCosts: 'Costos', thRenta: 'Renta', thIsr: 'ISR', thClean: 'Limpio', thFund: '¿Fondo cubre proveedores?',
    breakEven: 'Equilibrio', yes: 'Sí', notYet: 'Aún no',
    fundNote: (n: number) => `El fondo del 15% paga a los proveedores por sí solo desde ${n} creadores. Antes, el resto sale de la ganancia.`,
    growthTitle: 'Próximos 12 meses',
    now: 'Creadores activos hoy', perMonth: 'Creadores nuevos por mes',
    thMonth: 'Mes', thAccum: 'Acumulado limpio', month: (n: number) => `Mes ${n}`,
    growthNote: 'Supone que cada creador nuevo hace sus Reserve desde el primer mes y que nadie se va.',
    foot: 'Solo cuentas: no lee ni mueve dinero. Precios de los planes de src/lib/infraUsage.ts; la factura de cada proveedor es la que cuenta.',
  },
  en: {
    title: 'Profit projection',
    intro: 'How many creators we need to cover providers and when we start to earn. Change the assumptions: they are saved in this browser.',
    reset: 'Reset to defaults',
    kCost: 'Monthly operating cost', kCostNote: 'Providers and other costs',
    kPer: 'We keep per creator (without ISV)', kPerNote: (n: number, v: string, w: string) => `${n} Reserve × ${v} (with ISV ${w})`,
    kBe: 'Break-even', kBeNote: (r: number) => `${r} Reserve a month`,
    kGoal: 'First $1,000 clean a month', kGoalNote: (r: number, c: string) => `${r} Reserve, ${c} charged to fans`,
    creators: 'creators',
    flowTitle: 'What each Reserve leaves',
    fan: 'Fan pays', paypal: 'PayPal', creator: 'Creator', frIsv: 'Fans Reserve with ISV', isv: 'ISV', clean: 'We keep (without ISV)',
    assumptions: 'Assumptions',
    price: 'Price per Reserve (USD)', reserves: 'Reserve per creator a month', creatorPct: 'Creator %',
    isvPct: 'ISV (%)', isrPct: 'ISR set-aside, advance payments (%)', fundPct: 'Provider fund (% of our share)',
    costsTitle: 'Monthly costs (USD)', total: 'Monthly total',
    goalsTitle: 'From zero to the first $1,000 clean',
    goalsNote: 'Clean = after creators, PayPal, ISV, providers and the ISR set-aside. The last column is only a check, it is not subtracted.',
    thGoal: 'Clean goal', thCreators: 'Creators', thReserves: 'Reserve', thCharged: 'Charged', thFr: 'FR with ISV', thIsv: 'ISV',
    thCosts: 'Costs', thRenta: 'Taxable', thIsr: 'ISR', thClean: 'Clean', thFund: 'Fund covers providers?',
    breakEven: 'Break-even', yes: 'Yes', notYet: 'Not yet',
    fundNote: (n: number) => `The 15% fund pays the providers on its own from ${n} creators. Before that, the rest comes out of profit.`,
    growthTitle: 'Next 12 months',
    now: 'Active creators today', perMonth: 'New creators per month',
    thMonth: 'Month', thAccum: 'Clean to date', month: (n: number) => `Month ${n}`,
    growthNote: 'Assumes each new creator does their Reserve from the first month and nobody leaves.',
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

const AdminProjection: React.FC = () => {
  const { language } = useLanguage();
  const tx = TEXT[language === 'en' ? 'en' : 'es'];
  const locale = language === 'en' ? 'en-US' : 'es-HN';
  const [inp, setInp] = useState<ProjectionInputs>(load);
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(inp)); } catch { /* ignore */ } }, [inp]);

  const usd = (n: number, d = 0) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  const r = perReserve(inp);
  const costs = monthlyCosts(inp);
  const be = creatorsFor(inp, 0);
  const goal = creatorsFor(inp, 1000);
  const fundN = creatorsForFund(inp);
  const rows = useMemo(() => GOALS.map((g) => ({ g, ...monthFor(inp, creatorsFor(inp, g)) })), [inp]);
  const months = useMemo(() => growth(inp), [inp]);

  const set = (k: keyof ProjectionInputs) => (e: React.ChangeEvent<HTMLInputElement>) => setInp((p) => ({ ...p, [k]: Math.max(0, Number(e.target.value) || 0) }));
  const setCost = (id: string) => (e: React.ChangeEvent<HTMLInputElement>) => setInp((p) => ({ ...p, costs: { ...p.costs, [id]: Math.max(0, Number(e.target.value) || 0) } }));
  const field = 'w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-right tabular-nums text-sm';
  const num = (label: string, k: keyof ProjectionInputs, step = 1) => (
    <label className="flex items-center justify-between gap-3 text-sm text-gray-700">
      <span>{label}</span>
      <input type="number" min={0} step={step} value={inp[k] as number} onChange={set(k)} className={field} aria-label={label} />
    </label>
  );
  const thBase = 'px-2 py-2 font-semibold text-gray-500 text-xs whitespace-nowrap';
  const th = `${thBase} text-right`, thL = `${thBase} text-left`;
  const tdBase = 'px-2 py-2 tabular-nums whitespace-nowrap';
  const td = `${tdBase} text-right`, tdL = `${tdBase} text-left`;

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
            [tx.kPer, usd(r.frClean * inp.reservesPerCreator, 2), tx.kPerNote(inp.reservesPerCreator, usd(r.frClean, 2), usd(r.frWithIsv * inp.reservesPerCreator, 2)), ''],
            [tx.kBe, `${be} ${tx.creators}`, tx.kBeNote(be * inp.reservesPerCreator), 'be'],
            [tx.kGoal, `${goal} ${tx.creators}`, tx.kGoalNote(goal * inp.reservesPerCreator, usd(goal * inp.reservesPerCreator * inp.price)), 'goal'],
          ].map(([l, v, n, id]) => (
            <div key={l} className={`rounded-xl border p-4 ${id === 'be' ? 'border-green-200 bg-green-50' : id === 'goal' ? 'border-amber-200 bg-amber-50' : 'border-gray-200'}`} data-testid={id ? `projection-${id}` : undefined}>
              <p className="text-xs text-gray-600">{l}</p><p className="text-2xl font-bold tabular-nums text-gray-900">{v}</p><p className="text-xs text-gray-500">{n}</p>
            </div>
          ))}
        </div>
        <h4 className="font-semibold text-gray-900 text-sm mt-6 mb-2">{tx.flowTitle}</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-sm">
          {[[tx.fan, usd(r.price, 2)], [tx.paypal, `-${usd(r.fee, 2)}`], [`${tx.creator} (${inp.creatorPct}%)`, `-${usd(r.creator, 2)}`], [tx.frIsv, usd(r.frWithIsv, 2)], [`${tx.isv} (${inp.isvPct}%)`, `-${usd(r.isv, 2)}`], [tx.clean, usd(r.frClean, 2)]].map(([l, v]) => (
            <div key={l} className="rounded-lg bg-gray-50 px-3 py-2"><p className="text-xs text-gray-500">{l}</p><p className="font-bold tabular-nums">{v}</p></div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-white rounded-2xl shadow-sm p-5 space-y-3">
          <h4 className="font-semibold text-gray-900">{tx.assumptions}</h4>
          {num(tx.price, 'price')}{num(tx.reserves, 'reservesPerCreator')}{num(tx.creatorPct, 'creatorPct')}
          {num(tx.isvPct, 'isvPct', 0.5)}{num(tx.isrPct, 'isrPct')}{num(tx.fundPct, 'fundPct')}
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
            <thead><tr className="border-b border-gray-200"><th className={`${thL}`}>{tx.thGoal}</th><th className={th}>{tx.thCreators}</th><th className={th}>{tx.thReserves}</th><th className={th}>{tx.thCharged}</th><th className={th}>{tx.thFr}</th><th className={th}>{tx.thIsv}</th><th className={th}>{tx.thCosts}</th><th className={th}>{tx.thRenta}</th><th className={th}>{tx.thIsr}</th><th className={th}>{tx.thClean}</th><th className={th}>{tx.thFund}</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.g} className={`border-b border-gray-100 ${m.g === 0 ? 'bg-green-50' : m.g === 1000 ? 'bg-amber-50' : ''}`}>
                  <td className={`${tdL} font-medium`}>{m.g === 0 ? tx.breakEven : usd(m.g)}</td>
                  <td className={`${td} font-bold`}>{m.creators}</td><td className={td}>{m.reserves}</td><td className={td}>{usd(m.charged)}</td>
                  <td className={td}>{usd(m.frWithIsv)}</td><td className={td}>-{usd(m.isv)}</td><td className={td}>-{usd(m.costs)}</td>
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
            <thead><tr className="border-b border-gray-200"><th className={`${thL}`}>{tx.thMonth}</th><th className={th}>{tx.thCreators}</th><th className={th}>{tx.thReserves}</th><th className={th}>{tx.thCharged}</th><th className={th}>{tx.thClean}</th><th className={th}>{tx.thAccum}</th></tr></thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="border-b border-gray-100">
                  <td className={tdL}>{tx.month(m.month)}</td><td className={`${td} font-bold`}>{m.creators}</td><td className={td}>{m.reserves}</td>
                  <td className={td}>{usd(m.charged)}</td><td className={`${td} font-bold ${m.clean < 0 ? 'text-red-700' : 'text-green-700'}`}>{usd(m.clean)}</td><td className={td}>{usd(m.accumulated)}</td>
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
