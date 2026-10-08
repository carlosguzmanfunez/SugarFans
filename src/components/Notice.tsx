import React, { useEffect, useRef } from 'react';
import Icon from './Icon';

// The result of a button ("Cambios guardados", "Escribe el email…"), floating at the
// bottom of the screen. Saving forms are long: shown at the top of the page, the
// message landed off-screen and the tap seemed to do nothing. Successes fade on their
// own; errors stay until closed or replaced.
const Notice: React.FC<{ ok: boolean; text: string; onClose?: () => void }> = ({ ok, text, onClose }) => {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!ok) return;
    const t = setTimeout(() => close.current?.(), 4000);
    return () => clearTimeout(t);
  }, [ok, text]);

  return (
    <div
      role={ok ? 'status' : 'alert'}
      data-testid="notice"
      className={`fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] mx-auto flex max-w-md items-start gap-2 rounded-2xl border px-4 py-3 text-sm shadow-lg md:bottom-6 ${
        ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'
      }`}
    >
      <Icon name={ok ? 'fa-circle-check' : 'fa-circle-question'} className="mt-0.5 text-base" />
      <span className="flex-1">{text}</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Cerrar aviso" className="-mr-1 rounded-full p-1 opacity-60 hover:opacity-100">
          <Icon name="fa-xmark" />
        </button>
      )}
    </div>
  );
};

export default Notice;
