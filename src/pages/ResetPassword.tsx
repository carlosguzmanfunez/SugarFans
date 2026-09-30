import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { backend } from '../lib/backend';

// Opened from the emailed link: choose the new password.
const ResetPassword: React.FC = () => {
  const [params] = useSearchParams();
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError('Las contraseñas no coinciden');
    setSaving(true);
    const result = await backend.resetPassword(password, params.get('token') ?? undefined);
    setSaving(false);
    if (!result.ok) return setError(result.error || 'No se pudo cambiar la contraseña');
    setError('');
    setDone(true);
    await refreshUser();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Crea una nueva contraseña</h1>
        {done ? (
          <>
            <p role="status" className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6 text-sm">
              Tu contraseña se cambió correctamente.
            </p>
            <button onClick={() => navigate('/login')} className="w-full bg-gradient-to-r from-pink-500 to-purple-600 text-white py-3 rounded-xl font-bold">
              Continuar
            </button>
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
              <input type="password" name="newPassword" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nueva contraseña" className="w-full px-4 py-3 border border-gray-200 rounded-xl" />
              <input type="password" name="confirmPassword" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repite la contraseña" className="w-full px-4 py-3 border border-gray-200 rounded-xl" />
              <button type="submit" disabled={saving} className="w-full disabled:opacity-60 bg-gradient-to-r from-pink-500 to-purple-600 text-white py-3 rounded-xl font-bold">
                Guardar contraseña
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
