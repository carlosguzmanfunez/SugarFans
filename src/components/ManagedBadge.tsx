import React from 'react';
import type { Creator } from '../data/mockData';

// Tells fans a profile is run by SugarFans (and, for AI personas, that no real person is behind it).
const ManagedBadge: React.FC<{ creator: Creator; size?: 'sm' | 'md' }> = ({ creator, size = 'sm' }) => {
  if (!creator.managed) return null;
  const ai = creator.managed === 'ai';
  return (
    <span
      data-testid="managed-badge"
      title={ai ? 'Personaje generado con IA y gestionado por SugarFans' : 'Perfil gestionado por SugarFans'}
      className={`inline-flex items-center gap-1 rounded-full font-medium ${ai ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'} ${
        size === 'sm' ? 'text-[10px] px-2 py-0.5 ml-1' : 'text-xs px-2.5 py-1'
      }`}
    >
      <i className={`fas ${ai ? 'fa-robot' : 'fa-building'}`}></i>
      {ai ? 'Perfil IA' : 'Perfil oficial'}
    </span>
  );
};

export default ManagedBadge;
