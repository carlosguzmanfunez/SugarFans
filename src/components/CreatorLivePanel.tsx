import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { User } from '../context/AuthContext';
import { startLive, endLive, useCurrentLive, type BroadcastMode } from '../lib/live';
import { ENABLE_OPEN_LIVE } from '../config/features';

// Creator panel: start a Subscriber Live (a group Live included in the subscription;
// active subscribers get an alert) or end it. The public Open Live is only offered
// while ENABLE_OPEN_LIVE is on.
const CreatorLivePanel: React.FC<{ user: User }> = ({ user }) => {
  const live = useCurrentLive(user.creatorProfileId);
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<BroadcastMode>('subscriber');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const r = await startLive(user, title, ENABLE_OPEN_LIVE ? mode : 'subscriber');
    setBusy(false);
    if (!r.ok) {
      setMessage({ ok: false, text: r.error ?? 'No se pudo iniciar el Live.' });
      return;
    }
    setTitle('');
    const who = mode === 'open' && ENABLE_OPEN_LIVE ? ['seguidor', 'seguidores'] : ['suscriptor', 'suscriptores'];
    setMessage({ ok: true, text: r.notified ? `Avisamos a ${r.notified} ${r.notified === 1 ? who[0] : who[1]}.` : 'Tu Live está activo.' });
    navigate(`/en-vivo/${user.creatorProfileId}`);
  };

  const stop = async () => {
    setBusy(true);
    await endLive(user);
    setBusy(false);
    setMessage({ ok: true, text: 'Tu Live terminó.' });
  };

  return (
    <section className="bg-white rounded-2xl border border-line p-5 mb-6" data-testid="creator-live-panel" aria-labelledby="creator-live-title">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 id="creator-live-title" className="font-bold text-gray-900 flex items-center">
            <span aria-hidden="true" className="mr-2 h-2 w-2 rounded-full bg-brand-600"></span>Live para suscriptores
          </h2>
          <p className="text-sm text-gray-600">
            {live ? (
              <>Estás en Live{live.mode === 'open' ? ' abierto' : ' para suscriptores'}: <span className="font-medium">{live.title}</span></>
            ) : (
              'Solo entran tus suscriptores activos y les llega un aviso. Es grupal: no es tiempo individual ni garantiza interacción individual.'
            )}
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
            {ENABLE_OPEN_LIVE && (
              <select value={mode} onChange={(e) => setMode(e.target.value as BroadcastMode)} aria-label="Quién puede entrar" className="px-3 py-2 rounded-xl border border-gray-300 text-sm">
                <option value="subscriber">Solo suscriptores</option>
                <option value="open">Abierto (experimental)</option>
              </select>
            )}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              required
              minLength={3}
              aria-label="Título del Live"
              placeholder="Ej.: Live exclusivo para suscriptores"
              className="min-w-0 flex-1 px-4 py-2.5 rounded-full border border-line text-sm md:w-64"
            />
            <button type="submit" disabled={busy} className="btn btn-md btn-primary disabled:opacity-50">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-white"></span>Iniciar Live
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
