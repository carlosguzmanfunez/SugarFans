import React from 'react';
import type { User } from '../../context/AuthContext';
import { socialApi, compactCount } from '../../lib/social';
import { usePlatformQuery } from '../../lib/platform';
import { Link } from 'react-router-dom';
import { useCurrentLive, useLiveAlerts, setLiveAlerts } from '../../lib/live';
import { ENABLE_OPEN_LIVE } from '../../config/features';

export const useFollow = (creatorProfileId: string | undefined, user: User | null) =>
  usePlatformQuery(
    () => (creatorProfileId ? socialApi.followState(creatorProfileId, user) : Promise.resolve({ following: false, count: 0 })),
    [creatorProfileId, user?.id],
    { following: false, count: 0 }
  ).data;

interface Props {
  creator: { id: string; name: string; subscriptionPrice: number; followers: number };
  user: User | null;
  isOwner: boolean;
  isSubscribed: boolean;
  following: boolean;
  experiences: number;
  onSubscribe: () => void;
  onNeedLogin: () => void;
}

// How to get closer to a creator, from free to most personal:
// Seguir → Suscribirse (includes Subscriber Live) → Reserve (Reserve Event, Reserve 1:1).
// Each one says what it gives and what it doesn't. Live is not a step of its own.
const AccessLadder: React.FC<Props> = ({ creator, user, isOwner, isSubscribed, following, experiences, onSubscribe }) => {
  const current = useCurrentLive(creator.id);
  // An Open Live only counts while Open Live is enabled.
  const live = current && (current.mode === 'subscriber' || ENABLE_OPEN_LIVE) ? current : null;
  const subscriberLive = live?.mode === 'subscriber';
  const canEnter = !!live && (!subscriberLive || isSubscribed || isOwner);
  const alerts = useLiveAlerts(following ? creator.id : undefined, user);
  const step = 'flex flex-col rounded-2xl border border-line bg-white p-4';
  const action = 'mt-3 inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-semibold transition';

  return (
    <section aria-labelledby="access-title" className="mb-6" data-testid="access-ladder">
      <h2 id="access-title" className="sr-only">Formas de acceso</h2>
      <ol className="grid grid-cols-2 gap-3 lg:grid-cols-3 [&>li:last-child]:col-span-2 lg:[&>li:last-child]:col-span-1">
        <li className={step}>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">1 · Seguir</span>
          <span className="mt-1 text-sm font-semibold text-ink">Gratis</span>
          <span className="text-xs text-ink/60">Contenido público y novedades.</span>
          {!isOwner && following && (
            <span className="mt-3 inline-flex items-center text-xs font-semibold text-ink/70" data-testid="ladder-following">
              <i aria-hidden="true" className="fas fa-check mr-1.5 text-emerald-600"></i>Ya lo sigues
            </span>
          )}
          {isOwner && <span className="mt-3 text-xs text-muted">{compactCount(creator.followers)} seguidores</span>}
          {!isOwner && following && user && (
            <button
              type="button"
              onClick={() => setLiveAlerts(user, creator.id, !alerts)}
              aria-pressed={alerts}
              data-testid="live-alerts"
              className="mt-2 inline-flex items-center gap-1.5 self-start text-xs font-medium text-ink/70 hover:text-ink"
            >
              <i aria-hidden="true" className={`fas ${alerts ? 'fa-bell text-brand-600' : 'fa-bell-slash'}`}></i>
              {alerts ? 'Te avisaremos cuando esté en Live' : 'Avisos de Live desactivados'}
            </button>
          )}
        </li>
        <li className={`${step} ${live ? 'border-iris-200 bg-iris-50/40' : ''}`} data-testid="ladder-subscribe">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">2 · Suscribirse</span>
          <span className="mt-1 text-sm font-semibold text-ink">${creator.subscriptionPrice}/mes</span>
          <span className="text-xs text-ink/60">Contenido exclusivo, Lives para suscriptores y beneficios del creador.</span>
          {live && (
            <span className="mt-2 flex flex-col gap-0.5" data-testid="live-now">
              <span className="flex items-center text-sm font-semibold text-red-600">
                <span className="mr-1.5 h-2 w-2 rounded-full bg-red-500 animate-pulse"></span>
                {subscriberLive ? 'Live para suscriptores · ahora' : 'En Live ahora · Gratis'}
              </span>
              <span className="truncate text-xs text-ink/60">{live.title}</span>
            </span>
          )}
          {live && !isOwner && canEnter && (
            <Link to={`/en-vivo/${creator.id}`} className={`${action} bg-red-600 text-white hover:bg-red-700`}>
              Entrar al Live
            </Link>
          )}
          {!isOwner && user?.role !== 'creator' && (isSubscribed ? (
            <span className="mt-3 inline-flex h-10 items-center justify-center rounded-full border border-line px-4 text-sm font-semibold text-ink/70">
              <i aria-hidden="true" className="fas fa-check mr-1.5"></i>Tu suscripción está activa
            </span>
          ) : live && subscriberLive ? (
            // The main "Suscribirse" button lives in the profile header; here it only
            // shows when it unlocks a Live that is on right now.
            <button type="button" onClick={onSubscribe} className={`${action} bg-gradient-to-r from-brand-600 to-iris-600 text-white`}>
              Suscribirse para entrar
            </button>
          ) : null)}
          {live && subscriberLive && !canEnter && (
            <span className="mt-2 text-xs text-ink/60" data-testid="subscriber-live-locked">
              <i aria-hidden="true" className="fas fa-lock mr-1"></i>Exclusivo para suscriptores
            </span>
          )}
        </li>
        <li className={`${step} border-gold-300 bg-gradient-to-br from-white to-gold-50`}>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-700">3 · Reserve</span>
          <span className="mt-1 text-sm font-semibold text-ink">{experiences ? `${experiences} ${experiences === 1 ? 'experiencia' : 'experiencias'}` : 'A medida'}</span>
          <span className="text-xs text-ink/60">Reserve Events en grupo y sesiones privadas 1:1 con {creator.name.split(' ')[0]}, con fecha, precio y reglas.</span>
          <a href="#reserve" className="mt-3 inline-flex items-center gap-1.5 self-start text-sm font-semibold text-ink hover:text-brand-700">Ver experiencias <i aria-hidden="true" className="fas fa-arrow-right text-xs"></i></a>
        </li>
      </ol>
    </section>
  );
};

export default AccessLadder;
