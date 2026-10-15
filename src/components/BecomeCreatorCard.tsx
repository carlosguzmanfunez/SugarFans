import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { canBecomeCreator } from '../lib/becomeCreator';

// Ajustes, for fans: turn the account into a creator account. It keeps everything,
// gets a public profile and @usuario, then goes to identity verification (the same
// welcome a new creator sees after signing up).
const BecomeCreatorCard: React.FC<{ highlight?: boolean }> = ({ highlight = false }) => {
  const { user, becomeCreator } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlight) cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight]);

  if (!canBecomeCreator(user)) return null;

  const confirm = async () => {
    setWorking(true);
    setError('');
    const result = await becomeCreator();
    if (!result.ok) {
      setError(result.error || 'No se pudo convertir tu cuenta en creador');
      setWorking(false);
      return;
    }
    navigate('/creator/dashboard?bienvenida=1', { replace: true });
  };

  const points: { icon: string; text: string }[] = [
    { icon: 'fa-heart', text: t('becomeCreator.keep') },
    { icon: 'fa-at', text: t('becomeCreator.profile') },
    { icon: 'fa-id-card', text: t('becomeCreator.verify') },
  ];

  return (
    <>
      <div
        ref={cardRef}
        className={`mt-6 rounded-2xl border p-5 scroll-mt-28 ${highlight ? 'border-pink-400 bg-pink-50/60' : 'border-purple-100 bg-purple-50/50'}`}
        data-testid="become-creator"
      >
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center">
            <i aria-hidden="true" className="fas fa-star text-white"></i>
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900">{t('becomeCreator.title')}</p>
            <p className="text-sm text-gray-600 mt-1">{t('becomeCreator.desc')}</p>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="mt-3 bg-gradient-to-r from-pink-500 to-purple-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition"
              data-testid="become-creator-open"
            >
              {t('becomeCreator.button')}
            </button>
          </div>
        </div>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="become-creator-title" data-testid="become-creator-dialog">
          <div className="bg-white rounded-3xl shadow-xl max-w-md w-full p-6 sm:p-7">
            <h2 id="become-creator-title" className="text-xl sm:text-2xl font-bold text-gray-900 text-center">{t('becomeCreator.confirmTitle')}</h2>
            <ul className="mt-5 space-y-3">
              {points.map((p) => (
                <li key={p.icon} className="flex items-start gap-3 text-sm sm:text-base text-gray-700">
                  <i aria-hidden="true" className={`fas ${p.icon} mt-1 w-4 text-center text-pink-500`}></i>
                  <span>{p.text}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-gray-500 text-center">{t('becomeCreator.oneWay')}</p>
            {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-4">{error}</p>}
            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={confirm}
                disabled={working}
                className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-medium hover:opacity-90 transition disabled:opacity-60"
                data-testid="become-creator-confirm"
              >
                {working ? t('becomeCreator.working') : t('becomeCreator.confirm')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  setError('');
                }}
                disabled={working}
                className="text-gray-600 px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-100 transition"
              >
                {t('becomeCreator.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BecomeCreatorCard;
