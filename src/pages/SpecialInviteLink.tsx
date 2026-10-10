import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import BrandLogo from '../components/BrandLogo';
import { clearSpecialCode, saveSpecialCode, specialApi } from '../lib/special';

// /especial/<code>: a link the admin made for a special creator account. Signed in
// as a creator it activates the plan here; otherwise the code waits in the browser
// and SpecialInviteClaimer activates it once the creator account exists.
const SpecialInviteLink: React.FC = () => {
  const { code = '' } = useParams();
  const { user, loading, refreshUser } = useAuth();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const tried = useRef(false);

  useEffect(() => {
    if (code) saveSpecialCode(code);
  }, [code]);

  useEffect(() => {
    if (loading || !user || !code || tried.current || user.signupCompleted === false) return;
    tried.current = true;
    clearSpecialCode();
    specialApi.claim(code).then((r) => {
      if (r.ok) refreshUser();
      setResult(
        r.ok
          ? { ok: true, text: r.already ? `Tu cuenta ya tenía el plan especial «${r.label}».` : `¡Listo! Tu cuenta ya tiene el plan especial «${r.label}».` }
          : { ok: false, text: r.error || 'No se pudo activar el link' }
      );
    });
  }, [loading, user, code, refreshUser]);

  const card = (children: React.ReactNode) => (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 text-center" data-testid="special-invite">
        <div className="mb-6 flex justify-center">
          <BrandLogo size="md" />
        </div>
        {children}
      </div>
    </div>
  );

  if (loading || (user && !result)) {
    return card(<p className="text-gray-600" role="status">Activando tu cuenta especial…</p>);
  }

  if (result) {
    return card(
      <div role="status">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ${result.ok ? 'bg-green-100' : 'bg-red-100'}`}>
          <i aria-hidden="true" className={`fas ${result.ok ? 'fa-check text-green-600' : 'fa-times text-red-600'} text-xl`}></i>
        </div>
        <p className="text-gray-900 font-semibold mb-6" data-testid="special-invite-result">{result.text}</p>
        <Link
          to={user?.role === 'creator' ? '/creator/dashboard?tab=rewards' : '/explore'}
          className="inline-block bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-bold"
        >
          {user?.role === 'creator' ? 'Ir a mi panel' : 'Ir a Explorar'}
        </Link>
      </div>
    );
  }

  return card(
    <>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Te invitaron con un plan especial</h1>
      <p className="text-gray-600 mb-6">Crea tu cuenta de creador o inicia sesión con la que ya tienes. El plan se activa solo.</p>
      <div className="space-y-3">
        <Link to="/register?role=creator" className="block bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-bold">
          Abrir mi cuenta de creador
        </Link>
        <Link to="/login" state={{ from: `/especial/${code}` }} className="block border border-gray-200 text-gray-700 px-6 py-3 rounded-xl font-semibold hover:bg-gray-50">
          Ya tengo cuenta: iniciar sesión
        </Link>
      </div>
    </>
  );
};

export default SpecialInviteLink;
