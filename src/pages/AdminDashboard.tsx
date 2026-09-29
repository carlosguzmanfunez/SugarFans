import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useBackendData } from '../lib/useBackendData';

const AdminDashboard: React.FC = () => {
  const { user, listAccounts } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [userQuery, setUserQuery] = useState('');
  const { data: accounts } = useBackendData(listAccounts, [], []);

  const stats = [
    { label: 'Usuarios totales', value: '52,340', icon: 'fa-users', color: 'blue' },
    { label: 'Creadores activos', value: '3,210', icon: 'fa-star', color: 'purple' },
    { label: 'Ingresos del mes', value: '$125,400', icon: 'fa-dollar-sign', color: 'green' },
    { label: 'Reportes pendientes', value: '12', icon: 'fa-flag', color: 'red' },
  ];

  const pendingVerifications = [
    { id: '1', name: 'María López', email: 'maria@email.com', date: 'Hace 2 horas', type: 'Creador' },
    { id: '2', name: 'Juan Pérez', email: 'juan@email.com', date: 'Hace 5 horas', type: 'Creador' },
    { id: '3', name: 'Lucía García', email: 'lucia@email.com', date: 'Hace 1 día', type: 'Creador' },
  ];

  const reports = [
    { id: '1', reason: 'Contenido inapropiado', creator: 'Usuario X', reporter: 'Fan Y', date: 'Hace 1 hora', status: 'pending' },
    { id: '2', reason: 'Spam', creator: 'Usuario Z', reporter: 'Fan W', date: 'Hace 3 horas', status: 'pending' },
    { id: '3', reason: 'Derechos de autor', creator: 'Usuario A', reporter: 'Fan B', date: 'Hace 1 día', status: 'reviewing' },
    { id: '4', reason: 'Contenido sin consentimiento', creator: 'Usuario C', reporter: 'Persona D', date: 'Hace 2 días', status: 'pending' },
  ];

  const roleLabel = { fan: 'Fan', creator: 'Creador', admin: 'Admin' } as const;
  const recentUsers = [...accounts]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((u) => {
      const q = userQuery.trim().toLowerCase();
      return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    })
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: roleLabel[u.role],
      status: u.isVerified ? 'verified' : 'active',
      date: new Date(u.createdAt).toLocaleDateString('es'),
    }));

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Panel de Administración</h1>
            <p className="text-gray-600">Bienvenido, {user?.name}</p>
          </div>
          <div className="mt-4 sm:mt-0 flex items-center space-x-3">
            <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-sm font-medium">
              <i className="fas fa-exclamation-circle mr-1"></i> 12 pendientes
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {stats.map((stat, i) => (
            <div key={i} className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl bg-${stat.color}-100 flex items-center justify-center`}>
                  <i className={`fas ${stat.icon} text-${stat.color}-600`}></i>
                </div>
              </div>
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              <p className="text-sm text-gray-500 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex space-x-1 bg-white rounded-xl p-1 shadow-sm mb-8 overflow-x-auto">
          {[
            { id: 'overview', label: 'Resumen', icon: 'fa-chart-pie' },
            { id: 'verifications', label: 'Verificaciones', icon: 'fa-id-card' },
            { id: 'reports', label: 'Reportes', icon: 'fa-flag' },
            { id: 'users', label: 'Usuarios', icon: 'fa-users' },
            { id: 'content', label: 'Contenido', icon: 'fa-images' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                activeTab === tab.id ? 'bg-pink-100 text-pink-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <i className={`fas ${tab.icon} mr-1`}></i> {tab.label}
            </button>
          ))}
        </div>

        {/* Overview */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pending Verifications */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex justify-between items-center">
                <h3 className="font-bold text-gray-900">Verificaciones Pendientes</h3>
                <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full text-xs font-medium">{pendingVerifications.length}</span>
              </div>
              <div className="divide-y divide-gray-100">
                {pendingVerifications.map((v) => (
                  <div key={v.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{v.name}</p>
                      <p className="text-xs text-gray-500">{v.email} • {v.date}</p>
                    </div>
                    <div className="flex space-x-2">
                      <button className="px-3 py-1 bg-green-100 text-green-700 rounded-lg text-xs font-medium hover:bg-green-200">
                        Aprobar
                      </button>
                      <button className="px-3 py-1 bg-red-100 text-red-700 rounded-lg text-xs font-medium hover:bg-red-200">
                        Rechazar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Reports */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex justify-between items-center">
                <h3 className="font-bold text-gray-900">Reportes Recientes</h3>
                <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-medium">{reports.length}</span>
              </div>
              <div className="divide-y divide-gray-100">
                {reports.slice(0, 4).map((r) => (
                  <div key={r.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-gray-900 text-sm">{r.reason}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        r.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {r.status === 'pending' ? 'Pendiente' : 'En revisión'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Reportado por: {r.reporter} • {r.date}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Verifications */}
        {activeTab === 'verifications' && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Gestión de Verificaciones</h3>
              <p className="text-sm text-gray-600 mt-1">Revisa las solicitudes de verificación de identidad de creadores</p>
            </div>
            <div className="divide-y divide-gray-100">
              {pendingVerifications.map((v) => (
                <div key={v.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between hover:bg-gray-50">
                  <div className="flex items-center space-x-4 mb-3 sm:mb-0">
                    <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center">
                      <i className="fas fa-user text-gray-400"></i>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{v.name}</p>
                      <p className="text-sm text-gray-500">{v.email}</p>
                      <p className="text-xs text-gray-400">Solicitud: {v.date} • Tipo: {v.type}</p>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <button className="px-4 py-2 bg-green-100 text-green-700 rounded-lg text-sm font-medium hover:bg-green-200 transition">
                      <i className="fas fa-check mr-1"></i> Aprobar
                    </button>
                    <button className="px-4 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 transition">
                      <i className="fas fa-times mr-1"></i> Rechazar
                    </button>
                    <button className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition">
                      <i className="fas fa-eye mr-1"></i> Ver docs
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reports */}
        {activeTab === 'reports' && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Gestión de Reportes</h3>
              <p className="text-sm text-gray-600 mt-1">Revisa y gestiona los reportes de contenido y usuarios</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Razón</th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Reportado</th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Reportante</th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Fecha</th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Estado</th>
                    <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {reports.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-5 py-4 text-sm text-gray-900">{r.reason}</td>
                      <td className="px-5 py-4 text-sm text-gray-600">{r.creator}</td>
                      <td className="px-5 py-4 text-sm text-gray-600">{r.reporter}</td>
                      <td className="px-5 py-4 text-sm text-gray-500">{r.date}</td>
                      <td className="px-5 py-4">
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          r.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {r.status === 'pending' ? 'Pendiente' : 'En revisión'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex space-x-2">
                          <button className="text-green-600 hover:text-green-700 text-sm" title="Eliminar contenido">
                            <i className="fas fa-trash"></i>
                          </button>
                          <button className="text-red-600 hover:text-red-700 text-sm" title="Bloquear usuario">
                            <i className="fas fa-ban"></i>
                          </button>
                          <button className="text-gray-400 hover:text-gray-600 text-sm" title="Descartar">
                            <i className="fas fa-times"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Users */}
        {activeTab === 'users' && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-gray-900">Gestión de Usuarios</h3>
              <div className="relative">
                <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                <input type="text" value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="Buscar usuario..." className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-pink-500 outline-none" />
              </div>
            </div>
            <div className="divide-y divide-gray-100">
              {recentUsers.length === 0 && (
                <p className="p-6 text-center text-sm text-gray-500">No hay usuarios que coincidan con la búsqueda</p>
              )}
              {recentUsers.map((u) => (
                <div key={u.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                      <i className="fas fa-user text-gray-400"></i>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{u.name}</p>
                      <p className="text-xs text-gray-500">{u.email} • {u.role} • Registrado: {u.date}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      u.status === 'active' ? 'bg-green-100 text-green-700' :
                      u.status === 'verified' ? 'bg-blue-100 text-blue-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {u.status === 'active' ? 'Activo' : u.status === 'verified' ? 'Verificado' : 'Pendiente'}
                    </span>
                    <button className="text-gray-400 hover:text-red-500 transition">
                      <i className="fas fa-ellipsis-v"></i>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Content Review */}
        {activeTab === 'content' && (
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <h3 className="font-bold text-gray-900 mb-4">Revisión de Contenido</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border border-gray-200 rounded-xl p-4">
                <div className="bg-gray-200 rounded-lg h-32 mb-3 flex items-center justify-center">
                  <i className="fas fa-image text-gray-400 text-2xl"></i>
                </div>
                <p className="text-sm font-medium text-gray-900">Post #1234</p>
                <p className="text-xs text-gray-500">Por: Valentina Rose</p>
                <div className="flex space-x-2 mt-3">
                  <button className="flex-1 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">Aprobar</button>
                  <button className="flex-1 py-1 bg-red-100 text-red-700 rounded text-xs font-medium">Rechazar</button>
                </div>
              </div>
              <div className="border border-gray-200 rounded-xl p-4">
                <div className="bg-gray-200 rounded-lg h-32 mb-3 flex items-center justify-center">
                  <i className="fas fa-video text-gray-400 text-2xl"></i>
                </div>
                <p className="text-sm font-medium text-gray-900">Video #567</p>
                <p className="text-xs text-gray-500">Por: Diego Torres</p>
                <div className="flex space-x-2 mt-3">
                  <button className="flex-1 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">Aprobar</button>
                  <button className="flex-1 py-1 bg-red-100 text-red-700 rounded text-xs font-medium">Rechazar</button>
                </div>
              </div>
              <div className="border border-yellow-200 rounded-xl p-4 bg-yellow-50">
                <div className="bg-gray-200 rounded-lg h-32 mb-3 flex items-center justify-center">
                  <i className="fas fa-exclamation-triangle text-yellow-400 text-2xl"></i>
                </div>
                <p className="text-sm font-medium text-gray-900">Post #890 ⚠️</p>
                <p className="text-xs text-gray-500">Reportado - Revisión urgente</p>
                <div className="flex space-x-2 mt-3">
                  <button className="flex-1 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">Aprobar</button>
                  <button className="flex-1 py-1 bg-red-100 text-red-700 rounded text-xs font-medium">Eliminar</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
