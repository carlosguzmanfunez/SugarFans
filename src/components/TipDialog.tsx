import React, { useState } from 'react';
import type { User } from '../context/AuthContext';
import CheckoutDialog from './CheckoutDialog';
import { TIP_PRESETS, MIN_TIP, MAX_TIP, validateTip, money } from '../lib/platform';
import { sendTip } from '../lib/social';

interface Props {
  user: User;
  creatorProfileId: string;
  creatorName: string;
  postId?: string;
  onDone: (amount: number) => void;
  onClose: () => void;
}

// Step 1: choose the amount and an optional message. Step 2: pay (CheckoutDialog).
const TipDialog: React.FC<Props> = ({ user, creatorProfileId, creatorName, postId, onDone, onClose }) => {
  const [amount, setAmount] = useState<number>(TIP_PRESETS[1]);
  const [custom, setCustom] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);

  const value = custom ? Number(custom) : amount;

  const next = () => {
    const check = validateTip(value);
    if (!check.ok) return setError(check.error!);
    setError('');
    setPaying(true);
  };

  if (paying) {
    return (
      <CheckoutDialog
        user={user}
        title={`Propina para ${creatorName}`}
        amount={value}
        note={message.trim() ? `Mensaje: “${message.trim()}”` : 'El 80% va directo al saldo del creador.'}
        confirmLabel="Enviar propina"
        onConfirm={async (methodId) => {
          const result = await sendTip(user, creatorProfileId, creatorName, value, methodId, postId, message);
          if (result.ok) onDone(value);
          return result;
        }}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Propina para ${creatorName}`}>
      <div className="bg-white rounded-2xl max-w-md w-full p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Enviar propina</h3>
            <p className="text-sm text-gray-500 mt-1">Apoya a {creatorName}. El 80% va directo a su saldo.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-1 text-gray-400 hover:text-gray-600">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-3">
          {TIP_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={!custom && amount === p}
              onClick={() => { setAmount(p); setCustom(''); }}
              className={`py-3 rounded-xl font-bold border transition ${!custom && amount === p ? 'bg-pink-500 text-white border-pink-500' : 'border-gray-200 text-gray-700 hover:border-pink-300'}`}
            >
              ${p}
            </button>
          ))}
        </div>
        <label className="block text-sm text-gray-700 mb-1" htmlFor="tip-custom">Otro monto (USD)</label>
        <input
          id="tip-custom"
          type="number"
          min={MIN_TIP}
          max={MAX_TIP}
          step="1"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder={`Entre $${MIN_TIP} y $${MAX_TIP}`}
          className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none mb-3"
        />
        <label className="block text-sm text-gray-700 mb-1" htmlFor="tip-message">Mensaje (opcional)</label>
        <textarea
          id="tip-message"
          value={message}
          maxLength={200}
          onChange={(e) => setMessage(e.target.value)}
          className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none h-20 resize-none"
          placeholder="¡Me encanta tu contenido!"
        />
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <button
          type="button"
          onClick={next}
          className="mt-4 w-full bg-gradient-to-r from-pink-500 to-purple-600 text-white py-3 rounded-xl font-bold hover:opacity-90"
        >
          Continuar · {Number.isFinite(value) && value > 0 ? money(value) : '$0.00'}
        </button>
      </div>
    </div>
  );
};

export default TipDialog;
