import React from 'react';
import type { Creator } from '../data/mockData';
import { isDemoProfile } from '../lib/demoProfiles';

// "Perfil de ejemplo" on the demo catalogue; small "P-IA" tag on AI personas run by the platform. Platform profiles that are
// not AI carry no tag; verified human creators show the "Verificado" badge instead.
const ManagedBadge: React.FC<{ creator: Creator; size?: 'sm' | 'md' }> = ({ creator, size = 'sm' }) => {
  if (isDemoProfile(creator)) {
    return (
      <span
        data-testid="demo-badge"
        title="Perfil de ejemplo: sus números no son reales"
        className={`inline-flex items-center rounded-full font-semibold bg-amber-100 text-amber-800 ${size === 'sm' ? 'text-[10px] px-1.5 py-0.5 ml-1' : 'text-xs px-2 py-0.5'}`}
      >
        Perfil de ejemplo
      </span>
    );
  }
  if (creator.managed !== 'ai') return null;
  return (
    <span
      data-testid="managed-badge"
      title="Perfil IA"
      className={`inline-flex items-center rounded-full font-semibold bg-purple-100 text-purple-700 ${size === 'sm' ? 'text-[10px] px-1.5 py-0.5 ml-1' : 'text-xs px-2 py-0.5'}`}
    >
      P-IA
    </span>
  );
};

export default ManagedBadge;
