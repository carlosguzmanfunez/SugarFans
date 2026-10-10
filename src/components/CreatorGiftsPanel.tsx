import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePlatformQuery, platformApi, money } from '../lib/platform';
import { socialApi } from '../lib/social';
import GiftArt from './GiftArt';
import {
  GIFT_SHARE,
  deliverVideo,
  giftById,
  giftsApi,
  scheduleCall,
  type PerkRequest,
} from '../lib/gifts';
import { BRAND, displayPayer } from '../config/brand';
import { displayGiftNote } from '../config/gifts';

const field = 'w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none text-sm';
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
const perkStatus: Record<PerkRequest['status'], string> = {
  pending: 'Pendiente',
  scheduled: 'Agendada',
  delivered: 'Entregado',
  refunded: 'Devuelto al fan',
};

// Creator panel > Regalos: what gifts are (support, nothing unlocked), videos and
// calls still owed from gifts sent before perks were retired, and the gifts received.
const CreatorGiftsPanel: React.FC = () => {
  const { user } = useAuth();
  const profileId = user?.creatorProfileId ?? '';
  const { data } = usePlatformQuery(
    async () => {
      if (!user) return null;
      const [perks, sales] = await Promise.all([giftsApi.perkRequests(user), platformApi.creatorSales(profileId)]);
      return { perks, gifts: sales.filter((t) => t.kind === 'gift') };
    },
    [user?.id, profileId],
    null
  );
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [slots, setSlots] = useState<Record<string, { date: string; time: string }>>({});

  if (!user || !data) return null;
  const say = (r: { ok: boolean; error?: string }, okText: string) =>
    setNotice(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error || 'No se pudo completar la acción' });

  const sendVideo = async (perk: PerkRequest, file: File) => {
    setBusy(true);
    const up = await socialApi.uploadMedia(user, file);
    const r = up.ok && up.media ? await deliverVideo(user, perk.id, up.media) : up;
    setBusy(false);
    say(r, `Video entregado a ${perk.fanName}`);
  };

  const book = async (perk: PerkRequest) => {
    const slot = slots[perk.id] ?? { date: '', time: '' };
    say(await scheduleCall(user, perk.id, slot.date, slot.time), `Videollamada con ${perk.fanName} agendada`);
  };

  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const monthGifts = data.gifts.filter((t) => t.status === 'paid' && t.createdAt >= monthStart);
  const monthValue = monthGifts.reduce((s, t) => s + t.amount, 0);
  const open = data.perks.filter((p) => p.status === 'pending');

  return (
    <div className="space-y-6" data-testid="creator-gifts">
      {notice && (
        <div role={notice.ok ? 'status' : 'alert'} className={`px-4 py-3 rounded-xl border text-sm ${notice.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {notice.text}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <p className="text-sm text-gray-500">Regalos este mes</p>
          <p className="text-2xl font-bold text-gray-900">{monthGifts.length}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <p className="text-sm text-gray-500">Tu parte ({GIFT_SHARE * 100}%)</p>
          <p className="text-2xl font-bold text-green-700" data-testid="gift-earnings">{money(monthValue * GIFT_SHARE)}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <p className="text-sm text-gray-500">Pedidos por entregar</p>
          <p className="text-2xl font-bold text-gray-900">{open.length}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6 space-y-2" data-testid="gift-perks-retired">
        <h3 className="font-bold text-gray-900">Qué son tus regalos</h3>
        <p className="text-sm text-gray-600">
          Apoyo voluntario de tus fans: recibes el {GIFT_SHARE * 100}% de cada regalo, acreditado el día 1 como el resto de tus ingresos.
        </p>
        <p className="text-sm text-gray-600">
          Los regalos no desbloquean acceso, videos ni videollamadas. Las videollamadas y experiencias se ofrecen en{' '}
          <Link to="/creator/dashboard?tab=vip" className="text-pink-600 hover:underline">Reserve</Link>. Si activas tu{' '}
          <Link to="/creator/dashboard?tab=rewards" className="text-pink-600 hover:underline">Meta de experiencia</Link>, los regalos y propinas
          de cada fan la van llenando hasta ganar una de tus experiencias.
        </p>
      </div>

      {data.perks.length > 0 && (
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h3 className="font-bold text-gray-900 mb-1">Pedidos de regalos anteriores</h3>
        <p className="text-sm text-gray-500 mb-3">Videos y videollamadas que tus fans ganaron antes del cambio. Se siguen entregando aquí.</p>
        {(
          <div className="divide-y divide-gray-100">
            {data.perks.map((p) => (
              <div key={p.id} className="py-3 text-sm space-y-2" data-testid="perk-request">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-gray-900">
                    {p.kind === 'video' ? 'Video personalizado' : 'Videollamada 1:1'} · {p.fanName}
                  </p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${p.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : p.status === 'refunded' ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'}`}>
                    {perkStatus[p.status]}
                  </span>
                </div>
                {p.request && <p className="text-gray-600">“{p.request}”</p>}
                {p.status === 'pending' && <p className="text-xs text-gray-500">Vence el {fmtDate(p.dueAt)}</p>}
                {p.status === 'pending' && p.kind === 'video' && (
                  <label className="inline-block text-xs bg-pink-50 text-pink-700 px-3 py-2 rounded-lg cursor-pointer">
                    <i aria-hidden="true" className="fas fa-upload mr-1"></i>Subir video y entregar
                    <input type="file" name="perkVideo" accept="video/*" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && sendVideo(p, e.target.files[0])} />
                  </label>
                )}
                {p.status === 'pending' && p.kind === 'call' && (
                  <div className="flex flex-wrap gap-2 items-center">
                    <input type="date" aria-label="Día de la videollamada" className={`${field} max-w-[11rem]`} value={slots[p.id]?.date ?? ''} onChange={(e) => setSlots({ ...slots, [p.id]: { time: slots[p.id]?.time ?? '', date: e.target.value } })} />
                    <input type="time" aria-label="Hora de la videollamada" step={3600} className={`${field} max-w-[8rem]`} value={slots[p.id]?.time ?? ''} onChange={(e) => setSlots({ ...slots, [p.id]: { date: slots[p.id]?.date ?? '', time: e.target.value.slice(0, 2) + ':00' } })} />
                    <button type="button" onClick={() => book(p)} className="text-xs bg-pink-600 text-white px-3 py-2 rounded-lg">Agendar</button>
                  </div>
                )}
                {p.status === 'scheduled' && p.bookingId && (
                  <p className="text-xs text-gray-500">Aparece en tu Reserve con el botón para entrar a la sala.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h3 className="font-bold text-gray-900 mb-3">Regalos recibidos</h3>
        {data.gifts.length === 0 ? (
          <p className="text-sm text-gray-500">Aún no has recibido regalos.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.gifts.slice(0, 30).map((t) => (
              <div key={t.id} className="py-2 flex items-center justify-between text-sm" data-testid="gift-received">
                <span className="flex items-center gap-2">
                  {t.giftId && giftById(t.giftId) && <GiftArt gift={giftById(t.giftId)!} size={28} />}
                  {displayGiftNote(t.note, t.giftId)} · {displayPayer(t.payerName)}
                </span>
                {t.status === 'refunded' ? (
                  <span className="text-xs text-gray-500">Devuelto</span>
                ) : t.status === 'disputed' ? (
                  <span className="text-xs text-amber-600">En disputa con PayPal</span>
                ) : (
                  <span className="font-semibold text-green-700">+{money(t.amount * GIFT_SHARE)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CreatorGiftsPanel;
