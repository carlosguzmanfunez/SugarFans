import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, UserRole } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import LanguageSelector from '../components/LanguageSelector';

const Register: React.FC = () => {
  const { register } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<UserRole>('fan');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [error, setError] = useState('');

  const handleNext = () => {
    if (step === 1) {
      if (!name || !email) {
        setError('Completa todos los campos');
        return;
      }
      setError('');
      setStep(2);
    } else if (step === 2) {
      if (!password || password.length < 8) {
        setError('La contraseña debe tener al menos 8 caracteres');
        return;
      }
      if (password !== confirmPassword) {
        setError('Las contraseñas no coinciden');
        return;
      }
      setError('');
      setStep(3);
    }
  };

  const handleSubmit = () => {
    if (!agreeTerms) {
      setError('Debes aceptar los términos y condiciones');
      return;
    }
    register(name, email, password, role);
    navigate('/explore');
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
          {/* Progress */}
          <div className="flex items-center justify-center mb-6">
            {[1, 2, 3].map((s) => (
              <React.Fragment key={s}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  step >= s ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  {s}
                </div>
                {s < 3 && <div className={`w-12 h-1 ${step > s ? 'bg-pink-500' : 'bg-gray-200'}`}></div>}
              </React.Fragment>
            ))}
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {step === 1 && t('register.createAccount')}
            {step === 2 && t('register.security')}
            {step === 3 && t('register.accountType')}
          </h2>
          <p className="text-gray-600 mb-6">
            {step === 1 && t('register.basicInfo')}
            {step === 2 && t('register.passwordInfo')}
            {step === 3 && t('register.howToUse')}
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
              <i className="fas fa-exclamation-circle mr-2"></i>{error}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('register.fullName')}</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none"
                  placeholder="Tu nombre"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('register.email')}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none"
                  placeholder="tu@email.com"
                />
              </div>
              <button onClick={handleNext} className="w-full bg-gradient-to-r from-pink-500 to-purple-600 text-white py-3 rounded-xl font-bold hover:opacity-90 transition">
                {t('register.continue')}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('register.password')}</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none"
                  placeholder="Mínimo 8 caracteres"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('register.confirmPassword')}</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none"
                  placeholder="Repite tu contraseña"
                />
              </div>
              <div className="flex space-x-3">
                <button onClick={() => setStep(1)} className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl font-medium hover:bg-gray-200 transition">
                  {t('register.back')}
                </button>
                <button onClick={handleNext} className="flex-1 bg-gradient-to-r from-pink-500 to-purple-600 text-white py-3 rounded-xl font-bold hover:opacity-90 transition">
                  {t('register.continue')}
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setRole('fan')}
                  className={`p-4 rounded-xl border-2 text-center transition ${
                    role === 'fan' ? 'border-pink-500 bg-pink-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <i className="fas fa-heart text-2xl text-pink-500 mb-2"></i>
                  <p className="font-medium text-gray-900">{t('register.fan')}</p>
                  <p className="text-xs text-gray-500 mt-1">{t('register.fanDesc')}</p>
                </button>
                <button
                  onClick={() => setRole('creator')}
                  className={`p-4 rounded-xl border-2 text-center transition ${
                    role === 'creator' ? 'border-pink-500 bg-pink-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <i className="fas fa-star text-2xl text-purple-500 mb-2"></i>
                  <p className="font-medium text-gray-900">{t('register.creator')}</p>
                  <p className="text-xs text-gray-500 mt-1">{t('register.creatorDesc')}</p>
                </button>
              </div>

              <label className="flex items-start space-x-2">
                <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} className="mt-1 w-4 h-4 text-pink-600 rounded" />
                <span className="text-sm text-gray-600">
                  {t('register.terms')} <a href="/policies" className="text-pink-600">{t('register.termsLink')}</a>,{' '}
                  {t('register.and')} <a href="/policies" className="text-pink-600">{t('register.privacyLink')}</a>{' '}
                  {t('register.ageConfirm')}
                </span>
              </label>

              <div className="flex space-x-3">
                <button onClick={() => setStep(2)} className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl font-medium hover:bg-gray-200 transition">
                  {t('register.back')}
                </button>
                <button onClick={handleSubmit} className="flex-1 bg-gradient-to-r from-pink-500 to-purple-600 text-white py-3 rounded-xl font-bold hover:opacity-90 transition">
                  {t('register.submit')}
                </button>
              </div>
            </div>
          )}

          <p className="text-center text-sm text-gray-600 mt-6">
            {t('register.hasAccount')}{' '}
            <Link to="/login" className="text-pink-600 font-medium hover:text-pink-700">{t('register.login')}</Link>
          </p>
        </div>
      </div>
      </div>
    </div>
  );
};

export default Register;
