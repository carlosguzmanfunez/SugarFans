import React from 'react';
import { categoryFor } from '../config/reserve';

const countLabel = (n: number) => `${n} ${n === 1 ? 'creador' : 'creadores'}`;

// Above the grid once a category is picked: the category in its own color, what it
// is about and how many creators match.
export const CategoryHeader: React.FC<{ name: string; count: number }> = ({ name, count }) => {
  const category = categoryFor(name);
  return (
    <div className="mb-6 flex items-center gap-4 rounded-3xl px-5 py-5 sm:px-6" style={{ background: category.tint }} data-testid="category-header">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white text-xl" style={{ color: category.ink }}>
        <i className={`fas ${category.icon}`} aria-hidden="true"></i>
      </span>
      <div className="min-w-0">
        <h2 className="text-xl font-semibold leading-tight sm:text-2xl" style={{ color: category.ink }}>{category.name}</h2>
        <p className="mt-0.5 text-sm text-ink/70">
          {category.blurb} · {countLabel(count)}
        </p>
      </div>
    </div>
  );
};
