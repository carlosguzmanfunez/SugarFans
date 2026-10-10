import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import ManagedProfilesAdmin from '../components/ManagedProfilesAdmin';
import SpecialAccountsAdmin from '../components/SpecialAccountsAdmin';
import {
  usePlatformQuery,
  platformApi,
  reviewVerification,
  resolveReport,
  restorePost,
  coverRefund,
  creatorCut,
  transactionLabel,
  docTypeLabel,
  ageFrom,
  money,
  type VerificationRequest,
} from '../lib/platform';
import { displayEmail } from '../config/demoAccounts';
import { giftsApi, type CoinPurchase } from '../lib/gifts';
import AdminOverview from '../components/AdminOverview';
import AdminLedger from '../components/AdminLedger';
import AdminUserSheet, { isSuspendedNow } from '../components/AdminUserSheet';
import { countryName } from '../config/countries';

const countryLabel = (code: string) => (code ? countryName(code, 'es', 'Otro país') : 'Sin país');

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
      const [verifications, reports, payouts, transactions, removedPosts, coins, restrictions, adminActions] = await Promise.all([
        platformApi.listVerifications(),
        platformApi.listReports(),
        platformApi.listPayouts(),
        platformApi.allPayments(),
        platformApi.removedPosts(),
        giftsApi.allCoinPurchases(),
        platformApi.accountRestrictions(),
        platformApi.adminActions(),
      ]);
      return { verifications, reports, payouts, transactions, removedPosts, coins, restrictions, adminActions };
    },
    [],
    {
      verifications: [] as VerificationRequest[],
      reports: [] as Awaited<ReturnType<typeof platformApi.listReports>>,
      payouts: [] as Awaited<ReturnType<typeof platformApi.listPayouts>>,
      transactions: [] as Awaited<ReturnType<typeof platformApi.allPayments>>,
      removedPosts: [] as string[],
      coins: [] as CoinPurchase[],
      restrictions: [] as Awaited<ReturnType<typeof platformApi.accountRestrictions>>,
      adminActions: [] as Awaited<ReturnType<typeof platformApi.adminActions>>,
    }
  );
  const [activeTab, setActiveTab] = useState('overview');
  const [userQuery, setUserQuery] = useState('');
  const [viewing, setViewing] = useState<VerificationRequest | null>(null);
  const [managing, setManaging] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const pendingVerifications = platform.verifications.filter((v) => v.status === 'pending');
  const reports = [...platform.reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pendingReports = reports.filter((r) => r.status === 'pending');
  const payouts = [...platform.payouts].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const pendingTotal = pendingVerifications.length + pendingReports.length;
  // Sales PayPal gave back to the fan (refund, chargeback) or froze (dispute).
  const moneyBack = platform.transactions.filter((t) => (t.status === 'refunded' || t.status === 'disputed') && t.kind !== 'referral');
  const toggleCover = async (id: string, cover: boolean) => {
    const r = await coverRefund(id, cover);
    setNotice(r.ok ? { ok: true, text: cover ? 'Listo: el creador conserva su parte; la pérdida la asume Fans Reserve' : 'Listo: se le descuenta al creador' } : { ok: false, text: r.error ?? 'No se pudo actualizar la venta' });
  };

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
      country: u.country ?? '',
      phone: u.phone ?? '',
      isAdmin: u.role === 'admin',
      suspended: isSuspendedNow(platform.restrictions.find((r) => r.userId === u.id)),
      frozen: !!platform.restrictions.find((r) => r.userId === u.id)?.payoutsFrozen,
    }));
  const managed = accounts.find((a) => a.id === managing);

  // Sign-ups per country (fans and creators), most first. Accounts from before
  // the country question count as "Sin país".
  const byCountry = Object.values(
    accounts
      .filter((u) => u.role !== 'admin')
      .reduce<Record<string, { country: string; fans: number; creators: number; phones: number }>>((acc, u) => {
        const key = u.country ?? '';
        const row = (acc[key] ??= { country: key, fans: 0, creators: 0, phones: 0 });
        if (u.role === 'creator') row.creators += 1;
        else row.fans += 1;
        if (u.phone) row.phones += 1;
        return acc;
      }, {})
  ).sort((a, b) => b.fans + b.creators - (a.fans + a.creators) || (a.country ? 0 : 1) - (b.country ? 0 : 1));

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
        <p className="text-xs text-gray-500">{displayEmail(v.email)} • {roleName[v.role]} • {ago(v.submittedAt)}</p>
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
            <h1 className="text-2xl font-bold text-gray-900">Panel de administración</h1>
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

        {/* Tabs */}
        <div className="flex space-x-1 bg-white rounded-xl p-1 shadow-sm mb-8 overflow-x-auto">
          {[
            { id: 'overview', label: 'Resumen', icon: 'fa-chart-pie' },
            { id: 'ledger', label: 'Libro', icon: 'fa-book' },
            { id: 'verifications', label: `Verificaciones (${pendingVerifications.length})`, icon: 'fa-id-card' },
            { id: 'reports', label: `Reportes (${pendingReports.length})`, icon: 'fa-flag' },
            { id: 'payouts', label: 'Retiros', icon: 'fa-money-check-alt' },
            { id: 'managed', label: 'Perfiles gestionados', icon: 'fa-robot' },
            { id: 'special', label: 'Cuentas especiales', icon: 'fa-star' },
            { id: 'users', label: 'Usuarios', icon: 'fa-users' },
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
          <AdminOverview
            accounts={accounts}
            transactions={platform.transactions}
            coins={platform.coins}
            payouts={platform.payouts}
            pending={{ verifications: pendingVerifications.length, reports: pendingReports.length, disputes: moneyBack.filter((t) => !t.platformCovers).length }}
            onOpen={(tab) => { setActiveTab(tab); setNotice(null); }}
          />
        )}

        {activeTab === 'ledger' && <AdminLedger transactions={platform.transactions} coins={platform.coins.map((c) => ({ ...c, userName: accounts.find((a) => a.id === c.userId)?.name }))} payouts={platform.payouts} />}

        {/* Verifications */}
        {activeTab === 'verifications' && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden" data-testid="admin-verifications">
            <div className="p-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Gestión de verificaciones</h3>
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
                      <span className="text-gray-700">{v.userName} · {displayEmail(v.email)}</span>
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
              <h3 className="font-bold text-gray-900">Gestión de reportes</h3>
              <p className="text-sm text-gray-600 mt-1">Reportes enviados desde las publicaciones, los perfiles y el Centro de ayuda</p>
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
          <>
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-6" data-testid="admin-money-back">
            <div className="p-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Reembolsos, contracargos y disputas</h3>
              <p className="text-sm text-gray-600 mt-1">
                PayPal los descuenta solos al creador. Si no fue su culpa (fraude con tarjeta robada, un fallo nuestro), márcalo y conserva su parte: la pérdida la asume Fans Reserve.
              </p>
            </div>
            <div className="divide-y divide-gray-100">
              {moneyBack.length === 0 && <p className="p-6 text-center text-sm text-gray-500">No hay reembolsos ni disputas</p>}
              {moneyBack.map((t) => (
                <div key={t.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2" data-testid="money-back-row">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{transactionLabel[t.kind]} · {t.payerName} → {t.creatorName} · {money(t.amount)}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(t.createdAt).toLocaleDateString('es')} • {t.status === 'disputed' ? 'En disputa con PayPal' : 'Reembolsado al fan'} • Parte del creador {money(creatorCut(t))}
                    </p>
                  </div>
                  {t.platformCovers ? (
                    <button onClick={() => toggleCover(t.id, false)} className="text-xs px-3 py-1.5 rounded-full bg-green-100 text-green-700 font-medium">
                      <i aria-hidden="true" className="fas fa-shield-alt mr-1"></i>Lo cubre Fans Reserve · Deshacer
                    </button>
                  ) : (
                    <button onClick={() => toggleCover(t.id, true)} className="text-xs px-3 py-1.5 rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium">
                      No fue culpa del creador
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden" data-testid="admin-payouts">
            <div className="p-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Retiros de creadores</h3>
              <p className="text-sm text-gray-600 mt-1">Registro automático: el creador retira su saldo completo (desde $50) a su cuenta PayPal; PayPal confirma cada envío.</p>
            </div>
            <div className="divide-y divide-gray-100">
              {payouts.length === 0 && <p className="p-6 text-center text-sm text-gray-500">No hay solicitudes de retiro</p>}
              {payouts.map((p) => (
                <div key={p.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{p.creatorName} · {money(p.amount)}</p>
                    <p className="text-xs text-gray-500">
                      {p.accountLabel} • Disponía de {money(p.availableBefore)}
                      {p.fee > 0 && ` • Comisión PayPal ${money(p.fee)}`}
                      {p.paidAt && ` • Pagado el ${new Date(p.paidAt).toLocaleDateString('es')}`}
                    </p>
                  </div>
                  {p.status === 'paid' ? (
                    <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">
                      <i aria-hidden="true" className="fas fa-check-circle mr-1"></i>Pagado
                    </span>
                  ) : p.status === 'sending' ? (
                    <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700">En camino</span>
                  ) : (
                    <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700">No se pudo enviar</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          </>
        )}

        {/* Document review */}
        {viewing && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Revisar documentos">
            <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{viewing.userName}</h3>
                  <p className="text-sm text-gray-500">{displayEmail(viewing.email)} • {roleName[viewing.role]}</p>
                </div>
                <button onClick={() => setViewing(null)} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600"><i aria-hidden="true" className="fas fa-times"></i></button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <p><span className="text-gray-500">Nombre legal:</span> {viewing.legalName}</p>
                <p><span className="text-gray-500">Nacimiento:</span> {viewing.birthDate ? `${new Date(viewing.birthDate + 'T00:00:00').toLocaleDateString('es')} (${ageFrom(viewing.birthDate)} años)` : 'Sin leer'}</p>
                <p><span className="text-gray-500">Documento:</span> {docTypeLabel[viewing.docType]}</p>
                <p><span className="text-gray-500">País:</span> {viewing.country || 'Sin indicar'}{viewing.docNumber ? ` · Nº ${viewing.docNumber}` : ''}</p>
              </div>
              {viewing.provider === 'didit' && (
                <p className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-2">
                  Didit la dejó en revisión manual: las fotos, el video de vida y el detalle están en tu panel de Didit (busca a este usuario por su nombre o correo).
                </p>
              )}
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

        {activeTab === 'special' && <SpecialAccountsAdmin accounts={accounts} transactions={platform.transactions} />}

        {activeTab === 'users' && (
          <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden" data-testid="admin-countries">
            <div className="p-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Usuarios por país</h3>
              <p className="text-xs text-gray-500 mt-1">Del registro. El teléfono es opcional y solo lo ve el equipo.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th scope="col" className="px-5 py-2 text-left font-medium">País</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">Fans</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">Creadores</th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">Con teléfono</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {byCountry.map((r) => (
                    <tr key={r.country || 'none'}>
                      <td className="px-5 py-2 text-gray-900">{countryLabel(r.country)}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{r.fans}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{r.creators}</td>
                      <td className="px-5 py-2 text-right tabular-nums">{r.phones}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <h3 className="font-bold text-gray-900">Gestión de usuarios</h3>
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
                <div key={u.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-gray-50" data-testid="admin-user-row">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                      <i aria-hidden="true" className="fas fa-user text-gray-400"></i>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{u.name}</p>
                      <p className="text-xs text-gray-500">
                        {displayEmail(u.email)} • {u.role} • {countryLabel(u.country)}{u.phone ? ` • ${u.phone}` : ''} • Registrado: {u.date}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {u.suspended && <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700">Suspendida</span>}
                    {u.frozen && <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700">Retiros congelados</span>}
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      u.status === 'active' ? 'bg-green-100 text-green-700' :
                      u.status === 'verified' ? 'bg-blue-100 text-blue-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {u.status === 'active' ? 'Activo' : u.status === 'verified' ? 'Verificado' : 'Pendiente'}
                    </span>
                    {!u.isAdmin && (
                      <button onClick={() => setManaging(u.id)} className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-700">
                        <i aria-hidden="true" className="fas fa-user-cog mr-1"></i> Gestionar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          </div>
        )}

        {managed && user && (
          <AdminUserSheet
            admin={user}
            target={managed}
            restriction={platform.restrictions.find((r) => r.userId === managed.id)}
            history={platform.adminActions.filter((a) => a.userId === managed.id)}
            transactions={platform.transactions}
            onClose={() => setManaging(null)}
            onDone={(text) => {
              reloadAccounts();
              setNotice({ ok: true, text });
              setManaging(null);
            }}
          />
        )}

      </div>
    </div>
  );
};

export default AdminDashboard;
