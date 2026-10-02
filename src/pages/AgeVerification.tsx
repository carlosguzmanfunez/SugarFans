import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import LanguageSelector from '../components/LanguageSelector';
import BrandLogo from '../components/BrandLogo';

const AgeVerification: React.FC = () => {
  const { verifyAge } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [showDeny, setShowDeny] = useState(false);

  const handleConfirm = () => {
    verifyAge();
    navigate((location.state as { from?: string } | null)?.from || '/', { replace: true });
  };

  const handleDeny = () => {
    setShowDeny(true);
  };

  if (showDeny) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <i aria-hidden="true" className="fas fa-times text-2xl text-red-600"></i>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">{t('age.denied.title')}</h2>
          <p className="text-gray-600 mb-6">
            {t('age.denied.text')}
          </p>
          <button onClick={() => window.location.href = 'https://www.google.com'} className="bg-gray-200 text-gray-700 px-6 py-3 rounded-full font-medium hover:bg-gray-300 transition">
            {t('age.denied.button')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex flex-col">
      <div className="flex justify-end p-4">
        <LanguageSelector />
      </div>
      <div className="flex-1 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-8 max-w-lg w-full shadow-2xl">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-5">
            <BrandLogo size="md" to={null} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('age.title')}</h1>
          <p className="text-gray-600">
            {t('age.description')}
          </p>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
          <div className="flex items-start">
            <i aria-hidden="true" className="fas fa-exclamation-triangle text-yellow-600 mt-0.5 mr-3"></i>
            <div>
              <p className="text-sm text-yellow-800 font-medium">{t('age.warning')}</p>
              <p className="text-sm text-yellow-700 mt-1">
                {t('age.warningText')}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <button
            onClick={handleConfirm}
            className="w-full bg-gradient-to-r from-pink-500 to-purple-600 text-white py-4 rounded-xl font-bold text-lg hover:opacity-90 transition-all shadow-lg"
          >
            <i aria-hidden="true" className="fas fa-check-circle mr-2"></i>
            {t('age.confirm')}
          </button>
          <button
            onClick={handleDeny}
            className="w-full bg-gray-100 text-gray-700 py-4 rounded-xl font-medium hover:bg-gray-200 transition"
          >
            {t('age.deny')}
          </button>
        </div>

        <p className="text-xs text-gray-500 text-center mt-6">
          {t('age.terms')}{' '}
          <a href="/policies" className="text-pink-600 hover:underline">{t('age.termsLink')}</a>{' '}
          {t('age.and')}{' '}
          <a href="/policies" className="text-pink-600 hover:underline">{t('age.privacyLink')}</a>
        </p>
      </div>
      </div>
    </div>
  );
};

export default AgeVerification;
