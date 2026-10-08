import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import LanguageSelector from '../components/LanguageSelector';
import BrandLogo from '../components/BrandLogo';
import SocialLoginButtons from '../components/SocialLoginButtons';
import { DEMO_ACCOUNTS, type DemoAccount } from '../config/demoAccounts';

const Login: React.FC = () => {
  const { login } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || '/';
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const signIn = async (mail: string, pass: string) => {
    setSubmitting(true);
    setError('');
    const result = await login(mail, pass, remember);
    setSubmitting(false);
    if (result.ok) {
      navigate(from, { replace: true });
    } else {
      setError(result.error || 'Credenciales incorrectas');
    }
  };

  // Test mode: the demo accounts sign in with their internal credentials, which
  // are never shown (see src/config/demoAccounts.ts).
  const signInDemo = (account: DemoAccount) => signIn(account.email, account.password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Por favor completa todos los campos');
      return;
    }
    await signIn(email, password);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 to-purple-50 flex flex-col">
      <div className="flex justify-end p-4">
        <LanguageSelector />
      </div>
      <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <BrandLogo size="md" />
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('login.title')}</h2>
          <p className="text-gray-600 mb-6">{t('login.subtitle')}</p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
              <i aria-hidden="true" className="fas fa-exclamation-circle mr-2"></i>{error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('login.email')}</label>
              <div className="relative">
                <i aria-hidden="true" className="fas fa-envelope absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition"
                  placeholder="tu@email.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('login.password')}</label>
              <div className="relative">
                <i aria-hidden="true" className="fas fa-lock absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-12 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition"
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <i aria-hidden="true" className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <label className="flex items-center">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="w-4 h-4 text-pink-600 border-gray-300 rounded focus:ring-pink-500" />
                <span className="ml-2 text-sm text-gray-600">{t('login.remember')}</span>
              </label>
              <Link to="/forgot-password" className="text-sm text-pink-600 hover:text-pink-700">{t('login.forgot')}</Link>
            </div>

            <button type="submit" disabled={submitting} className="w-full disabled:opacity-60 bg-gradient-to-r from-pink-500 to-purple-600 text-white py-3 rounded-xl font-bold hover:opacity-90 transition-all shadow-lg">
              {t('login.submit')}
            </button>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"></div></div>
              <div className="relative flex justify-center text-sm"><span className="px-4 bg-white text-gray-500">o</span></div>
            </div>
            <div className="mt-4">
              <SocialLoginButtons from={(location.state as { from?: string } | null)?.from} onError={setError} />
            </div>
          </div>

          <p className="text-center text-sm text-gray-600 mt-6">
            {t('login.noAccount')}{' '}
            <Link to="/register" className="text-pink-600 font-medium hover:text-pink-700">{t('login.register')}</Link>
          </p>
        </div>

        {/* Demo accounts (test mode) */}
        <section className="mt-4 rounded-2xl border border-line bg-white/70 p-4" aria-labelledby="demo-access">
          <p id="demo-access" className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
            <i aria-hidden="true" className="fas fa-flask mr-1.5"></i>{t('login.demo')}
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.role}
                type="button"
                disabled={submitting}
                onClick={() => signInDemo(a)}
                title={a.description}
                data-testid={`demo-${a.role}`}
                className="flex items-center gap-2.5 rounded-xl border border-line bg-white px-3 py-2.5 text-left text-sm font-semibold text-ink transition hover:border-pink-300 hover:bg-pink-50 disabled:opacity-60 sm:flex-col sm:gap-1.5 sm:text-center"
              >
                <i aria-hidden="true" className={`fas ${a.icon} text-pink-600`}></i>
                {a.label}
              </button>
            ))}
          </div>
        </section>
      </div>
      </div>
    </div>
  );
};

export default Login;
