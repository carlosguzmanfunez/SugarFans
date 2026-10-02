import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import ManagedProfilesAdmin from '../components/ManagedProfilesAdmin';
import {
  usePlatformQuery,
  platformApi,
  reviewVerification,
  resolveReport,
  restorePost,
  docTypeLabel,
  ageFrom,
  money,
  type VerificationRequest,
} from '../lib/platform';

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins} min`;
  if (mins < 1440) return `Hace ${Math.round(mins / 60)} h`;
  return new Date(iso).toLocaleDateString('es');
};

const kindLabel = { post: 'Publicación', creator: 'Perfil', support: 'Soporte', other: 'Otro' } as const;
const roleName = { fan: 'Fan', creator: 'Creador', admin: 'Admin' } as const;

const AdminDashboard: React.FC = () => {
  const { user, listAccounts } = useAuth();
  const { data: accounts, reload: reloadAccounts } = usePlatformQuery(listAccounts, [], []);
  const { data: platform } = usePlatformQuery(
    async () => {
      const [verifications, reports, payouts, transactions, removedPosts] = await Promise.all([
        platformApi.listVerifications(),
        platformApi.listReports(),
        platformApi.listPayouts(),
        platformApi.allPayments(),
        platformApi.removedPosts(),
      ]);
      return { verifications, reports, payouts, transactions, removedPosts };
    },
    [],
    {
      verifications: [] as VerificationRequest[],
      reports: [] as Awaited<ReturnType<typeof platformApi.listReports>>,
      payouts: [] as Awaited<ReturnType<typeof platformApi.listPayouts>>,
      transactions: [] as Awaited<ReturnType<typeof platformApi.allPayments>>,
      removedPosts: [] as string[],
    }
  );
  const [activeTab, setActiveTab] = useState('overview');
  const [userQuery, setUserQuery] = useState('');
  const [viewing, setViewing] = useState<VerificationRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const pendingVerifications = platform.verifications.filter((v) => v.status === 'pending');
  const reports = [...platform.reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pendingReports = reports.filter((r) => r.status === 'pending');
  const payouts = [...platform.payouts].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const monthRevenue = platform.transactions
    .filter((t) => t.status === 'paid' && t.createdAt >= monthStart)
    .reduce((s, t) => s + t.amount, 0);
  const pendingTotal = pendingVerifications.length + pendingReports.length;

  const stats = [
    { label: 'Usuarios registrados', value: String(accounts.length), icon: 'fa-users', color: 'blue' },
    { label: 'Creadores', value: String(accounts.filter((a) => a.role === 'creator').length), icon: 'fa-star', color: 'purple' },
    { label: 'Cobrado este mes', value: money(monthRevenue), icon: 'fa-dollar-sign', color: 'green' },
    { label: 'Reportes pendientes', value: String(pendingReports.length), icon: 'fa-flag', color: 'red' },
  ];

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
      role: roleName[u.role],
      status: u.isVerified ? 'verified' : 'active',
      date: new Date(u.createdAt).toLocaleDateString('es'),
    }));

  const review = async (v: VerificationRequest, approve: boolean) => {
    const r = await reviewVerification(v.id, approve, rejectReason);
    if (!r.ok) return setNotice({ ok: false, text: r.error! });
    reloadAccounts();
    setNotice({ ok: true, text: approve ? `Identidad de ${v.userName} aprobada` : `Solicitud de ${v.userName} rechazada` });
    setViewing(null);
    setRejectReason('');
  };

  const verificationRow = (v: VerificationRequest, compact = false) => (
    <div key={v.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-gray-50">
      <div>
        <p className="font-medium text-gray-900 text-sm">{v.userName}</p>
        <p className="text-xs text-gray-500">{v.email} • {roleName[v.role]} • {ago(v.submittedAt)}</p>
        {!compact && <p className="text-xs text-gray-400">{docTypeLabel[v.docType]} • {v.country}</p>}
      </div>
      <button onClick={() => { setViewing(v); setRejectReason(''); }} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200">
        <i aria-hidden="true" className="fas fa-eye mr-1"></i> Revisar documentos
      </button>
    </div>
  );

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
              <i aria-hidden="true" className="fas fa-exclamation-circle mr-1"></i> {pendingTotal} pendientes
            </span>
          </div>
        </div>

        {notice && (
          <div role={notice.ok ? 'status' : 'alert'} className={`px-4 py-3 rounded-xl mb-6 border ${notice.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {notice.text}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {stats.map((stat, i) => (
            <div key={i} className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl bg-${stat.color}-100 flex items-center justify-center`}>
                  <i aria-hidden="true" className={`fas ${stat.icon} text-${stat.color}-600`}></i>
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
            { id: 'verifications', label: `Verificaciones (${pendingVerifications.length})`, icon: 'fa-id-card' },
            { id: 'reports', label: `Reportes (${pendingReports.length})`, icon: 'fa-flag' },
            { id: 'payouts', label: 'Retiros', icon: 'fa-money-check-alt' },
            { id: 'managed', label: 'Perfiles gestionados', icon: 'fa-robot' },
            { id: 'users', label: 'Usuarios', icon: 'fa-users' },
            { id: 'content', label: 'Contenido', icon: 'fa-images' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setNotice(null); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                activeTab === tab.id ? 'bg-pink-100 text-pink-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <i aria-hidden="true" className={`fas ${tab.icon} mr-1`}></i> {tab.label}
            </button>
          ))}
        </div>

        {/* Overview */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex justify-between items-center">
                <h3 className="font-bold text-gray-900">Verificaciones Pendientes</h3>
                <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full text-xs font-medium">{pendingVerifications.length}</span>
              </div>
              <div className="divide-y divide-gray-100">
                {pendingVerifications.length === 0 && <p className="p-6 text-center text-sm text-gray-500">No hay solicitudes pendientes</p>}
                {pendingVerifications.slice(0, 4).map((v) => verificationRow(v, true))}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex justify-between items-center">
                <h3 className="font-bold text-gray-900">Reportes Recientes</h3>
                <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-medium">{pendingReports.length}</span>
              </div>
              <div className="divide-y divide-gray-100">
                {pendingReports.length === 0 && <p className="p-6 text-center text-sm text-gray-500">No hay reportes pendientes</p>}
                {pendingReports.slice(0, 4).map((r) => (
                  <div key={r.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-gray-900 text-sm">{r.reason}</p>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">Pendiente</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{r.targetLabel} • Reportado por: {r.reporterName} • {ago(r.createdAt)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Verifications */}
        {activeTab === 'verifications' && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden" data-testid="admin-verifications">
            <div className="p-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Gestión de Verificaciones</h3>
              <p className="text-sm text-gray-600 mt-1">Compara la cara del selfie con la foto del documento y confirma que es mayor de edad antes de aprobar.</p>
            </div>
            <div className="divide-y divide-gray-100">
              {pendingVerifications.length === 0 && <p className="p-6 text-center text-sm text-gray-500">No hay solicitudes pendientes</p>}
              {pendingVerifications.map((v) => verificationRow(v))}
            </div>
            {platform.verifications.some((v) => v.status !== 'pending') && (
              <div className="border-t border-gray-100 p-5">
                <h4 className="text-sm font-bold text-gray-700 mb-3">Revisadas</h4>
                <div className="space-y-2">
                  {platform.verifications.filter((v) => v.status !== 'pending').map((v) => (
                    <div key={v.id} className="flex justify-between text-sm">
                      <span className="text-gray-700">{v.userName} · {v.email}</span>
                      <span className={v.status === 'approved' ? 'text-green-600' : 'text-red-600'}>
                        {v.status === 'approved' ? 'Aprobada' : `Rechazada: ${v.rejectionReason}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Reports */}
        {activeTab === 'reports' && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden" data-testid="admin-reports">
            <div className="p-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Gestión de Reportes</h3>
              <p className="text-sm text-gray-600 mt-1">Reportes enviados desde las publicaciones, los perfiles y el Centro de Ayuda</p>
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
                  {reports.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-gray-500">No hay reportes</td></tr>
                  )}
                  {reports.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50 align-top">
                      <td className="px-5 py-4 text-sm text-gray-900">
                        {r.reason}
                        <p className="text-xs text-gray-500 mt-1 max-w-xs">{r.description}</p>
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-600">
                        <span className="text-xs text-gray-400 block">{kindLabel[r.kind]}</span>{r.targetLabel}
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-600">{r.reporterName}{r.contactEmail && <span className="block text-xs text-gray-400">{r.contactEmail}</span>}</td>
                      <td className="px-5 py-4 text-sm text-gray-500">{ago(r.createdAt)}</td>
                      <td className="px-5 py-4">
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          r.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : r.status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {r.status === 'pending' ? 'Pendiente' : r.resolution}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {r.status === 'pending' ? (
                          <div className="flex flex-col gap-1 items-start">
                            {r.kind === 'post' && (
                              <button onClick={() => resolveReport(r.id, 'remove')} className="text-red-600 hover:text-red-700 text-xs font-medium">
                                <i aria-hidden="true" className="fas fa-trash mr-1"></i>Retirar contenido
                              </button>
                            )}
                            <button onClick={() => resolveReport(r.id, 'resolve')} className="text-green-600 hover:text-green-700 text-xs font-medium">
                              <i aria-hidden="true" className="fas fa-check mr-1"></i>Marcar atendido
                            </button>
                            <button onClick={() => resolveReport(r.id, 'dismiss')} className="text-gray-500 hover:text-gray-700 text-xs font-medium">
                              <i aria-hidden="true" className="fas fa-times mr-1"></i>Descartar
                            </button>
                          </div>
                        ) : r.kind === 'post' && r.targetId && platform.removedPosts.includes(r.targetId) ? (
                          <button onClick={() => restorePost(r.targetId!)} className="text-xs text-pink-600">Restaurar publicación</button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Payouts */}
        {activeTab === 'payouts' && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden" data-testid="admin-payouts">
            <div className="p-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Retiros de creadores</h3>
              <p className="text-sm text-gray-600 mt-1">Registro automático: el creador retira su saldo completo (desde $50) y queda pagado al momento.</p>
            </div>
            <div className="divide-y divide-gray-100">
              {payouts.length === 0 && <p className="p-6 text-center text-sm text-gray-500">No hay solicitudes de retiro</p>}
              {payouts.map((p) => (
                <div key={p.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{p.creatorName} · {money(p.amount)}</p>
                    <p className="text-xs text-gray-500">{p.accountLabel} • Disponía de {money(p.availableBefore)} • Pagado el {new Date(p.paidAt).toLocaleDateString('es')}</p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">
                    <i aria-hidden="true" className="fas fa-check-circle mr-1"></i>Pagado
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Document review */}
        {viewing && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Revisar documentos">
            <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{viewing.userName}</h3>
                  <p className="text-sm text-gray-500">{viewing.email} • {roleName[viewing.role]}</p>
                </div>
                <button onClick={() => setViewing(null)} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600"><i aria-hidden="true" className="fas fa-times"></i></button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <p><span className="text-gray-500">Nombre legal:</span> {viewing.legalName}</p>
                <p><span className="text-gray-500">Nacimiento:</span> {new Date(viewing.birthDate + 'T00:00:00').toLocaleDateString('es')} ({ageFrom(viewing.birthDate)} años)</p>
                <p><span className="text-gray-500">Documento:</span> {docTypeLabel[viewing.docType]}</p>
                <p><span className="text-gray-500">Número:</span> {viewing.docNumber} ({viewing.country})</p>
              </div>
              <p className="text-sm text-gray-600 mb-2">
                Comprueba que la cara del selfie es la misma que la de la foto del documento y que la fecha de nacimiento del documento coincide.
              </p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {[
                  { src: viewing.docFront, label: 'Documento (frente)' },
                  { src: viewing.selfie, label: 'Selfie de frente' },
                ].filter((x) => x.src).map((x) => (
                  <figure key={x.label} className="bg-gray-100 rounded-xl p-2">
                    <img src={x.src} alt={x.label} className="w-full h-48 object-contain" />
                    <figcaption className="text-xs text-center text-gray-500 mt-1">{x.label}</figcaption>
                  </figure>
                ))}
              </div>
              <input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Motivo del rechazo (obligatorio para rechazar)"
                className="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm mb-3 outline-none focus:ring-2 focus:ring-pink-500"
              />
              {notice && !notice.ok && <p role="alert" className="text-sm text-red-600 mb-3">{notice.text}</p>}
              <div className="flex gap-2 justify-end">
                <button onClick={() => review(viewing, false)} className="px-4 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200">
                  <i aria-hidden="true" className="fas fa-times mr-1"></i> Rechazar
                </button>
                <button onClick={() => review(viewing, true)} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
                  <i aria-hidden="true" className="fas fa-check mr-1"></i> Aprobar identidad
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Users */}
        {activeTab === 'managed' && <ManagedProfilesAdmin transactions={platform.transactions} />}

        {activeTab === 'users' && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-gray-900">Gestión de Usuarios</h3>
              <div className="relative">
                <i aria-hidden="true" className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
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
                      <i aria-hidden="true" className="fas fa-user text-gray-400"></i>
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
                      <i aria-hidden="true" className="fas fa-ellipsis-v"></i>
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
                  <i aria-hidden="true" className="fas fa-image text-gray-400 text-2xl"></i>
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
                  <i aria-hidden="true" className="fas fa-video text-gray-400 text-2xl"></i>
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
                  <i aria-hidden="true" className="fas fa-exclamation-triangle text-yellow-400 text-2xl"></i>
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
