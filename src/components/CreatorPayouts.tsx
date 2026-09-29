import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  usePlatform,
  creatorEarnings,
  creatorSales,
  isIdentityVerified,
  setPayoutAccount,
  requestPayout,
  money,
  CREATOR_SHARE,
  MIN_PAYOUT,
  firstOfNextMonth,
} from '../lib/platform';

const field = 'w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none text-sm';
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

// Creator dashboard > Ingresos: real balance (80% of fan payments), payout account and withdrawals.
const CreatorPayouts: React.FC = () => {
  const { user } = useAuth();
  const data = usePlatform();
  const [holder, setHolder] = useState('');
  const [bank, setBank] = useState('');
  const [account, setAccount] = useState('');
  const [editingAccount, setEditingAccount] = useState(false);
  const [amount, setAmount] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  if (!user) return null;
  const earnings = creatorEarnings(data, user.id);
  const sales = creatorSales(data, user.id);
  const payoutAccount = data.payoutAccounts[user.id];
  const verified = isIdentityVerified(data, user);

  const saveAccount = () => {
    const r = setPayoutAccount(user.id, holder, bank, account);
    setNotice(r.ok ? { ok: true, text: 'Cuenta de retiro guardada' } : { ok: false, text: r.error! });
    if (r.ok) setEditingAccount(false);
  };

  const withdraw = () => {
    const r = requestPayout(user, parseFloat(amount));
    setNotice(
      r.ok
        ? { ok: true, text: `Retiro programado para el ${fmtDate(firstOfNextMonth().toISOString())}` }
        : { ok: false, text: r.error! }
    );
    if (r.ok) setAmount('');
  };

  return (
    <div className="space-y-6" data-testid="earnings">
      {notice && (
        <div role={notice.ok ? 'status' : 'alert'} className={`px-4 py-3 rounded-xl border ${notice.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {notice.text}
        </div>
      )}
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h3 className="font-bold text-gray-900 mb-1">Resumen de Ingresos</h3>
        <p className="text-sm text-gray-500 mb-4">Recibes el {CREATOR_SHARE * 100}% de lo que pagan tus fans; la plataforma retiene el {100 - CREATOR_SHARE * 100}%.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-green-50 rounded-xl p-4">
            <p className="text-sm text-green-700">Saldo disponible</p>
            <p className="text-2xl font-bold text-green-900" data-testid="available-balance">{money(earnings.available)}</p>
          </div>
          <div className="bg-blue-50 rounded-xl p-4">
            <p className="text-sm text-blue-700">Este mes (neto)</p>
            <p className="text-2xl font-bold text-blue-900">{money(earnings.thisMonth)}</p>
          </div>
          <div className="bg-purple-50 rounded-xl p-4">
            <p className="text-sm text-purple-700">Total ganado</p>
            <p className="text-2xl font-bold text-purple-900">{money(earnings.totalEarned)}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h3 className="font-bold text-gray-900 mb-1">Solicitar retiro</h3>
        <p className="text-sm text-gray-500 mb-4">
          Mínimo {money(MIN_PAYOUT)} USD. Los retiros se pagan una vez al mes, el día 1, a tu cuenta bancaria.
        </p>
        {!verified && (
          <p className="text-sm bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-xl p-3 mb-4">
            <i className="fas fa-id-card mr-2"></i>Para retirar necesitas verificar tu identidad.{' '}
            <Link to="/settings?section=verification" className="font-medium underline">Verificar ahora</Link>
          </p>
        )}
        {payoutAccount && !editingAccount ? (
          <div className="flex items-center justify-between bg-gray-50 rounded-xl p-4 mb-4">
            <div>
              <p className="text-sm font-medium text-gray-900">{payoutAccount.bank} •••• {payoutAccount.accountLast4}</p>
              <p className="text-xs text-gray-500">Titular: {payoutAccount.holder}</p>
            </div>
            <button type="button" onClick={() => setEditingAccount(true)} className="text-sm text-pink-600">Cambiar</button>
          </div>
        ) : (
          <div className="space-y-3 mb-4 max-w-lg">
            <p className="text-sm font-medium text-gray-700">Cuenta bancaria para retiros</p>
            <input className={field} placeholder="Titular de la cuenta" value={holder} onChange={(e) => setHolder(e.target.value)} />
            <input className={field} placeholder="Banco" value={bank} onChange={(e) => setBank(e.target.value)} />
            <input className={field} placeholder="IBAN / CLABE / número de cuenta" value={account} onChange={(e) => setAccount(e.target.value)} />
            <button type="button" onClick={saveAccount} className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium">Guardar cuenta</button>
          </div>
        )}
        <div className="flex gap-3 max-w-lg">
          <div className="relative flex-1">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            <input type="number" name="payoutAmount" min={MIN_PAYOUT} step="0.01" placeholder={String(MIN_PAYOUT)} value={amount} onChange={(e) => setAmount(e.target.value)} className={`${field} pl-8`} />
          </div>
          <button type="button" onClick={withdraw} className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-5 rounded-xl text-sm font-medium hover:opacity-90">
            Solicitar retiro
          </button>
        </div>
        {earnings.payouts.length > 0 && (
          <div className="mt-6 divide-y divide-gray-100" data-testid="payouts">
            {earnings.payouts.map((p) => (
              <div key={p.id} className="py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-gray-900">{money(p.amount)} · {p.accountLabel}</p>
                  <p className="text-xs text-gray-500">Solicitado {fmtDate(p.requestedAt)} · Pago previsto {fmtDate(p.scheduledFor)}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${p.status === 'paid' ? 'bg-green-100 text-green-700' : p.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {p.status === 'paid' ? 'Pagado' : p.status === 'rejected' ? 'Rechazado' : 'Programado'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h3 className="font-bold text-gray-900 mb-4">Pagos de tus fans</h3>
        {sales.length === 0 ? (
          <p className="text-sm text-gray-500">Aún no hay pagos registrados{earnings.opening ? ` (saldo previo: ${money(earnings.opening)})` : ''}.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {sales.slice(0, 20).map((t) => (
              <div key={t.id} className="py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-gray-900">{t.kind === 'renewal' ? 'Renovación' : 'Suscripción'} · {t.payerName}</p>
                  <p className="text-xs text-gray-500">{fmtDate(t.createdAt)} · pagó {money(t.amount)}</p>
                </div>
                <span className="font-bold text-green-700">+{money(t.amount * CREATOR_SHARE)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CreatorPayouts;
