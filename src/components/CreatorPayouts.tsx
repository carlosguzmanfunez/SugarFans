import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  usePlatformQuery,
  platformApi,
  computeEarnings,
  setPayoutAccount,
  requestPayout,
  money,
  CREATOR_SHARE,
  creatorCut,
  MIN_PAYOUT,
  nextCreditDate,
  transactionLabel,
} from '../lib/platform';
import { GIFT_SHARE } from '../lib/giftRules';

const field = 'w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none text-sm';
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

// Creator dashboard > Ingresos: real balance (80% of fan payments), payout account and withdrawals.
const CreatorPayouts: React.FC = () => {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const profileId = user?.creatorProfileId ?? userId;
  const { data, loading } = usePlatformQuery(
    async () => {
      const [sales, payouts, payoutAccount] = await Promise.all([
        platformApi.creatorSales(profileId),
        platformApi.myPayouts(userId),
        platformApi.payoutAccount(userId),
      ]);
      return { sales, payouts, payoutAccount };
    },
    [userId, profileId],
    { sales: [], payouts: [], payoutAccount: null } as {
      sales: Awaited<ReturnType<typeof platformApi.creatorSales>>;
      payouts: Awaited<ReturnType<typeof platformApi.myPayouts>>;
      payoutAccount: Awaited<ReturnType<typeof platformApi.payoutAccount>>;
    }
  );
  const [holder, setHolder] = useState('');
  const [bank, setBank] = useState('');
  const [account, setAccount] = useState('');
  const [editingAccount, setEditingAccount] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  if (!user) return null;
  const { sales, payoutAccount } = data;
  const earnings = computeEarnings(sales, data.payouts);
  const paid = data.payouts;
  const creditDay = fmtDate(nextCreditDate());
  const canWithdraw = earnings.available >= MIN_PAYOUT;
  const verified = !!user.isVerified;

  const saveAccount = async () => {
    const r = await setPayoutAccount(user, holder, bank, account);
    setNotice(r.ok ? { ok: true, text: 'Cuenta de retiro guardada' } : { ok: false, text: r.error! });
    if (r.ok) setEditingAccount(false);
  };

  const withdraw = async () => {
    const r = await requestPayout(user);
    setNotice(r.ok ? { ok: true, text: `Retiro pagado: ${money(r.amount ?? 0)} enviados a tu cuenta` } : { ok: false, text: r.error! });
  };

  return (
    <div className="space-y-6" data-testid="earnings" aria-busy={loading}>
      {notice && (
        <div role={notice.ok ? 'status' : 'alert'} className={`px-4 py-3 rounded-xl border ${notice.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {notice.text}
        </div>
      )}
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h3 className="font-bold text-gray-900 mb-1">Resumen de Ingresos</h3>
        <p className="text-sm text-gray-500 mb-4">Recibes del {CREATOR_SHARE * 100}% al 90% de lo que pagan tus fans según tu nivel, tus metas y tus invitados ({GIFT_SHARE * 100}% de los regalos); el resto queda para la plataforma.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-green-50 rounded-xl p-4">
            <p className="text-sm text-green-700">Saldo disponible</p>
            <p className="text-2xl font-bold text-green-900" data-testid="available-balance">{money(earnings.available)}</p>
          </div>
          <div className="bg-blue-50 rounded-xl p-4">
            <p className="text-sm text-blue-700">Por acreditar el {creditDay}</p>
            <p className="text-2xl font-bold text-blue-900" data-testid="pending-balance">{money(earnings.pending)}</p>
          </div>
          <div className="bg-purple-50 rounded-xl p-4">
            <p className="text-sm text-purple-700">Total ganado</p>
            <p className="text-2xl font-bold text-purple-900">{money(earnings.totalEarned)}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h3 className="font-bold text-gray-900 mb-1">Retirar saldo</h3>
        <p className="text-sm text-gray-500 mb-4">
          Tus ingresos se acreditan el día 1 de cada mes y se acumulan si no los retiras. Puedes retirar en cualquier momento del mes, siempre el
          saldo completo, a partir de {money(MIN_PAYOUT)} USD.
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
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            type="button"
            onClick={withdraw}
            disabled={!canWithdraw}
            className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-5 py-3 rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Retirar {money(earnings.available)}
          </button>
          {!canWithdraw && (
            <p className="text-xs text-gray-500">Podrás retirar cuando tu saldo disponible llegue a {money(MIN_PAYOUT)}.</p>
          )}
        </div>
        {paid.length > 0 && (
          <div className="mt-6" data-testid="payouts">
            <p className="text-sm font-semibold text-gray-900">Retiros pagados</p>
            <div className="divide-y divide-gray-100">
              {paid.map((p) => (
                <div key={p.id} className="py-3 flex items-center gap-3 text-sm">
                  <i className="fas fa-check-circle text-green-600 text-lg" aria-hidden="true"></i>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">Retiraste {money(p.amount)} · {p.accountLabel}</p>
                    <p className="text-xs text-gray-500">Disponías de {money(p.availableBefore)} · pagado el {fmtDate(p.paidAt)}</p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">Pagado</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h3 className="font-bold text-gray-900 mb-4">Pagos de tus fans</h3>
        {sales.length === 0 ? (
          <p className="text-sm text-gray-500">Aún no hay pagos registrados.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {sales.slice(0, 20).map((t) => (
              <div key={t.id} className="py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-gray-900">{transactionLabel[t.kind]} · {t.payerName}</p>
                  <p className="text-xs text-gray-500">
                    {fmtDate(t.createdAt)} · pagó {money(t.amount)}
                    {(t.kind === 'gift' || t.kind === 'referral') && t.note ? ` · ${t.note}` : ''}
                  </p>
                </div>
                {t.status === 'refunded' ? (
                  <span className="text-xs font-medium text-gray-500">Devuelto al fan</span>
                ) : (
                  <span className="font-bold text-green-700">+{money(creatorCut(t))}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CreatorPayouts;
