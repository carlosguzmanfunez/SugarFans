import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { readDualCode } from '../lib/dualAccess';
import Icon from './Icon';

// Sign-up, where fan or creator is chosen: people the owner invited with their
// personal link get both, and are told so here.
const DualAccountNote: React.FC = () => {
  const { t } = useLanguage();
  if (!readDualCode()) return null;
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-ink/80" data-testid="dual-register-note">
      <p className="flex items-center gap-2 font-semibold text-brand-700">
        <Icon name="fa-crown" /> {t('dual.note.title')}
      </p>
      <p className="mt-1">{t('dual.note.body')}</p>
    </div>
  );
};

export default DualAccountNote;
