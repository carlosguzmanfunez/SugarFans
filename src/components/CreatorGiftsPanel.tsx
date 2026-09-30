import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePlatformQuery, platformApi, money } from '../lib/platform';
import { socialApi } from '../lib/social';
import GiftArt from './GiftArt';
import {
  CALL_MIN,
  CALL_MINUTES,
  CIRCLE_HIGHEST_MIN,
  CIRCLE_LOWEST_MIN,
  DEFAULT_GIFT_SETTINGS,
  GIFT_SHARE,
  VAULT_MIN,
  VIDEO_MIN,
  addVaultItem,
  deleteVaultItem,
  deliverVideo,
  giftById,
  giftsApi,
  saveGiftSettings,
  scheduleCall,
  type PerkRequest,
  type VaultItem,
} from '../lib/gifts';

const field = 'w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none text-sm';
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
const perkStatus: Record<PerkRequest['status'], string> = {
  pending: 'Pendiente',
  scheduled: 'Agendada',
  delivered: 'Entregado',
  refunded: 'Devuelto al fan',
};

// Creator panel > Regalos: what gifts unlock, owed videos and calls, the Bóveda
// and the gifts received this month.
const CreatorGiftsPanel: React.FC = () => {
  const { user } = useAuth();
  const profileId = user?.creatorProfileId ?? '';
  const { data } = usePlatformQuery(
    async () => {
      if (!user) return null;
      const [settings, perks, vault, sales] = await Promise.all([
        giftsApi.giftSettings(profileId),
        giftsApi.perkRequests(user),
        giftsApi.vaultItems(user, profileId),
        platformApi.creatorSales(profileId),
      ]);
      return { settings, perks, vault, gifts: sales.filter((t) => t.kind === 'gift') };
    },
    [user?.id, profileId],
    null
  );
  const [circleMin, setCircleMin] = useState(String(DEFAULT_GIFT_SETTINGS.circleMin));
  const [offersVideo, setOffersVideo] = useState(false);
  const [offersCall, setOffersCall] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [vaultTitle, setVaultTitle] = useState('');
  const [vaultFile, setVaultFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [slots, setSlots] = useState<Record<string, { date: string; time: string }>>({});

  useEffect(() => {
    if (!data) return;
    setCircleMin(String(data.settings.circleMin));
    setOffersVideo(data.settings.offersVideo);
    setOffersCall(data.settings.offersCall);
  }, [data?.settings.circleMin, data?.settings.offersVideo, data?.settings.offersCall]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user || !data) return null;
  const say = (r: { ok: boolean; error?: string }, okText: string) =>
    setNotice(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error || 'No se pudo completar la acción' });

  const save = async () => {
    say(await saveGiftSettings(user, { circleMin: Number(circleMin), offersVideo, offersCall }), 'Configuración de regalos guardada');
  };

  const uploadVault = async () => {
    if (!vaultFile) return setNotice({ ok: false, text: 'Elige una foto o un video' });
    setBusy(true);
    const up = await socialApi.uploadMedia(user, vaultFile);
    const r = up.ok && up.media ? await addVaultItem(user, vaultTitle, up.media) : up;
    setBusy(false);
    say(r, 'Añadido a tu Bóveda');
    if (r.ok) {
      setVaultTitle('');
      setVaultFile(null);
    }
  };

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

      <div className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
        <div>
          <h3 className="font-bold text-gray-900">Qué desbloquean tus regalos</h3>
          <p className="text-sm text-gray-500">
            Recibes el {GIFT_SHARE * 100}% de cada regalo, acreditado el día 1 como el resto de tus ingresos.{' '}
            <Link to={`/creator/${profileId}?tab=circle`} className="text-pink-600 hover:underline">Ver mi Círculo</Link>
          </p>
        </div>
        <label className="block text-sm text-gray-700">
          Entrada al Círculo privado (USD, entre ${CIRCLE_LOWEST_MIN} y ${CIRCLE_HIGHEST_MIN})
          <input className={`${field} mt-1 max-w-xs`} type="number" min={CIRCLE_LOWEST_MIN} max={CIRCLE_HIGHEST_MIN} step="1" name="circleMin" value={circleMin} onChange={(e) => setCircleMin(e.target.value)} />
          <span className="block text-xs text-gray-500 mt-1">Un regalo de ese monto, o regalos que lo sumen en el mes, dan 30 días de Círculo. La Bóveda se abre con {money(VAULT_MIN)}.</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" className="mt-1" checked={offersVideo} onChange={(e) => setOffersVideo(e.target.checked)} />
          <span>Ofrezco video personalizado con regalos de {money(VIDEO_MIN)} o más<span className="block text-xs text-gray-500">Tienes 7 días para entregarlo; si no, se devuelve el regalo al fan.</span></span>
        </label>
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" className="mt-1" checked={offersCall} onChange={(e) => setOffersCall(e.target.checked)} />
          <span>Ofrezco videollamada privada de {CALL_MINUTES} min con regalos de {money(CALL_MIN)}<span className="block text-xs text-gray-500">Agéndala en los 30 días siguientes; si no, se devuelve el regalo.</span></span>
        </label>
        <button type="button" onClick={save} className="bg-gray-900 text-white px-5 py-2 rounded-lg text-sm font-medium">Guardar</button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h3 className="font-bold text-gray-900 mb-3">Videos y videollamadas pedidos</h3>
        {data.perks.length === 0 ? (
          <p className="text-sm text-gray-500">Aún no tienes pedidos.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.perks.map((p) => (
              <div key={p.id} className="py-3 text-sm space-y-2" data-testid="perk-request">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-gray-900">
                    {p.kind === 'video' ? 'Video personalizado' : 'Videollamada privada'} · {p.fanName}
                  </p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${p.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : p.status === 'refunded' ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'}`}>
                    {perkStatus[p.status]}
                  </span>
                </div>
                {p.request && <p className="text-gray-600">“{p.request}”</p>}
                {p.status === 'pending' && <p className="text-xs text-gray-500">Vence el {fmtDate(p.dueAt)}</p>}
                {p.status === 'pending' && p.kind === 'video' && (
                  <label className="inline-block text-xs bg-pink-50 text-pink-700 px-3 py-2 rounded-lg cursor-pointer">
                    <i className="fas fa-upload mr-1"></i>Subir video y entregar
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
                  <p className="text-xs text-gray-500">Aparece en tus Experiencias VIP con el botón para entrar a la sala.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6 space-y-3">
        <h3 className="font-bold text-gray-900">Tu Bóveda</h3>
        <p className="text-sm text-gray-500">Contenido exclusivo para fans que te regalan {money(VAULT_MIN)} o más (30 días de acceso).</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input className={field} name="vaultTitle" placeholder="Título" value={vaultTitle} onChange={(e) => setVaultTitle(e.target.value)} />
          <input type="file" name="vaultFile" accept="image/*,video/*" className="text-sm" onChange={(e) => setVaultFile(e.target.files?.[0] ?? null)} />
          <button type="button" onClick={uploadVault} disabled={busy} className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap disabled:opacity-50">
            Añadir a la Bóveda
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {data.vault.map((v: VaultItem) => (
            <figure key={v.id} className="rounded-xl overflow-hidden bg-gray-100 relative" data-testid="vault-item">
              {v.mediaUrl && (v.mediaType === 'video' ? (
                <video src={v.mediaUrl} muted playsInline className="w-full aspect-square object-cover" />
              ) : (
                <img src={v.mediaUrl} alt={v.title} className="w-full aspect-square object-cover" />
              ))}
              <figcaption className="px-2 py-1 text-xs text-gray-700 truncate">{v.title}</figcaption>
              <button
                type="button"
                aria-label={`Eliminar ${v.title}`}
                onClick={async () => window.confirm(`¿Eliminar "${v.title}" de tu Bóveda?`) && say(await deleteVaultItem(user, v.id), 'Eliminado de tu Bóveda')}
                className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/60 text-white text-xs"
              >
                <i className="fas fa-trash"></i>
              </button>
            </figure>
          ))}
        </div>
      </div>

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
                  {t.note} · {t.payerName}
                </span>
                {t.status === 'refunded' ? (
                  <span className="text-xs text-gray-500">Devuelto</span>
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
