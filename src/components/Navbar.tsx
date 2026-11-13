import React, { useState, useEffect, useId, useRef } from 'react';
import Icon from './Icon';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import DualViewSwitch from './DualViewSwitch';
import HowItWorksButton from './HowItWorksButton';
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
  const { data: coins } = usePlatformQuery(async () => (await giftsApi.wallet(user)).coins, [user.id], 0, `coins:${user.id}`);
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
  const accountMenuId = useId();
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useDismiss<HTMLDivElement>(showMenu, () => setShowMenu(false));

  // Close the account menu whenever the address changes (also ?section= / #anchor links to the
  // page already open).
  useEffect(() => {
    setShowMenu(false);
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
  // Signed-in accounts get a short menu: "Cómo funciona" is the button on the right
  // (it explains their own side) and "Para creadores" is a pitch for visitors.
  const showCreators = !isAuthenticated;
  const showJourney = !isAuthenticated;
  const sections = [
    // Inicio, so the way home is in the menu and not only in the logo.
    { href: '/', label: t('nav.home') },
    // Explorar is a page (all the creators), not the communities section of Inicio.
    { href: '/explore', label: 'Explorar' },
    // A creator's "Reserve" is their own Reserve panel; everyone else gets the public page.
    { href: isCreator ? CREATOR_RESERVE_LINK : '#reserve', label: 'Reserve' },
    ...(ENABLE_OPEN_LIVE && ENABLE_HAPPENING_NOW ? [{ href: '#live', label: 'Live' }] : []),
    ...(showCreators ? [{ href: '#creadores', label: 'Para creadores' }] : []),
    ...(showJourney ? [{ href: '#journey', label: 'Cómo funciona' }] : []),
  ];

  const linkCls = (path: string) =>
    `relative rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
      location.pathname === path ? 'bg-brand-50 text-brand-700' : 'text-ink/70 hover:bg-ink/5 hover:text-ink'
    }`;
  const accountLinks = [
    ...(isAuthenticated ? [
      { to: '/profile', label: t('nav.profile'), icon: 'fa-user' },
      { to: '/settings?section=wallet', label: VIRTUAL_CURRENCY.displayName, icon: 'fa-coins' },
      { to: '/settings', label: t('nav.settings'), icon: 'fa-gear' },
    ] : [
      { to: '/login', label: t('nav.login'), icon: 'fa-circle-user' },
      { to: '/register', label: t('nav.register'), icon: 'fa-user' },
    ]),
    ...(isCreator ? [{ to: '/creator/dashboard', label: 'Mi panel de creador', icon: 'fa-chart-line' }] : []),
    ...(isAuthenticated && (user?.role === 'admin' || user?.isOwner)
      ? [{ to: '/admin', label: 'Administración', icon: 'fa-shield-halved' }] : []),
    ...(user?.isOwner ? [{ to: '/owner', label: 'Dirección general', icon: 'fa-crown' }] : []),
  ];
  const navigationLinks = [
    { to: '/explore', label: t('nav.explore'), icon: 'fa-compass' },
    { to: isCreator ? CREATOR_RESERVE_LINK : '/reserve', label: isCreator ? 'Reservas' : 'Reserve', icon: 'fa-ticket' },
    ...(showCreators ? [{ to: '/register?role=creator', label: 'Para creadores', icon: 'fa-star' }] : []),
    ...(showJourney ? [{ to: '/#journey', label: 'Cómo funciona', icon: 'fa-circle-question' }] : []),
    { to: '/help', label: t('nav.help'), icon: 'fa-circle-question' },
  ];
  const accountItemCls = 'flex min-h-11 items-center gap-3 px-4 py-2.5 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600';
  const accountLinkCls = `${accountItemCls} text-ink/80 hover:bg-canvas`;

  return (
    // Floating glass pill.
    <nav aria-label="Principal" className="sticky top-3 z-50 mx-auto mt-3.5 w-full max-w-[1240px] px-2 min-[400px]:px-2.5 sm:px-6 lg:px-10">
      <div
        className="rounded-full border border-white/80 bg-white/75 pl-3 pr-2 shadow-[0_10px_40px_-18px_rgba(70,20,60,0.25),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl backdrop-saturate-150 sm:pl-[18px] sm:pr-2.5"
      >
        <div className="flex h-16 items-center justify-between gap-2 sm:gap-4">
          {/* Logo */}
          {/* Use just the mark on the narrowest phones so the account controls still fit. */}
          <BrandLogo
            size="sm"
            className="shrink-0 max-[360px]:[&>svg:last-child]:hidden max-[400px]:gap-2! max-[400px]:[&>svg:first-child]:size-[30px] max-[400px]:[&>svg:last-child]:h-[10px] max-[400px]:[&>svg:last-child]:w-[89px]"
          />

          {/* Desktop Nav */}
          <div className="hidden xl:flex items-center gap-1 ml-auto" data-testid="desktop-navigation">
            {onLanding &&
              sections.map((sct, index) =>
                sct.href.startsWith('/') ? (
                  <Link key={sct.href} to={sct.href} className={`${linkCls(sct.href)} ${index < 3 ? 'font-semibold!' : ''}`}>
                    {sct.label}
                  </Link>
                ) : (
                  <a key={sct.href} href={sct.href} className={`rounded-full px-3.5 py-2 text-sm transition-colors hover:bg-ink/5 ${index < 3 ? 'font-semibold text-ink' : 'font-medium text-muted'}`}>
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
            <Link to={isCreator ? CREATOR_RESERVE_LINK : '/reserve'} data-testid="nav-reserve" className={isCreator ? linkCls(onReservas ? location.pathname : '-') : linkCls('/reserve')}>
              Reserve
            </Link>
              </>
            )}
            {isAuthenticated && user?.role === 'creator' && (
              <Link
                to="/creator/dashboard"
                data-testid="nav-dashboard"
                aria-label={waiting ? `${t('nav.dashboard')}, ${waiting} reservas por responder` : undefined}
                className={`${linkCls(onReservas ? '-' : '/creator/dashboard')} inline-flex items-center gap-1.5`}
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
          <div className="flex shrink-0 items-center gap-1 min-[400px]:gap-1.5 sm:gap-3 max-[400px]:[&_.h-10]:size-9">
            <LanguageSelector />
            <HowItWorksButton role={isAuthenticated ? user?.role : undefined} />
            {isAuthenticated && user && <NotificationBell user={user} />}
            {isAuthenticated && user && (user.role === 'fan' || user.role === 'creator') && <CreditsPill user={user} />}

            <div ref={menuRef} className="relative">
                <button
                  ref={accountButtonRef}
                  type="button"
                  onClick={() => setShowMenu(open => !open)}
                  aria-label="Menú de cuenta"
                  aria-expanded={showMenu}
                  aria-controls={showMenu ? accountMenuId : undefined}
                  className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full p-1 pr-2 ring-1 ring-line transition hover:ring-brand-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                >
                  <Avatar src={user?.avatar} name={user?.name ?? 'Cuenta'} size={34} decorative />
                  <Icon name="fa-chevron-down" className="text-[10px] text-ink/50" />
                </button>
                {showMenu && (
                  <div
                    id={accountMenuId}
                    role="region"
                    aria-label="Opciones de cuenta"
                    data-testid="account-menu"
                    onKeyDown={event => {
                      if (event.key === 'Escape') accountButtonRef.current?.focus();
                    }}
                    className="absolute right-0 z-50 mt-2 max-h-[calc(100dvh-11rem)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-white py-2 shadow-[var(--shadow-lift)]"
                  >
                    <div className="border-b border-line px-4 pb-3 pt-1">
                      <p className="truncate text-sm font-semibold text-ink">{user?.name ?? t('nav.profile')}</p>
                      {user && <p className="truncate text-xs text-muted">{displayEmail(user.email)}</p>}
                    </div>
                    <DualViewSwitch onDone={() => setShowMenu(false)} />
                    {accountLinks.map(item => (
                      <Link key={item.to} to={item.to} onClick={() => setShowMenu(false)} className={accountLinkCls}>
                        <Icon name={item.icon} className="w-4 text-ink/50" /> {item.label}
                      </Link>
                    ))}
                    <div className="my-1 border-t border-line" />
                    {navigationLinks.map(item => (
                      <Link key={item.to} to={item.to} onClick={() => setShowMenu(false)} className={accountLinkCls}>
                        <Icon name={item.icon} className="w-4 text-ink/50" /> {item.label}
                        {isCreator && item.to === CREATOR_RESERVE_LINK && !!waiting && <RedDot count={waiting} className="ml-auto" />}
                      </Link>
                    ))}
                    {isAuthenticated && (
                      <>
                        <div className="my-1 border-t border-line" />
                        <button onClick={handleLogout} className={`${accountItemCls} w-full text-left text-danger hover:bg-red-50`}>
                          <Icon name="fa-arrow-right-from-bracket" className="w-4" /> {t('nav.logout')}
                        </button>
                      </>
                    )}
                  </div>
                )}
            </div>
            {!isAuthenticated && (
              <div className="hidden sm:flex items-center gap-2">
                <Link to="/login" className="inline-flex items-center rounded-full border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-canvas">
                  {t('nav.login')}
                </Link>
                <Link
                  to="/register"
                  className="inline-flex items-center rounded-full bg-[linear-gradient(120deg,var(--grad-soft),var(--grad-main)_55%,var(--grad-cta-end))] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_16px_34px_-16px_rgb(var(--brand-rgb)/0.7)] transition-transform active:scale-[0.98]"
                >
                  {t('nav.register')}
                </Link>
              </div>
            )}

          </div>
        </div>

      </div>
    </nav>
  );
};

export default Navbar;
