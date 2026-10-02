import React from 'react';
import { Link } from 'react-router-dom';
import { categories } from '../../data/mockData';
import { categoryVisual } from '../../config/theme';
import { CATEGORIES } from '../../content/landing';
import SectionHeading from './SectionHeading';

// Categories as explorable tiles: each has its own icon and tint; hovering lifts
// the tile and slides the arrow in. Links open Explorar filtered by category.
const CategoryGrid: React.FC = () => (
  <section aria-labelledby="categories-title" className="reveal border-y border-line bg-surface py-16 md:py-24">
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <SectionHeading id="categories-title" eyebrow={CATEGORIES.eyebrow} title={CATEGORIES.title} subtitle={CATEGORIES.subtitle} />
      <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-3">
        {categories.map((cat) => {
          const v = categoryVisual(cat.name);
          const vip = false;
          return (
            <li key={cat.id}>
              <Link
                to={`/explore?category=${encodeURIComponent(cat.name)}`}
                className={`group flex h-full items-center gap-3 rounded-2xl border p-3.5 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-lift)] sm:gap-4 sm:p-5 ${
                  vip ? 'border-gold-300/50 bg-night-900 text-white' : 'border-line bg-canvas/60 hover:border-transparent hover:bg-white'
                }`}
              >
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg transition-transform duration-300 group-hover:-rotate-6 sm:h-14 sm:w-14 sm:text-xl"
                  style={vip ? { background: 'linear-gradient(135deg,#f9eccb,#e3a93a)', color: '#160d1f' } : { background: v.tint, color: v.ink }}
                >
                  <i className={`fas ${v.icon}`} aria-hidden="true"></i>
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block font-display text-[14px] leading-tight font-semibold sm:text-base ${vip ? 'text-white' : 'text-ink'}`}>{cat.name}</span>
                  <span className={`mt-0.5 hidden text-sm sm:block ${vip ? 'text-white/60' : 'text-muted'}`}>{v.blurb}</span>
                </span>
                <i
                  className={`fas fa-arrow-right hidden -translate-x-2 text-sm opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100 sm:block ${vip ? 'text-gold-300' : 'text-brand-600'}`}
                  aria-hidden="true"
                ></i>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  </section>
);

export default CategoryGrid;
