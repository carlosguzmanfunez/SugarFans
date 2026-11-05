import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { GENDERS, isGender, type Gender } from '../lib/backend';

// Optional gender for the sign-up forms and Ajustes, a dropdown like the country:
// Mujer / Hombre / Prefiero no decirlo. Private; it picks the account colours.
const GenderField: React.FC<{
  value?: Gender;
  onChange: (value: Gender) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled = false }) => {
  const { t } = useLanguage();
  return (
    <div>
      <label htmlFor="signup-gender" className="block text-sm font-medium text-gray-700 mb-1">{t('gender.label')}</label>
      <select
        id="signup-gender"
        name="gender"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => isGender(e.target.value) && onChange(e.target.value)}
        className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none disabled:opacity-60"
        data-testid="gender-field"
      >
        <option value="" disabled>{t('gender.choose')}</option>
        {GENDERS.map((g) => (
          <option key={g} value={g}>{t(`gender.${g}`)}</option>
        ))}
      </select>
    </div>
  );
};

export default GenderField;
