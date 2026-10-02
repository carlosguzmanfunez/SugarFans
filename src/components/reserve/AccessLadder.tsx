import React from 'react';
import type { User } from '../../context/AuthContext';
import { socialApi, setFollow, compactCount } from '../../lib/social';
import { usePlatformQuery } from '../../lib/platform';

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

// The four ways to get closer to a creator, from free to most personal:
// Seguir → Suscribirse → Live → Reserve. Each one says what it gives and what it doesn't.
const AccessLadder: React.FC<Props> = ({ creator, user, isOwner, isSubscribed, following, experiences, onSubscribe, onNeedLogin }) => {
  const toggleFollow = () => (user ? setFollow(user, creator.id, !following) : onNeedLogin());
  const step = 'flex flex-col rounded-2xl border border-line bg-white p-4';
  const action = 'mt-3 inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-semibold transition';

  return (
    <section aria-labelledby="access-title" className="mb-6" data-testid="access-ladder">
      <h2 id="access-title" className="sr-only">Formas de acceso</h2>
      <ol className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <li className={step}>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">1 · Seguir</span>
          <span className="mt-1 text-sm font-semibold text-ink">Gratis</span>
          <span className="text-xs text-ink/60">Contenido público y novedades.</span>
          {!isOwner && (
            <button
              type="button"
              onClick={toggleFollow}
              aria-pressed={following}
              data-testid="follow-button"
              className={`${action} ${following ? 'border border-line text-ink' : 'bg-ink text-white hover:bg-night-800'}`}
            >
              {following ? <><i aria-hidden="true" className="fas fa-check mr-1.5"></i>Siguiendo</> : 'Seguir'}
            </button>
          )}
          {isOwner && <span className="mt-3 text-xs text-muted">{compactCount(creator.followers)} seguidores</span>}
        </li>
        <li className={step}>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">2 · Suscribirse</span>
          <span className="mt-1 text-sm font-semibold text-ink">${creator.subscriptionPrice}/mes</span>
          <span className="text-xs text-ink/60">Contenido exclusivo y beneficios del creator.</span>
          {!isOwner && user?.role !== 'creator' && (isSubscribed ? (
            <span className="mt-3 inline-flex h-10 items-center justify-center rounded-full border border-line px-4 text-sm font-semibold text-ink/70">
              <i aria-hidden="true" className="fas fa-check mr-1.5"></i>Tu suscripción está activa
            </span>
          ) : (
            <button type="button" onClick={onSubscribe} className={`${action} bg-gradient-to-r from-brand-600 to-iris-600 text-white`}>
              Suscribirse
            </button>
          ))}
        </li>
        <li className={step}>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">3 · Live</span>
          <span className="mt-1 text-sm font-semibold text-ink">En vivo</span>
          <span className="text-xs text-ink/60">Sesiones en vivo en la sala privada de Fans Reserve, reservadas desde Reserve.</span>
        </li>
        <li className={`${step} border-gold-300 bg-gradient-to-br from-white to-gold-50`}>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-700">4 · Reserve</span>
          <span className="mt-1 text-sm font-semibold text-ink">{experiences ? `${experiences} ${experiences === 1 ? 'experiencia' : 'experiencias'}` : 'A medida'}</span>
          <span className="text-xs text-ink/60">Experiencias definidas por {creator.name.split(' ')[0]}, con fecha, precio y reglas.</span>
          <a href="#reserve" className={`${action} bg-ink text-white hover:bg-night-800`}>Ver Reserve</a>
        </li>
      </ol>
    </section>
  );
};

export default AccessLadder;
