import React, { useEffect, useState } from 'react';
import type { User } from '../context/AuthContext';
import { disablePush, enablePush, pushState, testPush, type PushState } from '../lib/push';

const btn = 'inline-flex h-9 items-center justify-center rounded-full px-4 text-xs font-semibold transition disabled:opacity-50';

// "Avisos en este celular": turns on phone alerts for this device, so a new Reserve
// request (or an answer, for a fan) arrives like any app notification.
const PushOptIn: React.FC<{ user: User }> = ({ user }) => {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    pushState().then((s) => live && setState(s)).catch(() => live && setState('unsupported'));
    return () => {
      live = false;
    };
  }, [user.id]);

  if (!state || state === 'local') return null;
  const creator = user.role === 'creator';

  const run = async (fn: () => Promise<{ ok: boolean; error?: string } | void>, okText: string) => {
    setBusy(true);
    const r = (await fn()) ?? { ok: true };
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error || 'No se pudo completar.' });
    setState(await pushState().catch(() => 'unsupported' as const));
  };

  return (
    <div data-testid="push-optin" className="rounded-2xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${state === 'on' ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-50 text-brand-700'}`}>
            <i aria-hidden="true" className={`fas ${state === 'on' ? 'fa-bell' : 'fa-mobile-screen'}`}></i>
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{state === 'on' ? 'Avisos activados en este dispositivo' : 'Recibe avisos en tu celular'}</p>
            <p className="text-xs text-ink/60">
              {state === 'unsupported'
                ? 'Este navegador no permite avisos. Abre fansreserve.com en Chrome (Android) o en Safari desde la pantalla de inicio (iPhone).'
                : state === 'install-first'
                ? 'En iPhone: toca Compartir y “Añadir a pantalla de inicio”, abre Fans Reserve desde ese ícono y activa los avisos aquí.'
                : state === 'denied'
                  ? 'Bloqueaste los avisos para este sitio. Actívalos en los ajustes del navegador y vuelve aquí.'
                  : creator
                    ? 'Te avisamos al instante cuando un fan te envía una solicitud de Reserve.'
                    : 'Te avisamos cuando el creador responde a tu solicitud.'}
            </p>
          </div>
        </div>
        {state === 'off' && (
          <button type="button" disabled={busy} onClick={() => run(enablePush, 'Listo. Te avisaremos en este dispositivo.')} className={`${btn} bg-ink text-white`}>
            Activar avisos
          </button>
        )}
        {state === 'on' && (
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => run(testPush, 'Aviso de prueba enviado.')} className={`${btn} border border-line text-ink`}>
              Probar aviso
            </button>
            <button type="button" disabled={busy} onClick={() => run(disablePush, 'Avisos desactivados en este dispositivo.')} className={`${btn} text-ink/60 hover:text-ink`}>
              Desactivar
            </button>
          </div>
        )}
      </div>
      {msg && (
        <p role="status" className={`mt-2 text-xs ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
};

export default PushOptIn;
