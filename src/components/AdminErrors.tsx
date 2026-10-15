import React, { useState } from 'react';
import { backend } from '../lib/backend';
import type { AppError } from '../lib/backend/socialTypes';
import { usePlatformQuery } from '../lib/platform';

const sourceLabel: Record<AppError['source'], { text: string; className: string }> = {
  web: { text: 'Web', className: 'bg-blue-50 text-blue-700' },
  api: { text: 'Servidor', className: 'bg-purple-50 text-purple-700' },
  email: { text: 'Correo', className: 'bg-amber-100 text-amber-800' },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Admin tab: errors that happened to real visitors in production (browser), in
// the server functions (PayPal, Didit, avisos) and emails that could not be sent.
// The same error within one hour is one row with a counter; rows older than 30
// days are deleted automatically.
const AdminErrors: React.FC = () => {
  const { data: errors, reload } = usePlatformQuery(() => backend.appErrors(), [], [] as AppError[]);
  const [open, setOpen] = useState('');

  return (
    <div className="bg-white rounded-2xl shadow-sm" data-testid="admin-errors">
      <div className="p-6 border-b border-gray-100 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold mb-1">Errores en producción</h2>
          <p className="text-sm text-gray-500">
            Lo que falló a usuarios reales en la web, en el servidor o al enviar un correo. Si un error se repite mucho, avísale a Claude con una captura.
          </p>
        </div>
        <button type="button" onClick={reload} className="self-start px-3 py-1.5 rounded-full text-sm bg-gray-50 text-gray-600 hover:bg-gray-100">
          <i aria-hidden="true" className="fas fa-sync-alt mr-1"></i> Actualizar
        </button>
      </div>
      {errors.length === 0 ? (
        <p className="p-6 text-center text-sm text-gray-500">Sin errores registrados en los últimos 30 días</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {errors.map((e) => (
            <li key={e.id} className="p-4 sm:p-5" data-testid="admin-error-row">
              <button type="button" onClick={() => setOpen(open === e.id ? '' : e.id)} className="w-full text-left" aria-expanded={open === e.id}>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${sourceLabel[e.source].className}`}>{sourceLabel[e.source].text}</span>
                  {e.count > 1 && <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700">{e.count} veces</span>}
                  <span className="text-xs text-gray-500">{when(e.lastSeen)}</span>
                  {e.url && <span className="text-xs text-gray-500 break-all">{e.url}</span>}
                </div>
                <p className="text-sm font-medium text-gray-900 break-words">{e.message}</p>
              </button>
              {open === e.id && (
                <div className="mt-3 text-xs text-gray-600 space-y-1">
                  <p>Primera vez: {when(e.firstSeen)}{e.userName ? ` · Usuario: ${e.userName}` : ''}</p>
                  {e.userAgent && <p className="break-words">Navegador: {e.userAgent}</p>}
                  {e.detail && <pre className="mt-2 p-3 bg-gray-50 rounded-lg overflow-x-auto whitespace-pre-wrap break-words">{e.detail}</pre>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AdminErrors;
