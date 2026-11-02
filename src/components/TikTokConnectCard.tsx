import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { backend } from '../lib/backend';
import type { TikTokConnection } from '../lib/backend/prospectTypes';
import { compact } from '../lib/prospects';

const RESULT: Record<string, { ok: boolean; text: string }> = {
  ok: { ok: true, text: 'Listo, tu TikTok quedó conectado.' },
  cancelado: { ok: false, text: 'No se conectó: cancelaste en TikTok.' },
  vencido: { ok: false, text: 'El enlace venció. Vuelve a tocar "Conectar TikTok".' },
  error: { ok: false, text: 'TikTok no respondió bien. Intenta de nuevo en un momento.' },
  'no-disponible': { ok: false, text: 'Conectar TikTok todavía no está disponible.' },
};

// Settings → Perfil, for creators: connect TikTok with TikTok's own sign-in so the
// team (and later the fans) see real, confirmed numbers. Hidden until the TikTok
// app is set up on the server.
export default function TikTokConnectCard() {
  const [params, setParams] = useSearchParams();
  const [available, setAvailable] = useState(false);
  const [conn, setConn] = useState<TikTokConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const result = RESULT[params.get('tiktok') ?? ''];

  useEffect(() => {
    let live = true;
    void backend.prospects.tiktokAvailable().then((a) => live && setAvailable(a));
    void backend.prospects.myTikTok().then((c) => live && setConn(c)).catch(() => {});
    return () => { live = false; };
  }, []);

  if (!available && !conn) return null;

  const connect = async () => {
    setBusy(true); setError('');
    const r = await backend.prospects.connectTikTok(window.location.pathname);
    if (r.ok) { window.location.assign(r.url); return; }
    setBusy(false);
    setError(r.error);
  };
  const disconnect = async () => {
    setBusy(true); setError('');
    const r = await backend.prospects.disconnectTikTok();
    setBusy(false);
    if (r.ok) { setConn(null); params.delete('tiktok'); setParams(params, { replace: true }); } else setError(r.error ?? 'No se pudo desconectar.');
  };

  return <section className="rounded-2xl border border-gray-200 p-4 sm:p-5" aria-labelledby="tiktok-title" data-testid="tiktok-connect">
    <div className="flex items-start gap-3">
      <span className="hidden sm:grid shrink-0 h-10 w-10 rounded-full bg-gray-900 text-white place-items-center"><i aria-hidden="true" className="fab fa-tiktok" /></span>
      <div className="min-w-0 flex-1">
        <h3 id="tiktok-title" className="font-semibold text-gray-900"><i aria-hidden="true" className="fab fa-tiktok mr-2 sm:hidden" />Conecta tu TikTok</h3>
        {conn ? <>
          <p className="text-sm text-gray-700 mt-0.5">
            <i aria-hidden="true" className="fas fa-circle-check text-emerald-600 mr-1" />Conectado{conn.username ? <> como <b>@{conn.username}</b></> : ''}
          </p>
          <dl className="mt-3 grid grid-cols-3 gap-1.5 sm:gap-2 text-center">
            {[['Seguidores', conn.followers], ['Me gusta', conn.likes], ['Videos', conn.videos]].map(([k, v]) => <div key={k as string} className="rounded-xl bg-gray-50 px-1 py-2">
              <dt className="text-xs text-gray-500 whitespace-nowrap">{k}</dt><dd className="text-sm sm:text-base font-bold tabular-nums text-gray-900 whitespace-nowrap">{compact(v as number | undefined)}</dd></div>)}
          </dl>
          <p className="text-xs text-gray-500 mt-2">TikTok confirma que la cuenta es tuya. Guardamos solo estos números públicos, nunca tu contraseña ni acceso a tu cuenta.</p>
        </> : <p className="text-sm text-gray-600 mt-0.5">Inicia sesión con TikTok para confirmar que la cuenta es tuya y mostrar tus seguidores reales. No guardamos tu contraseña ni podemos publicar nada.</p>}
        {result && <p role={result.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${result.ok ? 'text-emerald-800' : 'text-red-700'}`}>{result.text}</p>}
        {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {conn
            ? <>
              <button type="button" disabled={busy} onClick={() => void connect()} className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50">Actualizar números</button>
              <button type="button" disabled={busy} onClick={() => void disconnect()} className="min-h-11 px-2 text-sm text-gray-600 underline underline-offset-4 disabled:opacity-50">Desconectar</button>
            </>
            : <button type="button" disabled={busy || !available} onClick={() => void connect()} className="min-h-11 rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50">
              <i aria-hidden="true" className="fab fa-tiktok mr-2" />{busy ? 'Abriendo TikTok…' : 'Conectar TikTok'}</button>}
        </div>
      </div>
    </div>
  </section>;
}
