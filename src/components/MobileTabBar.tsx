import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ENABLE_OPEN_LIVE } from '../config/features';
import { useReserveInbox } from '../lib/live';
import { CREATOR_RESERVE_LINK } from '../lib/reserveAlerts';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Phone navigation, like an installed app: tabs pinned to the bottom of the
// screen (hidden from md up, where the top bar has room for everything).
// The account tab adapts to who is signed in. There is no Live tab: Live is not a
// pillar of Fans Reserve (it comes back only with ENABLE_OPEN_LIVE). A creator gets
// "Reservas" (their requests, with a red dot while some wait for an answer)
// instead of the fans' Reserve catalogue.
// The red dot with how many items wait (shared with the top bar and the panel).
export const RedDot: React.FC<{ count: number; className?: string }> = ({ count, className = '' }) => (
  <span
    aria-hidden="true"
    data-testid="reserve-badge"
    className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white ${className}`}
  >
    {count > 9 ? '9+' : count}
  </span>
);

const MobileTabBar: React.FC = () => {
  const { user, isAuthenticated } = useAuth();
  const { pathname, search } = useLocation();
  const liveTab = ENABLE_OPEN_LIVE && pathname === '/explore' && new URLSearchParams(search).has('live');
  const isCreator = isAuthenticated && user?.role === 'creator';
  const waiting = useReserveInbox(isCreator ? user : null);
  const onReservas = pathname.startsWith('/creator/dashboard') && new URLSearchParams(search).get('tab') === 'vip';

  const account = !isAuthenticated
    ? { to: '/login', label: 'Entrar', icon: 'fa-circle-user', active: pathname === '/login' || pathname === '/register' }
    : user?.role === 'creator'
      ? { to: '/creator/dashboard', label: 'Mi panel', icon: 'fa-chart-line', active: pathname.startsWith('/creator/dashboard') && !onReservas }
      : user?.role === 'admin'
        ? { to: '/admin', label: 'Admin', icon: 'fa-shield-halved', active: pathname === '/admin' }
        : { to: '/profile', label: 'Perfil', icon: 'fa-user', active: pathname === '/profile' || pathname === '/settings' };

  const tabs = [
    { to: '/', label: 'Inicio', icon: 'fa-house', active: pathname === '/' },
    { to: '/explore', label: 'Explorar', icon: 'fa-compass', active: pathname === '/explore' && !liveTab },
    ...(ENABLE_OPEN_LIVE ? [{ to: '/explore?live=1', label: 'Live', icon: 'fa-tower-broadcast', active: liveTab, live: true }] : []),
    isCreator
      ? { to: CREATOR_RESERVE_LINK, label: 'Reservas', icon: 'fa-ticket', active: onReservas, badge: waiting }
      : { to: '/reserve', label: 'Reserve', icon: 'fa-ticket', active: pathname === '/reserve' || pathname === '/vip-experiences' },
    account,
  ];

  return (
    <nav
      aria-label="Pestañas"
      data-testid="tab-bar"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line/80 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className={`mx-auto grid h-16 max-w-md ${tabs.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}>
        {tabs.map((tab) => (
          <li key={tab.label} className="flex">
            <Link
              to={tab.to}
              aria-current={tab.active ? 'page' : undefined}
              onClick={() => {
                // Tapping the tab you are already on goes back to its top.
                if (tab.active) window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
              }}
              className={`tab-press flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                tab.active ? ('live' in tab ? 'text-red-600' : 'text-brand-700') : 'text-ink/55'
              }`}
            >
              <span className="relative">
                <i key={tab.active ? 'on' : 'off'} className={`fas ${tab.icon} text-[19px] ${tab.active ? 'tab-pop' : ''}`} aria-hidden="true"></i>
                {'badge' in tab && !!tab.badge && <RedDot count={tab.badge} className="absolute -right-2.5 -top-1.5" />}
              </span>
              {tab.label}
              {'badge' in tab && !!tab.badge && <span className="sr-only">, {tab.badge} por responder</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};

export default MobileTabBar;
