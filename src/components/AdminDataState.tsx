import React from 'react';
export default function AdminDataState({ loading, error, onRetry, children }: {
  loading: boolean; error?: string; onRetry: () => void; children: React.ReactNode;
}) {
  if (error) return <div role="alert" className="p-5 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-950">
    <p>{error} No podemos confirmar si hay asuntos pendientes.</p>
    <button type="button" onClick={onRetry} className="mt-3 min-h-11 px-4 py-2 border border-amber-700 rounded-lg font-medium">Volver a consultar</button>
  </div>;
  if (loading) return <p role="status" className="p-5 text-sm text-gray-600">Estamos consultando la información…</p>;
  return <>{children}</>;
}
