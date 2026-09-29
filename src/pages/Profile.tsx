import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';

const Profile: React.FC = () => {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Profile Header */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-6">
          <div className="h-32 bg-gradient-to-r from-pink-400 to-purple-500"></div>
          <div className="px-6 pb-6 -mt-12">
            <img src={user.avatar} alt={user.name} className="w-24 h-24 rounded-full border-4 border-white shadow-lg" />
            <div className="mt-4">
              <div className="flex items-center space-x-2">
                <h1 className="text-2xl font-bold text-gray-900">{user.name}</h1>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  user.role === 'admin' ? 'bg-red-100 text-red-700' :
                  user.role === 'creator' ? 'bg-purple-100 text-purple-700' :
                  'bg-blue-100 text-blue-700'
                }`}>
                  {user.role === 'admin' ? 'Administrador' : user.role === 'creator' ? 'Creador' : 'Fan'}
                </span>
              </div>
              <p className="text-gray-500">{user.email}</p>
              {user.bio && <p className="text-gray-600 mt-2">{user.bio}</p>}
            </div>
            {user.role === 'creator' && (
              <div className="flex space-x-6 mt-4">
                <div className="text-center">
                  <p className="font-bold text-gray-900">{user.followers?.toLocaleString()}</p>
                  <p className="text-xs text-gray-500">Seguidores</p>
                </div>
                <div className="text-center">
                  <p className="font-bold text-gray-900">{user.following}</p>
                  <p className="text-xs text-gray-500">Siguiendo</p>
                </div>
                <div className="text-center">
                  <p className="font-bold text-gray-900">{user.posts}</p>
                  <p className="text-xs text-gray-500">Posts</p>
                </div>
              </div>
            )}
            <div className="flex space-x-3 mt-4">
              <Link to="/settings" className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition">
                <i className="fas fa-cog mr-1"></i> Editar perfil
              </Link>
              {user.role === 'creator' && (
                <Link to="/creator/dashboard" className="px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-600 text-white rounded-xl text-sm font-medium hover:opacity-90 transition">
                  <i className="fas fa-chart-line mr-1"></i> Mi panel
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <h3 className="font-bold text-gray-900 mb-3">
              <i className="fas fa-history text-pink-500 mr-2"></i> Historial de Compras
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <div>
                  <p className="text-sm font-medium text-gray-900">Suscripción - Valentina Rose</p>
                  <p className="text-xs text-gray-500">15 Ene 2024</p>
                </div>
                <span className="text-sm font-bold text-gray-900">$9.99</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <div>
                  <p className="text-sm font-medium text-gray-900">PPV - Diego Torres</p>
                  <p className="text-xs text-gray-500">12 Ene 2024</p>
                </div>
                <span className="text-sm font-bold text-gray-900">$4.99</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">Propina - Sofía Luna</p>
                  <p className="text-xs text-gray-500">10 Ene 2024</p>
                </div>
                <span className="text-sm font-bold text-gray-900">$5.00</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-5">
            <h3 className="font-bold text-gray-900 mb-3">
              <i className="fas fa-star text-purple-500 mr-2"></i> Suscripciones Activas
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <div className="flex items-center space-x-3">
                  <img src="https://api.dicebear.com/7.0/adventurer/svg?seed=valentina" alt="" className="w-8 h-8 rounded-full" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Valentina Rose</p>
                    <p className="text-xs text-gray-500">Renovación: 15 Feb 2024</p>
                  </div>
                </div>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">Activa</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center space-x-3">
                  <img src="https://api.dicebear.com/7.0/adventurer/svg?seed=diego" alt="" className="w-8 h-8 rounded-full" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Diego Torres</p>
                    <p className="text-xs text-gray-500">Renovación: 20 Feb 2024</p>
                  </div>
                </div>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">Activa</span>
              </div>
            </div>
          </div>
        </div>

        {/* Account Info */}
        <div className="mt-6 bg-white rounded-2xl shadow-sm p-5">
          <h3 className="font-bold text-gray-900 mb-4">
            <i className="fas fa-info-circle text-blue-500 mr-2"></i> Información de la Cuenta
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Tipo de cuenta</p>
              <p className="font-medium text-gray-900 capitalize">{user.role}</p>
            </div>
            <div>
              <p className="text-gray-500">Email</p>
              <p className="font-medium text-gray-900">{user.email}</p>
            </div>
            <div>
              <p className="text-gray-500">Verificación de edad</p>
              <p className="font-medium text-green-600"><i className="fas fa-check-circle mr-1"></i> Verificado</p>
            </div>
            <div>
              <p className="text-gray-500">Miembro desde</p>
              <p className="font-medium text-gray-900">Enero 2024</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Profile;
