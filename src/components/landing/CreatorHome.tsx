import React from 'react';
import { Link } from 'react-router-dom';
import Icon from '../Icon';
import { useAuth } from '../../context/AuthContext';
import { usePlatformQuery, platformApi, computeEarnings, money } from '../../lib/platform';
import { socialApi } from '../../lib/social';
import { levelById, nextLevel, rewardsApi } from '../../lib/rewards';
import { useReserveInbox } from '../../lib/live';
import { CREATOR_RESERVE_LINK } from '../../lib/reserveAlerts';

// A creator's home: instead of the fans' hero (which sells creators to fans), the top
// of the page is about their own day: requests waiting, money this month, how close
// the next level is, and a nudge to post when their fans haven't seen anything new for a while.
// The rest of the landing stays the same below.
export const STALE_DAYS = 7;
// Opens the panel's Contenido tab with the new-post form already open and in view.
const CONTENT_LINK = '/creator/dashboard?tab=content#nuevo';
const DAY = 86_400_000;

const CreatorHome: React.FC = () => {
  const { user } = useAuth();
  const profileId = user?.creatorProfileId ?? user?.id ?? '';
  const waiting = useReserveInbox(user ?? null);
  const { data } = usePlatformQuery(
    async () => {
      if (!user) return null;
      const [sales, payouts, posts, rewards] = await Promise.all([
        platformApi.creatorSales(profileId),
        platformApi.myPayouts(user.id),
        socialApi.postsByCreator(profileId),
        rewardsApi.myRewards(user),
      ]);
      const last = posts.reduce((max, p) => Math.max(max, Date.parse(p.createdAt) || 0), 0);
      return { earnings: computeEarnings(sales, payouts), lastPost: last || null, rewards };
    },
    [user?.id, profileId],
    null
  );

  const first = (user?.name ?? '').split(' ')[0];
  const days = data?.lastPost ? Math.floor((Date.now() - data.lastPost) / DAY) : null;
  const stale = !!data && (days === null || days >= STALE_DAYS);
  // Metas: how far along the closer of the two ways up (active fans or 30-day sales) is.
  const level = data ? levelById(data.rewards.level) : null;
  const next = level ? nextLevel(level) : null;
  const pct = data && next
    ? Math.min(99, Math.floor(100 * Math.max(data.rewards.activeFans / next.minFans, data.rewards.sales / next.minSales)))
    : null;

  const tiles = [
    {
      to: CREATOR_RESERVE_LINK,
      label: 'Reservas por responder',
      value: String(waiting),
      icon: <Icon name="fa-ticket" />,
      alert: waiting > 0,
      testid: 'ch-reservas',
    },
    {
      to: '/creator/dashboard?tab=earnings',
      label: 'Ganado este mes',
      value: data ? money(data.earnings.thisMonth) : '…',
      icon: <Icon name="fa-wallet" />,
      testid: 'ch-ganado',
    },
    {
      to: '/creator/dashboard?tab=goals#panel-tabs',
      // Labelled as progress (with a bar) so it never reads as the creator's cut of a payment.
      label: next ? `Avance a ${next.name}` : level ? 'Nivel más alto' : 'Tu meta',
      value: pct !== null ? `${pct}%` : level ? level.name : '…',
      icon: <Icon name="fa-bullseye" />,
      bar: pct,
      testid: 'ch-metas',
    },
  ];

  return (
    <header className="hero" aria-labelledby="creator-home-title" data-testid="creator-home">
      <div className="wrap">
        <h1 id="creator-home-title" className="text-[clamp(36px,5vw,56px)]! leading-[1.05]!">
          Hola, <span className="bg-[linear-gradient(90deg,var(--brand),var(--iris)_60%,var(--gold))] bg-clip-text text-transparent">{first || 'creador'}</span>.
        </h1>
        <p className="lead">
          {waiting > 0
            ? `Tienes ${waiting === 1 ? '1 reserva esperando' : `${waiting} reservas esperando`} tu respuesta.`
            : 'Esto es lo que pasa hoy en tu cuenta.'}
        </p>

        {data && (
          <div
            data-testid="ch-nudge"
            className={`mt-7 flex flex-col gap-4 rounded-3xl border p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 ${
              stale ? 'border-brand-200 bg-gradient-to-br from-brand-50 to-white' : 'border-emerald-200 bg-emerald-50/60'
            }`}
          >
            <div className="flex items-start gap-3.5">
              <span
                aria-hidden="true"
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-lg ${stale ? 'bg-brand-500 text-white' : 'bg-emerald-500 text-white'}`}
              >
                <Icon name={stale ? 'fa-images' : 'fa-check'} />
              </span>
              <div>
                <p className="text-[17px] font-semibold text-ink">
                  {days === null
                    ? 'Aún no has publicado nada'
                    : stale
                      ? `Tus fans no te ven desde hace ${days} días`
                      : days === 0
                        ? 'Publicaste hoy, ¡bien ahí!'
                        : `Publicaste hace ${days === 1 ? '1 día' : `${days} días`}`}
                </p>
                <p className="mt-0.5 text-sm text-ink/60">
                  {stale
                    ? 'Una foto, un video o un Live mantienen a tu comunidad cerca y suscrita.'
                    : 'Sigue así: publicar seguido mantiene a tu comunidad cerca y suscrita.'}
                </p>
              </div>
            </div>
            <div className="grid gap-2 sm:flex sm:flex-none">
              <Link to={CONTENT_LINK} className="v-btn v-pri" data-testid="ch-subir">
                <Icon name="fa-upload" /> Subir foto o video
              </Link>
              <Link to={`/creator/${profileId}`} className="v-btn v-ghost" data-testid="ch-perfil">
                <Icon name="fa-user" /> Mi perfil
              </Link>
              <Link to="/creator/dashboard" className="v-btn v-ghost">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-red-500" /> Iniciar Live
              </Link>
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2.5 sm:gap-4">
          {tiles.map((t) => (
            <Link
              key={t.label}
              to={t.to}
              data-testid={t.testid}
              className={`group flex flex-col gap-2 rounded-2xl border bg-white p-3.5 transition-colors hover:border-brand-200 sm:p-5 ${
                t.alert ? 'border-red-200' : 'border-line'
              }`}
            >
              <span className={`text-lg ${t.alert ? 'text-red-600' : 'text-ink/45'}`}>{t.icon}</span>
              <span className={`font-display text-xl font-semibold tabular-nums sm:text-2xl ${t.alert ? 'text-red-600' : 'text-ink'}`}>{t.value}</span>
              {'bar' in t && t.bar !== null && (
                <span className="h-1.5 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-label={t.label} aria-valuenow={t.bar} aria-valuemin={0} aria-valuemax={100}>
                  <span className="block h-full rounded-full bg-gradient-to-r from-amber-500 to-brand-500" style={{ width: `${Math.max(t.bar ?? 0, 3)}%` }} />
                </span>
              )}
              <span className="text-[12px] leading-tight text-ink/60 sm:text-sm">{t.label}</span>
            </Link>
          ))}
        </div>

        <div className="mt-5">
          <Link to="/creator/dashboard" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
            Ir a mi panel completo <Icon name="fa-arrow-right" />
          </Link>
        </div>
      </div>
    </header>
  );
};

export default CreatorHome;
