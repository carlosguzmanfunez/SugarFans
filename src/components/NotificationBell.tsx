import React, { useRef, useState } from 'react';
import Icon from './Icon';
import type { User } from '../context/AuthContext';
import { useNotifications, markNotificationsRead, dismissNotification, dismissAllNotifications, type AppNotification } from '../lib/live';
import { useLanguage } from '../context/LanguageContext';
import { useDismiss } from '../hooks/useDismiss';
import NotificationItem from './NotificationItem';
import { PushToggle } from './PushOptIn';

const timeAgo = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });
};

const KIND_ICON: Record<AppNotification['kind'], { icon: string; className: string }> = {
  live_started: { icon: 'fa-tower-broadcast', className: 'bg-red-50 text-red-600' },
  creator_goal: { icon: 'fa-crown', className: 'bg-amber-50 text-amber-600' },
  subscription_payment: { icon: 'fa-star', className: 'bg-emerald-50 text-emerald-700' },
  subscription_update: { icon: 'fa-bell', className: 'bg-brand-50 text-brand-700' },
  reserve_request: { icon: 'fa-ticket', className: 'bg-brand-50 text-brand-700' },
  reserve_update: { icon: 'fa-ticket', className: 'bg-iris-50 text-iris-700' },
};

// The account inbox: Reserve updates, confirmed subscription payments and changes.
const NotificationBell: React.FC<{ user: User }> = ({ user }) => {
  const { data } = useNotifications(user);
  const { t } = useLanguage();
  const [clearing, setClearing] = useState(false);
  const [removed, setRemoved] = useState<{ userId: string; ids: string[] }>({ userId: user.id, ids: [] });
  const [feedback, setFeedback] = useState({ userId: user.id, error: '', message: '' });
  const panel = useRef<HTMLDivElement>(null);
  const items = data.filter(n => removed.userId !== user.id || !removed.ids.includes(n.id));
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const unread = items.filter((n) => !n.read).length;

  const remove = async (id: string) => {
    const activeRow = document.activeElement?.closest('[data-notification-id]');
    if (activeRow?.getAttribute('data-notification-id') === id) panel.current?.focus();
    setFeedback({ userId: user.id, error: '', message: '' });
    try {
      const result = await dismissNotification(user, id);
      if (!result.ok) throw new Error(result.error);
      setRemoved(previous => ({ userId: user.id, ids: [...(previous.userId === user.id ? previous.ids : []), id] }));
      setFeedback({ userId: user.id, error: '', message: 'Aviso eliminado.' });
      return true;
    } catch {
      setFeedback({ userId: user.id, error: 'No se pudo borrar el aviso. Revisa tu conexión e inténtalo de nuevo.', message: '' });
      return false;
    }
  };

  // Like Android's "Borrar todo": one tap empties the inbox, no confirmation.
  const removeAll = async () => {
    if (clearing) return;
    setClearing(true);
    setFeedback({ userId: user.id, error: '', message: '' });
    try {
      const result = await dismissAllNotifications(user);
      if (!result.ok) throw new Error(result.error);
      const ids = items.map((n) => n.id);
      setRemoved(previous => ({ userId: user.id, ids: [...(previous.userId === user.id ? previous.ids : []), ...ids] }));
      setFeedback({ userId: user.id, error: '', message: t('notifications.clearedAll') });
      panel.current?.focus();
    } catch {
      setFeedback({ userId: user.id, error: t('notifications.clearAllError'), message: '' });
    } finally {
      setClearing(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread) markNotificationsRead(user);
  };

  return (
    <div ref={ref} className="relative max-sm:static">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread ? `Avisos, ${unread} sin leer` : 'Avisos'}
        aria-expanded={open}
        data-testid="notification-bell"
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink/70 ring-1 ring-line transition hover:text-ink hover:ring-brand-200"
      >
        <Icon name="fa-bell" />
        {unread > 0 && (
          <span data-testid="notification-count" className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={panel}
          tabIndex={-1}
          role="region"
          aria-label="Avisos"
          data-testid="notification-panel"
          className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] max-sm:inset-x-2 max-sm:top-full max-sm:w-auto max-sm:max-w-none overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-lift)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-1">
            <p className="text-sm font-semibold text-ink">Avisos</p>
            <PushToggle user={user} />
          </div>
          <span className="sr-only">Desliza un aviso a la derecha o a la izquierda para eliminarlo.</span>
          {feedback.userId === user.id && feedback.error && <p role="alert" className="px-4 py-2 text-xs text-red-700">{feedback.error}</p>}
          <span role="status" className="sr-only">{feedback.userId === user.id ? feedback.message : ''}</span>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">
              {user.role === 'creator'
                ? 'Aún no tienes avisos. Aquí verás las novedades de tus reservas y suscriptores.'
                : 'Aún no tienes avisos. Aquí verás las novedades de tus reservas y suscripciones.'}
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto overscroll-contain">
              {items.map((n) => (
                <NotificationItem key={`${user.id}:${n.id}`} notification={n} icon={KIND_ICON[n.kind] ?? KIND_ICON.live_started} time={timeAgo(n.createdAt)} onOpen={() => setOpen(false)} onDismiss={remove} />
              ))}
            </ul>
          )}
          {items.length > 0 && (
            <div className="flex justify-center border-t border-line py-1.5">
              <button type="button" onClick={removeAll} disabled={clearing} data-testid="notifications-clear-all" className="rounded-full px-3 py-1 text-xs font-medium text-muted transition hover:text-ink disabled:opacity-50">
                {t('notifications.clearAll')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
