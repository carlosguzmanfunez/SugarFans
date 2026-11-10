import React from 'react';
import { Link } from 'react-router-dom';
import Icon from '../Icon';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { usePlatformQuery, platformApi } from '../../lib/platform';
import { backend } from '../../lib/backend';
import { fill } from '../../lib/liveSlots';
import type { AdminSection } from '../../lib/adminWorkspace';

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
    prospects: 'Captar creadores', monitor: 'Mano derecha', errors: 'Problemas de la página', infra: 'Costos y límites',
    fullPanel: 'Ir al panel de administración completo', switchView: 'Cambiar de vista (fan, creador o admin)',
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
    prospects: 'Recruit creators', monitor: 'Right hand', errors: 'Site problems', infra: 'Costs and limits',
    fullPanel: 'Open the full admin panel', switchView: 'Switch view (fan, creator or admin)',
  },
} as const;
const section = (id: AdminSection) => `/admin?section=${id}`;

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
    { id: 'verifications', icon: 'fa-shield-halved', label: tx.verifications, count: data?.verifications },
    { id: 'reports', icon: 'fa-flag', label: tx.reports, count: data?.reports },
    { id: 'moderation', icon: 'fa-images', label: tx.moderation, count: data?.moderation },
    { id: 'payouts', icon: 'fa-hand-holding-dollar', label: tx.disputes, count: data?.disputes },
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
    { id: 'attendance', icon: 'fa-ticket', label: tx.attendance },
    { id: 'prospects', icon: 'fa-bullseye', label: tx.prospects },
    { id: 'monitor', icon: 'fa-bell', label: tx.monitor },
    { id: 'errors', icon: 'fa-ban', label: tx.errors },
    { id: 'infra', icon: 'fa-chart-line', label: tx.infra },
  ];

  return (
    <header className="hero" aria-labelledby="admin-home-title" data-testid="admin-home">
      <div className="wrap">
        <h1 id="admin-home-title" className="text-[clamp(36px,5vw,56px)]! leading-[1.05]!">
          {tx.hello}{' '}
          <span className="bg-[linear-gradient(90deg,var(--brand),var(--iris)_60%,var(--gold))] bg-clip-text text-transparent">{first}</span>.
        </h1>
        <p className="lead" data-testid="admin-home-lead">{lead}</p>
        {error && !data && (
          <button type="button" onClick={() => void reload()} className="v-btn v-ghost mt-4">{tx.retry}</button>
        )}

        <section className="mt-7" aria-labelledby="admin-home-attention">
          <h2 id="admin-home-attention" className="text-lg font-semibold text-ink">{tx.attention}</h2>
          <ul className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tasks.map((task) => {
              const waiting = (task.count ?? 0) > 0;
              return (
                <li key={task.id} className="flex">
                  <Link
                    to={section(task.id)}
                    data-testid={`admin-home-task-${task.id}`}
                    className={`flex flex-1 flex-col gap-2 rounded-2xl border p-4 transition-colors ${
                      waiting ? 'border-brand-200 bg-gradient-to-br from-brand-50 to-white hover:border-brand-400' : 'border-line bg-white hover:border-ink/30'
                    }`}
                  >
                    <span aria-hidden="true" className={`grid h-10 w-10 place-items-center rounded-xl text-base ${waiting ? 'bg-brand-500 text-white' : 'bg-ink/5 text-ink/60'}`}>
                      <Icon name={task.icon} />
                    </span>
                    <strong className="text-2xl font-bold tabular-nums text-ink">{loading && !data ? '—' : task.count ?? '—'}</strong>
                    <span className="text-sm leading-snug text-ink/70">{task.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="mt-7" aria-labelledby="admin-home-stats">
          <h2 id="admin-home-stats" className="text-lg font-semibold text-ink">{tx.stats}</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 rounded-2xl border border-line bg-white p-4 sm:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label}>
                <dt className="text-xs text-ink/60">{stat.label}</dt>
                <dd className="mt-0.5 text-xl font-bold tabular-nums text-ink">{stat.value ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-7" aria-labelledby="admin-home-shortcuts">
          <h2 id="admin-home-shortcuts" className="text-lg font-semibold text-ink">{tx.shortcuts}</h2>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {shortcuts.map((item) => (
              <li key={item.id} className="flex">
                <Link
                  to={section(item.id)}
                  data-testid={`admin-home-go-${item.id}`}
                  className="flex min-h-12 flex-1 items-center gap-2.5 rounded-xl border border-line bg-white px-3 py-2.5 text-sm font-medium text-ink hover:border-ink/30"
                >
                  <Icon name={item.icon} className="text-brand-700" />
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
          <Link to="/admin" className="inline-flex items-center gap-1.5 text-brand-700 hover:underline" data-testid="admin-home-panel">
            {tx.fullPanel} <Icon name="fa-arrow-right" />
          </Link>
          {user?.isOwner && (
            <Link to="/owner" className="inline-flex items-center gap-1.5 text-brand-700 hover:underline" data-testid="admin-home-owner">
              {tx.switchView} <Icon name="fa-arrow-right" />
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};

export default AdminHome;
