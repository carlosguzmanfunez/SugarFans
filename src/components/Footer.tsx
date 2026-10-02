import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import BrandLogo from './BrandLogo';
import { BRAND } from '../config/brand';

const Footer: React.FC = () => {
  const { t } = useLanguage();

  return (
    <footer className="bg-gray-900 text-gray-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-1">
            <BrandLogo size="sm" tone="dark" className="mb-4" />
            <p className="text-sm text-gray-400">
              {t('footer.description')}
            </p>
          </div>

          {/* Links */}
          <div>
            <h3 className="text-white font-semibold mb-4">{t('footer.platform')}</h3>
            <ul className="space-y-2 text-sm">
              <li><Link to="/explore" className="hover:text-pink-400 transition">{t('footer.explore')}</Link></li>
              <li><Link to="/register?role=creator" className="hover:text-pink-400 transition">{t('footer.pricing')}</Link></li>
              <li><Link to="/help" className="hover:text-pink-400 transition">{t('footer.help')}</Link></li>
              <li><Link to="/register" className="hover:text-pink-400 transition">{t('footer.becomeCreator')}</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-4">{t('footer.legal')}</h3>
            <ul className="space-y-2 text-sm">
              <li><Link to="/legal" className="hover:text-pink-400 transition">📋 Centro Legal</Link></li>
              <li><Link to="/policies" className="hover:text-pink-400 transition">{t('footer.terms')}</Link></li>
              <li><Link to="/policies" className="hover:text-pink-400 transition">{t('footer.privacy')}</Link></li>
              <li><Link to="/policies" className="hover:text-pink-400 transition">🤝 Contrato de Creadores</Link></li>
              <li><Link to="/policies" className="hover:text-pink-400 transition">🛡️ Protección de Menores</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-4">{t('footer.security')}</h3>
            <ul className="space-y-2 text-sm">
              <li><Link to="/help" className="hover:text-pink-400 transition">{t('footer.reportContent')}</Link></li>
              <li><Link to="/help" className="hover:text-pink-400 transition">{t('footer.minorProtection')}</Link></li>
              <li><Link to="/help" className="hover:text-pink-400 transition">{t('footer.identityVerification')}</Link></li>
              <li><Link to="/help" className="hover:text-pink-400 transition">{t('footer.copyright')}</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 mt-8 pt-8 flex flex-col md:flex-row justify-between items-center">
          <p className="text-sm text-gray-500">
            © {new Date().getFullYear()} {BRAND.name}. {t('footer.rights')}
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
