import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { User } from '../context/AuthContext';
import BuyCoinsDialog from './BuyCoinsDialog';
import GiftArt from './GiftArt';
import CoinIcon from './CoinIcon';
import { VIRTUAL_CURRENCY, currencyWord, displayMethodLabel } from '../config/currency';
import { usePlatformQuery, money } from '../lib/platform';
import { DAILY_UNVERIFIED_LIMIT, formatCoins, giftById, giftsApi, packById, type PerkRequest, type SentGift, type Wallet } from '../lib/gifts';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

const perkLabel = (p: PerkRequest) => {
  if (p.status === 'refunded') return `No se entregó a tiempo: te devolvimos los ${currencyWord}`;
  if (p.kind === 'video') return p.status === 'delivered' ? 'Video entregado' : `Pendiente, se entrega antes del ${fmtDate(p.dueAt)}`;
  return p.status === 'scheduled' ? 'Videollamada agendada' : `Pendiente de agendar, antes del ${fmtDate(p.dueAt)}`;
};

// Settings > wallet (virtual currency): balance, packs bought, gifts sent and the perks owed to the fan.
const WalletPanel: React.FC<{ user: User }> = ({ user }) => {
  const { data } = usePlatformQuery(
    async () => {
      const [wallet, sent, perks] = await Promise.all([giftsApi.wallet(user), giftsApi.sentGifts(user), giftsApi.perkRequests(user)]);
      return { wallet, sent, perks: perks.filter((p) => p.fanId === user.id) };
    },
    [user.id],
    { wallet: { coins: 0, purchases: [], spentToday: 0 } as Wallet, sent: [] as SentGift[], perks: [] as PerkRequest[] }
  );
  const [buying, setBuying] = useState(false);
  const [notice, setNotice] = useState('');

  return (
    <div className="space-y-6" data-testid="wallet">
      <div className="bg-gradient-to-br from-pink-500 to-purple-600 text-white rounded-2xl p-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm opacity-80">Tus {currencyWord}</p>
          <p className="text-3xl font-bold flex items-center gap-2" data-testid="wallet-balance"><CoinIcon size={30} /> {formatCoins(data.wallet.coins)}</p>
          <p className="text-xs opacity-80 mt-1">Equivalen a {money(data.wallet.coins / 100)} en regalos</p>
        </div>
        <button type="button" onClick={() => setBuying(true)} className="shrink-0 whitespace-nowrap bg-white text-pink-600 px-4 sm:px-5 py-2.5 rounded-full font-bold hover:bg-pink-50">
          Comprar {currencyWord}
        </button>
      </div>
      {notice && <div role="status" className="px-4 py-3 rounded-xl border bg-green-50 border-green-200 text-green-700 text-sm">{notice}</div>}
      {!user.isVerified && (
        <p className="text-xs text-gray-500">
          Sin verificar tu identidad puedes comprar hasta ${DAILY_UNVERIFIED_LIMIT} al día (hoy llevas {money(data.wallet.spentToday)}).{' '}
          <Link to="/settings?section=verification" className="text-pink-600 hover:underline">Verificarme</Link>
        </p>
      )}

      {data.perks.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h4 className="font-semibold text-gray-900 mb-3">Tus beneficios</h4>
          <div className="divide-y divide-gray-100">
            {data.perks.map((p) => (
              <div key={p.id} className="py-3 text-sm" data-testid="my-perk">
                <p className="font-medium text-gray-900">{p.kind === 'video' ? 'Video personalizado' : 'Videollamada 1:1'} de {p.creatorName}</p>
                <p className="text-xs text-gray-500">{perkLabel(p)}</p>
                {p.status === 'delivered' && p.mediaUrl && <video src={p.mediaUrl} controls playsInline className="mt-2 w-full max-w-sm rounded-xl" />}
                {p.status === 'scheduled' && p.bookingId && (
                  <Link to={`/live/${p.bookingId}`} className="inline-block mt-2 text-xs bg-pink-600 text-white px-3 py-1.5 rounded-lg">Ir a la sala</Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h4 className="font-semibold text-gray-900 mb-3">Regalos enviados</h4>
        {data.sent.length === 0 ? (
          <p className="text-sm text-gray-500">Aún no has enviado regalos. Búscalos en el perfil de tus creadores favoritos.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.sent.map((g) => {
              const gift = giftById(g.giftId);
              return (
                <div key={g.id} className="py-2 flex items-center justify-between text-sm" data-testid="sent-gift">
                  <span className="flex items-center gap-2">{gift && <GiftArt gift={gift} size={28} />}{gift?.name ?? 'Regalo'} · <Link to={`/creator/${g.creatorProfileId}`} className="text-pink-600">{g.creatorName}</Link></span>
                  <span className="text-gray-500">{g.status === 'refunded' ? 'Devuelto' : g.status === 'disputed' ? 'En disputa' : <><CoinIcon size={14} /> {formatCoins(g.coins)}</>}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h4 className="font-semibold text-gray-900 mb-3">Compras de {currencyWord}</h4>
        {data.wallet.purchases.length === 0 ? (
          <p className="text-sm text-gray-500">Aún no has comprado {currencyWord}.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.wallet.purchases.map((p) => (
              <div key={p.id} className="py-2 flex items-center justify-between text-sm" data-testid="coin-purchase">
                <span>{packById(p.packId)?.name ?? 'Paquete'} · <CoinIcon size={14} /> {formatCoins(p.coins)} · {displayMethodLabel(p.methodLabel)}</span>
                <span className="text-gray-500">{money(p.price)} · {fmtDate(p.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {buying && (
        <BuyCoinsDialog
          user={user}
          onDone={(coins) => { setBuying(false); setNotice(`Compra completada: ${formatCoins(coins)} ${currencyWord} añadidos`); }}
          onClose={() => setBuying(false)}
        />
      )}
    </div>
  );
};

export default WalletPanel;
