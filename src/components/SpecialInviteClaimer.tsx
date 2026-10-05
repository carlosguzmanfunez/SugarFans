import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { clearSpecialCode, readSpecialCode, specialApi } from '../lib/special';

// Activates a special-account link saved in this tab before the creator had an
// account (or a session): right after sign-up or sign-in, wherever they land.
const SpecialInviteClaimer: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const { pathname } = useLocation();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    // Only creator accounts can use the link; the link's own page and the sign-up steps handle themselves.
    if (!user || user.role !== 'creator' || user.signupCompleted === false || busy.current || pathname.startsWith('/especial/') || pathname === '/auth/callback') return;
    const code = readSpecialCode();
    if (!code) return;
    busy.current = true;
    clearSpecialCode();
    specialApi.claim(code).then((r) => {
      busy.current = false;
      if (r.ok) refreshUser();
      setNotice(r.ok ? { ok: true, text: `Tu cuenta ya tiene el plan especial «${r.label}».` } : { ok: false, text: r.error || 'No se pudo activar el link especial' });
    });
  }, [user, pathname, refreshUser]);

  if (!notice) return null;
  return (
    <div className="fixed inset-x-4 bottom-24 md:bottom-6 z-50 flex justify-center pointer-events-none">
      <div
        role="status"
        data-testid="special-claim-notice"
        className={`pointer-events-auto max-w-md w-full flex items-start gap-3 rounded-2xl px-4 py-3 shadow-xl text-sm ${notice.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}
      >
        <i aria-hidden="true" className={`fas ${notice.ok ? 'fa-check-circle' : 'fa-exclamation-circle'} mt-0.5`}></i>
        <p className="flex-1">{notice.text}</p>
        <button type="button" onClick={() => setNotice(null)} aria-label="Cerrar" className="opacity-80 hover:opacity-100">
          <i aria-hidden="true" className="fas fa-times"></i>
        </button>
      </div>
    </div>
  );
};

export default SpecialInviteClaimer;
