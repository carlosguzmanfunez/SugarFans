import React, { useRef } from 'react';
import type { Creator } from '../data/mockData';
import { CREATOR_CATEGORIES, categoryFor, type CreatorCategory } from '../config/reserve';

const countLabel = (n: number) => `${n} ${n === 1 ? 'creador' : 'creadores'}`;

type ShelfLook = Pick<CreatorCategory, 'name' | 'blurb' | 'icon' | 'tint' | 'ink'> & { id: string };

// Creators who haven't picked a category yet still get a shelf, at the end.
const OTHERS: ShelfLook = { id: 'otros', name: 'Más creadores', blurb: 'Recién llegados a Fans Reserve', icon: 'fa-users', tint: '#f1edf3', ink: '#1c1324' };

const CategoryIcon: React.FC<{ category: ShelfLook; size?: 'sm' | 'lg' }> = ({ category, size = 'sm' }) => (
  <span
    className={`flex shrink-0 items-center justify-center rounded-full ${size === 'lg' ? 'size-14 text-xl' : 'size-11 text-base'}`}
    style={{ background: size === 'lg' ? '#fff' : category.tint, color: category.ink }}
  >
    <i className={`fas ${category.icon}`} aria-hidden="true"></i>
  </span>
);

// Groups creators by category, keeping the order they come in (Explorar's own
// order), and leaves out the categories nobody is in yet. A category's place
// follows its best-placed creator, so the shelves keep Explorar's ranking.
export const shelvesFor = (creators: Creator[]) => {
  const byId = new Map<string, Creator[]>();
  const others: Creator[] = [];
  creators.forEach((c) => {
    if (!c.category) return others.push(c);
    const id = categoryFor(c.category).id;
    byId.set(id, [...(byId.get(id) ?? []), c]);
  });
  const shelves: { category: ShelfLook; members: Creator[]; filterable: boolean }[] = [...byId.entries()].map(([id, members]) => ({
    category: CREATOR_CATEGORIES.find((c) => c.id === id)!,
    members,
    filterable: true,
  }));
  if (others.length) shelves.push({ category: OTHERS, members: others, filterable: false });
  return shelves;
};

// One category as a Netflix-style shelf: its name, what it is about and how many
// creators it has, with their cards in one swipeable row. "Ver todo" filters by it.
export const CategoryShelf: React.FC<{
  category: ShelfLook;
  members: Creator[];
  onSeeAll?: () => void;
  renderCard: (creator: Creator) => React.ReactNode;
}> = ({ category, members, onSeeAll, renderCard }) => {
  const row = useRef<HTMLUListElement>(null);
  const titleId = `shelf-${category.id}`;
  const scroll = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.9, behavior: 'smooth' });
  return (
    <section aria-labelledby={titleId} data-testid="category-shelf" data-category={category.id}>
      <div className="mb-3 flex items-center gap-3">
        <CategoryIcon category={category} />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-lg font-semibold leading-tight text-ink">{category.name}</h2>
          <p className="line-clamp-2 text-sm leading-snug text-muted">
            {category.blurb} · {countLabel(members.length)}
          </p>
        </div>
        {members.length > 1 && (
          <span className="hidden shrink-0 gap-1.5 sm:flex">
            <button type="button" onClick={() => scroll(-1)} aria-label={`Anteriores en ${category.name}`} className="flex size-9 items-center justify-center rounded-full border border-line bg-white text-ink/60 transition hover:text-ink">
              <i className="fas fa-chevron-left text-xs" aria-hidden="true"></i>
            </button>
            <button type="button" onClick={() => scroll(1)} aria-label={`Siguientes en ${category.name}`} className="flex size-9 items-center justify-center rounded-full border border-line bg-white text-ink/60 transition hover:text-ink">
              <i className="fas fa-chevron-right text-xs" aria-hidden="true"></i>
            </button>
          </span>
        )}
        {onSeeAll && (
          <button type="button" onClick={onSeeAll} className="shrink-0 text-sm font-semibold text-brand-700 hover:text-brand-800">
            Ver todo
          </button>
        )}
      </div>
      <ul ref={row} className="rail -mx-4 gap-4 px-4 pb-2 sm:mx-0 sm:gap-6 sm:px-0" aria-label={category.name}>
        {members.map((c) => (
          <li key={c.id} className="flex w-[82%] sm:w-[calc((100%-1.5rem)/2)] lg:w-[calc((100%-3rem)/3)]">
            {renderCard(c)}
          </li>
        ))}
      </ul>
    </section>
  );
};

// Above the grid once a category is picked: the category in its own color, what it
// is about and how many creators match.
export const CategoryHeader: React.FC<{ name: string; count: number }> = ({ name, count }) => {
  const category = categoryFor(name);
  return (
    <div className="mb-6 flex items-center gap-4 rounded-3xl px-5 py-5 sm:px-6" style={{ background: category.tint }} data-testid="category-header">
      <CategoryIcon category={category} size="lg" />
      <div className="min-w-0">
        <h2 className="text-xl font-semibold leading-tight sm:text-2xl" style={{ color: category.ink }}>{category.name}</h2>
        <p className="mt-0.5 text-sm text-ink/70">
          {category.blurb} · {countLabel(count)}
        </p>
      </div>
    </div>
  );
};
