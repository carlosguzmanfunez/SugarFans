import React, { useId, useSyncExternalStore } from 'react';
import { languageNames, useLanguage, type Language } from '../../context/LanguageContext';
import { RESERVE_READING } from '../../content/reserveCatalog';

const KEY = 'fansreserve_reserve_reading_language_v1';
const CHANGED = 'reserve:reading-language';
let volatileLanguage: Language | null = null;
export const RESERVE_LANGUAGES: Language[] = ['es', 'en', 'pt', 'fr', 'it'];
const read = (): Language | null => {
  try {
    const saved = localStorage.getItem(KEY) as Language;
    return volatileLanguage ?? (RESERVE_LANGUAGES.includes(saved) ? saved : null);
  } catch { return volatileLanguage; }
};
const subscribe = (notify: () => void) => {
  const storage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) { volatileLanguage = null; notify(); }
  };
  window.addEventListener(CHANGED, notify);
  window.addEventListener('storage', storage);
  return () => { window.removeEventListener(CHANGED, notify); window.removeEventListener('storage', storage); };
};
// Scoped to offer names and descriptions. The global selector remains Spanish
// until the rest of the site is translated; this does not claim otherwise.
export const useReserveLanguage = () => {
  const { language } = useLanguage();
  return useSyncExternalStore(subscribe, read, () => null) ?? language;
};

const ReserveLanguageSelector: React.FC = () => {
  const id = useId();
  const language = useReserveLanguage();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm" data-testid="reserve-language-selector" lang={language}>
      <label htmlFor={id} className="font-medium text-ink/80">{RESERVE_READING[language].language}</label>
      <select id={id} value={language} onChange={(event) => {
        volatileLanguage = event.target.value as Language;
        try { localStorage.setItem(KEY, event.target.value); } catch { /* Selection still works for this page session. */ }
        window.dispatchEvent(new Event(CHANGED));
      }} className="min-h-11 max-w-full rounded-full border border-line bg-white px-4 py-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
        {RESERVE_LANGUAGES.map((code) => <option key={code} value={code} lang={code}>{languageNames[code]}</option>)}
      </select>
    </div>
  );
};

export default ReserveLanguageSelector;
