import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const AgeVerification: React.FC = () => {
  const { verifyAge } = useAuth();
  const navigate = useNavigate();
  const [showDeny, setShowDeny] = useState(false);

  const handleConfirm = () => {
    verifyAge();
    navigate('/');
  };

  const handleDeny = () => {
    setShowDeny(true);
  };

  if (showDeny) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <i className="fas fa-times text-2xl text-red-600"></i>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Acceso Denegado</h2>
          <p className="text-gray-600 mb-6">
            Lo sentimos, debes ser mayor de 18 años para acceder a SugarFans. Serás redirigido en unos momentos.
          </p>
          <button onClick={() => window.location.href = 'https://www.google.com'} className="bg-gray-200 text-gray-700 px-6 py-3 rounded-full font-medium hover:bg-gray-300 transition">
            Salir del sitio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-8 max-w-lg w-full shadow-2xl">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-pink-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-xl">SF</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Verificación de Edad</h1>
          <p className="text-gray-600">
            Este sitio contiene contenido exclusivo para adultos. Debes confirmar que eres mayor de 18 años para continuar.
          </p>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
          <div className="flex items-start">
            <i className="fas fa-exclamation-triangle text-yellow-600 mt-0.5 mr-3"></i>
            <div>
              <p className="text-sm text-yellow-800 font-medium">Aviso Legal</p>
              <p className="text-sm text-yellow-700 mt-1">
                Al ingresar, declaras bajo juramento que tienes 18 años o más. El acceso a menores está estrictamente prohibido.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <button
            onClick={handleConfirm}
            className="w-full bg-gradient-to-r from-pink-500 to-purple-600 text-white py-4 rounded-xl font-bold text-lg hover:opacity-90 transition-all shadow-lg"
          >
            <i className="fas fa-check-circle mr-2"></i>
            Sí, soy mayor de 18 años
          </button>
          <button
            onClick={handleDeny}
            className="w-full bg-gray-100 text-gray-700 py-4 rounded-xl font-medium hover:bg-gray-200 transition"
          >
            No, soy menor de 18 años
          </button>
        </div>

        <p className="text-xs text-gray-500 text-center mt-6">
          Al continuar, aceptas nuestros{' '}
          <a href="/policies" className="text-pink-600 hover:underline">Términos de Servicio</a> y{' '}
          <a href="/policies" className="text-pink-600 hover:underline">Política de Privacidad</a>
        </p>
      </div>
    </div>
  );
};

export default AgeVerification;
