import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { User } from '../context/AuthContext';
import { startLive, endLive, useCurrentLive } from '../lib/live';

// Creator panel: start a free Live (followers with the bell on get an alert) or end it.
const CreatorLivePanel: React.FC<{ user: User }> = ({ user }) => {
  const live = useCurrentLive(user.creatorProfileId);
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const r = await startLive(user, title);
    setBusy(false);
    if (!r.ok) {
      setMessage({ ok: false, text: r.error ?? 'No se pudo iniciar el Live.' });
      return;
    }
    setTitle('');
    setMessage({ ok: true, text: r.notified ? `Avisamos a ${r.notified} ${r.notified === 1 ? 'seguidor' : 'seguidores'}.` : 'Tu Live está activo.' });
    navigate(`/en-vivo/${user.creatorProfileId}`);
  };

  const stop = async () => {
    setBusy(true);
    await endLive(user);
    setBusy(false);
    setMessage({ ok: true, text: 'Tu Live terminó.' });
  };

  return (
    <section className="bg-white rounded-2xl p-5 shadow-sm mb-6" data-testid="creator-live-panel" aria-labelledby="creator-live-title">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 id="creator-live-title" className="font-bold text-gray-900 flex items-center">
            <i aria-hidden="true" className="fas fa-tower-broadcast mr-2 text-red-500"></i>Live gratis
          </h2>
          <p className="text-sm text-gray-600">
            {live ? <>Estás en Live: <span className="font-medium">{live.title}</span></> : 'Emite para todos tus seguidores. Quien tenga la campanita activada recibe un aviso.'}
          </p>
        </div>
        {live ? (
          <div className="flex flex-wrap gap-2">
            <Link to={`/en-vivo/${user.creatorProfileId}`} className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700">
              Volver al Live
            </Link>
            <button type="button" onClick={stop} disabled={busy} className="px-4 py-2 rounded-xl border border-gray-300 text-sm font-medium disabled:opacity-50">
              Terminar Live
            </button>
          </div>
        ) : (
          <form onSubmit={start} className="flex w-full flex-col gap-2 sm:flex-row md:w-auto">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              required
              minLength={3}
              aria-label="Título del Live"
              placeholder="De qué va tu Live"
              className="min-w-0 flex-1 px-3 py-2 rounded-xl border border-gray-300 text-sm md:w-64"
            />
            <button type="submit" disabled={busy} className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 whitespace-nowrap">
              <i aria-hidden="true" className="fas fa-circle text-[8px] mr-2 align-middle"></i>Iniciar Live
            </button>
          </form>
        )}
      </div>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`mt-3 text-sm ${message.ok ? 'text-green-700' : 'text-red-600'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
};

export default CreatorLivePanel;
