import React, { useState } from 'react';
import { usePlatform, methodsFor, defaultMethodFor, money } from '../lib/platform';
import PaymentMethodForm from './PaymentMethodForm';

interface Props {
  userId: string;
  title: string;
  amount: number;
  note?: string; // e.g. "Se renueva el 29 de cada mes"
  confirmLabel?: string;
  onConfirm: (methodId: string) => { ok: boolean; error?: string };
  onClose: () => void;
}

// Pick (or add) a payment method and confirm a charge. Reusable for subscriptions and VIP bookings.
const CheckoutDialog: React.FC<Props> = ({ userId, title, amount, note, confirmLabel = 'Pagar', onConfirm, onClose }) => {
  const data = usePlatform();
  const methods = methodsFor(data, userId);
  const [selected, setSelected] = useState(defaultMethodFor(data, userId)?.id ?? '');
  const [adding, setAdding] = useState(methods.length === 0);
  const [error, setError] = useState('');

  const confirm = () => {
    if (!selected) return setError('Añade o elige un método de pago');
    const result = onConfirm(selected);
    if (!result.ok) setError(result.error || 'No se pudo completar el pago');
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            {note && <p className="text-sm text-gray-500 mt-1">{note}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="flex justify-between items-center bg-gray-50 rounded-xl p-4 mb-4">
          <span className="text-gray-600 text-sm">Total</span>
          <span className="text-2xl font-bold text-gray-900">{money(amount)}</span>
        </div>

        <h4 className="text-sm font-medium text-gray-700 mb-2">Método de pago</h4>
        <div className="space-y-2 mb-3">
          {methods.map((m) => (
            <label key={m.id} className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer ${selected === m.id ? 'border-pink-500 bg-pink-50' : 'border-gray-200'}`}>
              <input type="radio" name="payment-method" checked={selected === m.id} onChange={() => setSelected(m.id)} />
              <span className="text-sm font-medium text-gray-900">{m.label}</span>
              <span className="text-xs text-gray-500 ml-auto">{m.detail}</span>
            </label>
          ))}
        </div>

        {adding ? (
          <PaymentMethodForm
            userId={userId}
            onAdded={(id) => { setSelected(id); setAdding(false); setError(''); }}
            onCancel={methods.length ? () => setAdding(false) : undefined}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="text-sm text-pink-600 hover:text-pink-700 font-medium">
            <i className="fas fa-plus mr-1"></i> Añadir otro método
          </button>
        )}

        {error && <p role="alert" className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        <button
          type="button"
          onClick={confirm}
          disabled={adding}
          className="mt-5 w-full bg-gradient-to-r from-pink-500 to-purple-600 text-white py-3 rounded-xl font-bold hover:opacity-90 disabled:opacity-40"
        >
          <i className="fas fa-lock mr-2"></i>{confirmLabel} {money(amount)}
        </button>
        <p className="text-xs text-gray-400 text-center mt-2">Pago de demostración: aún no se conecta a una pasarela real.</p>
      </div>
    </div>
  );
};

export default CheckoutDialog;
