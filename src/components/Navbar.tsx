import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import LanguageSelector from './LanguageSelector';
import BrandLogo from './BrandLogo';
import Avatar from './Avatar';
import NotificationBell from './NotificationBell';
import { useDismiss } from '../hooks/useDismiss';
import { displayEmail } from '../config/demoAccounts';

const Navbar: React.FC = () => {
  const { user, isAuthenticated, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [showMenu, setShowMenu] = useState(false);
  const [showMobile, setShowMobile] = useState(false);
  const menuRef = useDismiss<HTMLDivElement>(showMenu, () => setShowMenu(false));
  const navRef = useDismiss<HTMLElement>(showMobile, () => setShowMobile(false));

  // Close menus whenever the route changes.
  useEffect(() => {
    setShowMenu(false);
    setShowMobile(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    setShowMenu(false);
    await logout();
    navigate('/');
  };

  const linkCls = (path: string) =>
    `relative rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
      location.pathname === path ? 'bg-brand-50 text-brand-700' : 'text-ink/70 hover:bg-ink/5 hover:text-ink'
    }`;
  const mobileLinkCls = (path: string) =>
    `flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] font-medium ${location.pathname === path ? 'bg-brand-50 text-brand-700' : 'text-ink/80 hover:bg-ink/5'}`;

  return (
    <nav ref={navRef} aria-label="Principal" className="sticky top-0 z-50 border-b border-line/80 bg-white/80 backdrop-blur-xl supports-[backdrop-filter]:bg-white/70">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4 md:h-[72px]">
          {/* Logo */}
          <BrandLogo size="sm" />

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-1">
            <Link to="/explore" className={linkCls('/explore')}>
              {t('nav.explore')}
            </Link>
            <Link to="/reserve" className={linkCls('/reserve')}>
              Reserve
            </Link>
            {isAuthenticated && user?.role === 'creator' && (
              <Link to="/creator/dashboard" className={linkCls('/creator/dashboard')}>
                {t('nav.dashboard')}
              </Link>
            )}
            {isAuthenticated && user?.role === 'admin' && (
              <Link to="/admin" className={linkCls('/admin')}>
                {t('nav.admin')}
              </Link>
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageSelector />
            {isAuthenticated && user && <NotificationBell user={user} />}

            {isAuthenticated ? (
              <div ref={menuRef} className="relative">
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  aria-label="Menú de cuenta"
                  aria-expanded={showMenu}
                  className="flex items-center gap-2 rounded-full p-0.5 pr-0.5 ring-1 ring-line transition hover:ring-brand-200 sm:pr-2.5"
                >
                  <Avatar src={user?.avatar} name={user?.name ?? 'Cuenta'} size={34} decorative />
                  <i className="fas fa-chevron-down text-[10px] text-ink/50 max-sm:hidden!" aria-hidden="true"></i>
                </button>
                {showMenu && (
                  <div className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-line bg-white py-2 shadow-[var(--shadow-lift)]">
                    <div className="border-b border-line px-4 pb-3 pt-1">
                      <p className="truncate text-sm font-semibold text-ink">{user?.name}</p>
                      <p className="truncate text-xs text-muted">{displayEmail(user?.email)}</p>
                    </div>
                    <Link to="/profile" className="flex items-center gap-3 px-4 py-2.5 text-sm text-ink/80 hover:bg-canvas">
                      <i aria-hidden="true" className="fas fa-user w-4 text-ink/40"></i> {t('nav.profile')}
                    </Link>
                    <Link to="/settings" className="flex items-center gap-3 px-4 py-2.5 text-sm text-ink/80 hover:bg-canvas">
                      <i aria-hidden="true" className="fas fa-gear w-4 text-ink/40"></i> {t('nav.settings')}
                    </Link>
                    <Link to="/help" className="flex items-center gap-3 px-4 py-2.5 text-sm text-ink/80 hover:bg-canvas">
                      <i aria-hidden="true" className="fas fa-circle-question w-4 text-ink/40"></i> {t('nav.help')}
                    </Link>
                    <div className="my-1 border-t border-line" />
                    <button onClick={handleLogout} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-danger hover:bg-red-50">
                      <i aria-hidden="true" className="fas fa-arrow-right-from-bracket w-4"></i> {t('nav.logout')}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-2">
                <Link to="/login" className="rounded-full px-3.5 py-2 text-sm font-medium text-ink/80 hover:bg-ink/5 hover:text-ink">
                  {t('nav.login')}
                </Link>
                <Link to="/register" className="btn btn-primary px-4 py-2 text-sm">
                  {t('nav.register')}
                </Link>
              </div>
            )}

            {/* Mobile menu button */}
            <button
              onClick={() => setShowMobile(!showMobile)}
              aria-label="Menú"
              aria-expanded={showMobile}
              className="md:hidden flex h-10 w-10 items-center justify-center rounded-full text-ink ring-1 ring-line"
            >
              <i aria-hidden="true" className={`fas ${showMobile ? 'fa-xmark' : 'fa-bars'} text-lg`}></i>
            </button>
          </div>
        </div>

        {/* Mobile Nav */}
        {showMobile && (
          <div className="md:hidden border-t border-line pb-5 pt-3">
            <div className="flex flex-col gap-1">
              <Link to="/explore" className={mobileLinkCls('/explore')} onClick={() => setShowMobile(false)}>
                <i aria-hidden="true" className="fas fa-compass w-5 text-brand-600"></i> {t('nav.explore')}
              </Link>
              <Link to="/reserve" className={mobileLinkCls('/reserve')} onClick={() => setShowMobile(false)}>
                <i aria-hidden="true" className="fas fa-ticket w-5 text-gold-600"></i> Reserve
              </Link>
              {isAuthenticated && user?.role === 'creator' && (
                <Link to="/creator/dashboard" className={mobileLinkCls('/creator/dashboard')} onClick={() => setShowMobile(false)}>
                  <i aria-hidden="true" className="fas fa-chart-line w-5 text-iris-600"></i> {t('nav.dashboard')}
                </Link>
              )}
              {isAuthenticated && user?.role === 'admin' && (
                <Link to="/admin" className={mobileLinkCls('/admin')} onClick={() => setShowMobile(false)}>
                  <i aria-hidden="true" className="fas fa-shield-halved w-5 text-iris-600"></i> {t('nav.admin')}
                </Link>
              )}
              {isAuthenticated && (
                <>
                  <Link to="/profile" className={mobileLinkCls('/profile')}>
                    <i aria-hidden="true" className="fas fa-user w-5 text-ink/40"></i> {t('nav.profile')}
                  </Link>
                  <Link to="/settings" className={mobileLinkCls('/settings')}>
                    <i aria-hidden="true" className="fas fa-gear w-5 text-ink/40"></i> {t('nav.settings')}
                  </Link>
                  <button onClick={handleLogout} className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] font-medium text-danger hover:bg-red-50">
                    <i aria-hidden="true" className="fas fa-arrow-right-from-bracket w-5"></i> {t('nav.logout')}
                  </button>
                </>
              )}
            </div>
            {!isAuthenticated && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Link to="/login" className="btn btn-outline btn-md" onClick={() => setShowMobile(false)}>
                  {t('nav.login')}
                </Link>
                <Link to="/register" className="btn btn-primary btn-md" onClick={() => setShowMobile(false)}>
                  {t('nav.register')}
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
