import React from 'react';
import { backend } from '../lib/backend';
import { usePlatformQuery } from '../lib/platform';
import { usageRows } from '../lib/infraUsage';
import type { AdminSection } from '../lib/adminWorkspace';
import AdminDataState from './AdminDataState';

export default function AdminAttention({ counts, onOpen }: {
  counts: { verifications: number; reports: number; moderation: number; payouts: number };
  onOpen: (section: AdminSection) => void;
}) {
  const service = usePlatformQuery(async () => {
    const [errors, usage] = await Promise.all([backend.appErrors(), backend.infraUsage()]);
    if (!usage) throw Error('Sin medición');
    return { recent: errors.filter(e => Date.parse(e.lastSeen) >= Date.now() - 86400000).length,
      limits: usageRows(usage).filter(row => row.level >= 70).length };
  }, [], { recent: 0, limits: 0 });
  const tasks = [
    { id: 'payouts', count: counts.payouts, title: 'Disputas abiertas con PayPal', effect: 'Pueden afectar el dinero de un fan o un creador. Abre el expediente para revisar su responsabilidad.', action: 'Revisar disputas' },
    { id: 'reports', count: counts.reports, title: 'Denuncias y solicitudes', effect: 'Una persona pidió ayuda o reportó un problema.', action: 'Atender solicitudes' },
    { id: 'moderation', count: counts.moderation, title: 'Fotos y videos por revisar', effect: 'Estos archivos esperan una decisión antes de mostrarse.', action: 'Revisar contenido' },
    { id: 'verifications', count: counts.verifications, title: 'Identidades por verificar', effect: 'Estos creadores esperan la revisión de sus documentos.', action: 'Revisar identidades' },
  ] as const;
  const pending = tasks.filter(task => task.count > 0);
  return <section className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 mb-6" aria-labelledby="admin-attention-title">
    <h2 id="admin-attention-title" className="text-lg font-bold">Qué necesita mi atención</h2>
    <p className="text-sm text-gray-600 mt-1">Pendientes en esta consulta. Cada caso conserva su revisión por separado.</p>
    {pending.length === 0 ? <p className="py-5 text-sm">No hay identidades, denuncias o archivos pendientes ni disputas abiertas en esta consulta.</p> :
      <ul className="mt-3 divide-y divide-gray-100">{pending.map(task => <li key={task.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div><h3 className="text-sm font-semibold">{task.title} <span className="tabular-nums">({task.count})</span></h3><p className="text-sm text-gray-600 mt-1">{task.effect}</p></div>
        <button type="button" onClick={() => onOpen(task.id)} className="shrink-0 min-h-11 rounded-lg px-4 py-2 text-sm bg-gray-900 text-white">{task.action}</button>
      </li>)}</ul>}
    <button type="button" onClick={() => onOpen('finance')} className="min-h-11 mb-3 text-sm text-pink-800 underline underline-offset-4">Consultar el seguimiento y los problemas de pagos</button>
    <div className="border-t border-gray-200 pt-4">
      <h3 className="text-sm font-semibold">Funcionamiento de la página</h3>
      <AdminDataState loading={service.loading} error={service.error} onRetry={service.reload}>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <button type="button" onClick={() => onOpen('errors')} className="min-h-11 text-pink-800 underline underline-offset-4">{service.data.recent} {service.data.recent === 1 ? 'registro de fallo' : 'registros de fallos'} en las últimas 24 horas</button>
          <button type="button" onClick={() => onOpen('infra')} className="min-h-11 text-pink-800 underline underline-offset-4">{service.data.limits} {service.data.limits === 1 ? 'límite de servicio requiere' : 'límites de servicios requieren'} atención</button>
        </div>
        <p className="text-xs text-gray-600">Los fallos registrados muestran lo ocurrido; no confirman por sí solos que el problema continúe.</p>
      </AdminDataState>
    </div>
  </section>;
}
