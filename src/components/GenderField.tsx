import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { GENDERS, type Gender } from '../lib/backend';

// Optional gender for the sign-up forms and Ajustes: Mujer / Hombre / Prefiero no
// decirlo. Private; it only picks the colours of the account (blue for men).
const GenderField: React.FC<{
  value?: Gender;
  onChange: (value: Gender) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled = false }) => {
  const { t } = useLanguage();
  return (
    <fieldset data-testid="gender-field">
      <legend className="block text-sm font-medium text-gray-700 mb-1">{t('gender.label')}</legend>
      <div className="grid grid-cols-3 gap-2" role="radiogroup">
        {GENDERS.map((g) => (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={value === g}
            disabled={disabled}
            onClick={() => onChange(g)}
            data-testid={`gender-${g}`}
            className={`min-h-11 px-2 py-2.5 rounded-xl border-2 text-sm font-medium leading-tight transition disabled:opacity-60 ${
              value === g ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-700 hover:border-gray-300'
            }`}
          >
            {t(`gender.${g}`)}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-gray-500">{t('gender.hint')}</p>
    </fieldset>
  );
};

export default GenderField;
