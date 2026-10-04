import React from 'react';
import { Link } from 'react-router-dom';
import type { Creator } from '../../data/mockData';
import { CREATOR_CATEGORIES, categoryFor, type CreatorCategoryId } from '../../config/reserve';
import { CATEGORIES } from '../../content/landing';
import { ArrowRight, trackSpot } from './landingBits';

// Each community has its own colour (soft gradient + accent) and line icon.
const LOOK: Record<CreatorCategoryId, { tint: string; ink: string; icon: React.ReactNode }> = {
  'modelaje-glamour': { tint: '#ffd6e6', ink: '#c81b63', icon: <><circle cx="9" cy="8" r="3.2" /><path d="M3 19.5c.6-3.3 3-5.2 6-5.2s5.4 1.9 6 5.2" /><circle cx="17" cy="9" r="2.5" /><path d="M16.2 14.4c2.6.1 4.3 1.8 4.8 4.6" /></> },
  fitness: { tint: '#cdf1e1', ink: '#0f8a5f', icon: <path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11" /> },
  cocina: { tint: '#ffe0c8', ink: '#ea580c', icon: <path d="M7 3v7a2 2 0 0 0 4 0V3M9 10v11M17 21V3c-2 1-3 4-3 7h3" /> },
  musica: { tint: '#e7dcff', ink: '#7c3aed', icon: <><path d="M9 18V5l11-2v13" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></> },
  gaming: { tint: '#d9e5ff', ink: '#2563eb', icon: <><rect x="2.5" y="7" width="19" height="11" rx="5" /><path d="M7.5 10.5v4M5.5 12.5h4" /><circle cx="15.5" cy="11.5" r=".6" /><circle cx="17.5" cy="13.5" r=".6" /></> },
  arte: { tint: '#fbe7bd', ink: '#b7791f', icon: <><path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10.5" cy="7" r="1" /><circle cx="15.5" cy="7.5" r="1" /></> },
  belleza: { tint: '#ffdada', ink: '#e5484d', icon: <><path d="M12 21c4-2.5 6-5.5 6-9.5C18 7 15 4 12 3 9 4 6 7 6 11.5c0 4 2 7 6 9.5z" /><path d="M12 21V9" /></> },
  lifestyle: { tint: '#e0f2c4', ink: '#4d8a10', icon: <><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></> },
  educacion: { tint: '#cdeff6', ink: '#0e7490', icon: <><path d="M2 9l10-5 10 5-10 5z" /><path d="M6 11v5c3 2.5 9 2.5 12 0v-5M22 9v6" /></> },
  'premium-stars': { tint: '#fbe7bd', ink: '#8f5318', icon: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /> },
};

// Every community at a glance: the hovered one lights up in its colour, the rest
// step back. Each opens Explorar filtered by that category.
const CategoryGrid: React.FC<{ creators: Creator[] }> = ({ creators }) => {
  const byCategory = new Map<string, Creator[]>();
  creators.forEach((c) => {
    const id = categoryFor(c.category).id;
    byCategory.set(id, [...(byCategory.get(id) ?? []), c]);
  });
  return (
    <section className="sec" id="comunidades" aria-labelledby="categories-title" style={{ paddingTop: 72 }}>
      <div className="wrap">
        <div className="sec-head v-reveal">
          <h2 id="categories-title">
            {CATEGORIES.titleLead} <em className="grad">{CATEGORIES.titleAccent}</em>
          </h2>
          <p>{CATEGORIES.subtitle}</p>
        </div>
        <div className="cats v-reveal">
          {CREATOR_CATEGORIES.map((cat) => {
            const look = LOOK[cat.id];
            const members = byCategory.get(cat.id) ?? [];
            const faces = members.filter((m) => m.avatar).slice(0, 2);
            return (
              <Link
                key={cat.id}
                className="cat"
                to={`/explore?category=${encodeURIComponent(cat.name)}`}
                style={{ ['--tint' as string]: look.tint, ['--ink-c' as string]: look.ink }}
                onPointerMove={trackSpot}
              >
                <span className="ic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {look.icon}
                  </svg>
                </span>
                <span className="txt">
                  <b>{cat.name}</b>
                  <span>{cat.blurb}</span>
                  <span className="meta">
                    {faces.length > 0 && (
                      <span className="faces">
                        {faces.map((f) => (
                          <img key={f.id} src={f.avatar} alt="" />
                        ))}
                      </span>
                    )}
                    {members.length === 0 ? 'Nueva comunidad' : `${members.length} ${members.length === 1 ? 'creador' : 'creadores'}`}
                  </span>
                </span>
                <span className="go">
                  <ArrowRight />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default CategoryGrid;
