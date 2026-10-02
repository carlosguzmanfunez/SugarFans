import React from 'react';
import { Link } from 'react-router-dom';
import type { Creator } from '../data/mockData';
import type { LevelId } from '../lib/rewards';
import { compactCount } from '../lib/social';
import { categoryVisual } from '../config/theme';
import { categoryFor } from '../config/reserve';
import { CoverImage } from './CoverArt';
import Avatar from './Avatar';
import ManagedBadge from './ManagedBadge';
import LevelBadge from './LevelBadge';

export const formatPrice = (n: number) => `$${n.toFixed(2).replace(/\.00$/, '')}`;

// Public creator card (landing, Explorar): cover, avatar, identity, category,
// short bio, audience and monthly price. Badges: VIP when the creator offers
// bookable experiences, level and "Destacado" from the rewards programme.
const CreatorCard: React.FC<{
  creator: Creator;
  level?: LevelId;
  featured?: boolean;
  vip?: boolean;
  className?: string;
}> = ({ creator, level, featured = false, vip = false, className = '' }) => {
  const visual = creator.category ? categoryVisual(creator.category) : null;
  return (
    <Link
      to={`/creator/${creator.id}`}
      className={`card card-hover group relative flex flex-col overflow-hidden ${className}`}
      data-testid="creator-card"
    >
      <CoverImage src={creator.cover} seed={creator.id + creator.name} className="h-28 sm:h-32">
        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          {creator.category ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/30 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md ring-1 ring-white/15">
              <i className={`fas ${visual!.icon} text-[10px]`} aria-hidden="true"></i>
              {categoryFor(creator.category).name}
            </span>
          ) : (
            <span />
          )}
          <span className="flex gap-1.5">
            {featured && (
              <span data-testid="featured-tag" className="rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
                Destacado
              </span>
            )}
            {vip && (
              <span className="inline-flex items-center gap-1 rounded-full bg-night-900/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gold-200 ring-1 ring-gold-300/30">
                <i className="fas fa-ticket text-[9px]" aria-hidden="true"></i> Reserve
              </span>
            )}
          </span>
        </div>
      </CoverImage>

      <div className="relative flex flex-1 flex-col px-5 pb-5">
        <div className="-mt-8 flex items-end justify-between">
          <Avatar src={creator.avatar} name={creator.name} size={64} className="ring-4 ring-white shadow-md" />
          <span className="mb-1 rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white">
            {formatPrice(creator.subscriptionPrice)}
            <span className="font-normal text-white/70">/mes</span>
          </span>
        </div>
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-1">
          <h3 className="truncate text-base font-semibold text-ink">{creator.name}</h3>
          {creator.isVerified && (
            <i className="fas fa-circle-check text-[13px] text-iris-600" role="img" title="Identidad verificada" aria-label="Identidad verificada"></i>
          )}
          <ManagedBadge creator={creator} />
          <LevelBadge level={level} />
        </div>
        <p className="text-sm text-muted">@{creator.username}</p>
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink/75">{creator.bio}</p>
        <div className="mt-auto flex items-center gap-4 pt-4 text-xs text-muted">
          {creator.followers > 0 && (
            <span><i className="fas fa-user-group mr-1.5 text-ink/40" aria-hidden="true"></i>{compactCount(creator.followers)} fans</span>
          )}
          {creator.postsCount > 0 && (
            <span><i className="fas fa-images mr-1.5 text-ink/40" aria-hidden="true"></i>{creator.postsCount} posts</span>
          )}
          <span className="ml-auto inline-flex items-center gap-1 font-medium text-brand-600 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            Ver perfil <i className="fas fa-arrow-right text-[10px]" aria-hidden="true"></i>
          </span>
        </div>
      </div>
    </Link>
  );
};

export default CreatorCard;
