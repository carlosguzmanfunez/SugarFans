import React, { useEffect, useState } from 'react';
import type { User } from '../context/AuthContext';
import { isInstalledApp, useInstallApp } from '../lib/install';
import { disablePush, enablePush, pushState, testPush, type PushState } from '../lib/push';

const btn = 'inline-flex h-9 items-center justify-center rounded-full px-4 text-xs font-semibold transition disabled:opacity-50';

// "Avisos en este celular": turns on phone alerts for this device, so a new Reserve
// request (or an answer, for a fan) arrives like any app notification. Red until
// they are on, green once they are, so it can't be missed.
const PushOptIn: React.FC<{ user: User }> = ({ user }) => {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { canInstall, install } = useInstallApp();

  useEffect(() => {
    let live = true;
    pushState().then((s) => live && setState(s)).catch(() => live && setState('unsupported'));
    return () => {
      live = false;
    };
  }, [user.id]);

  if (!state || state === 'local') return null;
  const creator = user.role === 'creator';
  const on = state === 'on';

  const run = async (fn: () => Promise<{ ok: boolean; error?: string } | void>, okText: string) => {
    setBusy(true);
    const r = (await fn()) ?? { ok: true };
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error || 'No se pudo completar.' });
    setState(await pushState().catch(() => 'unsupported' as const));
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
                        ? 'Te avisaremos al instante cuando un fan te envíe una solicitud de Reserve.'
                        : 'Te avisaremos cuando el creador responda a tu solicitud.'
                      : creator
                        ? 'Te avisamos al instante cuando un fan te envía una solicitud de Reserve.'
                        : 'Te avisamos cuando el creador responde a tu solicitud.'}
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
