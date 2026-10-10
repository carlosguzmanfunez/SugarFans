import React, { useState } from 'react';
import type { User } from '../lib/backend/types';
import type { Payout, Transaction } from '../lib/platform';
import { money } from '../lib/platform';
import type { CoinPurchase } from '../lib/gifts';
import { owedToCreators, periodLabel, summarize, unspentCredits, type Period } from '../lib/adminLedger';
import { periodRange } from '../lib/adminLedger';

interface Props {
  accounts: User[];
  transactions: Transaction[];
  coins: CoinPurchase[];
  payouts: Payout[];
  pending: { verifications: number; reports: number; disputes: number };
  onOpen: (tab: string) => void;
}

const Card: React.FC<{ title: string; hint?: string; children: React.ReactNode; testId?: string }> = ({ title, hint, children, testId }) => (
  <div className="bg-white rounded-2xl shadow-sm p-5" data-testid={testId}>
    <h3 className="font-bold text-gray-900">{title}</h3>
    {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
    <div className="mt-4">{children}</div>
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
  const s = summarize(transactions, coins, period);
  const owed = owedToCreators(transactions, payouts);
  const [from, to] = periodRange(period);
  const people = accounts.filter((a) => a.role !== 'admin');
  const fresh = people.filter((a) => (!from || a.createdAt >= from) && (!to || a.createdAt < to));
  const creators = people.filter((a) => a.role === 'creator');
  const todo = [
    { tab: 'verifications', label: 'Verificaciones por revisar', n: pending.verifications },
    { tab: 'reports', label: 'Reportes pendientes', n: pending.reports },
    { tab: 'payouts', label: 'Reembolsos y disputas', n: pending.disputes },
  ];

  const big = [
    { label: 'Entró de fans', value: s.cashIn, hint: `${s.sales} pagos con PayPal`, tone: 'text-gray-900', icon: 'fa-arrow-down', bg: 'bg-blue-50 text-blue-600' },
    { label: 'Comisión de PayPal', value: -s.paypalFees, hint: 'Lo que PayPal se quedó', tone: 'text-gray-900', icon: 'fa-receipt', bg: 'bg-gray-100 text-gray-600' },
    { label: 'Para los creadores', value: -s.creators, hint: 'Su parte de ventas y regalos', tone: 'text-gray-900', icon: 'fa-user-friends', bg: 'bg-purple-50 text-purple-600' },
    { label: 'Ganancia de Fans Reserve', value: s.platform, hint: 'Lo que queda para nosotros', tone: s.platform >= 0 ? 'text-green-700' : 'text-red-600', icon: 'fa-piggy-bank', bg: 'bg-green-50 text-green-600' },
  ];

  return (
    <div className="space-y-6" data-testid="admin-overview">
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="admin-money">
        {big.map((c) => (
          <div key={c.label} className="bg-white rounded-2xl shadow-sm p-5">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${c.bg}`}>
              <i aria-hidden="true" className={`fas ${c.icon}`}></i>
            </div>
            <p className={`text-2xl font-bold mt-3 ${c.tone}`}>{c.value < 0 ? `−${money(-c.value)}` : money(Math.abs(c.value))}</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{c.label}</p>
            <p className="text-xs text-gray-500">{c.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Lo que debemos a creadores" hint="Hoy, sin importar el periodo" testId="admin-owed">
          <Row label="Disponible para retirar" value={money(owed.available)} strong />
          <Row label="Se acredita el 1° del mes" value={money(owed.pending)} />
          <Row label="Retiros en camino" value={money(owed.sending)} />
          <Row label="Total ya retirado" value={money(owed.withdrawn)} />
        </Card>

        <Card title="Cuidado con el dinero" hint={periodLabel[period]}>
          <Row label="Reembolsado a fans" value={money(s.refunded)} tone={s.refunded ? 'text-red-600' : undefined} />
          <Row label="En disputa con PayPal" value={money(s.disputed)} tone={s.disputed ? 'text-amber-600' : undefined} />
          <Row label="Créditos sin gastar (de fans)" value={money(unspentCredits(transactions, coins))} />
          <Row label="Fans que pagaron" value={String(s.payingFans)} />
        </Card>

        <Card title="Usuarios" hint={`Nuevos: ${periodLabel[period].toLowerCase()}`} testId="admin-people">
          <Row label="Total" value={String(people.length)} strong />
          <Row label="Fans" value={String(people.length - creators.length)} />
          <Row label="Creadores" value={`${creators.length} (${creators.filter((c) => c.isVerified).length} verificados)`} />
          <Row label="Nuevos en el periodo" value={`${fresh.length} (${fresh.filter((a) => a.role === 'creator').length} creadores)`} />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
