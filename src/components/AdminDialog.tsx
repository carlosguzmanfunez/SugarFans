import React, { useEffect, useId, useRef } from 'react';

// Native dialog keeps keyboard focus inside, supports Escape and restores focus.
export function AdminDialog({ title, onClose, busy = false, children, wide = false }: {
  title: string; onClose: () => void; busy?: boolean; children: React.ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={heading} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    className={`m-auto w-[calc(100%-2rem)] ${wide ? 'max-w-3xl' : 'max-w-xl'} max-h-[90dvh] overflow-y-auto rounded-2xl bg-white text-gray-900 p-4 sm:p-6 backdrop:bg-black/60`}>
    <div className="flex items-start justify-between gap-4 mb-4">
      <h2 id={heading} className="text-lg font-bold break-words min-w-0">{title}</h2>
      <button type="button" disabled={busy} onClick={onClose} aria-label="Cerrar" className="shrink-0 min-h-11 min-w-11 rounded-lg hover:bg-gray-100 focus-visible:outline-pink-700 disabled:opacity-40">
        <i aria-hidden="true" className="fas fa-times" />
      </button>
    </div>
    {children}
  </dialog>;
}

export interface AdminDecision {
  title: string; person: string; effect: string; after: string; label: string;
  run: () => Promise<{ ok: boolean; error?: string }>; destructive?: boolean;
}
export function AdminConfirmation({ decision, onClose, onDone }: {
  decision: AdminDecision; onClose: () => void; onDone: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const lock = useRef(false);
  const confirm = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await decision.run();
      if (result.ok) onDone();
      else setError(result.error || 'No se pudo guardar. Comprueba el estado antes de intentarlo otra vez.');
    } catch { setError('No pudimos confirmar el resultado. Actualiza la información antes de repetir la acción.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <AdminDialog title={decision.title} onClose={onClose} busy={busy}>
    <dl className="text-sm space-y-4">
      <div><dt className="font-semibold">A quién afecta</dt><dd className="mt-1 break-words">{decision.person}</dd></div>
      <div><dt className="font-semibold">Qué cambiará</dt><dd className="mt-1">{decision.effect}</dd></div>
      <div><dt className="font-semibold">Después de confirmar</dt><dd className="mt-1 text-gray-600">{decision.after}</dd></div>
    </dl>
    {error && <p role="alert" className="mt-4 text-sm text-red-800">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2 mt-6">
      <button type="button" autoFocus disabled={busy} onClick={onClose} className="min-h-11 px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-40">Volver sin cambiar</button>
      <button type="button" disabled={busy || !!error} onClick={confirm} className={`min-h-11 px-4 py-2 rounded-lg text-sm text-white disabled:opacity-40 ${decision.destructive ? 'bg-red-700 hover:bg-red-800' : 'bg-gray-900 hover:bg-gray-700'}`}>
        {busy ? 'Guardando…' : decision.label}
      </button>
    </div>
  </AdminDialog>;
}
