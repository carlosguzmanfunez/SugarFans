import React, { useCallback, useEffect, useState } from 'react';
import { backend } from '../lib/backend';
import type { MfaStatus } from '../lib/backend/types';
import { useLanguage } from '../context/LanguageContext';

const inputClass =
  'w-full max-w-xs px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none tracking-widest';
const primary =
  'bg-gradient-to-r from-pink-500 to-purple-600 text-white px-5 py-2.5 rounded-xl font-medium hover:opacity-90 transition disabled:opacity-50';
const secondary = 'px-5 py-2.5 rounded-xl font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50';

// Settings > Seguridad: the authenticator-app code. Offered only to the team
// (allowed); someone who already has it on can still see and turn it off.
const TwoFactorSettings: React.FC<{ allowed: boolean }> = ({ allowed }) => {
  const { t } = useLanguage();
  const mfa = backend.mfa;
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [trust, setTrust] = useState(true);
  const [busy, setBusy] = useState(false);
  const [disabling, setDisabling] = useState(false);
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

  if (!mfa || !status || (!allowed && !status.enabled)) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      const r = await mfa.enroll();
      if (r.ok) {
        setSetup({ factorId: r.factorId, qr: r.qr, secret: r.secret });
        setCode('');
      } else setMessage({ ok: false, text: r.error });
    });

  const confirm = () =>
    run(async () => {
      if (!setup) return;
      const r = await mfa.verify(setup.factorId, code, trust);
      if (!r.ok) return setMessage({ ok: false, text: r.error || '' });
      setSetup(null);
      setCode('');
      setMessage({ ok: true, text: t('mfa.enabled') });
      await load();
    });

  // Turning it off always asks for a fresh code, even on a trusted device.
  const turnOff = () =>
    run(async () => {
      if (!status.factorId) return;
      const v = await mfa.verify(status.factorId, code);
      if (!v.ok) return setMessage({ ok: false, text: v.error || '' });
      const r = await mfa.disable(status.factorId);
      setDisabling(false);
      setCode('');
      setMessage(r.ok ? { ok: true, text: t('mfa.disabled') } : { ok: false, text: r.error || '' });
      await load();
    });

  const forget = () =>
    run(async () => {
      const r = await mfa.forgetDevices();
      setMessage(r.ok ? { ok: true, text: t('mfa.forgotten') } : { ok: false, text: r.error || '' });
    });

  const codeInput = (
    <input
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={8}
      value={code}
      onChange={(e) => setCode(e.target.value)}
      placeholder={t('mfa.code')}
      aria-label={t('mfa.code')}
      className={inputClass}
    />
  );

  return (
    <div data-testid="two-factor" className="border-t border-gray-100 pt-6">
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
          {codeInput}
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} className="mt-0.5 accent-pink-500" />
            <span>{t('mfa.trust')}</span>
          </label>
          <div className="flex gap-2">
            <button disabled={busy} onClick={confirm} className={primary}>
              {t('mfa.confirm')}
            </button>
            <button disabled={busy} onClick={() => setSetup(null)} className={secondary}>
              {t('mfa.cancel')}
            </button>
          </div>
        </div>
      ) : status.enabled ? (
        disabling ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              {t('mfa.disableAsk')} {t('mfa.disableCode')}
            </p>
            {codeInput}
            <div className="flex gap-2">
              <button disabled={busy} onClick={turnOff} className="px-5 py-2.5 rounded-xl font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-50">
                {t('mfa.disableSure')}
              </button>
              <button disabled={busy} onClick={() => setDisabling(false)} className={secondary}>
                {t('mfa.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} onClick={forget} className={secondary}>
              {t('mfa.forget')}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setCode('');
                setDisabling(true);
              }}
              className={secondary}
            >
              {t('mfa.disable')}
            </button>
          </div>
        )
      ) : (
        <button disabled={busy} onClick={start} className={primary}>
          {t('mfa.enable')}
        </button>
      )}

      {message && <p className={`text-sm mt-3 ${message.ok ? 'text-green-600' : 'text-red-600'}`}>{message.text}</p>}
    </div>
  );
};

export default TwoFactorSettings;
