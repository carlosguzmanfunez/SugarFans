import React, { useState, useEffect } from 'react';
import Icon from './Icon';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import LanguageSelector from './LanguageSelector';
import BrandLogo from './BrandLogo';
import Avatar from './Avatar';
import NotificationBell from './NotificationBell';
import { useDismiss } from '../hooks/useDismiss';
import { displayEmail } from '../config/demoAccounts';
import { VIRTUAL_CURRENCY } from '../config/currency';
import CoinIcon from './CoinIcon';
import { usePlatformQuery } from '../lib/platform';
import { formatCoins, giftsApi } from '../lib/gifts';
import type { User } from '../context/AuthContext';
import { ENABLE_HAPPENING_NOW, ENABLE_OPEN_LIVE } from '../config/features';
import { useReserveInbox } from '../lib/live';
import { CREATOR_RESERVE_LINK } from '../lib/reserveAlerts';
import { RedDot } from './MobileTabBar';

// Créditos balance (fans and creators), always in sight on every screen size, in the
// champagne tone of the coin. Compact on phones so it fits between the bell and the avatar.
const CreditsPill: React.FC<{ user: User }> = ({ user }) => {
  const { data: coins } = usePlatformQuery(async () => (await giftsApi.wallet(user)).coins, [user.id], 0);
  return (
    <Link
      to="/settings?section=wallet"
      aria-label={`Tus ${VIRTUAL_CURRENCY.displayName}: ${formatCoins(coins)}`}
      data-testid="credits-pill"
      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-gold-200 bg-gold-50 pl-1 pr-2.5 text-xs font-semibold tabular-nums text-night-900 transition-colors hover:border-gold-300 sm:h-9 sm:gap-1.5 sm:pl-1.5 sm:pr-3 sm:text-sm"
    >
      <CoinIcon size={20} />
      <span className="sm:hidden">{coins >= 10_000 ? `${Math.floor(coins / 100) / 10}k` : formatCoins(coins)}</span>
      <span className="max-sm:hidden">{formatCoins(coins)}</span>
    </Link>
  );
};

const Navbar: React.FC = () => {
  const { user, isAuthenticated, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [showMenu, setShowMenu] = useState(false);
  const [showMobile, setShowMobile] = useState(false);
  const menuRef = useDismiss<HTMLDivElement>(showMenu, () => setShowMenu(false));
  const navRef = useDismiss<HTMLElement>(showMobile, () => setShowMobile(false));

  // Close menus whenever the address changes (also ?section= / #anchor links to the
  // page already open).
  useEffect(() => {
    setShowMenu(false);
    setShowMobile(false);
  }, [location.pathname, location.search, location.hash, location.key]);

  const handleLogout = async () => {
    setShowMenu(false);
    await logout();
    navigate('/');
  };

  // On the landing the menu jumps to its sections, as in the approved design. Subscribing
  // is explained in "Cómo funciona" (and offered on each creator's profile), so it has no
  // menu entry of its own. Live is not a pillar either (Open Live only with ENABLE_OPEN_LIVE).
  // #live is the "Está pasando ahora" section, so it also needs ENABLE_HAPPENING_NOW.
  const onLanding = location.pathname === '/';
  // A creator's requests, one tap away, with a red dot while some wait for an answer.
  const isCreator = isAuthenticated && user?.role === 'creator';
  const waiting = useReserveInbox(isCreator ? user : null);
  const onReservas = location.pathname === '/creator/dashboard' && new URLSearchParams(location.search).get('tab') === 'vip';
  const showCreators = !isAuthenticated || user?.role === 'creator';
  const sections = [
    // Inicio, so the way home is in the menu and not only in the logo.
    { href: '/', label: t('nav.home') },
    // Explorar is a page (all the creators), not the communities section of Inicio.
    { href: '/explore', label: 'Explorar' },
    { href: '#reserve', label: 'Reserve' },
    ...(ENABLE_OPEN_LIVE && ENABLE_HAPPENING_NOW ? [{ href: '#live', label: 'Live' }] : []),
    ...(showCreators ? [{ href: '#creadores', label: 'Para creadores' }] : []),
    { href: '#journey', label: 'Cómo funciona' },
  ];

  const linkCls = (path: string) =>
    `relative px-3 py-2 text-sm font-medium transition-colors ${
      location.pathname === path ? 'text-fr-primary after:absolute after:inset-x-3 after:-bottom-px after:h-px after:bg-fr-primary' : 'text-fr-ink/75 hover:text-fr-ink'
    }`;
  const mobileLinkCls = (path: string) =>
    `flex items-center gap-3 rounded-(--radius-fr-sm) px-3 py-3 text-[15px] font-medium ${location.pathname === path ? 'bg-fr-soft text-fr-primary' : 'text-fr-ink/80 hover:bg-fr-ink/5'}`;

  return (
    // V3: a flat editorial bar on the canvas with a thin rule, no floating glass.
    <nav ref={navRef} aria-label="Principal" className="sticky top-0 z-50 w-full border-b border-fr-border bg-fr-canvas/95 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-(--container-fr) px-3 min-[400px]:px-4 sm:px-6 lg:px-10">
        <div className="flex h-16 items-center justify-between gap-2 sm:gap-4">
          {/* Logo */}
          {/* Use just the mark on the narrowest phones so the account controls still fit. */}
          <BrandLogo
            size="sm"
            className="shrink-0 max-[360px]:[&>svg:last-child]:hidden max-[400px]:gap-2! max-[400px]:[&>svg:first-child]:size-[30px] max-[400px]:[&>svg:last-child]:h-[10px] max-[400px]:[&>svg:last-child]:w-[89px]"
          />

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-1 lg:ml-auto">
            {onLanding &&
              sections.map((sct) =>
                sct.href.startsWith('/') ? (
                  <Link key={sct.href} to={sct.href} className={linkCls(sct.href)}>
                    {sct.label}
                  </Link>
                ) : (
                  <a key={sct.href} href={sct.href} className="px-3 py-2 text-sm font-medium text-fr-ink/75 transition-colors hover:text-fr-ink">
                    {sct.label}
                  </a>
                )
              )}
            {!onLanding && (
              <>
            <Link to="/" className={linkCls('/')}>
              {t('nav.home')}
            </Link>
            <Link to="/explore" className={linkCls('/explore')}>
              {t('nav.explore')}
            </Link>
            <Link to="/reserve" className={linkCls('/reserve')}>
              Reserve
            </Link>
              </>
            )}
            {isAuthenticated && user?.role === 'creator' && (
              <Link
                to="/creator/dashboard"
                data-testid="nav-dashboard"
                aria-label={waiting ? `${t('nav.dashboard')}, ${waiting} reservas por responder` : undefined}
                className={`${linkCls('/creator/dashboard')} inline-flex items-center gap-1.5`}
              >
                {t('nav.dashboard')}
                {/* Reservas lives in the panel now; the red count stays visible from any page. */}
                {!!waiting && <RedDot count={waiting} />}
              </Link>
            )}
            {isAuthenticated && (user?.role === 'admin' || user?.isOwner) && (
              <Link to="/admin" className={linkCls('/admin')}>
                {t('nav.admin')}
              </Link>
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-1 min-[400px]:gap-1.5 sm:gap-3 max-[400px]:[&_.h-10]:size-9">
            <LanguageSelector />
            {isAuthenticated && user && <NotificationBell user={user} />}
            {isAuthenticated && user && (user.role === 'fan' || user.role === 'creator') && <CreditsPill user={user} />}

            {isAuthenticated ? (
              <div ref={menuRef} className="relative">
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  aria-label="Menú de cuenta"
                  aria-expanded={showMenu}
                  className="flex items-center gap-2 rounded-full p-0.5 pr-0.5 ring-1 ring-line transition hover:ring-brand-200 sm:pr-2.5"
                >
                  <Avatar src={user?.avatar} name={user?.name ?? 'Cuenta'} size={34} decorative />
                  <Icon name="fa-chevron-down" className="text-[10px] text-ink/50 max-sm:hidden!" />
                </button>
                {showMenu && (
                  <div className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-line bg-white py-2 shadow-[var(--shadow-lift)]">
                    <div className="border-b border-line px-4 pb-3 pt-1">
                      <p className="truncate text-sm font-semibold text-ink">{user?.name}</p>
                      <p className="truncate text-xs text-muted">{displayEmail(user?.email)}</p>
                    </div>
                    {user?.isOwner && (
                      <Link to="/owner" className="flex items-center gap-3 border-b border-line px-4 py-3 text-sm font-semibold text-brand-700">
                        <Icon name="fa-crown" className="w-4" /> Dirección general
                      </Link>
                    )}
                    <Link to="/profile" className="flex items-center gap-3 px-4 py-2.5 text-sm text-ink/80 hover:bg-canvas">
                      <Icon name="fa-user" className="w-4 text-ink/40" /> {t('nav.profile')}
                    </Link>
                    <Link to="/settings?section=wallet" className="flex items-center gap-3 px-4 py-2.5 text-sm text-ink/80 hover:bg-canvas">
                      <Icon name="fa-coins" className="w-4 text-ink/40" /> {VIRTUAL_CURRENCY.displayName}
                    </Link>
                    <Link to="/settings" className="flex items-center gap-3 px-4 py-2.5 text-sm text-ink/80 hover:bg-canvas">
                      <Icon name="fa-gear" className="w-4 text-ink/40" /> {t('nav.settings')}
                    </Link>
                    <Link to="/help" className="flex items-center gap-3 px-4 py-2.5 text-sm text-ink/80 hover:bg-canvas">
                      <Icon name="fa-circle-question" className="w-4 text-ink/40" /> {t('nav.help')}
                    </Link>
                    <div className="my-1 border-t border-line" />
                    <button onClick={handleLogout} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-danger hover:bg-red-50">
                      <Icon name="fa-arrow-right-from-bracket" className="w-4" /> {t('nav.logout')}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-2">
                <Link to="/login" className="inline-flex items-center px-3 py-2.5 text-sm font-semibold text-fr-ink transition-colors hover:text-fr-primary">
                  {t('nav.login')}
                </Link>
                <Link
                  to="/register"
                  className="inline-flex items-center rounded-(--radius-fr-sm) bg-fr-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-fr-primary-hover"
                >
                  {t('nav.register')}
                </Link>
              </div>
            )}

            {/* Mobile menu button */}
            <button
              onClick={() => setShowMobile(!showMobile)}
              aria-label="Menú"
              aria-expanded={showMobile}
              className="md:hidden flex h-10 w-10 items-center justify-center rounded-(--radius-fr-sm) text-fr-ink ring-1 ring-fr-border"
            >
              <Icon name={showMobile ? 'fa-xmark' : 'fa-bars'} className="text-xl" />
            </button>
          </div>
        </div>

        {/* Mobile Nav */}
        {showMobile && (
          <div className="md:hidden border-t border-line pb-5 pt-3">
            <div className="flex flex-col gap-1">
              <Link to="/explore" className={mobileLinkCls('/explore')} onClick={() => setShowMobile(false)}>
                <Icon name="fa-compass" className="w-5 text-brand-600" /> {t('nav.explore')}
              </Link>
              <Link to="/reserve" className={mobileLinkCls('/reserve')} onClick={() => setShowMobile(false)}>
                <Icon name="fa-ticket" className="w-5 text-gold-600" /> Reserve
              </Link>
              {showCreators && (
                // Visitors have no landing with this section ("/" is the sign-up page): go to the creator sign-up.
                <Link to={isAuthenticated ? '/#creadores' : '/register?role=creator'} className={mobileLinkCls('/#creadores')} onClick={() => setShowMobile(false)}>
                  <Icon name="fa-star" className="w-5 text-iris-600" /> Para creadores
                </Link>
              )}
              <Link to="/#journey" className={mobileLinkCls('/#journey')} onClick={() => setShowMobile(false)}>
                <Icon name="fa-circle-question" className="w-5 text-ink/40" /> Cómo funciona
              </Link>
              {isCreator && (
                <Link to={CREATOR_RESERVE_LINK} className={mobileLinkCls(onReservas ? location.pathname : '-')} onClick={() => setShowMobile(false)}>
                  <Icon name="fa-ticket" className="w-5 text-brand-600" /> Reservas
                  {!!waiting && <RedDot count={waiting} className="ml-auto" />}
                </Link>
              )}
              {isAuthenticated && user?.role === 'creator' && (
                <Link to="/creator/dashboard" className={mobileLinkCls('/creator/dashboard')} onClick={() => setShowMobile(false)}>
                  <Icon name="fa-chart-line" className="w-5 text-iris-600" /> {t('nav.dashboard')}
                </Link>
              )}
              {isAuthenticated && (user?.role === 'admin' || user?.isOwner) && (
                <Link to="/admin" className={mobileLinkCls('/admin')} onClick={() => setShowMobile(false)}>
                  <Icon name="fa-shield-halved" className="w-5 text-iris-600" /> {t('nav.admin')}
                </Link>
              )}
              {isAuthenticated && (
                <>
                  <Link to="/profile" className={mobileLinkCls('/profile')}>
                    <Icon name="fa-user" className="w-5 text-ink/40" /> {t('nav.profile')}
                  </Link>
                  <Link to="/settings?section=wallet" className={mobileLinkCls('/settings?section=wallet')}>
                    <Icon name="fa-coins" className="w-5 text-ink/40" /> {VIRTUAL_CURRENCY.displayName}
                  </Link>
                  <Link to="/settings" className={mobileLinkCls('/settings')}>
                    <Icon name="fa-gear" className="w-5 text-ink/40" /> {t('nav.settings')}
                  </Link>
                  <button onClick={handleLogout} className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] font-medium text-danger hover:bg-red-50">
                    <Icon name="fa-arrow-right-from-bracket" className="w-5" /> {t('nav.logout')}
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
