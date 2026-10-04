import React from 'react';
import { Link } from 'react-router-dom';
import type { Creator } from '../data/mockData';
import { backend } from '../lib/backend';
import { usePlatformQuery } from '../lib/platform';
import { detailsOf, typeOf, type VipExperience } from '../lib/vip';
import { RESERVE_MODALITIES, categoryFor } from '../config/reserve';
import { formatPrice } from './CreatorCard';
import Avatar from './Avatar';

const firstName = (name: string) => name.trim().split(/\s+/)[0];

// Creators as round avatars in one swipeable row, like stories: whoever is in
// Live right now goes first, with a LIVE ring that opens the Live.
export const LiveRail: React.FC<{ creators: Creator[]; liveIds: Set<string>; className?: string }> = ({ creators, liveIds, className = '' }) => {
  const ordered = [...creators].sort((a, b) => Number(liveIds.has(b.id)) - Number(liveIds.has(a.id)));
  if (!ordered.length) return null;
  return (
    <ul className={`rail -mx-4 gap-4 px-4 py-1 sm:mx-0 sm:px-0 ${className}`} aria-label="Creadores" data-testid="live-rail">
      {ordered.map((c) => {
        const live = liveIds.has(c.id);
        return (
          <li key={c.id} className="w-[72px]">
            <Link
              to={live ? `/en-vivo/${c.id}` : `/creator/${c.id}`}
              aria-label={live ? `${c.name}, en Live ahora` : c.name}
              className="tab-press flex flex-col items-center gap-1.5 text-center"
            >
              <span className={`relative rounded-full p-[3px] ${live ? 'live-ring' : 'bg-line'}`}>
                <span className="block rounded-full bg-canvas p-[2px]">
                  <Avatar src={c.avatar} name={c.name} size={60} decorative />
                </span>
                {live && (
                  <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-md bg-red-600 px-1.5 py-px text-[9px] font-extrabold tracking-wider text-white ring-2 ring-canvas">
                    LIVE
                  </span>
                )}
              </span>
              <span className="w-full truncate text-xs font-medium text-ink/75">{firstName(c.name)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
};

// Active Reserve experiences in one row of compact cards: who, what, how long and
// for how much, so a fan sees something bookable without leaving the page.
export const ReserveRail: React.FC<{ creators: Creator[]; limit?: number }> = ({ creators, limit = 8 }) => {
  const { data: experiences } = usePlatformQuery(() => backend.listExperiences(), [], [] as VipExperience[]);
  const byId = new Map(creators.map((c) => [c.id, c]));
  const items = experiences.filter((e) => e.active && byId.has(e.creatorProfileId)).slice(0, limit);
  if (!items.length) return null;
  return (
    <ul className="rail -mx-4 -my-2 gap-3 px-4 py-2 pb-4 sm:mx-0 sm:px-0 sm:[mask-image:linear-gradient(to_right,black_90%,transparent)]" aria-label="Experiencias de Reserve" data-testid="reserve-rail">
      {items.map((exp) => {
        const creator = byId.get(exp.creatorProfileId)!;
        const modality = RESERVE_MODALITIES[detailsOf(exp).modality];
        return (
          <li key={exp.id} className="w-[260px] sm:w-[280px]">
            <Link
              to={`/creator/${creator.id}#reserve`}
              className="card card-hover flex h-full flex-col gap-3 p-4"
            >
              <span className="flex items-center gap-2.5">
                <Avatar src={creator.avatar} name={creator.name} size={36} decorative />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{creator.name}</span>
                  <span className="block truncate text-xs text-muted">{creator.category ? categoryFor(creator.category).name : typeOf(exp.type).name}</span>
                </span>
              </span>
              <span className="line-clamp-2 font-display text-[15px] font-semibold leading-snug text-ink">{exp.title}</span>
              <span className="mt-auto flex items-end justify-between gap-2">
                <span className="text-xs text-muted">
                  <i className={`fas ${modality.icon} mr-1 text-gold-600`} aria-hidden="true"></i>
                  {modality.label}
                  {exp.durationMinutes ? ` · ${exp.durationMinutes} min` : ''}
                </span>
                <span className="font-display text-lg font-semibold text-ink">{formatPrice(exp.price)}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
};

// Section title used above the rails: a heading and an optional "Ver todo" link.
export const RailHeading: React.FC<{ id: string; title: string; to?: string; icon?: string; tone?: string }> = ({ id, title, to, icon, tone = 'text-brand-600' }) => (
  <div className="mb-3 flex items-center justify-between gap-3">
    <h2 id={id} className="flex items-center gap-2 text-lg font-semibold text-ink">
      {icon && <i className={`fas ${icon} text-base ${tone}`} aria-hidden="true"></i>}
      {title}
    </h2>
    {to && (
      <Link to={to} className="shrink-0 text-sm font-semibold text-brand-700 hover:text-brand-800">
        Ver todo
      </Link>
    )}
  </div>
);
