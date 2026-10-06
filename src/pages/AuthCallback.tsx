import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, type UserRole } from '../context/AuthContext';
import { readJSON, removeKey } from '../lib/storage';
import { clearRefCode, readRefCode } from '../lib/rewardRules';
import BrandLogo from '../components/BrandLogo';
import { BRAND } from '../config/brand';
import { SOCIAL_INTENT_KEY, type SocialIntent } from '../components/SocialLoginButtons';
import CountryPhoneFields, { phoneFromForm } from '../components/CountryPhoneFields';
import { detectCountry } from '../config/countries';
import { useLanguage } from '../context/LanguageContext';

// The provider sends errors (e.g. the user pressed "Cancel") in the query or the hash.
const providerError = (): string => {
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const code = params.get('error') || hash.get('error');
  if (!code) return '';
  if (code === 'access_denied') return 'Cancelaste el acceso. Puedes intentarlo de nuevo o usar tu email.';
  return 'No se pudo iniciar sesión con esa cuenta. Inténtalo de nuevo o usa tu email.';
};

const homeFor = (role: UserRole) => (role === 'creator' ? '/creator/dashboard' : role === 'admin' ? '/admin' : '/explore');

// Landing page after Google/Microsoft. Existing accounts go straight in; a new
// account first picks fan or creator and accepts the terms (18+).
const AuthCallback: React.FC = () => {
  const { user, loading, completeSocialSignup, logout } = useAuth();
  const navigate = useNavigate();
  const [intent] = useState<SocialIntent>(() => readJSON<SocialIntent>(SOCIAL_INTENT_KEY, {}));
  const [role, setRole] = useState<UserRole>(intent.role === 'creator' ? 'creator' : 'fan');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const { t } = useLanguage();
  const [country, setCountry] = useState(detectCountry);
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(providerError);
  const [timedOut, setTimedOut] = useState(false);
  // While the form is being submitted, handleSubmit decides where to go.
  const completing = useRef(false);

  // Existing (or just completed) account: continue where the user was going.
  useEffect(() => {
    if (!user || user.signupCompleted === false || completing.current) return;
    removeKey(SOCIAL_INTENT_KEY);
    navigate(intent.from || homeFor(user.role), { replace: true });
  }, [user, intent.from, navigate]);

  // The session is read from the URL on load; don't spin forever if it never comes.
  useEffect(() => {
    if (user) return;
    const t = setTimeout(() => setTimedOut(true), 10000);
    return () => clearTimeout(t);
  }, [user]);

  const handleSubmit = async () => {
    if (!country) {
      setError(t('register.chooseCountry'));
      return;
    }
    const checked = phoneFromForm(country, phone, t);
    if ('error' in checked) {
      setError(checked.error);
      return;
    }
    if (!agreeTerms) {
      setError('Debes aceptar los términos y confirmar que eres mayor de 18 años');
      return;
    }
    setSubmitting(true);
    setError('');
    completing.current = true;
    const result = await completeSocialSignup(role, readRefCode(), { country, phone: checked.phone });
    completing.current = false;
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error || 'No se pudo completar el registro');
      return;
    }
    clearRefCode();
    // Creators land on their panel, where identity verification starts.
    removeKey(SOCIAL_INTENT_KEY);
    navigate(role === 'creator' ? '/creator/dashboard' : intent.from || '/', { replace: true });
  };

  const cancel = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const failed = !user && (error || (timedOut && !loading));

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <BrandLogo size="md" />
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          {failed ? (
            <div className="text-center" role="alert">
              <h2 className="text-xl font-bold text-gray-900 mb-2">No pudimos iniciar tu sesión</h2>
              <p className="text-gray-600 mb-6">{error || 'El enlace caducó o la sesión no llegó. Inténtalo de nuevo.'}</p>
              <Link to="/login" className="inline-block bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-bold">
                Volver a iniciar sesión
              </Link>
            </div>
          ) : !user || user.signupCompleted !== false ? (
            <div className="flex flex-col items-center py-6" role="status">
              <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin mb-4"></div>
              <p className="text-gray-600">Iniciando sesión…</p>
            </div>
          ) : (
            <div data-testid="complete-signup">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Hola, {user.name.split(' ')[0]}</h2>
              <p className="text-gray-600 mb-6">Un último paso: ¿cómo vas a usar {BRAND.name}?</p>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
                  <i aria-hidden="true" className="fas fa-exclamation-circle mr-2"></i>{error}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 mb-4">
                {(['fan', 'creator'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    aria-pressed={role === r}
                    className={`p-4 rounded-xl border-2 text-center transition ${role === r ? 'border-pink-500 bg-pink-50' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <i aria-hidden="true" className={`fas ${r === 'fan' ? 'fa-heart text-pink-500' : 'fa-star text-purple-500'} text-2xl mb-2`}></i>
                    <p className="font-medium text-gray-900">{r === 'fan' ? 'Fan' : 'Creador'}</p>
                    <p className="text-xs text-gray-500 mt-1">{r === 'fan' ? 'Sigue y apoya a tus creadores' : 'Publica y ofrece experiencias'}</p>
                  </button>
                ))}
              </div>

              {role === 'creator' && (
                <p className="text-xs text-gray-600 bg-purple-50 border border-purple-100 rounded-xl p-3 mb-4">
                  <i aria-hidden="true" className="fas fa-id-card text-purple-500 mr-1.5"></i>
                  Como creador verificarás tu identidad con tu ID y un selfie desde tu panel antes de recibir la insignia Verificado.
                </p>
              )}

              <div className="space-y-4 mb-4">
                <CountryPhoneFields country={country} phone={phone} onCountry={setCountry} onPhone={setPhone} />
              </div>

              <label className="flex items-start space-x-2 mb-6">
                <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} className="mt-1 w-4 h-4 text-pink-600 rounded" />
                <span className="text-sm text-gray-600">
                  Acepto los <Link to="/legal" target="_blank" className="text-pink-600">términos de servicio</Link> y la{' '}
                  <Link to="/legal" target="_blank" className="text-pink-600">política de privacidad</Link>, y confirmo que soy mayor de 18 años.
                </span>
              </label>

              <div className="flex space-x-3">
                <button type="button" onClick={cancel} className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl font-medium hover:bg-gray-200 transition">
                  Cancelar
                </button>
                <button type="button" onClick={handleSubmit} disabled={submitting} className="flex-1 disabled:opacity-60 bg-gradient-to-r from-pink-500 to-purple-600 text-white py-3 rounded-xl font-bold hover:opacity-90 transition">
                  Crear mi cuenta
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthCallback;
