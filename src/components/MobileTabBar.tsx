import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Phone navigation, like an installed app: five tabs pinned to the bottom of
// the screen (hidden from md up, where the top bar has room for everything).
// The account tab adapts to who is signed in.
const MobileTabBar: React.FC = () => {
  const { user, isAuthenticated } = useAuth();
  const { pathname, search } = useLocation();
  const liveTab = pathname === '/explore' && new URLSearchParams(search).has('live');

  const account = !isAuthenticated
    ? { to: '/login', label: 'Entrar', icon: 'fa-circle-user', active: pathname === '/login' || pathname === '/register' }
    : user?.role === 'creator'
      ? { to: '/creator/dashboard', label: 'Mi panel', icon: 'fa-chart-line', active: pathname.startsWith('/creator/dashboard') }
      : user?.role === 'admin'
        ? { to: '/admin', label: 'Admin', icon: 'fa-shield-halved', active: pathname === '/admin' }
        : { to: '/profile', label: 'Perfil', icon: 'fa-user', active: pathname === '/profile' || pathname === '/settings' };

  const tabs = [
    { to: '/', label: 'Inicio', icon: 'fa-house', active: pathname === '/' },
    { to: '/explore', label: 'Explorar', icon: 'fa-compass', active: pathname === '/explore' && !liveTab },
    { to: '/explore?live=1', label: 'Live', icon: 'fa-tower-broadcast', active: liveTab, live: true },
    { to: '/reserve', label: 'Reserve', icon: 'fa-ticket', active: pathname === '/reserve' || pathname === '/vip-experiences' },
    account,
  ];

  return (
    <nav
      aria-label="Pestañas"
      data-testid="tab-bar"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line/80 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="mx-auto grid h-16 max-w-md grid-cols-5">
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
              <i className={`fas ${tab.icon} text-[19px]`} aria-hidden="true"></i>
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};

export default MobileTabBar;
