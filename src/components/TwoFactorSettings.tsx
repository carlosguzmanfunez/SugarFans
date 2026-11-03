import React, { useCallback, useEffect, useState } from 'react';
import { backend } from '../lib/backend';
import type { MfaStatus } from '../lib/backend/types';
import { useLanguage } from '../context/LanguageContext';

// Settings > Seguridad: turn the authenticator-app code on or off.
const TwoFactorSettings: React.FC = () => {
  const { t } = useLanguage();
  const mfa = backend.mfa;
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!mfa) return;
    try {
      setStatus(await mfa.status());
    } catch {
      setStatus(null);
    }
  }, [mfa]);

  useEffect(() => {
    load();
  }, [load]);

  if (!mfa || !status) return null;

  const start = async () => {
    setBusy(true);
    setMessage(null);
    const r = await mfa.enroll();
    setBusy(false);
    if (r.ok) {
      setSetup({ factorId: r.factorId, qr: r.qr, secret: r.secret });
      setCode('');
    } else setMessage({ ok: false, text: r.error });
  };

  const confirm = async () => {
    if (!setup) return;
    setBusy(true);
    const r = await mfa.verify(setup.factorId, code);
    setBusy(false);
    if (!r.ok) {
      setMessage({ ok: false, text: r.error || '' });
      return;
    }
    setSetup(null);
    setMessage({ ok: true, text: t('mfa.enabled') });
    load();
  };

  const turnOff = async () => {
    if (!status.factorId) return;
    setBusy(true);
    const r = await mfa.disable(status.factorId);
    setBusy(false);
    setAsking(false);
    setMessage(r.ok ? { ok: true, text: t('mfa.disabled') } : { ok: false, text: r.error || '' });
    load();
  };

  return (
    <div data-testid="two-factor">
      <h3 className="font-medium text-gray-900 mb-2">{t('mfa.title')}</h3>
      <p className="text-sm text-gray-600 mb-3">{status.enabled ? t('mfa.on') : t('mfa.off')}</p>

      {setup ? (
        <div className="space-y-3 bg-gray-50 rounded-xl p-4">
          <p className="text-sm text-gray-700">{t('mfa.scan')}</p>
          <img src={setup.qr} alt="QR" className="w-44 h-44 bg-white rounded-lg p-2" />
          <p className="text-xs text-gray-500">
            {t('mfa.manual')} <span className="font-mono break-all text-gray-800 select-all">{setup.secret}</span>
          </p>
          <p className="text-sm text-gray-700">{t('mfa.enter')}</p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t('mfa.code')}
            aria-label={t('mfa.code')}
            className="w-full max-w-xs px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none tracking-widest"
          />
          <div className="flex gap-2">
            <button disabled={busy} onClick={confirm} className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-5 py-2.5 rounded-xl font-medium hover:opacity-90 transition disabled:opacity-50">
              {t('mfa.confirm')}
            </button>
            <button disabled={busy} onClick={() => setSetup(null)} className="px-5 py-2.5 rounded-xl font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50">
              {t('mfa.cancel')}
            </button>
          </div>
        </div>
      ) : status.enabled ? (
        asking ? (
          <div className="space-y-2">
            <p className="text-sm text-gray-700">{t('mfa.disableAsk')}</p>
            <div className="flex gap-2">
              <button disabled={busy} onClick={turnOff} className="px-5 py-2.5 rounded-xl font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-50">
                {t('mfa.disableSure')}
              </button>
              <button disabled={busy} onClick={() => setAsking(false)} className="px-5 py-2.5 rounded-xl font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50">
                {t('mfa.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAsking(true)} className="px-5 py-2.5 rounded-xl font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50">
            {t('mfa.disable')}
          </button>
        )
      ) : (
        <button disabled={busy} onClick={start} className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-5 py-2.5 rounded-xl font-medium hover:opacity-90 transition disabled:opacity-50">
          {t('mfa.enable')}
        </button>
      )}

      {message && <p className={`text-sm mt-3 ${message.ok ? 'text-green-600' : 'text-red-600'}`}>{message.text}</p>}
    </div>
  );
};

export default TwoFactorSettings;
