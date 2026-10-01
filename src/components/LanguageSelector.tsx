import React, { useState } from 'react';
import { useLanguage, Language, languageNames, ENABLED_LANGUAGES } from '../context/LanguageContext';

const LanguageSelector: React.FC = () => {
  const { language, setLanguage } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);

  const languages: { code: Language; flag: string }[] = (
    [
      { code: 'es', flag: '🇪🇸' },
      { code: 'en', flag: '🇺🇸' },
      { code: 'pt', flag: '🇧🇷' },
      { code: 'fr', flag: '🇫🇷' },
      { code: 'it', flag: '🇮🇹' },
    ] as { code: Language; flag: string }[]
  ).filter((l) => ENABLED_LANGUAGES.includes(l.code));

  const currentFlag = languages.find(l => l.code === language)?.flag || '🌐';
  // Nothing to choose while the site is in a single language.
  if (ENABLED_LANGUAGES.length < 2) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition text-sm font-medium text-gray-700"
        aria-label="Seleccionar idioma"
      >
        <span className="text-lg">{currentFlag}</span>
        <span className="hidden sm:inline">{languageNames[language]}</span>
        <i className={`fas fa-chevron-down text-xs transition-transform ${isOpen ? 'rotate-180' : ''}`}></i>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
          <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50 animate-fade-in">
            {languages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => {
                  setLanguage(lang.code);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center space-x-3 px-4 py-2.5 text-sm transition ${
                  language === lang.code
                    ? 'bg-pink-50 text-pink-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="text-lg">{lang.flag}</span>
                <span>{languageNames[lang.code]}</span>
                {language === lang.code && (
                  <i className="fas fa-check text-pink-600 ml-auto text-xs"></i>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default LanguageSelector;
