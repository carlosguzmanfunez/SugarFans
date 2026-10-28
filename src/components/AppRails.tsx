import React from 'react';
import { Link } from 'react-router-dom';
import type { Creator } from '../data/mockData';
import { categoryFor } from '../config/reserve';
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

// The categories as round icons in one swipeable row, where the creator avatars used
// to be: "Todos" first, then each category in its own color. Tapping one filters the
// list below; the selected one gets a ring in its color.
export const CategoryRail: React.FC<{
  categories: { id: string; name: string }[];
  selected: string;
  onSelect: (name: string) => void;
  className?: string;
}> = ({ categories, selected, onSelect, className = '' }) => {
  const items = [
    { key: 'todos', name: '', label: 'Todos', icon: 'fa-border-all', tint: '#f1edf3', ink: '#1c1324' },
    ...categories.map((c) => {
      const { icon, tint, ink } = categoryFor(c.name);
      return { key: c.id, name: c.name, label: c.name, icon, tint, ink };
    }),
  ];
  return (
    <ul className={`rail -mx-4 gap-3 px-4 py-1 sm:mx-0 sm:px-0 ${className}`} aria-label="Categorías" data-testid="category-rail">
      {items.map((it) => {
        const on = selected === it.name;
        return (
          <li key={it.key} className="w-[76px] shrink-0">
            <button
              type="button"
              onClick={() => onSelect(it.name)}
              aria-pressed={on}
              className="tab-press flex w-full flex-col items-center gap-1.5 text-center"
            >
              <span className="rounded-full p-[3px] transition" style={{ background: on ? it.ink : 'var(--color-line)' }}>
                <span className="block rounded-full bg-canvas p-[2px]">
                  <span className="flex size-[60px] items-center justify-center rounded-full text-xl" style={{ background: it.tint, color: it.ink }}>
                    <i className={`fas ${it.icon}`} aria-hidden="true"></i>
                  </span>
                </span>
              </span>
              <span className={`line-clamp-2 w-full text-[11.5px] leading-tight ${on ? 'font-semibold text-ink' : 'font-medium text-ink/75'}`}>{it.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
};
