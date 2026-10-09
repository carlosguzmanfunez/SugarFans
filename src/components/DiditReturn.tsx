import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { platformApi } from '../lib/platform';

// Didit sends people back to Settings > Verificación. Its webhook usually lands a
// few seconds later, so we wait for our own record: approved → green check, then
// Inicio; anything else closes and leaves the verification card showing the status.
const POLL_MS = 2000;
const GIVE_UP_MS = 40000;
const SHOW_MS = 2500;

export const returnedFromDidit = (params: URLSearchParams) => params.has('didit') || params.has('verificationSessionId');

const DiditReturn: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const [phase, setPhase] = useState<'checking' | 'approved'>('checking');
  const verified = useRef(false);
  verified.current = !!user?.isVerified;

  useEffect(() => {
    if (!user) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    const finish = () => {
      setSearchParams({ section: 'verification' }, { replace: true });
      onDone();
    };
    const poll = async () => {
      const request = await platformApi.myVerification(user.id).catch(() => null);
      if (!alive) return;
      if (request?.status === 'approved' || verified.current) {
        setPhase('approved');
        await refreshUser();
        timer = setTimeout(() => alive && navigate('/', { replace: true }), SHOW_MS);
      } else if (request?.status === 'rejected' || request?.status === 'pending' || Date.now() - started > GIVE_UP_MS) {
        finish();
      } else {
        await refreshUser();
        timer = setTimeout(poll, POLL_MS);
      }
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-live="polite" data-testid="didit-return">
      <div className="bg-white rounded-3xl shadow-xl max-w-sm w-full p-8 text-center">
        {phase === 'approved' ? (
          <>
            <div className="mx-auto mb-4 h-20 w-20 rounded-full bg-green-500 flex items-center justify-center check-pop">
              <i aria-hidden="true" className="fas fa-check text-4xl text-white"></i>
            </div>
            <h2 className="text-2xl font-bold text-gray-900">¡Identidad verificada!</h2>
            <p className="text-sm text-gray-600 mt-2">Ya tienes la insignia <span className="text-blue-700 font-medium">Verificado</span>. Te llevamos al inicio…</p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 h-14 w-14 rounded-full border-4 border-pink-200 border-t-pink-500 animate-spin" aria-hidden="true"></div>
            <h2 className="text-lg font-bold text-gray-900">Confirmando tu verificación…</h2>
            <p className="text-sm text-gray-600 mt-2">Solo unos segundos.</p>
          </>
        )}
      </div>
    </div>
  );
};

export default DiditReturn;
