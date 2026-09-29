import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import LanguageSelector from './LanguageSelector';

const Navbar: React.FC = () => {
  const { user, isAuthenticated, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [showMenu, setShowMenu] = useState(false);
  const [showMobile, setShowMobile] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <nav className="bg-white shadow-sm border-b border-gray-100 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-pink-500 to-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">SF</span>
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text text-transparent">
              SugarFans
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center space-x-6">
            <Link to="/explore" className={`text-sm font-medium ${location.pathname === '/explore' ? 'text-pink-600' : 'text-gray-600 hover:text-pink-500'}`}>
              <i className="fas fa-compass mr-1"></i> {t('nav.explore')}
            </Link>
            {isAuthenticated && (
              <>
                {user?.role === 'creator' && (
                  <Link to="/creator/dashboard" className={`text-sm font-medium ${location.pathname === '/creator/dashboard' ? 'text-pink-600' : 'text-gray-600 hover:text-pink-500'}`}>
                    <i className="fas fa-chart-line mr-1"></i> {t('nav.dashboard')}
                  </Link>
                )}
                {user?.role === 'admin' && (
                  <Link to="/admin" className={`text-sm font-medium ${location.pathname === '/admin' ? 'text-pink-600' : 'text-gray-600 hover:text-pink-500'}`}>
                    <i className="fas fa-shield-alt mr-1"></i> {t('nav.admin')}
                  </Link>
                )}
              </>
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center space-x-3">
            <LanguageSelector />
            
            {isAuthenticated ? (
              <div className="relative">
                <button onClick={() => setShowMenu(!showMenu)} className="flex items-center space-x-2">
                  <img src={user?.avatar} alt={user?.name} className="w-8 h-8 rounded-full border-2 border-pink-200" />
                </button>
                {showMenu && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-100 py-2 z-50">
                    <Link to="/profile" className="block px-4 py-2 text-sm text-gray-700 hover:bg-pink-50">
                      <i className="fas fa-user mr-2"></i> {t('nav.profile')}
                    </Link>
                    <Link to="/settings" className="block px-4 py-2 text-sm text-gray-700 hover:bg-pink-50">
                      <i className="fas fa-cog mr-2"></i> {t('nav.settings')}
                    </Link>
                    <Link to="/help" className="block px-4 py-2 text-sm text-gray-700 hover:bg-pink-50">
                      <i className="fas fa-question-circle mr-2"></i> {t('nav.help')}
                    </Link>
                    <hr className="my-2" />
                    <button onClick={handleLogout} className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                      <i className="fas fa-sign-out-alt mr-2"></i> {t('nav.logout')}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="hidden sm:flex items-center space-x-3">
                <Link to="/login" className="text-sm font-medium text-gray-600 hover:text-pink-500">
                  {t('nav.login')}
                </Link>
                <Link to="/register" className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-4 py-2 rounded-full text-sm font-medium hover:opacity-90 transition">
                  {t('nav.register')}
                </Link>
              </div>
            )}

            {/* Mobile menu button */}
            <button onClick={() => setShowMobile(!showMobile)} className="md:hidden text-gray-600">
              <i className={`fas ${showMobile ? 'fa-times' : 'fa-bars'} text-xl`}></i>
            </button>
          </div>
        </div>

        {/* Mobile Nav */}
        {showMobile && (
          <div className="md:hidden pb-4 border-t border-gray-100 pt-4">
            <Link to="/explore" className="block py-2 text-gray-600 hover:text-pink-500" onClick={() => setShowMobile(false)}>
              <i className="fas fa-compass mr-2"></i> {t('nav.explore')}
            </Link>
            {isAuthenticated && user?.role === 'creator' && (
              <Link to="/creator/dashboard" className="block py-2 text-gray-600 hover:text-pink-500" onClick={() => setShowMobile(false)}>
                <i className="fas fa-chart-line mr-2"></i> {t('nav.dashboard')}
              </Link>
            )}
            {isAuthenticated && user?.role === 'admin' && (
              <Link to="/admin" className="block py-2 text-gray-600 hover:text-pink-500" onClick={() => setShowMobile(false)}>
                <i className="fas fa-shield-alt mr-2"></i> {t('nav.admin')}
              </Link>
            )}
            {!isAuthenticated && (
              <>
                <Link to="/login" className="block py-2 text-gray-600 hover:text-pink-500" onClick={() => setShowMobile(false)}>
                  <i className="fas fa-sign-in-alt mr-2"></i> {t('nav.login')}
                </Link>
                <Link to="/register" className="block py-2 text-pink-600 font-medium" onClick={() => setShowMobile(false)}>
                  <i className="fas fa-user-plus mr-2"></i> {t('nav.register')}
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
