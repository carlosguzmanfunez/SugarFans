import React, { useEffect, useState } from 'react';
import type { User } from '../context/AuthContext';
import { isInstalledApp, useInstallApp } from '../lib/install';
import { disablePush, enablePush, testPush, usePushState } from '../lib/push';

const btn = 'inline-flex h-9 items-center justify-center rounded-full px-4 text-xs font-semibold transition disabled:opacity-50';

// "Avisos en este celular": turns on phone alerts for this device, so a new Reserve
// request (or an answer, for a fan) arrives like any app notification. Red until
// they are on, green once they are, so it can't be missed. With `untilOn` (Reserve
// panels) it disappears once alerts are on; Ajustes > Notificaciones always shows it.
const PushOptIn: React.FC<{ user: User; untilOn?: boolean }> = ({ user, untilOn = false }) => {
  const { state, busy: changing } = usePushState(user.id);
  const [running, setRunning] = useState(false);
  const busy = running || changing;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setMsg(null), [state, user.id]);
  const { canInstall, install } = useInstallApp();

  if (!state || state === 'local') return null;
  const creator = user.role === 'creator';
  const on = state === 'on';
  // Settings retains the controls; invitations disappear after either entry point succeeds.
  if (untilOn && on) return null;

  const run = async (fn: () => Promise<{ ok: boolean; error?: string } | void>, okText: string) => {
    setRunning(true);
    try {
      const r = (await fn()) ?? { ok: true };
      setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error || 'No se pudo completar.' });
    } catch { setMsg({ ok: false, text: 'No se pudo completar. Revisa tu conexión e inténtalo de nuevo.' }); }
    finally { setRunning(false); }
  };

  return (
    <div
      data-testid="push-optin"
      data-state={state}
      className={`rounded-2xl border-2 p-4 ${on ? 'border-emerald-400 bg-emerald-50' : 'border-red-400 bg-red-50'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white ${on ? 'bg-emerald-500' : 'bg-red-500'}`}>
            <i aria-hidden="true" className={`fas ${on ? 'fa-check' : 'fa-bell'}`}></i>
            {!on && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-ping rounded-full bg-red-400 motion-reduce:animate-none"></span>}
          </span>
          <div className="min-w-0">
            <p className={`text-sm font-bold ${on ? 'text-emerald-800' : 'text-red-700'}`}>
              {on ? 'Avisos activados en este dispositivo' : 'Avisos desactivados: actívalos para no perder solicitudes'}
            </p>
            <p className="text-xs text-ink/70">
              {state === 'unsupported'
                ? 'Este navegador no permite avisos. Abre fansreserve.com en Chrome (Android) o en Safari desde la pantalla de inicio (iPhone).'
                : state === 'install-first'
                  ? 'En iPhone: toca Compartir y “Añadir a pantalla de inicio”, abre Fans Reserve desde ese ícono y activa los avisos aquí.'
                  : state === 'denied'
                    ? 'Bloqueaste los avisos para este sitio. Actívalos en los ajustes del navegador y vuelve aquí.'
                    : on
                      ? creator
                        ? 'Recibirás avisos de tus reservas, nuevas suscripciones y renovaciones.'
                        : 'Recibirás avisos de tus reservas y de los pagos y cambios de tus suscripciones.'
                      : creator
                        ? 'Recibe avisos de tus reservas, nuevas suscripciones y renovaciones.'
                        : 'Recibe avisos de tus reservas y de los pagos y cambios de tus suscripciones.'}
            </p>
          </div>
        </div>
        {state === 'off' && (
          <button type="button" disabled={busy} onClick={() => run(enablePush, 'Listo. Te avisaremos en este dispositivo.')} className={`${btn} h-10 bg-red-600 px-5 text-sm text-white shadow-sm hover:bg-red-700`}>
            Activar avisos
          </button>
        )}
        {on && (
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => run(testPush, 'Aviso de prueba enviado.')} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
              Probar aviso
            </button>
            <button type="button" disabled={busy} onClick={() => run(disablePush, 'Avisos desactivados en este dispositivo.')} className={`${btn} text-ink/60 hover:text-ink`}>
              Desactivar
            </button>
          </div>
        )}
      </div>
      {canInstall && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-black/10 pt-3">
          <p className="min-w-0 flex-1 text-xs text-ink/70">
            Instala Fans Reserve como app: tendrás su ícono en el celular y los avisos llegarán con su nombre, como los de cualquier app.
          </p>
          <button type="button" onClick={() => install()} className={`${btn} border border-ink/20 bg-white text-ink`}>
            <i aria-hidden="true" className="fas fa-download mr-1.5"></i>Instalar app
          </button>
        </div>
      )}
      {!canInstall && !isInstalledApp() && on && (
        <p className="mt-2 text-xs text-ink/60">
          Para que lleguen como los de una app, con el ícono de Fans Reserve: en el menú del navegador elige “Instalar app” o “Añadir a pantalla de inicio”.
        </p>
      )}
      {msg && (
        <p role="status" className={`mt-2 text-xs ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
};

export default PushOptIn;

export const PushToggle: React.FC<{ user: User }> = ({ user }) => {
  const { state, busy } = usePushState(user.id);
  const [error, setError] = useState('');
  useEffect(() => { if (state === 'on') setError(''); }, [state]);
  useEffect(() => setError(''), [user.id]);
  const toggle = async (on: boolean) => {
    setError('');
    if (state === 'denied') return setError('Activa las notificaciones en los ajustes del navegador y vuelve aquí.');
    if (state === 'install-first') return setError('Añade Fans Reserve a la pantalla de inicio y ábrelo desde ese ícono para activar las notificaciones.');
    if (state === 'unsupported') return setError('Este navegador no permite notificaciones. Usa Chrome en Android o la app instalada desde Safari en iPhone.');
    const result = await (on ? enablePush() : disablePush());
    if (!result.ok) setError(result.error || 'No se pudo completar el cambio.');
  };
  return <div className="max-w-[15rem] text-right">
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-xs text-ink/70 has-[:disabled]:cursor-default">
      <input type="checkbox" checked={state === 'on'} disabled={busy || !state || state === 'local'}
        onChange={e => void toggle(e.currentTarget.checked)} data-testid="push-toggle"
        title={state === 'local' ? 'Disponible en la versión publicada' : undefined}
        className="h-3.5 w-3.5 shrink-0 accent-emerald-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-50" />
      <span>Activar notificaciones</span>
    </label>
    {error && <p role="alert" className="pb-2 text-xs text-red-700">{error}</p>}
  </div>;
};
