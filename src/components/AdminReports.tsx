import React, { useState } from 'react';
import { resolveReport, restorePost, type Report } from '../lib/platform';
import { adminDate } from '../lib/adminWorkspace';
import { AdminConfirmation, type AdminDecision } from './AdminDialog';

export default function AdminReports({ reports, removedPosts }: { reports: Report[]; removedPosts: string[] }) {
  const [filter, setFilter] = useState('pending');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [decision, setDecision] = useState<AdminDecision | null>(null);
  const [notice, setNotice] = useState('');
  const matching = reports.filter(r => (filter === 'all' || r.status === filter) &&
    `${r.targetLabel} ${r.reporterName} ${r.reason}`.toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es')));
  const pages = Math.max(1, Math.ceil(matching.length / 20)), current = Math.min(page, pages - 1);
  const action = (r: Report, choice: 'remove' | 'resolve' | 'dismiss' | 'restore') => {
    const titles = { remove: 'Retirar contenido', resolve: 'Marcar solicitud atendida', dismiss: 'Descartar solicitud', restore: 'Restaurar publicación' };
    const effects = {
      remove: 'La publicación dejará de mostrarse. Su autor conserva su cuenta. La denuncia quedará atendida.',
      resolve: 'La solicitud quedará atendida. Este botón no cambia el contenido ni la cuenta de la persona reportada.',
      dismiss: 'La solicitud quedará descartada. Este botón no cambia el contenido ni la cuenta reportada.',
      restore: 'La publicación volverá a mostrarse según sus permisos de acceso y las demás revisiones vigentes.',
    };
    setDecision({ title: titles[choice], person: `${r.targetLabel} · Reportado por ${r.reporterName}`,
      effect: effects[choice], after: choice === 'remove' ? 'Podrás revisar su restauración desde esta misma lista. Se conserva el estado de la denuncia.' : 'El resultado se consultará en esta lista. No inicia pagos ni devoluciones.',
      label: titles[choice], destructive: choice === 'remove', run: () => choice === 'restore' ? restorePost(r.targetId!) : resolveReport(r.id, choice) });
  };
  const button = 'min-h-11 px-3 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50';
  return <section className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6" data-testid="admin-reports">
    <h2 className="text-lg font-bold">Denuncias y solicitudes</h2>
    <p className="text-sm text-gray-600 mt-1">Lee lo ocurrido y revisa el efecto antes de tomar una decisión.</p>
    <div className="flex flex-wrap gap-3 my-4 text-sm">
      <label className="flex-1 min-w-0">Buscar<input type="search" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="Persona o motivo" className="block w-full min-h-11 mt-1 border border-gray-300 rounded-lg px-3" /></label>
      <label>Estado<select value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }} className="block min-h-11 mt-1 border border-gray-300 rounded-lg px-3"><option value="pending">Pendientes</option><option value="resolved">Atendidas</option><option value="dismissed">Descartadas</option><option value="all">Todas</option></select></label>
    </div>
    {notice && <p role="status" className="text-sm text-green-800 mb-3">{notice}</p>}
    {!matching.length && <p className="py-5 text-sm text-gray-600">No hay solicitudes que coincidan con estos filtros. Puedes cambiar el estado o la búsqueda.</p>}
    <ul className="divide-y divide-gray-200">{matching.slice(current * 20, current * 20 + 20).map(r => <li key={r.id} className="py-5 text-sm">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold break-words">{r.reason}</h3><span>{r.status === 'pending' ? 'Pendiente' : r.status === 'resolved' ? 'Atendida' : 'Descartada'}</span></div>
      <p className="mt-2 break-words">{r.description || 'Sin descripción adicional.'}</p>
      <dl className="grid sm:grid-cols-2 gap-3 mt-3 text-gray-600"><div><dt className="font-medium">Persona o contenido reportado</dt><dd className="break-words">{r.targetLabel}</dd></div><div><dt className="font-medium">Quién pidió la revisión</dt><dd className="break-words">{r.reporterName}{r.contactEmail ? ` · ${r.contactEmail}` : ''}</dd></div></dl>
      <p className="text-xs text-gray-600 mt-3">{adminDate(r.createdAt)} · Hora de Honduras</p>
      <div className="flex flex-wrap gap-2 mt-3">{r.status === 'pending' ? <>
        {r.kind === 'post' && r.targetId && <button type="button" className={`${button} text-red-800`} onClick={() => action(r, 'remove')}>Revisar retiro del contenido</button>}
        <button type="button" className={button} onClick={() => action(r, 'resolve')}>Marcar atendida</button>
        <button type="button" className={button} onClick={() => action(r, 'dismiss')}>Descartar</button>
      </> : r.kind === 'post' && r.targetId && removedPosts.includes(r.targetId) ? <button type="button" className={button} onClick={() => action(r, 'restore')}>Revisar restauración</button> : null}</div>
    </li>)}</ul>
    <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-sm"><p>{matching.length} resultados · Página {current + 1} de {pages}</p><div className="flex gap-2"><button disabled={!current} className={`${button} disabled:opacity-40`} onClick={() => setPage(current - 1)}>Anterior</button><button disabled={current >= pages - 1} className={`${button} disabled:opacity-40`} onClick={() => setPage(current + 1)}>Siguiente</button></div></div>
    {decision && <AdminConfirmation decision={decision} onClose={() => setDecision(null)} onDone={() => { setDecision(null); setNotice('Decisión guardada. La lista se actualizará con el estado confirmado.'); }} />}
  </section>;
}
