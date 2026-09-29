import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import LanguageSelector from '../components/LanguageSelector';

const Login: React.FC = () => {
  const { login } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Por favor completa todos los campos');
      return;
    }
    const success = login(email, password);
    if (success) {
      navigate('/explore');
    } else {
      setError('Credenciales incorrectas');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 to-purple-50 flex flex-col">
      <div className="flex justify-end p-4">
        <LanguageSelector />
      </div>
      <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center space-x-2">
            <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold">SF</span>
            </div>
            <span className="text-2xl font-bold bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text text-transparent">
              SugarFans
            </span>
          </Link>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('login.title')}</h2>
          <p className="text-gray-600 mb-6">{t('login.subtitle')}</p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
              <i className="fas fa-exclamation-circle mr-2"></i>{error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('login.email')}</label>
              <div className="relative">
                <i className="fas fa-envelope absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
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
                <i className="fas fa-lock absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-12 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition"
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <label className="flex items-center">
                <input type="checkbox" className="w-4 h-4 text-pink-600 border-gray-300 rounded focus:ring-pink-500" />
                <span className="ml-2 text-sm text-gray-600">{t('login.remember')}</span>
              </label>
              <a href="#" className="text-sm text-pink-600 hover:text-pink-700">{t('login.forgot')}</a>
            </div>

            <button type="submit" className="w-full bg-gradient-to-r from-pink-500 to-purple-600 text-white py-3 rounded-xl font-bold hover:opacity-90 transition-all shadow-lg">
              {t('login.submit')}
            </button>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"></div></div>
              <div className="relative flex justify-center text-sm"><span className="px-4 bg-white text-gray-500">{t('login.or')}</span></div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button className="flex items-center justify-center py-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 transition">
                <i className="fab fa-google text-red-500 mr-2"></i> Google
              </button>
              <button className="flex items-center justify-center py-2.5 border border-gray-200 rounded-xl hover:bg-gray-50 transition">
                <i className="fab fa-apple text-gray-800 mr-2"></i> Apple
              </button>
            </div>
          </div>

          <p className="text-center text-sm text-gray-600 mt-6">
            {t('login.noAccount')}{' '}
            <Link to="/register" className="text-pink-600 font-medium hover:text-pink-700">{t('login.register')}</Link>
          </p>
        </div>

        {/* Demo hint */}
        <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
          <p className="font-medium mb-1"><i className="fas fa-info-circle mr-1"></i> {t('login.demo')}</p>
          <p>• {t('login.demoFan')}</p>
          <p>• {t('login.demoCreator')}</p>
          <p>• {t('login.demoAdmin')}</p>
        </div>
      </div>
      </div>
    </div>
  );
};

export default Login;
