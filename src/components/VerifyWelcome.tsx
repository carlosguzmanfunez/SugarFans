import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { diditEnabled, startDidit } from '../lib/didit';

// Right after a creator signs up: identity verification is the last step. They can
// do it now or later; until then they can set up the profile but not publish or earn.
const VerifyWelcome: React.FC<{ name: string; onLater: () => void }> = ({ name, onLater }) => {
  const navigate = useNavigate();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');

  const verifyNow = async () => {
    setOpening(true);
    try {
      if (await diditEnabled()) await startDidit();
      else navigate('/settings?section=verification');
    } catch (err) {
      setError((err as Error).message);
      setOpening(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="verify-welcome-title" data-testid="verify-welcome">
      <div className="bg-white rounded-3xl shadow-xl max-w-md w-full p-7 text-center">
        <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center">
          <i aria-hidden="true" className="fas fa-id-card text-2xl text-white"></i>
        </div>
        <p className="text-sm font-medium text-pink-600">¡Ya eres parte de Fans Reserve, {name.split(' ')[0]}!</p>
        <h2 id="verify-welcome-title" className="text-2xl font-bold text-gray-900 mt-1">Último paso: verifica tu identidad</h2>
        <p className="text-sm md:text-base text-gray-600 mt-3">
          Toma unos 2 minutos con tu documento oficial y la cámara. Mientras tanto ya puedes armar tu perfil y subir
          contenido: se guarda y <span className="font-medium text-gray-900">se publica solo al verificarte</span>. Para
          recibir pagos necesitas la insignia <span className="text-blue-700 font-medium">Verificado</span>.
        </p>
        {/* Desktop only: on a phone the camera is right there. */}
        <p className="hidden md:flex items-center gap-3 text-left text-base text-gray-800 bg-pink-50 border border-pink-100 rounded-2xl px-4 py-3 mt-4" data-testid="verify-qr-hint">
          <i aria-hidden="true" className="fas fa-mobile-alt text-2xl text-pink-500 shrink-0"></i>
          <span>¿Tu computadora no tiene cámara? Didit te muestra un <span className="font-semibold">código QR</span> para terminar desde tu celular.</span>
        </p>
        {error && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-4">{error}</p>}
        <div className="mt-6 flex flex-col gap-2">
          <button type="button" onClick={verifyNow} disabled={opening} className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-medium hover:opacity-90 transition disabled:opacity-60">
            {opening ? 'Abriendo…' : 'Verificar ahora'}
          </button>
          <button type="button" onClick={onLater} className="text-gray-600 px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-100 transition">
            Más tarde
          </button>
        </div>
      </div>
    </div>
  );
};

export default VerifyWelcome;
