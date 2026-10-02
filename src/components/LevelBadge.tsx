import React from 'react';
import { levelById, type LevelId } from '../lib/rewards';

// Creator level shown next to the name; Bronce (the starting level) shows nothing.
const STYLE: Record<string, { icon: string; cls: string }> = {
  plata: { icon: 'fa-medal', cls: 'bg-slate-50 text-slate-700 border-slate-200' },
  oro: { icon: 'fa-medal', cls: 'bg-gold-50 text-gold-700 border-gold-200' },
  diamante: { icon: 'fa-gem', cls: 'bg-iris-50 text-iris-700 border-iris-200' },
};

const LevelBadge: React.FC<{ level?: LevelId }> = ({ level }) => {
  if (!level || level === 'bronce') return null;
  const l = levelById(level);
  const s = STYLE[level] ?? STYLE.oro;
  return (
    <span data-testid="level-badge" title={`Creador nivel ${l.name}`} className={`ml-2 inline-flex items-center gap-1 text-[11px] font-semibold border px-2 py-0.5 rounded-full ${s.cls}`}>
      <i className={`fas ${s.icon} text-[10px]`} aria-hidden="true"></i> {l.name}
    </span>
  );
};

export default LevelBadge;
