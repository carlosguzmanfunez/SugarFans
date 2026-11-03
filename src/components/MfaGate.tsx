import React, { useEffect, useState } from 'react';
import { backend } from '../lib/backend';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { BRAND } from '../config/brand';

// After the password (or Google), someone who turned on two-step verification types
// the code from their app before using the site. Until then the database treats the
// session as unverified: no admin access and no payout account changes.
const MfaGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout, refreshUser } = useAuth();
  const { t } = useLanguage();
  const mfa = backend.mfa;
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [trust, setTrust] = useState(true);

  useEffect(() => {
    let active = true;
    setFactorId(null);
    if (!mfa || !user) return;
    mfa
      .status()
      .then((s) => active && setFactorId(s.needsCode ? s.factorId : null))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [mfa, user?.id]);

  if (!mfa || !user || !factorId) return <>{children}</>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await mfa.verify(factorId, code, trust);
    setBusy(false);
    if (!r.ok) {
      setError(r.error || '');
      return;
    }
    setFactorId(null);
    setCode('');
    await refreshUser();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4" data-testid="mfa-gate">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-2xl shadow-sm p-6 space-y-4">
        <p className="text-sm font-semibold text-gray-500">{BRAND.name}</p>
        <h1 className="text-xl font-bold text-gray-900">{t('mfa.gate.title')}</h1>
        <p className="text-sm text-gray-600">{t('mfa.gate.body')}</p>
        <input
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t('mfa.code')}
          aria-label={t('mfa.code')}
          className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none tracking-widest"
        />
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} className="mt-0.5 accent-pink-500" />
          <span>{t('mfa.trust')}</span>
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className="w-full bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-medium hover:opacity-90 transition disabled:opacity-50">
          {t('mfa.gate.submit')}
        </button>
        <button type="button" onClick={() => logout()} className="w-full text-sm text-gray-500 hover:text-gray-700">
          {t('mfa.gate.logout')}
        </button>
      </form>
    </div>
  );
};

export default MfaGate;
