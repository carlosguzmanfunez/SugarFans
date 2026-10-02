import React, { useState } from 'react';
import type { User } from '../context/AuthContext';
import BuyCoinsDialog from './BuyCoinsDialog';
import GiftArt from './GiftArt';
import { ReserveNotice } from './reserve/ReserveBits';
import { RESERVE_COPY } from '../config/reserve';
import CoinIcon from './CoinIcon';
import { currencyWord } from '../config/currency';
import { giftCategoryLabel } from '../config/gifts';
import { usePlatformQuery, money } from '../lib/platform';
import {
  GIFTS,
  GIFT_CATEGORIES,
  VIDEO_MIN,
  DEFAULT_GIFT_SETTINGS,
  coinsToUsd,
  formatCoins,
  giftsApi,
  perksFor,
  sendGift,
  type Gift,
} from '../lib/gifts';

// Tile tint per category, from support to legend.
const TINT: Record<string, [string, string]> = {
  Dulces: ['#fdf2f8', '#fbcfe8'],
  Repostería: ['#fff7ed', '#fed7aa'],
  Romance: ['#fff1f2', '#fecdd3'],
  Lujo: ['#f5f3ff', '#ddd6fe'],
  Fantasía: ['#fefce8', '#fde68a'],
};

interface Props {
  user: User;
  creatorProfileId: string;
  creatorName: string;
  postId?: string;
  onSent: (gift: Gift) => void;
  onClose: () => void;
}

// Pick a gift, add a message (and what you want in a personalised video), pay with the virtual currency.
const GiftDialog: React.FC<Props> = ({ user, creatorProfileId, creatorName, postId, onSent, onClose }) => {
  const { data } = usePlatformQuery(
    async () => {
      const [wallet, settings] = await Promise.all([giftsApi.wallet(user), giftsApi.giftSettings(creatorProfileId)]);
      return { coins: wallet.coins, settings };
    },
    [user.id, creatorProfileId],
    { coins: 0, settings: DEFAULT_GIFT_SETTINGS }
  );
  const [selected, setSelected] = useState<Gift | null>(null);
  const [message, setMessage] = useState('');
  const [request, setRequest] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [buying, setBuying] = useState(false);

  const value = selected ? coinsToUsd(selected.coins) : 0;
  const perks = perksFor(value, data.settings);
  const short = selected ? Math.max(0, selected.coins - data.coins) : 0;

  const send = async () => {
    if (!selected) return setError('Elige un regalo');
    setSending(true);
    const r = await sendGift(user, { creatorProfileId, creatorName, giftId: selected.id, postId, message, request });
    setSending(false);
    if (!r.ok) return setError(r.error || 'No se pudo enviar el regalo');
    onSent(selected);
  };

  if (buying) {
    return <BuyCoinsDialog user={user} needed={short} onDone={() => { setBuying(false); setError(''); }} onClose={() => setBuying(false)} />;
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Regalo para ${creatorName}`}>
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Enviar regalo a {creatorName}</h3>
            <p className="text-sm text-gray-500 mt-1">
              Tienes <span className="font-semibold text-gray-900" data-testid="coin-balance"><CoinIcon /> {formatCoins(data.coins)}</span> {currencyWord}.{' '}
              <button type="button" onClick={() => setBuying(true)} className="text-pink-600 font-medium hover:underline">Comprar {currencyWord}</button>
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-1 text-gray-400 hover:text-gray-600">
            <i aria-hidden="true" className="fas fa-times"></i>
          </button>
        </div>

        {GIFT_CATEGORIES.map((cat) => (
          <div key={cat} className="mb-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{giftCategoryLabel(cat)}</p>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {GIFTS.filter((g) => g.category === cat).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={selected?.id === g.id}
                  aria-label={`${g.name}, ${formatCoins(g.coins)} ${currencyWord}`}
                  onClick={() => { setSelected(g); setError(''); }}
                  style={{ '--tile': TINT[cat][0], '--tile-edge': TINT[cat][1] } as React.CSSProperties}
                  className={`gift-tile p-2 pt-3 rounded-2xl border text-center ${selected?.id === g.id ? 'border-pink-500 ring-2 ring-pink-300' : 'border-white/80'}`}
                >
                  <GiftArt gift={g} size={56} className="mx-auto" />
                  <span className="mt-0.5 min-h-[2lh] text-xs leading-tight font-medium text-gray-800 text-balance line-clamp-2" title={g.name}>{g.name}</span>
                  <span className="block text-[11px] text-gray-500"><CoinIcon size={12} /> {formatCoins(g.coins)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}

        {selected && (
          <div className="border-t border-gray-100 pt-4 space-y-3">
            <div className="flex items-center gap-4">
              <div className="gift-pedestal shrink-0 w-24 h-24 rounded-3xl flex items-center justify-center">
                <GiftArt key={selected.id} gift={selected} size={80} float className="gift-pop" />
              </div>
              <p className="text-sm text-gray-700">
                <span className="block text-base font-bold text-gray-900">{selected.name}</span>
                {money(value)} en regalo para {creatorName}.
              </p>
            </div>
            {(perks.circle || perks.vault || perks.video || perks.call) && (
              <ul className="text-sm text-purple-800 bg-purple-50 rounded-xl p-3 space-y-1" data-testid="gift-perks">
                {perks.circle && <li><i aria-hidden="true" className="fas fa-users mr-2"></i>Entras al Círculo privado por 30 días</li>}
                {perks.vault && <li><i aria-hidden="true" className="fas fa-lock-open mr-2"></i>Acceso a la Bóveda por 30 días</li>}
                {perks.video && <li><i aria-hidden="true" className="fas fa-video mr-2"></i>Video personalizado, entregado en 7 días</li>}
                {perks.call && <li><i aria-hidden="true" className="fas fa-phone mr-2"></i>Videollamada privada, agendada en 30 días</li>}
              </ul>
            )}
            {value >= VIDEO_MIN && !data.settings.offersVideo && (
              <p className="text-xs text-gray-500">{creatorName} no ofrece video personalizado: el regalo se envía sin ese beneficio.</p>
            )}
            <ReserveNotice kind="gift" text={RESERVE_COPY.giftPerks} />
            {perks.video && (
              <textarea
                aria-label="Qué quieres en tu video"
                value={request}
                maxLength={500}
                onChange={(e) => setRequest(e.target.value)}
                placeholder="¿Qué quieres en tu video personalizado?"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none h-20 resize-none text-sm"
              />
            )}
            <input
              aria-label="Mensaje del regalo"
              value={message}
              maxLength={200}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Mensaje (opcional)"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none text-sm"
            />
          </div>
        )}

        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        {selected && short > 0 ? (
          <button type="button" onClick={() => setBuying(true)} className="mt-4 w-full bg-gray-900 text-white py-3 rounded-xl font-bold hover:opacity-90">
            Te faltan {formatCoins(short)} {currencyWord} · Comprar
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={!selected || sending}
            className="mt-4 w-full bg-gradient-to-r from-pink-500 to-purple-600 text-white py-3 rounded-xl font-bold hover:opacity-90 disabled:opacity-50"
          >
            {selected ? <>Enviar {selected.name} · <CoinIcon /> {formatCoins(selected.coins)}</> : 'Elige un regalo'}
          </button>
        )}
      </div>
    </div>
  );
};

export default GiftDialog;
