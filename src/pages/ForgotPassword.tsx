import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { backend } from '../lib/backend';

// Asks for an email and sends a link to choose a new password.
const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    const result = await backend.requestPasswordReset(email);
    setSending(false);
    setMessage(result.ok ? { ok: true, text: result.notice || 'Revisa tu correo.' } : { ok: false, text: result.error || 'No se pudo enviar el enlace' });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">¿Olvidaste tu contraseña?</h1>
        <p className="text-gray-600 mb-6">Escribe el email de tu cuenta y te enviaremos un enlace para crear una nueva.</p>
        {message && (
          <div role="status" className={`px-4 py-3 rounded-lg mb-4 text-sm border ${message.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {message.text}
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none"
          />
          <button type="submit" disabled={sending} className="w-full disabled:opacity-60 bg-gradient-to-r from-pink-500 to-purple-600 text-white py-3 rounded-xl font-bold">
            Enviar enlace
          </button>
        </form>
        <p className="text-center text-sm text-gray-600 mt-6">
          <Link to="/login" className="text-pink-600 font-medium">Volver a iniciar sesión</Link>
        </p>
      </div>
    </div>
  );
};

export default ForgotPassword;
