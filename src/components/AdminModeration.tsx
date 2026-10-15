import React, { useState } from 'react';
import { backend } from '../lib/backend';
import type { ModerationItem } from '../lib/backend/socialTypes';
import { platformChanged, usePlatformQuery } from '../lib/platform';

const kindLabel: Record<ModerationItem['kind'], string> = {
  post: 'Publicación',
  perk_video: 'Video de regalo',
  avatar: 'Foto de perfil',
  cover: 'Portada',
};

const statusLabel: Record<ModerationItem['status'], { text: string; className: string }> = {
  pending: { text: 'Sin escanear', className: 'bg-gray-100 text-gray-700' },
  review: { text: 'Dudoso', className: 'bg-amber-100 text-amber-800' },
  rejected: { text: 'Bloqueado', className: 'bg-red-100 text-red-700' },
  approved: { text: 'Aprobado', className: 'bg-green-100 text-green-700' },
};

type Filter = 'open' | 'rejected';

// Admin tab: photos and videos the automatic scan held back (doubtful, not scanned)
// or blocked. Nothing here is visible to the public until an admin approves it.
const AdminModeration: React.FC = () => {
  const { data: items, reload } = usePlatformQuery(() => backend.moderationQueue(), [], [] as ModerationItem[]);
  const [filter, setFilter] = useState<Filter>('open');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const open = items.filter((i) => i.status === 'pending' || i.status === 'review');
  const rejected = items.filter((i) => i.status === 'rejected');
  const shown = filter === 'open' ? open : rejected;

  const decide = async (item: ModerationItem, approve: boolean) => {
    setBusy(item.path);
    const r = await backend.reviewMedia(item.bucket, item.path, approve);
    setBusy('');
    setNotice(r.ok ? { ok: true, text: approve ? 'Aprobado: ya es visible.' : 'Bloqueado: no se mostrará.' } : { ok: false, text: r.error || 'No se pudo guardar' });
    if (r.ok) {
      reload();
      platformChanged();
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm" data-testid="admin-moderation">
      <div className="p-6 border-b border-gray-100">
        <h2 className="text-xl font-bold mb-1">Moderación de fotos y videos</h2>
        <p className="text-sm text-gray-500">
          Cada archivo que se sube se escanea antes de mostrarse. Aquí llegan los dudosos, los que no se pudieron escanear y los bloqueados.
        </p>
        <div className="flex gap-2 mt-4">
          {([['open', `Por revisar (${open.length})`], ['rejected', `Bloqueados (${rejected.length})`]] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`px-3 py-1.5 rounded-full text-sm ${filter === id ? 'bg-pink-100 text-pink-700 font-medium' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {notice && (
          <p role={notice.ok ? 'status' : 'alert'} className={`mt-3 text-sm px-3 py-2 rounded-lg ${notice.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {notice.text}
          </p>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="p-6 text-sm text-gray-500">{filter === 'open' ? 'No hay nada pendiente.' : 'No hay archivos bloqueados.'}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 sm:p-6">
          {shown.map((item) => (
            <div key={`${item.bucket}/${item.path}`} className="border border-gray-200 rounded-xl overflow-hidden flex flex-col" data-testid="moderation-item">
              {/* Shown as is: only admins see this tab. */}
              <div className="relative bg-gray-900 h-64">
                {item.previewUrl ? (
                  item.mediaType === 'video' ? (
                    <video src={item.previewUrl} controls playsInline preload="metadata" className="w-full h-64 object-contain" />
                  ) : (
                    <a href={item.previewUrl} target="_blank" rel="noopener noreferrer" title="Ver en grande">
                      <img src={item.previewUrl} alt="" className="w-full h-64 object-contain" />
                    </a>
                  )
                ) : (
                  <div className="w-full h-64 flex items-center justify-center text-gray-400 text-sm">Sin vista previa</div>
                )}
              </div>
              <div className="p-4 flex-1 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-900 truncate">{item.ownerName || 'Sin nombre'}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${statusLabel[item.status].className}`}>{statusLabel[item.status].text}</span>
                </div>
                <p className="text-xs text-gray-500">
                  {kindLabel[item.kind]} · {item.mediaType === 'video' ? 'Video' : 'Foto'} · {new Date(item.createdAt).toLocaleString('es')}
                </p>
                {item.reason && <p className="text-xs text-gray-700 bg-gray-50 rounded-lg px-2 py-1">{item.reason}</p>}
                <div className="mt-auto flex gap-2 pt-2">
                  <button
                    type="button"
                    disabled={busy === item.path}
                    onClick={() => decide(item, true)}
                    className="flex-1 px-3 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    Aprobar
                  </button>
                  {item.status !== 'rejected' && (
                    <button
                      type="button"
                      disabled={busy === item.path}
                      onClick={() => decide(item, false)}
                      className="flex-1 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                    >
                      Bloquear
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminModeration;
