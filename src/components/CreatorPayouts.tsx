import React, { useState } from 'react';
import Notice from './Notice';
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
  type Payout,
} from '../lib/platform';
import { GIFT_SHARE } from '../lib/giftRules';
import { rewardsApi } from '../lib/rewards';
import { BRAND, displayPayer } from '../config/brand';
import { displayGiftNote } from '../config/gifts';
import { earningsCycle, payoutWindow, formatPayoutDate } from '../lib/payoutCalendar';
import { usePayoutCalendar } from '../lib/usePayoutCalendar';
import { useCreatorBalance } from '../lib/useCreatorBalance';
import { payoutRequestMessage, sendingPayoutNote } from '../lib/payoutMessages';

const field = 'w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none text-sm';
const fmtDate = formatPayoutDate;

// How each withdrawal looks in the list.
const payoutBadge: Record<Payout['status'], { label: string; chip: string; icon: string }> = {
  paid: { label: 'Pagado', chip: 'bg-green-100 text-green-700', icon: 'fa-check-circle text-green-600' },
  sending: { label: 'En proceso', chip: 'bg-blue-100 text-blue-700', icon: 'fa-clock text-blue-600' },
  failed: { label: 'Devuelto al saldo', chip: 'bg-red-100 text-red-700', icon: 'fa-times-circle text-red-600' },
};

// Creator dashboard > Ingresos: real balance (80% of fan payments), PayPal account and withdrawals.
const CreatorPayouts: React.FC = () => {
  const { user } = useAuth();
  const calendar = usePayoutCalendar();
  const userId = user?.id ?? '';
  const book = useCreatorBalance(userId);
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
  // Oro and Diamante withdraw from $25.
  const { data: terms } = usePlatformQuery(() => (user ? rewardsApi.payoutTerms(user) : Promise.resolve({ min: MIN_PAYOUT })), [userId], { min: MIN_PAYOUT });
  const [paypalEmail, setPaypalEmail] = useState('');
  const [editingAccount, setEditingAccount] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  if (!user) return null;
  const { sales, payoutAccount } = data;
  const earnings = computeEarnings(sales, data.payouts, calendar.at, calendar.data?.legacyCutoff,book.data);
  const paid = data.payouts;
  const cycle = earningsCycle(calendar.at);
  const window = payoutWindow(calendar.at);
  const creditDay = fmtDate(nextCreditDate(calendar.at));
  const canWithdraw = book.ready && !!calendar.data && !loading && window.open && !!user.isVerified && !!payoutAccount && !book.data?.holds?.length && !data.payouts.some(p=>p.status==='sending') && earnings.available >= terms.min;
  const fee = payoutFee(earnings.available);
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
      text: payoutRequestMessage(r.status, r.amount),
    });
  };

  const cancel = async (id: string) => {
    const r = await cancelPayout(user, id);
    setNotice(r.ok ? { ok: true, text: 'Retiro cancelado: el monto volvió a tu saldo. Revisa el email de PayPal y vuelve a retirar.' } : { ok: false, text: r.error! });
  };

  return (
    <div className="space-y-6" data-testid="earnings" aria-busy={loading}>
      {notice && <Notice ok={notice.ok} text={notice.text} onClose={() => setNotice(null)} />}
      <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6">
        <h3 className="font-bold text-gray-900 mb-1">Resumen de ingresos</h3>
        <p className="text-sm text-gray-600 mb-3" data-testid="earnings-cycle">Ciclo actual: {fmtDate(cycle.start)} – {fmtDate(cycle.lastDay)}. Hora de Honduras (UTC−6).</p>
        {calendar.data && calendar.data.legacyCutoff > cycle.start && <p className="text-xs text-gray-500 mb-3">Los importes ya acreditados antes de este calendario permanecen en el saldo de ciclos cerrados.</p>}
        {!calendar.loading && !calendar.data && <p role="alert" className="text-sm text-amber-800 mb-3">No pudimos confirmar el calendario de pagos. Actualiza la página antes de solicitar un pago.</p>}
        {!book.ready && <p role="status" className="text-sm text-amber-800 mb-3">Estamos confirmando tu saldo y lo apartado para pagos. <button className="underline" onClick={book.reload}>Actualizar saldo</button></p>}
        {book.data && book.data.reserved>0 && <p className="text-sm bg-amber-50 text-amber-900 p-3 rounded-xl mb-3" data-testid="creator-batch-reserved">{money(book.data.reserved)} apartados para el lote de pago. Ese importe sigue siendo tuyo y ya está separado del saldo que puedes retirar manualmente.</p>}
        <p className="text-sm text-gray-500 mb-4">Recibes el {CREATOR_SHARE * 100}% de lo que llega de cada pago después de la comisión de PayPal (más en Diamante y con los fans de tu enlace; {GIFT_SHARE * 100}% de los regalos). Los detalles están en Recompensas.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-green-50 rounded-xl p-4">
            <p className="text-sm text-green-700">Disponible sin apartar · ciclos cerrados</p>
            <p className="text-2xl font-bold text-green-900" data-testid="available-balance">{calendar.data && book.ready ? money(earnings.available) : '—'}</p>
          </div>
          <div className="bg-blue-50 rounded-xl p-4">
            <p className="text-sm text-blue-700">En acumulación · se acredita el {creditDay}</p>
            <p className="text-2xl font-bold text-blue-900" data-testid="pending-balance">{calendar.data && book.ready ? money(earnings.pending) : '—'}</p>
          </div>
          <div className="bg-purple-50 rounded-xl p-4">
            <p className="text-sm text-purple-700">Total ganado</p>
            <p className="text-2xl font-bold text-purple-900">{book.ready?money(earnings.totalEarned):'—'}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6">
        <h3 className="font-bold text-gray-900 mb-1">Retirar saldo</h3>
        <p className="text-sm text-gray-500 mb-4">
          Tus ganancias se acumulan del 26 de cada mes al 25 del siguiente. Al comenzar el 26 se cierra ese ciclo y empieza uno nuevo.
          La ventana de pago va del 26 al día 1 siguiente, ambos incluidos, en hora de Honduras (UTC−6).
          Por ahora solicita aquí el saldo completo durante esa ventana, a partir de {money(terms.min)} USD, a tu cuenta PayPal (desde ahí puedes pasarlo a tu banco). Todo se paga en dólares (USD).
          El costo real de enviar el retiro corre por tu cuenta. El panel muestra una estimación; las diferencias comprobadas con PayPal se registran a tu favor o a tu cargo, conservando el retiro original.
        </p>
        <p className="text-sm text-gray-700 mb-4" data-testid="payout-window">{window.open ? 'Ventana de pago abierta' : 'Próxima ventana de pago'}: {fmtDate(window.nextStart)} – {fmtDate(new Date(Date.parse(window.nextEnd) - 1).toISOString())}. Los saldos no pagados se conservan; las ganancias del nuevo ciclo se pagan en su próxima ventana.</p>
        {!!book.data?.holds?.length&&<div className="rounded-xl bg-amber-50 text-amber-900 p-3 mb-4 text-sm" data-testid="creator-payout-holds"><p className="font-medium">Tus retiros están en revisión</p><ul className="list-disc pl-5 mt-1">{book.data.holds.map(h=><li key={h.id}>{h.kind==='fee'?'Revisión del costo de un retiro':h.kind==='manual'?'Revisión administrativa de tu cuenta':'Comprobación de seguridad de pagos'}</li>)}</ul><p className="mt-2">El saldo permanece registrado. Puedes pedir una revisión a soporte; cada motivo se libera cuando termina su comprobación.</p></div>}
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
            <p className="text-xs text-gray-500">
              Usa el email con el que entras a PayPal. ¿Aún no tienes cuenta?{' '}
              <a href="https://www.paypal.com/signup" target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 underline hover:text-blue-800">
                Crea tu cuenta PayPal gratis<i aria-hidden="true" className="fas fa-arrow-up-right-from-square ml-1 text-[10px]"></i>
              </a>
            </p>
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
            {book.ready?`Retirar ${money(earnings.available)}`:'Confirmando saldo…'}
          </button>
          {canWithdraw && (
            <p className="text-xs text-gray-500">
              Importe previsto de envío: {money(earnings.available - fee)} (costo estimado del retiro: {money(fee)}).
            </p>
          )}
          {book.ready && !loading && window.open && calendar.data && earnings.available < terms.min && (
            <p className="text-xs text-gray-500">Podrás retirar cuando tu saldo disponible llegue a {money(terms.min)}.</p>
          )}
          {!window.open && <p className="text-xs text-gray-500">Las solicitudes de pago se habilitan del 26 al 1, hora de Honduras.</p>}
        </div>
        {paid.length > 0 && (
          <div className="mt-6" data-testid="payouts">
            <p className="text-sm font-semibold text-gray-900">Tus retiros</p>
            <div className="divide-y divide-gray-100">
              {paid.map((p) => (
                <div key={p.id} className="py-3 flex flex-wrap items-start gap-3 text-sm sm:flex-nowrap sm:items-center">
                  <i className={`fas ${payoutBadge[p.status].icon} text-lg`} aria-hidden="true"></i>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900">Retiro de {money(p.amount)} · {p.accountLabel}</p>
                    <p className="text-xs text-gray-500">
                      Disponías de {money(p.availableBefore)}
                      {p.fee > 0 && ` · importe ${p.status === 'paid' ? 'entregado' : 'previsto'} ${money(p.net)} (costo estimado registrado ${money(p.fee)})`}
                      {p.status === 'paid' && ` · PayPal confirmó la entrega${p.paidAt ? ` el ${fmtDate(p.paidAt)}` : ''}`}
                      {p.status === 'sending' && ` · ${sendingPayoutNote(p.paypalState)}`}
                      {p.status === 'failed' && ' · el monto volvió a tu saldo'}
                    </p>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-3 pl-7 sm:w-auto sm:flex-nowrap sm:pl-0">
                    {p.status === 'sending' && p.paypalState === 'UNCLAIMED' && (
                      <button type="button" onClick={() => cancel(p.id)} className="text-xs font-semibold text-pink-600 hover:text-pink-700">
                        Cancelar y devolver a mi saldo
                      </button>
                    )}
                    <span className={`shrink-0 text-xs px-2 py-1 rounded-full ${payoutBadge[p.status].chip}`}>{payoutBadge[p.status].label}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {!!book.data?.fee_adjustments?.length&&<div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6" data-testid="creator-fee-adjustments">
        <h3 className="font-bold text-gray-900 mb-3">Ajustes del costo de tus retiros</h3>
        <ul className="space-y-3">{book.data.fee_adjustments.map(a=><li key={a.id} className="rounded-xl bg-gray-50 p-3 text-sm"><p className="font-medium">{a.reversed_at?'Ajuste revertido':a.creator_delta>0?`${money(a.creator_delta)} a tu favor`:a.creator_delta<0?`${money(-a.creator_delta)} a tu cargo`:'Corrección del reporte, sin cambio de saldo'}</p><p className="text-gray-600">Estimado: {money(a.estimated_fee)} · Confirmado por PayPal: {money(a.actual_fee)} · {fmtDate(a.created_at)}</p></li>)}</ul>
        <p className="text-xs text-gray-500 mt-3">Los créditos nuevos se incorporan al siguiente cierre; los descuentos afectan el saldo disponible. Una reversión conserva la fecha original. Estos ajustes ya están incluidos en tus saldos.</p>
      </div>}
      <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6">
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
                {t.platformCovers && t.status !== 'paid' ? (
                  <span className="text-right">
                    <span className="block font-bold text-green-700">+{money(creatorCut(t))}</span>
                    <span className="block text-xs text-gray-500">Reembolsado al fan, lo cubre Fans Reserve</span>
                  </span>
                ) : t.status === 'refunded' ? (
                  <span className="text-xs font-medium text-gray-500">Devuelto al fan</span>
                ) : t.status === 'disputed' ? (
                  <span className="text-xs font-medium text-amber-600" title="El fan abrió una disputa en PayPal. Si PayPal te da la razón, vuelve a contar.">En disputa con PayPal</span>
                ) : t.status === 'failed' ? (
                  <span className="text-xs font-medium text-gray-500">Pago fallido</span>
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
