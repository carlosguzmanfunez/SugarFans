import React from 'react';
import { adminArea, adminAreas, adminSections, type AdminSection } from '../lib/adminWorkspace';

export default function AdminNavigation({ section, onOpen, counts }: {
  section: AdminSection; onOpen: (section: AdminSection) => void;
  counts: Partial<Record<AdminSection, number>>;
}) {
  const current = adminArea(section);
  const button = 'min-h-11 px-3 py-2 rounded-lg text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-700';
  return <div className="mb-6 space-y-3">
    <nav aria-label="Áreas de administración" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1 bg-white p-1 rounded-xl border border-gray-200">
      {adminAreas.map(area => {
        const count = area.tabs.reduce((sum, tab) => sum + (counts[tab] ?? 0), 0);
        return <button key={area.id} type="button" aria-current={current.id === area.id ? 'true' : undefined}
          onClick={() => onOpen(area.tabs[0])} className={`${button} ${current.id === area.id ? 'bg-pink-100 text-pink-800' : 'text-gray-700 hover:bg-gray-50'}`}>
          {area.label}{count > 0 && <span className="ml-2 tabular-nums" aria-label={`${count} pendientes en esta consulta`}>({count})</span>}
        </button>;
      })}
    </nav>
    {current.tabs.length > 1 && <nav aria-label={`Secciones de ${current.label}`} className="flex flex-wrap gap-1 border-b border-gray-200 pb-3">
      {current.tabs.map(tab => <button key={tab} type="button" aria-current={section === tab ? 'page' : undefined}
        onClick={() => onOpen(tab)} className={`${button} ${section === tab ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>
        {adminSections[tab]}{(counts[tab] ?? 0) > 0 ? ` (${counts[tab]})` : ''}
      </button>)}
    </nav>}
  </div>;
}
