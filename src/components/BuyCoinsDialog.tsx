import React, { useState } from 'react';
import type { User } from '../context/AuthContext';
import CheckoutDialog from './CheckoutDialog';
import { money } from '../lib/platform';
import CoinIcon from './CoinIcon';
import { currencyWord } from '../config/currency';
import { COIN_PACKS, DAILY_UNVERIFIED_LIMIT, buyCoins, formatCoins, type CoinPack } from '../lib/gifts';

interface Props {
  user: User;
  // Coins the fan is short of, to highlight the smallest pack that covers it.
  needed?: number;
  onDone: (coins: number) => void;
  onClose: () => void;
}

// Step 1: pick a pack of the virtual currency. Step 2: pay (CheckoutDialog).
const BuyCoinsDialog: React.FC<Props> = ({ user, needed = 0, onDone, onClose }) => {
  const suggested = COIN_PACKS.find((p) => p.coins >= needed) ?? COIN_PACKS[COIN_PACKS.length - 1];
  const [pack, setPack] = useState<CoinPack | null>(null);

  if (pack) {
    return (
      <CheckoutDialog
        user={user}
        title={`${pack.name}: ${formatCoins(pack.coins)} ${currencyWord}`}
        amount={pack.price}
        note={`Recibes ${formatCoins(pack.coins)} ${currencyWord} para regalar (${money(pack.coins / 100)} en regalos).`}
        confirmLabel={`Comprar ${currencyWord}`}
        onConfirm={async (methodId) => {
          const r = await buyCoins(user, pack.id, methodId);
          if (r.ok) onDone(pack.coins);
          return r;
        }}
        onClose={() => setPack(null)}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Comprar ${currencyWord}`}>
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Comprar {currencyWord}</h3>
            <p className="text-sm text-gray-500 mt-1">Recibes en {currencyWord} todo lo que pagas: 100 {currencyWord} = $1 en regalos.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-1 text-gray-400 hover:text-gray-600">
            <i aria-hidden="true" className="fas fa-times"></i>
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {COIN_PACKS.map((p) => (
            <button
              key={p.id}
              type="button"
              data-testid="coin-pack"
              onClick={() => setPack(p)}
              className={`text-left p-4 rounded-xl border transition hover:border-pink-400 ${p.id === suggested.id && needed > 0 ? 'border-pink-500 ring-2 ring-pink-200' : 'border-gray-200'}`}
            >
              <p className="text-xs text-gray-500">{p.name}</p>
              <p className="font-bold text-gray-900 flex items-center gap-1.5"><CoinIcon /> {formatCoins(p.coins)}</p>
              <p className="text-sm text-pink-600 font-semibold">{money(p.price)}</p>
            </button>
          ))}
        </div>
        {!user.isVerified && (
          <p className="text-xs text-gray-500 mt-4">
            Sin verificar tu identidad puedes comprar hasta ${DAILY_UNVERIFIED_LIMIT} al día.
          </p>
        )}
      </div>
    </div>
  );
};

export default BuyCoinsDialog;
