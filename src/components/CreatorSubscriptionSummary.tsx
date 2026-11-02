import React from 'react';
import type { Creator } from '../data/mockData';
import type { DisplayPost } from './PostCard';
import Icon from './Icon';
import { CoverImage } from './CoverArt';
import { formatPrice } from './CreatorCard';

interface Props {
  creator: Creator;
  posts: DisplayPost[];
  isSubscribed: boolean;
  isOwner: boolean;
  onViewPosts: () => void;
}

const CreatorSubscriptionSummary: React.FC<Props> = ({ creator, posts, isSubscribed, isOwner, onViewPosts }) => {
  const exclusive = posts.filter((post) => post.isLocked && !post.isDraft && (!post.moderation || post.moderation === 'approved'));
  const canAccess = isSubscribed || isOwner;
  const name = creator.name.split(' ')[0];

  return (
    <section id="suscripcion" className="mb-6 scroll-mt-28 overflow-hidden rounded-2xl border border-brand-100 bg-white" aria-labelledby="creator-subscription-title" data-testid="creator-subscription-summary">
      <div className="flex flex-wrap items-start justify-between gap-4 p-4 sm:p-6">
        <div className="min-w-0 flex-1 basis-56">
          <h2 id="creator-subscription-title" className="font-display text-lg font-semibold leading-snug text-ink sm:text-xl">El contenido exclusivo de {name}</h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
            {exclusive.length > 0
              ? `Accede al contenido que ${name} comparte solo con su comunidad de suscriptores.`
              : `${name} todavía no ha publicado contenido exclusivo. Aquí podrás ver qué comparte antes de decidir si te suscribes.`}
          </p>
          {exclusive.length > 0 && <p className="mt-2 text-sm font-medium text-brand-700">{exclusive.length} {exclusive.length === 1 ? 'publicación exclusiva disponible' : 'publicaciones exclusivas disponibles'}</p>}
          {isSubscribed && <p className="mt-2 text-sm font-medium text-emerald-700"><Icon name="fa-check" className="mr-1.5" />Tu suscripción está activa</p>}
        </div>
        <p className="flex shrink-0 flex-col text-left sm:text-right">
          <span className="font-display text-2xl font-semibold tabular-nums text-brand-700">{formatPrice(creator.subscriptionPrice)}<span className="ml-1 text-sm font-normal text-muted">/mes</span></span>
          <span className="mt-1 text-xs text-muted">Suscripción mensual</span>
        </p>
      </div>

      {exclusive.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 pb-4 sm:px-6 sm:pb-6">
          <div className="flex min-w-0 gap-2" aria-label={canAccess ? 'Contenido de tu suscripción' : 'Publicaciones protegidas para suscriptores'}>
            {exclusive.slice(0, 3).map((post) => (
              <div key={post.id} className="relative h-20 w-20 overflow-hidden rounded-xl bg-iris-50 sm:h-24 sm:w-24">
                {/* A locked post gets generated cover art, never its private URL. */}
                <CoverImage src={canAccess && post.mediaType !== 'video' ? post.mediaUrl : undefined} seed={`subscription-${post.id}`} className="absolute inset-0 h-full w-full object-cover" />
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-night-900/65 px-1 text-center text-xs font-medium text-white">
                  <Icon name={canAccess ? (post.mediaType === 'video' ? 'fa-play' : 'fa-image') : 'fa-lock'} className="text-base" />
                  {post.mediaType === 'video' ? 'Video' : post.mediaType === 'image' ? 'Foto' : 'Publicación'}
                </span>
              </div>
            ))}
          </div>
          <a href="#publicaciones" onClick={onViewPosts} className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-brand-700 underline decoration-brand-200 underline-offset-4 hover:decoration-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600">Ver publicaciones <Icon name="fa-arrow-down" className="text-xs" /></a>
        </div>
      )}

      <p className="border-t border-brand-100 bg-brand-50/40 px-4 py-3 text-xs leading-relaxed text-ink/75 sm:px-6">La suscripción incluye contenido. Las videollamadas 1:1 y los eventos de Reserve se reservan y pagan por separado.</p>
    </section>
  );
};

export default CreatorSubscriptionSummary;
