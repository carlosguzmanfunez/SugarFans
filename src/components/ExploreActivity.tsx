import React from 'react';

// Title over each part of Explorar.
export const ExploreHeading: React.FC<{ id: string; title: string; icon: string; tone?: string }> = ({ id, title, icon, tone = 'text-brand-600' }) => (
  <h2 id={id} className="mb-3 flex items-center gap-2 text-lg font-semibold text-ink">
    <i className={`fas ${icon} text-base ${tone}`} aria-hidden="true"></i>
    {title}
  </h2>
);
