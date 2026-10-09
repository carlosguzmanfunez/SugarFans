import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';

// The sign-up consent (email and Google alike): Terms, Privacy and every other
// Fans Reserve policy, plus the 18+ confirmation. Each link opens its own document.
const TermsConsent: React.FC<{ checked: boolean; onChange: (checked: boolean) => void; className?: string }> = ({ checked, onChange, className = '' }) => {
  const { t } = useLanguage();
  const link = 'text-pink-600 underline-offset-2 hover:underline';
  return (
    <label className={`flex items-start space-x-2 ${className}`} data-testid="terms-consent">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 w-4 h-4 shrink-0 text-pink-600 rounded" />
      <span className="text-sm text-gray-600">
        {t('register.terms')} <Link to="/legal?doc=terms" target="_blank" className={link}>{t('register.termsLink')}</Link>,{' '}
        {t('register.and')} <Link to="/legal?doc=privacy" target="_blank" className={link}>{t('register.privacyLink')}</Link>{' '}
        {t('register.policiesAnd')} <Link to="/legal" target="_blank" className={link}>{t('register.policiesLink')}</Link>,{' '}
        {t('register.ageConfirm')}
      </span>
    </label>
  );
};

export default TermsConsent;
