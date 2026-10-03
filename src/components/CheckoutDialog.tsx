import React, { useEffect, useRef, useState } from 'react';
import type { User } from '../context/AuthContext';
import { usePlatformQuery, platformApi, money } from '../lib/platform';
import PaymentMethodForm, { paymentKindIcon } from './PaymentMethodForm';
import { PAID_WITH_PAYPAL, capturePaypalOrder, createPaypalOrder, loadPaypalSdk, paypalConfig, type PaypalConfig, type PaypalPurchase } from '../lib/paypal';

interface Props {
  user: User;
  title: string;
  amount: number;
  note?: string; // e.g. "Se renueva el 29 de cada mes"
  confirmLabel?: string;
  // Extra context under the total (e.g. what a subscription does and doesn't include).
  extra?: React.ReactNode;
  // When set and PayPal is configured, the fan pays with PayPal's buttons and
  // onConfirm receives PAID_WITH_PAYPAL once the server confirmed the purchase.
  paypal?: PaypalPurchase;
  onConfirm: (methodId: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}

// PayPal's buttons for one purchase. The server creates and captures the order.
const PaypalCheckout: React.FC<{ purchase: PaypalPurchase; config: PaypalConfig; onPaid: (operation: string) => void }> = ({ purchase, config, onPaid }) => {
  const box = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'paying'>('loading');
  const [error, setError] = useState('');
  // The latest purchase and callback, read when PayPal calls back.
  const latest = useRef({ purchase, onPaid });
  latest.current = { purchase, onPaid };

  useEffect(() => {
    let buttons: { close(): Promise<void> } | null = null;
    let cancelled = false;
    loadPaypalSdk(config.clientId!)
      .then((paypal) => {
        if (cancelled || !box.current) return;
        const b = paypal.Buttons({
          style: { layout: 'vertical', shape: 'pill', label: 'pay', height: 45 },
          createOrder: async () => {
            setError('');
            try {
              return await createPaypalOrder(latest.current.purchase);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'No se pudo iniciar el pago.');
              throw err;
            }
          },
          onApprove: async ({ orderID }) => {
            setStatus('paying');
            try {
              latest.current.onPaid(await capturePaypalOrder(orderID));
            } catch (err) {
              setError(err instanceof Error ? err.message : 'No se pudo completar el pago.');
              setStatus('ready');
            }
          },
          onCancel: () => setError('Cancelaste el pago en PayPal. No se te cobró nada.'),
          onError: () => setError((e) => e || 'PayPal tuvo un problema. Intenta de nuevo.'),
        });
        buttons = b;
        return b.render(box.current).then(() => !cancelled && setStatus('ready'));
      })
      .catch((err) => !cancelled && (setError(err instanceof Error ? err.message : 'No se pudo cargar PayPal.'), setStatus('ready')));
    return () => {
      cancelled = true;
      buttons?.close().catch(() => undefined);
    };
  }, [config.clientId]);

  return (
    <div>
      <h4 className="text-sm font-medium text-gray-700 mb-2">Paga con PayPal o con tarjeta</h4>
      {status === 'loading' && <p className="text-sm text-gray-500 py-3"><i aria-hidden="true" className="fas fa-spinner fa-spin mr-2"></i>Cargando PayPal…</p>}
      {status === 'paying' && <p className="text-sm text-gray-600 py-3"><i aria-hidden="true" className="fas fa-spinner fa-spin mr-2"></i>Confirmando tu pago…</p>}
      <div ref={box} className={status === 'paying' ? 'hidden' : ''} data-testid="paypal-buttons" />
      {error && <p role="alert" className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      <p className="text-xs text-gray-400 text-center mt-3">
        <i aria-hidden="true" className="fas fa-lock mr-1"></i>
        {config.env === 'sandbox' ? 'PayPal en modo de prueba: usa una cuenta sandbox, no se cobra dinero real.' : 'Pago seguro procesado por PayPal, en dólares (USD).'}
      </p>
    </div>
  );
};

// Shown once PayPal confirmed the payment, before the dialog closes.
const PaymentReceipt: React.FC<{ title: string; amount: number; operation: string; error: string; onDone: () => void }> = ({ title, amount, operation, error, onDone }) => (
  <div className="text-center" data-testid="payment-receipt">
    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
      <i aria-hidden="true" className="fas fa-check text-3xl text-green-600"></i>
    </div>
    <h3 className="text-xl font-bold text-gray-900">Pago exitoso</h3>
    <p className="mt-1 text-sm text-gray-500">Tu pago con PayPal se completó.</p>
    <dl className="mt-5 space-y-2 rounded-xl bg-gray-50 p-4 text-left text-sm">
      <div className="flex justify-between gap-4"><dt className="text-gray-500">Concepto</dt><dd className="text-right font-medium text-gray-900">{title.replace(/^Pagar:\s*/, '')}</dd></div>
      <div className="flex justify-between gap-4"><dt className="text-gray-500">Monto</dt><dd className="font-bold text-gray-900">{money(amount)} USD</dd></div>
      <div className="flex justify-between gap-4"><dt className="text-gray-500">Fecha</dt><dd className="text-gray-900">{new Date().toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })}</dd></div>
      <div className="flex justify-between gap-4"><dt className="text-gray-500">Operación PayPal</dt><dd className="break-all text-right font-mono text-xs text-gray-900">{operation}</dd></div>
    </dl>
    {error && <p role="alert" className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
    <button type="button" onClick={onDone} className="mt-5 w-full rounded-xl bg-green-600 py-3 font-bold text-white hover:bg-green-700">Listo</button>
  </div>
);

// Pick (or add) a payment method and confirm a charge. Reusable for subscriptions and VIP bookings.
const CheckoutDialog: React.FC<Props> = ({ user, title, amount, note, confirmLabel = 'Pagar', extra, paypal, onConfirm, onClose }) => {
  // null while checking whether PayPal is set up on the server.
  const [pp, setPp] = useState<PaypalConfig | null>(paypal ? null : { enabled: false, clientId: null, env: 'sandbox' });
  const wantsPaypal = !!paypal;
  useEffect(() => {
    if (wantsPaypal) paypalConfig().then(setPp);
  }, [wantsPaypal]);
  const usePaypal = !!(paypal && pp?.enabled);
  const { data: methods, loading } = usePlatformQuery(() => platformApi.paymentMethods(user.id), [user.id], []);
  const [selected, setSelected] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  // PayPal's operation number once paid: the receipt shows until the fan closes it.
  const [receipt, setReceipt] = useState<string | null>(null);

  // The purchase is already done on the server; this refreshes the screen and closes.
  const finishPaypal = async () => {
    const result = await onConfirm(PAID_WITH_PAYPAL);
    if (!result.ok) setError(result.error || 'El pago se hizo, pero no se pudo actualizar la pantalla. Recarga la página.');
  };

  // Preselect the default method; open the form straight away when there is none.
  useEffect(() => {
    if (loading) return;
    if (!methods.length) setAdding(true);
    else if (!methods.some((m) => m.id === selected)) setSelected((methods.find((m) => m.isDefault) ?? methods[0]).id);
  }, [loading, methods, selected]);

  const confirm = async () => {
    if (!selected) return setError('Añade o elige un método de pago');
    setPaying(true);
    const result = await onConfirm(selected);
    setPaying(false);
    if (!result.ok) setError(result.error || 'No se pudo completar el pago');
  };

  if (receipt) {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Pago exitoso">
        <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6">
          <PaymentReceipt title={title} amount={amount} operation={receipt} error={error} onDone={finishPaypal} />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            {note && <p className="text-sm text-gray-500 mt-1">{note}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-1 text-gray-400 hover:text-gray-600">
            <i aria-hidden="true" className="fas fa-times"></i>
          </button>
        </div>

        <div className="flex justify-between items-center bg-gray-50 rounded-xl p-4 mb-4">
          <span className="text-gray-600 text-sm">Total</span>
          <span className="text-2xl font-bold text-gray-900">{money(amount)}</span>
        </div>
        {extra && <div className="mb-4">{extra}</div>}

        {usePaypal ? (
          <PaypalCheckout
            purchase={paypal!}
            config={pp!}
            onPaid={setReceipt}
          />
        ) : !pp ? (
          <p className="text-sm text-gray-500 py-3"><i aria-hidden="true" className="fas fa-spinner fa-spin mr-2"></i>Preparando el pago…</p>
        ) : (
          <>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Método de pago</h4>
            <div className="space-y-2 mb-3">
              {methods.map((m) => (
                <label key={m.id} className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer ${selected === m.id ? 'border-pink-500 bg-pink-50' : 'border-gray-200'}`}>
                  <input type="radio" name="payment-method" checked={selected === m.id} onChange={() => setSelected(m.id)} />
                  <i aria-hidden="true" className={`${paymentKindIcon[m.kind]} text-gray-500`}></i>
                  <span className="text-sm font-medium text-gray-900">{m.label}</span>
                  <span className="text-xs text-gray-500 ml-auto">{m.detail}</span>
                </label>
              ))}
            </div>

            {adding ? (
              <PaymentMethodForm
                user={user}
                onAdded={(id) => { setSelected(id); setAdding(false); setError(''); }}
                onCancel={methods.length ? () => setAdding(false) : undefined}
              />
            ) : (
              <button type="button" onClick={() => setAdding(true)} className="text-sm text-pink-600 hover:text-pink-700 font-medium">
                <i aria-hidden="true" className="fas fa-plus mr-1"></i> Añadir otro método
              </button>
            )}

            {error && <p role="alert" className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

            <button
              type="button"
              onClick={confirm}
              disabled={adding || paying || !selected}
              className="mt-5 w-full bg-gradient-to-r from-pink-500 to-purple-600 text-white py-3 rounded-xl font-bold hover:opacity-90 disabled:opacity-40"
            >
              <i aria-hidden="true" className="fas fa-lock mr-2"></i>{confirmLabel} {money(amount)}
            </button>
            <p className="text-xs text-gray-400 text-center mt-2">Pago de demostración: aún no se conecta a una pasarela real.</p>
          </>
        )}
        {usePaypal && error && <p role="alert" className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      </div>
    </div>
  );
};

export default CheckoutDialog;
