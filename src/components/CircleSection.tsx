import React, { useState } from 'react';
import type { User } from '../context/AuthContext';
import { usePlatformQuery, money } from '../lib/platform';
import {
  giftsApi,
  isActive,
  postCircleMessage,
  subscribedTo,
  type CircleMessage,
  type CircleStatus,
  type TopFan,
  type VaultItem,
} from '../lib/gifts';

interface Props {
  user: User | null;
  creatorProfileId: string;
  creatorName: string;
  // Absent when the viewer can't subscribe (the creator, other creators).
  onSubscribe?: () => void;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });
const fmtTime = (iso: string) => new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Creator profile > Círculo: this month's top fans, then the private group chat
// and the Bóveda, both subscriber benefits. Access earned with gifts before gift
// perks were retired lasts until it expires.
const CircleSection: React.FC<Props> = ({ user, creatorProfileId, creatorName, onSubscribe }) => {
  const subscribed = !!user && subscribedTo(user.subscriptions, creatorProfileId);
  const { data } = usePlatformQuery(
    async () => {
      const [topFans, status] = await Promise.all([giftsApi.topFans(creatorProfileId), giftsApi.circleStatus(user, creatorProfileId)]);
      const member = status.owner || !!status.subscriber;
      const inCircle = member || isActive(status.circleUntil);
      const inVault = member || isActive(status.vaultUntil);
      const [messages, vault] = user
        ? await Promise.all([
            inCircle ? giftsApi.circleMessages(user, creatorProfileId) : Promise.resolve([]),
            inVault ? giftsApi.vaultItems(user, creatorProfileId) : Promise.resolve([]),
          ])
        : [[], []];
      return { topFans, status, inCircle, inVault, messages, vault };
    },
    [user?.id, creatorProfileId, subscribed],
    {
      topFans: [] as TopFan[],
      status: { owner: false } as CircleStatus,
      inCircle: false,
      inVault: false,
      messages: [] as CircleMessage[],
      vault: [] as VaultItem[],
    }
  );
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const r = await postCircleMessage(user, creatorProfileId, draft);
    if (!r.ok) return setError(r.error || 'No se pudo enviar');
    setError('');
    setDraft('');
  };

  const { status } = data;
  const legacy = !status.owner && !status.subscriber;

  return (
    <div className="space-y-6" data-testid="circle-section">
      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <h3 className="font-bold text-gray-900 mb-3"><i aria-hidden="true" className="fas fa-trophy text-yellow-500 mr-2"></i>Top fans del mes</h3>
        {data.topFans.length === 0 ? (
          <p className="text-sm text-gray-500">Aún nadie ha enviado regalos este mes. ¡Sé el primero!</p>
        ) : (
          <ol className="space-y-2" data-testid="top-fans">
            {data.topFans.map((f, i) => (
              <li key={i} className="flex items-center justify-between text-sm">
                <span><span className="font-bold text-pink-600 mr-2">#{i + 1}</span>{f.name}</span>
                <span className="text-gray-500">{money(f.value)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {!data.inCircle ? (
        <div className="bg-gradient-to-br from-pink-50 to-purple-50 border border-purple-100 rounded-2xl p-6 text-center">
          <i aria-hidden="true" className="fas fa-users text-3xl text-purple-500 mb-3"></i>
          <h3 className="font-bold text-lg text-gray-900">Círculo privado de {creatorName}</h3>
          <p className="text-sm text-gray-600 mt-2 max-w-md mx-auto">
            Chat grupal con {creatorName} y su Bóveda de contenido exclusivo, para sus suscriptores. Los regalos no dan acceso.
          </p>
          {onSubscribe && (
            <button type="button" onClick={onSubscribe} className="mt-4 bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-full font-bold hover:opacity-90">
              <i aria-hidden="true" className="fas fa-star mr-2"></i>Suscribirse
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl p-6 shadow-sm" data-testid="circle-chat">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-900"><i aria-hidden="true" className="fas fa-users text-purple-500 mr-2"></i>Círculo privado</h3>
            {status.subscriber && !status.owner && (
              <span className="text-xs text-purple-700 bg-purple-100 px-2 py-1 rounded-full">Suscriptor</span>
            )}
            {legacy && status.circleUntil && (
              <span className="text-xs text-purple-700 bg-purple-100 px-2 py-1 rounded-full">Miembro hasta el {fmtDate(status.circleUntil)}</span>
            )}
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto mb-3">
            {data.messages.length === 0 && <p className="text-sm text-gray-500">Aún no hay mensajes. Saluda al Círculo.</p>}
            {data.messages.map((m) => (
              <div key={m.id} data-testid="circle-message" className={`flex gap-2 ${m.userId === user?.id ? 'flex-row-reverse text-right' : ''}`}>
                <img src={m.userAvatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                <div className={`px-3 py-2 rounded-xl text-sm max-w-[80%] ${m.fromCreator ? 'bg-purple-100' : 'bg-gray-100'}`}>
                  <p className="text-[11px] text-gray-500">
                    {m.userName}{m.fromCreator && <span className="ml-1 text-purple-700 font-semibold">· Creador</span>} · {fmtTime(m.createdAt)}
                  </p>
                  <p className="text-gray-800 break-words">{m.body}</p>
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={send} className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={1000}
              aria-label="Mensaje al Círculo"
              placeholder="Escribe al Círculo…"
              className="flex-1 px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none text-sm"
            />
            <button type="submit" className="px-4 py-2 rounded-xl bg-purple-600 text-white text-sm font-medium">Enviar</button>
          </form>
          {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      )}

      {data.inVault ? (
        <div className="bg-white rounded-2xl p-6 shadow-sm" data-testid="vault">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-900"><i aria-hidden="true" className="fas fa-gem text-pink-500 mr-2"></i>Bóveda</h3>
            {legacy && status.vaultUntil && (
              <span className="text-xs text-pink-700 bg-pink-100 px-2 py-1 rounded-full">Acceso hasta el {fmtDate(status.vaultUntil)}</span>
            )}
          </div>
          {data.vault.length === 0 ? (
            <p className="text-sm text-gray-500">{creatorName} aún no ha subido contenido a su Bóveda.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {data.vault.map((v) => (
                <figure key={v.id} data-testid="vault-item" className="rounded-xl overflow-hidden bg-gray-100">
                  {v.mediaUrl && (v.mediaType === 'video' ? (
                    <video src={v.mediaUrl} controls playsInline className="w-full aspect-square object-cover" />
                  ) : (
                    <img src={v.mediaUrl} alt={v.title} className="w-full aspect-square object-cover" />
                  ))}
                  <figcaption className="px-2 py-1 text-xs text-gray-700 truncate">{v.title}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>
      ) : data.inCircle ? (
        <div className="bg-white rounded-2xl p-6 shadow-sm text-sm text-gray-600">
          <i aria-hidden="true" className="fas fa-gem text-pink-400 mr-2"></i>La Bóveda de {creatorName} es para sus suscriptores.
        </div>
      ) : null}
    </div>
  );
};

export default CircleSection;
