import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { OTHER_COUNTRY, dialCode, normalizePhone, sortedCountries } from '../config/countries';

// Country (required) and phone (optional) for the sign-up forms and Settings.
// The phone is typed without the country code, which is shown next to it.
// countryLocked: a verified creator's country comes from their ID and can't change.
const CountryPhoneFields: React.FC<{
  country: string;
  phone: string;
  countryLocked?: boolean;
  onCountry: (code: string) => void;
  onPhone: (value: string) => void;
}> = ({ country, phone, countryLocked = false, onCountry, onPhone }) => {
  const { t, language } = useLanguage();
  const options = sortedCountries(language, t('country.other'));
  const dial = dialCode(country);
  const inputClass = 'w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none';

  return (
    <>
      <div>
        <label htmlFor="signup-country" className="block text-sm font-medium text-gray-700 mb-1">{t('register.country')}</label>
        <select id="signup-country" name="country" value={country} onChange={(e) => onCountry(e.target.value)}
          disabled={countryLocked}
          aria-describedby={countryLocked ? 'signup-country-hint' : undefined}
          className={`${inputClass} ${countryLocked ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : 'bg-white'}`}
          data-testid="signup-country"
        >
          <option value="" disabled>{t('register.chooseCountry')}</option>
          {options.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}{c.dial ? ` (+${c.dial})` : ''}
            </option>
          ))}
        </select>
        {countryLocked && (
          <p id="signup-country-hint" className="mt-1 text-xs text-gray-500" data-testid="country-from-id">
            <i aria-hidden="true" className="fas fa-lock mr-1"></i>
            {t('register.countryFromId')}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="signup-phone" className="block text-sm font-medium text-gray-700 mb-1">{t('register.phone')}</label>
        <div className="flex">
          {dial && (
            <span className="inline-flex items-center rounded-l-xl border border-r-0 border-gray-200 bg-gray-50 px-3 text-gray-600 tabular-nums" aria-hidden="true">
              +{dial}
            </span>
          )}
          <input
            id="signup-phone"
            type="tel"
            name="phone"
            inputMode="tel"
            autoComplete={dial ? 'tel-national' : 'tel'}
            value={phone}
            onChange={(e) => onPhone(e.target.value)}
            className={`${inputClass} ${dial ? 'rounded-l-none' : ''}`}
            placeholder={country === OTHER_COUNTRY || !country ? t('register.phoneFull') : t('register.phonePlaceholder')}
            aria-describedby="signup-phone-hint"
            data-testid="signup-phone"
          />
        </div>
        <p id="signup-phone-hint" className="mt-1 text-xs text-gray-500">{t('register.phoneHint')}</p>
      </div>
    </>
  );
};

// The phone as it will be saved (+…), or the translated error to show.
export const phoneFromForm = (country: string, phone: string, t: (key: string) => string): { phone: string } | { error: string } => {
  const result = normalizePhone(country, phone);
  if ('phone' in result) return result;
  return { error: t(result.error === 'phone.needsPrefix' ? 'register.phoneNeedsPrefix' : 'register.phoneInvalid') };
};

export default CountryPhoneFields;
