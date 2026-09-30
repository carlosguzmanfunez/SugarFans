import React from 'react';
import { levelById, type LevelId } from '../lib/rewards';

// Creator level shown next to the name; Bronce (the starting level) shows nothing.
const LevelBadge: React.FC<{ level?: LevelId }> = ({ level }) => {
  if (!level || level === 'bronce') return null;
  const l = levelById(level);
  return (
    <span data-testid="level-badge" title={`Creador nivel ${l.name}`} className="ml-2 text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
      {l.icon} {l.name}
    </span>
  );
};

export default LevelBadge;
