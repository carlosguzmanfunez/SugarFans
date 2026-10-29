import React from 'react';
import { Link } from 'react-router-dom';
import type { Creator, Post } from '../data/mockData';
import { socialApi } from '../lib/social';
import { usePlatformQuery } from '../lib/platform';
import { categoryFor } from '../config/reserve';
import { CoverImage } from './CoverArt';
import Avatar from './Avatar';

const firstName = (name: string) => name.trim().split(/\s+/)[0];

const timeAgo = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });
};

interface Activity {
  id: string;
  creator: Creator;
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  isLocked: boolean;
  createdAt: string;
}

// How many creators' posts to read, and how many of each to show: the row is
// about who is active, so nobody fills it alone.
const CREATORS_READ = 12;
const PER_CREATOR = 2;
const LIMIT = 10;

// Title over each part of Explorar.
export const ExploreHeading: React.FC<{ id: string; title: string; icon: string; tone?: string }> = ({ id, title, icon, tone = 'text-brand-600' }) => (
  <h2 id={id} className="mb-3 flex items-center gap-2 text-lg font-semibold text-ink">
    <i className={`fas ${icon} text-base ${tone}`} aria-hidden="true"></i>
    {title}
  </h2>
);

// "Lo nuevo": the latest posts of the creators on screen (all, or one category),
// newest first, as small tiles in one swipeable row. Each opens the post.
export const NewActivity: React.FC<{
  creators: Creator[];
  catalogPosts: Post[];
  removedPosts: string[];
  title: string;
}> = ({ creators, catalogPosts, removedPosts, title }) => {
  const key = creators.map((c) => c.id).join(',');
  const { data: items } = usePlatformQuery(
    async () => {
      const byId = new Map(creators.map((c) => [c.id, c]));
      const read = creators.slice(0, CREATORS_READ);
      const published = await Promise.all(read.map((c) => socialApi.postsByCreator(c.id).catch(() => [])));
      const all: Activity[] = [
        ...published.flat()
          .filter((p) => !p.isDraft && (!p.moderation || p.moderation === 'approved') && byId.has(p.creatorProfileId))
          .map((p) => ({ id: p.id, creator: byId.get(p.creatorProfileId)!, mediaUrl: p.mediaUrl, mediaType: p.mediaType, isLocked: p.isLocked, createdAt: p.createdAt })),
        ...catalogPosts
          .filter((p) => byId.has(p.creatorId))
          .map((p) => ({ id: p.id, creator: byId.get(p.creatorId)!, mediaUrl: p.media, mediaType: p.mediaType, isLocked: p.isLocked, createdAt: p.createdAt })),
      ];
      const shown = new Map<string, number>();
      return all
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .filter((a) => {
          const n = shown.get(a.creator.id) ?? 0;
          shown.set(a.creator.id, n + 1);
          return n < PER_CREATOR;
        })
        .slice(0, LIMIT);
    },
    [key],
    [] as Activity[]
  );
  const visible = items.filter((a) => !removedPosts.includes(a.id));
  if (!visible.length) return null;
  return (
    <section aria-labelledby="new-activity-title" className="mb-8 sm:mb-10" data-testid="new-activity">
      <ExploreHeading id="new-activity-title" title={title} icon="fa-bolt" />
      <ul className="rail -mx-4 gap-3 px-4 pb-1 sm:mx-0 sm:px-0" aria-label={title}>
        {visible.map((a) => (
          <li key={a.id} className="w-[140px] sm:w-[168px]">
            <Link to={`/creator/${a.creator.id}#post-${a.id}`} className="card card-hover block overflow-hidden" data-testid="new-activity-item">
              <CoverImage src={a.mediaType === 'video' ? null : a.mediaUrl} seed={`post-${a.id}`} className="aspect-square">
                {a.isLocked && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white backdrop-blur-sm">
                    <i className="fas fa-lock" aria-hidden="true"></i>
                    <span className="sr-only">Contenido exclusivo</span>
                  </span>
                )}
                {!a.isLocked && a.mediaType === 'video' && (
                  <span className="absolute inset-0 flex items-center justify-center text-2xl text-white/90">
                    <i className="fas fa-circle-play" aria-hidden="true"></i>
                  </span>
                )}
              </CoverImage>
              <span className="flex items-center gap-2 p-2">
                <Avatar src={a.creator.avatar} name={a.creator.name} size={26} decorative />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-ink">{firstName(a.creator.name)}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {a.creator.category ? `${categoryFor(a.creator.category).name} · ` : ''}{timeAgo(a.createdAt)}
                  </span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
};
