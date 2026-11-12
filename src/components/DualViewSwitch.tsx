import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, type UserRole } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import Icon from './Icon';

// Cuenta doble: one account with both sides. A two-button switch in the site's
// colour (blue palette for men, pink otherwise), in the account menu like the
// owner's view switch.
const DualViewSwitch: React.FC<{ onDone?: () => void }> = ({ onDone }) => {
  const { user, switchDualView } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<UserRole | null>(null);
  const [error, setError] = useState('');
  if (!user?.isDual) return null;

  const go = async (view: UserRole) => {
    if (view === user.role || busy) return;
    setBusy(view); setError('');
    const r = await switchDualView(view);
    setBusy(null);
    if (!r.ok) { setError(r.error || t('dual.switchFailed')); return; }
    onDone?.();
    navigate(view === 'creator' ? '/creator/dashboard' : '/');
  };
  const option = (view: UserRole, icon: string, label: string) => {
    const on = user.role === view;
    return (
      <button
        type="button"
        onClick={() => go(view)}
        disabled={!!busy}
        aria-pressed={on}
        data-testid={`dual-view-${view}`}
        className={`flex flex-1 items-center justify-center gap-2 rounded-full px-3 font-semibold transition h-9 text-xs ${
          on
            ? 'bg-[linear-gradient(120deg,var(--grad-soft),var(--grad-main)_55%,var(--grad-cta-end))] text-white shadow-[0_10px_24px_-14px_rgb(var(--brand-rgb)/0.8)]'
            : 'text-brand-700 hover:bg-white/70'
        }`}
      >
        <Icon name={icon} /> {busy === view ? t('dual.switching') : label}
      </button>
    );
  };

  const toggle = (
    <div role="group" aria-label={t('dual.title')} className="flex gap-1 rounded-full border border-brand-200 bg-brand-50 p-1">
      {option('fan', 'fa-heart', t('dual.fan'))}
      {option('creator', 'fa-star', t('dual.creator'))}
    </div>
  );

  return (
    <div className="px-4 py-2" data-testid="dual-switch-menu">
      {toggle}
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
};

export default DualViewSwitch;
