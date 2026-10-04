import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { User } from '../context/AuthContext';
import { useNotifications, markNotificationsRead } from '../lib/live';
import { useDismiss } from '../hooks/useDismiss';

const timeAgo = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });
};

// "Campanita": tells the fan when a creator they subscribe to starts a Subscriber Live.
const NotificationBell: React.FC<{ user: User }> = ({ user }) => {
  const { data: items } = useNotifications(user);
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const unread = items.filter((n) => !n.read).length;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread) markNotificationsRead(user);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread ? `Avisos, ${unread} sin leer` : 'Avisos'}
        aria-expanded={open}
        data-testid="notification-bell"
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink/70 ring-1 ring-line transition hover:text-ink hover:ring-brand-200"
      >
        <i aria-hidden="true" className="fas fa-bell"></i>
        {unread > 0 && (
          <span data-testid="notification-count" className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="region"
          aria-label="Avisos"
          data-testid="notification-panel"
          className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-lift)]"
        >
          <p className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">Avisos</p>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">
              Aún no tienes avisos. Suscríbete a un creator y te avisaremos de sus Lives para suscriptores.
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    to={n.link || '/'}
                    onClick={() => setOpen(false)}
                    className={`flex gap-3 px-4 py-3 text-left hover:bg-canvas ${n.read ? '' : 'bg-brand-50/60'}`}
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
                      <i aria-hidden="true" className="fas fa-tower-broadcast text-xs"></i>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{n.title}</span>
                      {n.body && <span className="block truncate text-xs text-ink/70">{n.body}</span>}
                      <span className="block text-[11px] text-muted">{timeAgo(n.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
