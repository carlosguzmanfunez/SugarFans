import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  usePlatformQuery,
  platformApi,
  computeEarnings,
  setPayoutAccount,
  requestPayout,
  cancelPayout,
  money,
  CREATOR_SHARE,
  creatorCut,
  MIN_PAYOUT,
  nextCreditDate,
  transactionLabel,
  payoutAccountLabel,
  payoutFee,
  PAYOUT_FEE_RATE,
  PAYOUT_FEE_MAX,
  type Payout,
} from '../lib/platform';
import { GIFT_SHARE } from '../lib/giftRules';
import { BRAND, displayPayer } from '../config/brand';
import { displayGiftNote } from '../config/gifts';

const field = 'w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none text-sm';
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

// How each withdrawal looks in the list.
const payoutBadge: Record<Payout['status'], { label: string; chip: string; icon: string }> = {
  paid: { label: 'Pagado', chip: 'bg-green-100 text-green-700', icon: 'fa-check-circle text-green-600' },
  sending: { label: 'En camino', chip: 'bg-blue-100 text-blue-700', icon: 'fa-clock text-blue-600' },
  failed: { label: 'No se pudo enviar', chip: 'bg-red-100 text-red-700', icon: 'fa-times-circle text-red-600' },
};

// What PayPal says about a withdrawal still on its way.
const sendingNote = (state?: string) =>
  state === 'UNCLAIMED'
    ? 'PayPal no pudo entregarlo: no hay una cuenta con ese email o esa cuenta no puede recibir pagos (cancélalo para que vuelva a tu saldo, o vuelve solo en 30 días)'
    : state === 'ONHOLD'
      ? 'PayPal lo retuvo para revisarlo'
      : state
        ? `PayPal lo está enviando (estado en PayPal: ${state})`
        : 'PayPal lo está enviando';

// Creator dashboard > Ingresos: real balance (80% of fan payments), PayPal account and withdrawals.
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
  const [paypalEmail, setPaypalEmail] = useState('');
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
    const r = await setPayoutAccount(user, paypalEmail);
    setNotice(r.ok ? { ok: true, text: 'Cuenta PayPal guardada' } : { ok: false, text: r.error! });
    if (r.ok) setEditingAccount(false);
  };

  const withdraw = async () => {
    const r = await requestPayout(user);
    if (!r.ok) return setNotice({ ok: false, text: r.error! });
    setNotice({
      ok: true,
      text:
        r.status === 'sending'
          ? `Retiro en camino: PayPal está enviando ${money(r.amount ?? 0)} a tu cuenta`
          : `Retiro pagado: ${money(r.amount ?? 0)} enviados a tu cuenta PayPal`,
    });
  };

  const cancel = async (id: string) => {
    const r = await cancelPayout(user, id);
    setNotice(r.ok ? { ok: true, text: 'Retiro cancelado: el monto volvió a tu saldo. Revisa el email de PayPal y vuelve a retirar.' } : { ok: false, text: r.error! });
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
          saldo completo, a partir de {money(MIN_PAYOUT)} USD, a tu cuenta PayPal (desde ahí puedes pasarlo a tu banco). Todo se paga en dólares (USD).
          PayPal cobra {PAYOUT_FEE_RATE * 100}% (máximo {money(PAYOUT_FEE_MAX)}) por enviar el retiro, y esa comisión se descuenta del monto retirado.
        </p>
        {!verified && (
          <p className="text-sm bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-xl p-3 mb-4">
            <i aria-hidden="true" className="fas fa-id-card mr-2"></i>Para retirar necesitas verificar tu identidad.{' '}
            <Link to="/settings?section=verification" className="font-medium underline">Verificar ahora</Link>
          </p>
        )}
        {payoutAccount && !editingAccount ? (
          <div className="flex items-center justify-between bg-gray-50 rounded-xl p-4 mb-4">
            <div>
              <p className="text-sm font-medium text-gray-900">{payoutAccountLabel(payoutAccount)}</p>
              <p className="text-xs text-gray-500">Aquí recibes tus retiros</p>
            </div>
            <button type="button" onClick={() => setEditingAccount(true)} className="text-sm text-pink-600">Cambiar</button>
          </div>
        ) : (
          <div className="space-y-3 mb-4 max-w-lg">
            <p className="text-sm font-medium text-gray-700">Cuenta PayPal para retiros</p>
            <input
              className={field}
              type="email"
              autoComplete="email"
              placeholder="Email de tu cuenta PayPal"
              value={paypalEmail}
              onChange={(e) => setPaypalEmail(e.target.value)}
            />
            <p className="text-xs text-gray-500">Usa el email con el que entras a PayPal; si aún no tienes cuenta, puedes crearla gratis en paypal.com.</p>
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
          {canWithdraw && (
            <p className="text-xs text-gray-500">
              Recibirás {money(earnings.available - payoutFee(earnings.available))} (comisión de PayPal {money(payoutFee(earnings.available))}).
            </p>
          )}
          {!canWithdraw && (
            <p className="text-xs text-gray-500">Podrás retirar cuando tu saldo disponible llegue a {money(MIN_PAYOUT)}.</p>
          )}
        </div>
        {paid.length > 0 && (
          <div className="mt-6" data-testid="payouts">
            <p className="text-sm font-semibold text-gray-900">Tus retiros</p>
            <div className="divide-y divide-gray-100">
              {paid.map((p) => (
                <div key={p.id} className="py-3 flex items-center gap-3 text-sm">
                  <i className={`fas ${payoutBadge[p.status].icon} text-lg`} aria-hidden="true"></i>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">Retiraste {money(p.amount)} · {p.accountLabel}</p>
                    <p className="text-xs text-gray-500">
                      Disponías de {money(p.availableBefore)}
                      {p.fee > 0 && ` · recibes ${money(p.net)} (comisión de PayPal ${money(p.fee)})`}
                      {p.status === 'paid' && p.paidAt && ` · pagado el ${fmtDate(p.paidAt)}`}
                      {p.status === 'sending' && ` · ${sendingNote(p.paypalState)}`}
                      {p.status === 'failed' && ' · el monto volvió a tu saldo'}
                    </p>
                  </div>
                  {p.status === 'sending' && p.paypalState === 'UNCLAIMED' && (
                    <button type="button" onClick={() => cancel(p.id)} className="text-xs font-semibold text-pink-600 hover:text-pink-700">
                      Cancelar y devolver a mi saldo
                    </button>
                  )}
                  <span className={`text-xs px-2 py-1 rounded-full ${payoutBadge[p.status].chip}`}>{payoutBadge[p.status].label}</span>
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
                  <p className="font-medium text-gray-900">{transactionLabel[t.kind]} · {displayPayer(t.payerName)}</p>
                  <p className="text-xs text-gray-500">
                    {fmtDate(t.createdAt)} · pagó {money(t.amount)}
                    {(t.kind === 'gift' || t.kind === 'referral') && t.note ? ` · ${displayGiftNote(t.note, t.giftId)}` : ''}
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
