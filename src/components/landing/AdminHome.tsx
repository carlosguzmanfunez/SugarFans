import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../Icon';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { usePlatformQuery, platformApi } from '../../lib/platform';
import { backend } from '../../lib/backend';
import { fill } from '../../lib/liveSlots';
import type { AdminSection } from '../../lib/adminWorkspace';
import './admin-home.css';

// An admin's home: instead of the fans' pitch (hero, how it works, Reserve
// showcase), Inicio shows what is waiting for a decision, a quick look at the
// community and shortcuts into the Admin panel. The owner also gets a way back
// to the view switcher.
const WEEK = 7 * 86_400_000;

// Admin screens are only for the team: Spanish (the one we use) and English.
// Any other site language falls back to Spanish.
const TEXT = {
  es: {
    hello: 'Hola,', fallbackName: 'equipo',
    leadPending: 'Hay {count} pendientes que esperan tu revisión.', leadPendingOne: 'Hay 1 pendiente que espera tu revisión.',
    leadClear: 'Todo en orden: no hay pendientes por revisar.', loading: 'Consultando pendientes…',
    error: 'No se pudieron cargar los pendientes.', retry: 'Reintentar',
    attention: 'Qué necesita tu atención',
    verifications: 'Identidades por verificar', reports: 'Denuncias y solicitudes',
    moderation: 'Fotos y videos por revisar', disputes: 'Disputas abiertas con PayPal',
    stats: 'Comunidad', creators: 'Creadores', verified: 'Creadores verificados', fans: 'Fans', newWeek: 'Cuentas nuevas en 7 días',
    shortcuts: 'Accesos rápidos',
    users: 'Buscar personas', finance: 'Pagos a creadores', ledger: 'Todos los movimientos', attendance: 'Asistencia de Reserve',
    prospects: 'Captar creadores', monitor: 'Mano derecha', errors: 'Problemas de la página', infra: 'Costos y límites', projection: 'Proyección de ganancias',
    owner: 'Propietario', admin: 'Administración', review: 'Revisar', upToDate: 'Al día',
    attentionSub: 'Toca una tarjeta para ir directo a resolverlo.', statsSub: 'Así va creciendo Fans Reserve.',
    fullPanel: 'Panel completo', switchView: 'Cambiar de vista',
  },
  en: {
    hello: 'Hi,', fallbackName: 'team',
    leadPending: '{count} items are waiting for your review.', leadPendingOne: '1 item is waiting for your review.',
    leadClear: 'All clear: nothing is waiting for review.', loading: 'Checking what is pending…',
    error: 'Could not load what is pending.', retry: 'Try again',
    attention: 'What needs your attention',
    verifications: 'Identities to verify', reports: 'Reports and requests',
    moderation: 'Photos and videos to review', disputes: 'Open PayPal disputes',
    stats: 'Community', creators: 'Creators', verified: 'Verified creators', fans: 'Fans', newWeek: 'New accounts in 7 days',
    shortcuts: 'Shortcuts',
    users: 'Find people', finance: 'Creator payments', ledger: 'All transactions', attendance: 'Reserve attendance',
    prospects: 'Recruit creators', monitor: 'Right hand', errors: 'Site problems', infra: 'Costs and limits', projection: 'Profit projection',
    owner: 'Owner', admin: 'Admin', review: 'Review', upToDate: 'Up to date',
    attentionSub: 'Tap a card to go straight to it.', statsSub: 'How Fans Reserve is growing.',
    fullPanel: 'Full panel', switchView: 'Switch view',
  },
} as const;
const section = (id: AdminSection) => `/admin?section=${id}`;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Counts up from 0 the first time the number arrives.
const CountUp: React.FC<{ value: number | undefined }> = ({ value }) => {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (value === undefined) return;
    if (reducedMotion() || value === 0) { setShown(value); return; }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 900);
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{value === undefined ? '—' : shown}</>;
};

const AdminHome: React.FC = () => {
  const { user, listAccounts } = useAuth();
  const { language } = useLanguage();
  const tx = TEXT[language === 'en' ? 'en' : 'es'];
  const { data, loading, error, reload } = usePlatformQuery(
    async () => {
      const [verifications, reports, payments, media, accounts] = await Promise.all([
        platformApi.listVerifications(),
        platformApi.listReports(),
        platformApi.allPayments(),
        backend.moderationQueue(),
        listAccounts(),
      ]);
      const weekAgo = Date.now() - WEEK;
      return {
        verifications: verifications.filter((v) => v.status === 'pending').length,
        reports: reports.filter((r) => r.status === 'pending').length,
        moderation: media.filter((m) => m.status === 'pending' || m.status === 'review').length,
        disputes: payments.filter((p) => p.status === 'disputed' && p.kind !== 'referral').length,
        creators: accounts.filter((a) => a.role === 'creator').length,
        verified: accounts.filter((a) => a.role === 'creator' && a.isVerified).length,
        fans: accounts.filter((a) => a.role === 'fan').length,
        newWeek: accounts.filter((a) => Date.parse(a.createdAt) >= weekAgo).length,
      };
    },
    [user?.id],
    null
  );

  const first = (user?.name ?? '').split(' ')[0] || tx.fallbackName;
  const tasks = [
    { id: 'verifications', tone: 'ah-c-iris', icon: 'fa-shield-halved', label: tx.verifications, count: data?.verifications },
    { id: 'reports', tone: 'ah-c-rose', icon: 'fa-flag', label: tx.reports, count: data?.reports },
    { id: 'moderation', tone: 'ah-c-amber', icon: 'fa-images', label: tx.moderation, count: data?.moderation },
    { id: 'payouts', tone: 'ah-c-red', icon: 'fa-hand-holding-dollar', label: tx.disputes, count: data?.disputes },
  ] as const;
  const pending = data ? tasks.reduce((sum, task) => sum + (task.count ?? 0), 0) : null;
  const lead = pending === null
    ? (error ? tx.error : tx.loading)
    : pending === 0
      ? tx.leadClear
      : pending === 1
        ? tx.leadPendingOne
        : fill(tx.leadPending, { count: pending });

  const stats = [
    { label: tx.creators, value: data?.creators },
    { label: tx.verified, value: data?.verified },
    { label: tx.fans, value: data?.fans },
    { label: tx.newWeek, value: data?.newWeek },
  ];
  const shortcuts: { id: AdminSection; icon: string; label: string }[] = [
    { id: 'users', icon: 'fa-users', label: tx.users },
    { id: 'finance', icon: 'fa-wallet', label: tx.finance },
    { id: 'ledger', icon: 'fa-chart-pie', label: tx.ledger },
    { id: 'projection', icon: 'fa-arrow-trend-up', label: tx.projection },
    { id: 'attendance', icon: 'fa-ticket', label: tx.attendance },
    { id: 'prospects', icon: 'fa-bullseye', label: tx.prospects },
    { id: 'monitor', icon: 'fa-bell', label: tx.monitor },
    { id: 'errors', icon: 'fa-ban', label: tx.errors },
    { id: 'infra', icon: 'fa-chart-line', label: tx.infra },
  ];

  const today = new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'es-HN', {
    timeZone: 'America/Tegucigalpa', weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date()).replace(/^./, (c) => c.toUpperCase());

  return (
    <section className="ah" aria-labelledby="admin-home-title" data-testid="admin-home">
      <div className="wrap">
        <div className="ah-card ah-rise">
          <span className="ah-orb ah-orb-1" aria-hidden="true" />
          <span className="ah-orb ah-orb-2" aria-hidden="true" />
          <span className="ah-orb ah-orb-3" aria-hidden="true" />
          <div className="ah-head">
            <span className="ah-badge">
              <span className="ah-badge-icon" aria-hidden="true"><Icon name={user?.isOwner ? 'fa-crown' : 'fa-shield-halved'} /></span>
              {user?.isOwner ? tx.owner : tx.admin} · Fans Reserve
            </span>
            <h1 id="admin-home-title" className="ah-title">
              {tx.hello} <span className="ah-name">{first}</span>.
            </h1>
            <p className="ah-date">{today}</p>
          </div>
          <div className="ah-side">
            <p className="ah-status" data-testid="admin-home-lead">
              <span className="ah-dot" data-pending={!!pending} aria-hidden="true" />
              {lead}
            </p>
            <div className="ah-actions">
              {error && !data && (
                <button type="button" onClick={() => void reload()} className="ah-btn ah-btn-ghost">{tx.retry}</button>
              )}
              <Link to="/admin" className="ah-btn ah-btn-gold" data-testid="admin-home-panel">
                <Icon name="fa-chart-line" /> {tx.fullPanel}
              </Link>
              <Link to={section('monitor')} className="ah-btn ah-btn-ghost" data-testid="admin-home-monitor">
                <Icon name="fa-bell" /> {tx.monitor}
              </Link>
              {user?.isOwner && (
                <Link to="/owner" className="ah-btn ah-btn-ghost" data-testid="admin-home-owner">
                  <Icon name="fa-users" /> {tx.switchView}
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="ah-section">
          <div className="ah-sechead"><h2 className="ah-h2">{tx.attention}</h2><p className="ah-sub">{tx.attentionSub}</p></div>
          <ul className="ah-tasks">
            {tasks.map((task, i) => {
              const waiting = (task.count ?? 0) > 0;
              return (
                <li key={task.id} className="ah-rise" style={{ '--i': i + 1 } as React.CSSProperties}>
                  <Link to={section(task.id)} data-testid={`admin-home-task-${task.id}`} data-pending={waiting} className={`ah-task ${task.tone}`}>
                    {waiting && <span className="ah-flag" aria-hidden="true" />}
                    <span className="ah-task-icon" aria-hidden="true"><Icon name={task.icon} /></span>
                    <strong className="ah-task-count">{loading && !data ? '—' : <CountUp value={task.count} />}</strong>
                    <span className="ah-task-label">{task.label}</span>
                    <span className="ah-task-go">{waiting ? tx.review : tx.upToDate} <Icon name="fa-arrow-right" /></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="ah-section">
          <div className="ah-sechead"><h2 className="ah-h2">{tx.stats}</h2><p className="ah-sub">{tx.statsSub}</p></div>
          <dl className="ah-stats">
            {stats.map((stat, i) => (
              <div key={stat.label} className={`ah-stat ah-s${i + 1} ah-rise`} style={{ '--i': i + 5 } as React.CSSProperties}>
                <dt>{stat.label}</dt>
                <dd><CountUp value={stat.value} /></dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="ah-section">
          <h2 className="ah-h2">{tx.shortcuts}</h2>
          <ul className="ah-shorts">
            {shortcuts.map((item, i) => (
              <li key={item.id} className="ah-rise" style={{ '--i': i + 9 } as React.CSSProperties}>
                <Link to={section(item.id)} data-testid={`admin-home-go-${item.id}`} className="ah-short">
                  <span className="ah-short-icon" aria-hidden="true"><Icon name={item.icon} /></span>
                  <span>{item.label}</span>
                  <Icon name="fa-arrow-right" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};

export default AdminHome;
