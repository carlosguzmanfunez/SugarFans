import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { clearDualCode, readDualCode } from '../lib/dualAccess';

// Right after sign-up or sign-in with a personal link, turns the account into a
// cuenta doble (fan + creador), showing first the side chosen at sign-up.
const DualAccessClaimer: React.FC = () => {
  const { user, claimDual } = useAuth();
  const { t } = useLanguage();
  const { pathname } = useLocation();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!user || user.signupCompleted === false || busy.current || pathname === '/auth/callback') return;
    if (user.role === 'admin' || user.isOwner) return;
    const code = readDualCode();
    if (!code) return;
    if (user.isDual) { clearDualCode(); return; }
    busy.current = true;
    claimDual(code, user.role).then((r) => {
      busy.current = false;
      clearDualCode();
      setNotice(r.ok ? { ok: true, text: t('dual.claimed') } : { ok: false, text: r.error || t('dual.claimFailed') });
    });
  }, [user, pathname, claimDual, t]);

  useEffect(() => {
    if (!notice?.ok) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-24 z-50 flex justify-center md:bottom-6">
      <div role="status" data-testid="dual-claim-notice" className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl px-4 py-3 text-sm text-white shadow-xl ${notice.ok ? 'bg-green-600' : 'bg-red-600'}`}>
        <p className="flex-1">{notice.text}</p>
        <button type="button" onClick={() => setNotice(null)} aria-label="Cerrar" className="opacity-80 hover:opacity-100">
          <i aria-hidden="true" className="fas fa-times"></i>
        </button>
      </div>
    </div>
  );
};

export default DualAccessClaimer;
