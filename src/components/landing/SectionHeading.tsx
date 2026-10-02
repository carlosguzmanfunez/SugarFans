import React from 'react';

// Eyebrow + title + optional subtitle used by every landing section.
const SectionHeading: React.FC<{
  eyebrow: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  align?: 'left' | 'center';
  tone?: 'light' | 'dark';
  id?: string;
  action?: React.ReactNode;
}> = ({ eyebrow, title, subtitle, align = 'left', tone = 'light', id, action }) => {
  const dark = tone === 'dark';
  return (
    <div className={`mb-10 flex flex-col gap-6 md:mb-12 ${align === 'center' ? 'items-center text-center' : 'md:flex-row md:items-end md:justify-between'}`}>
      <div className={align === 'center' ? 'max-w-2xl' : 'max-w-2xl'}>
        <p className={`eyebrow mb-3 ${dark ? 'text-gold-300' : 'text-brand-600'}`}>{eyebrow}</p>
        <h2 id={id} className={`text-display-lg ${dark ? 'text-white' : 'text-ink'}`}>{title}</h2>
        {subtitle && <p className={`mt-4 text-base md:text-lg ${dark ? 'text-white/70' : 'text-muted'}`}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
};

export default SectionHeading;
