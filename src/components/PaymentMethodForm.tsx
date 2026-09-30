import React, { useState } from 'react';
import type { User } from '../context/AuthContext';
import { addPaymentMethod, type PaymentKind } from '../lib/platform';

const input = 'w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none text-sm';

export const paymentKindIcon: Record<PaymentKind, string> = {
  card: 'fas fa-credit-card',
  paypal: 'fab fa-paypal',
  google_pay: 'fab fa-google-pay',
};

// Add a Visa/Mastercard card, a PayPal account or Google Pay. Only masked data is stored.
const PaymentMethodForm: React.FC<{ user: User; onAdded: (id: string) => void; onCancel?: () => void }> = ({
  user,
  onAdded,
  onCancel,
}) => {
  const [kind, setKind] = useState<PaymentKind>('card');
  const [holder, setHolder] = useState('');
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [email, setEmail] = useState(user.email);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const result = await addPaymentMethod(user, kind === 'card' ? { kind, holder, number, expiry, cvc } : { kind, email });
    setSaving(false);
    if (!result.ok || !result.id) return setError(result.error || 'No se pudo guardar el método de pago');
    setError('');
    onAdded(result.id);
  };

  const formatCard = (v: string) => v.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
  const formatExpiry = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  };

  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-3" data-testid="payment-method-form">
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1" role="tablist">
        {[
          { id: 'card', label: 'Visa / Mastercard' },
          { id: 'paypal', label: 'PayPal' },
          { id: 'google_pay', label: 'Google Pay' },
        ].map((k) => (
          <button
            key={k.id}
            type="button"
            role="tab"
            aria-selected={kind === k.id}
            onClick={() => { setKind(k.id as PaymentKind); setError(''); }}
            className={`flex-1 py-2 rounded-md text-xs font-medium transition ${kind === k.id ? 'bg-white shadow text-pink-700' : 'text-gray-600'}`}
          >
            <i className={`${paymentKindIcon[k.id as PaymentKind]} mr-1`}></i>{k.label}
          </button>
        ))}
      </div>

      {kind === 'card' && (
        <>
          <input className={input} placeholder="Titular de la tarjeta" autoComplete="cc-name" value={holder} onChange={(e) => setHolder(e.target.value)} />
          <input className={input} placeholder="Número de tarjeta" inputMode="numeric" autoComplete="cc-number" value={number} onChange={(e) => setNumber(formatCard(e.target.value))} />
          <div className="grid grid-cols-2 gap-3">
            <input className={input} placeholder="MM/AA" inputMode="numeric" autoComplete="cc-exp" value={expiry} onChange={(e) => setExpiry(formatExpiry(e.target.value))} />
            <input className={input} placeholder="CVC" inputMode="numeric" autoComplete="cc-csc" value={cvc} onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </div>
          <p className="text-xs text-gray-500">
            <i className="fas fa-lock mr-1"></i>Aceptamos Visa y Mastercard de crédito o débito. Solo guardamos la marca y los últimos 4 dígitos; el CVC nunca se almacena.
          </p>
        </>
      )}
      {kind !== 'card' && (
        <>
          <input
            className={input}
            type="email"
            name="walletEmail"
            placeholder={kind === 'paypal' ? 'Email de tu cuenta PayPal' : 'Email de tu cuenta de Google'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className="text-xs text-gray-500">
            {kind === 'paypal'
              ? 'Autorizas a SugarFans a cobrar tus suscripciones desde PayPal. Puedes quitarlo cuando quieras.'
              : 'Pagarás con la tarjeta guardada en tu Google Pay. Puedes quitarlo cuando quieras.'}
          </p>
        </>
      )}

      {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-2 justify-end">
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
        )}
        <button type="button" onClick={submit} disabled={saving} className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:opacity-90">
          {kind === 'card' ? 'Guardar método de pago' : kind === 'paypal' ? 'Vincular PayPal' : 'Vincular Google Pay'}
        </button>
      </div>
    </div>
  );
};

export default PaymentMethodForm;
