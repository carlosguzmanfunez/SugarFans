import React, { useEffect,useState } from 'react';
import {backend}from'../lib/backend';
import {hondurasDateKey}from'../lib/payoutCalendar';
import type { User } from '../lib/backend/types';
import type { Payout, Transaction } from '../lib/platform';
import { money } from '../lib/platform';
import type { CoinPurchase } from '../lib/gifts';
import { owedToCreators, periodLabel, summarize, unspentCredits, type Period } from '../lib/adminLedger';
import { periodRange } from '../lib/adminLedger';
import { usePayoutCalendar } from '../lib/usePayoutCalendar';

interface Props {
  accounts: User[];
  transactions: Transaction[];
  coins: CoinPurchase[];
  payouts: Payout[];
  pending: { verifications: number; reports: number; disputes: number; media?: number };
  onOpen: (tab: string) => void;
}

const Card: React.FC<{ title: string; hint?: string; children: React.ReactNode; testId?: string }> = ({ title, hint, children, testId }) => (
  <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-5" data-testid={testId}>
    <h3 className="font-bold text-gray-900">{title}</h3>
    {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
    <div className="mt-3 sm:mt-4">{children}</div>
  </div>
);

const Row: React.FC<{ label: string; value: string; strong?: boolean; tone?: string }> = ({ label, value, strong, tone }) => (
  <div className="flex items-center justify-between py-1.5 text-sm">
    <span className="text-gray-600">{label}</span>
    <span className={`${strong ? 'font-bold' : 'font-medium'} ${tone ?? 'text-gray-900'}`}>{value}</span>
  </div>
);

// Admin home: the money of the chosen period, what is owed to creators, users and to-dos.
const AdminOverview: React.FC<Props> = ({ accounts, transactions, coins, payouts, pending, onOpen }) => {
  const [period, setPeriod] = useState<Period>('month');
  const calendar = usePayoutCalendar();
  const s = summarize(transactions, coins, period);
  const owed = owedToCreators(transactions, payouts, calendar.at, calendar.data?.legacyCutoff);
  const [book,setBook]=useState<{available:number;recoverable:number;pending:number;reserved:number;sending:number;paid:number}|null>(null);
  const [bookError,setBookError]=useState('');const bookDay=hondurasDateKey(calendar.at);
  useEffect(()=>{if(backend.finance.mode==='local')return;let active=true;setBook(null);setBookError('');backend.finance.creatorTotals?.().then(r=>{if(active){if(r.ok)setBook(r.data);else setBookError(r.error);}}).catch(()=>{if(active)setBookError('No pudimos confirmar los saldos de los libros.');});return()=>{active=false;};},[transactions,payouts,bookDay]);
  const remote=backend.finance.mode!=='local',bookValue=(value:number|undefined)=>value==null?'—':money(value);
  const [from, to] = periodRange(period);
  const people = accounts.filter((a) => a.role !== 'admin');
  const fresh = people.filter((a) => (!from || a.createdAt >= from) && (!to || a.createdAt < to));
  const creators = people.filter((a) => a.role === 'creator');
  const todo = [
    { tab: 'verifications', label: 'Verificaciones por revisar', n: pending.verifications },
    { tab: 'reports', label: 'Reportes pendientes', n: pending.reports },
    { tab: 'moderation', label: 'Fotos y videos por revisar', n: pending.media ?? 0 },
    { tab: 'payouts', label: 'Reembolsos y disputas', n: pending.disputes },
  ];

  const big = [
    { label: 'Entró de fans', value: s.cashIn, hint: `${s.sales} pagos con PayPal`, tone: 'text-gray-900', icon: 'fa-arrow-down', bg: 'bg-blue-50 text-blue-600' },
    { label: 'Comisión de PayPal', value: -s.paypalFees, hint: s.estimatedCollectionCosts?`Incluye ${s.estimatedCollectionCosts} costos estimados`:'Costos de cobro comprobados, menos lo reintegrado', tone: 'text-gray-900', icon: 'fa-receipt', bg: 'bg-gray-100 text-gray-600' },
    { label: 'Para los creadores', value: -s.creators, hint: 'Su parte de ventas y regalos', tone: 'text-gray-900', icon: 'fa-user-friends', bg: 'bg-purple-50 text-purple-600' },
    { label: 'Resultado de cobros y repartos', value: s.platform, hint: 'Antes de ajustes y otros gastos; incluye Créditos sin usar', tone: s.platform >= 0 ? 'text-green-700' : 'text-red-600', icon: 'fa-piggy-bank', bg: 'bg-green-50 text-green-600' },
  ];

  return (
    <div className="space-y-4 sm:space-y-6" data-testid="admin-overview">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Periodo">
        {(Object.keys(periodLabel) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            aria-pressed={period === p}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border ${period === p ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
          >
            {periodLabel[p]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4" data-testid="admin-money">
        {big.map((c) => (
          <div key={c.label} className="bg-white rounded-2xl shadow-sm p-4 sm:p-5">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${c.bg}`}>
              <i aria-hidden="true" className={`fas ${c.icon}`}></i>
            </div>
            <p className={`text-2xl font-bold mt-2 sm:mt-3 ${c.tone}`}>{c.value < 0 ? `−${money(-c.value)}` : money(Math.abs(c.value))}</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{c.label}</p>
            <p className="text-xs text-gray-500">{c.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <Card title="Lo que debemos a creadores" hint="Hoy, sin importar el periodo; incluye ajustes del libro" testId="admin-owed">
          <Row label="Saldo de ciclos cerrados sin apartar" value={remote?bookValue(book?.available):calendar.data?money(owed.available):'—'} strong />
          <Row label="En acumulación · ciclo 26–25" value={remote?bookValue(book?.pending):calendar.data?money(owed.pending):'—'} />
          {remote&&<Row label="Apartado para lotes" value={bookValue(book?.reserved)}/>}
          <Row label="Retiros en camino" value={remote?bookValue(book?.sending):money(owed.sending)} />
          <Row label="Pagos confirmados, con costo apartado" value={remote?bookValue(book?.paid):money(owed.withdrawn)} />
          {!!book?.recoverable&&<Row label="Saldos por recuperar"value={money(book.recoverable)}/>}
          {bookError&&<p role="alert"className="text-xs text-amber-900 mt-2">{bookError}</p>}
        </Card>

        <Card title="Cuidado con el dinero" hint={periodLabel[period]}>
          <Row label="Reembolsado a fans" value={money(s.refunded)} tone={s.refunded ? 'text-red-600' : undefined} />
          <Row label="En disputa con PayPal" value={money(s.disputed)} tone={s.disputed ? 'text-amber-600' : undefined} />
          <Row label="Créditos sin usar (valor de regalos)" value={money(unspentCredits(transactions, coins))} />
          <p className="text-xs text-gray-500">Incluye los Créditos extra de los paquetes. Es su valor para regalar; no es dinero libre de Fans Reserve.</p>
          <Row label="Fans que pagaron" value={String(s.payingFans)} />
        </Card>

        <Card title="Usuarios" hint={`Nuevos: ${periodLabel[period].toLowerCase()}`} testId="admin-people">
          <Row label="Total" value={String(people.length)} strong />
          <Row label="Fans" value={String(people.length - creators.length)} />
          <Row label="Creadores" value={`${creators.length} (${creators.filter((c) => c.isVerified).length} verificados)`} />
          <Row label="Nuevos en el periodo" value={`${fresh.length} (${fresh.filter((a) => a.role === 'creator').length} creadores)`} />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <Card title="Ventas por tipo" hint={periodLabel[period]} testId="admin-by-kind">
          {s.byKind.map((k) => (
            <Row key={k.key} label={`${k.label} (${k.count})`} value={money(k.amount)} />
          ))}
        </Card>

        <Card title="Creadores que más venden" hint={periodLabel[period]}>
          {s.topCreators.length === 0 && <p className="text-sm text-gray-500">Todavía no hay ventas en este periodo</p>}
          {s.topCreators.map((c, i) => (
            <Row key={c.id} label={`${i + 1}. ${c.name}`} value={`${money(c.amount)} · le toca ${money(c.creators)}`} />
          ))}
        </Card>

        <Card title="Pendientes">
          {todo.map((t) => (
            <button key={t.tab} onClick={() => onOpen(t.tab)} className="w-full flex items-center justify-between py-2 text-sm hover:bg-gray-50 rounded-lg px-2 -mx-2">
              <span className="text-gray-700">{t.label}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${t.n ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>{t.n}</span>
            </button>
          ))}
        </Card>
      </div>
    </div>
  );
};

export default AdminOverview;
