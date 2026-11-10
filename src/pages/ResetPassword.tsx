import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { backend, consumeRecoveryLink, recoveryLinkPending } from '../lib/backend';

// Password box with an eye to show or hide what is typed.
const PasswordField: React.FC<{ name: string; value: string; placeholder: string; onChange: (v: string) => void; autoFocus?: boolean }> = ({ name, value, placeholder, onChange, autoFocus }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="new-password"
        autoFocus={autoFocus}
        className="w-full rounded-xl border border-gray-200 py-3 pl-4 pr-12"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        aria-pressed={show}
        className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-gray-400 hover:text-gray-600"
        data-testid={`toggle-${name}`}
      >
        <i aria-hidden="true" className={`fas ${show ? 'fa-eye-slash' : 'fa-eye'}`}></i>
      </button>
    </div>
  );
};

// Opened from the emailed link: choose the new password. Once saved, the
// recovery session is closed and the user signs in again with the new one, so
// reopening this page (a reload, the phone waking up) cannot show the form again.
const ResetPassword: React.FC = () => {
  const [params] = useSearchParams();
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const token = params.get('token') ?? undefined;
  // The form needs the emailed link (or the session it opened); without it the
  // link was already used or expired.
  const usable = recoveryLinkPending() || !!token || !!user;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError('Las contraseñas no coinciden');
    setSaving(true);
    const result = await backend.resetPassword(password, token);
    if (!result.ok) {
      setSaving(false);
      return setError(result.error || 'No se pudo cambiar la contraseña');
    }
    consumeRecoveryLink();
    await logout();
    navigate('/login', { replace: true, state: { passwordChanged: true } });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Crea una nueva contraseña</h1>
        {!usable && !loading ? (
          <>
            <p role="alert" className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Este enlace ya se usó o caducó. Si ya cambiaste tu contraseña, entra con la nueva.
            </p>
            <Link to="/login" replace className="block w-full rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 py-3 text-center font-bold text-white">
              Iniciar sesión
            </Link>
            <Link to="/forgot-password" className="mt-3 block text-center text-sm text-gray-600 underline">
              Pedir otro enlace
            </Link>
          </>
        ) : (
          <>
            <p className="text-gray-600 mb-6">Mínimo 8 caracteres.</p>
            {error && (
              <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
                {error} {/caduc/.test(error) && <Link to="/forgot-password" className="underline">Pedir otro enlace</Link>}
              </div>
            )}
            <form onSubmit={submit} className="space-y-4">
              <PasswordField name="newPassword" value={password} onChange={setPassword} placeholder="Nueva contraseña" autoFocus />
              <PasswordField name="confirmPassword" value={confirm} onChange={setConfirm} placeholder="Repite la contraseña" />
              <button type="submit" disabled={saving} className="w-full disabled:opacity-60 bg-gradient-to-r from-pink-500 to-purple-600 text-white py-3 rounded-xl font-bold">
                {saving ? 'Guardando…' : 'Guardar contraseña'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
