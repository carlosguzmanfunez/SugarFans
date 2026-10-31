import { formatPayoutDate } from '../lib/payoutCalendar';
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AdminNavigation from '../components/AdminNavigation';
import AdminAttention from '../components/AdminAttention';
import AdminDataState from '../components/AdminDataState';
import { AdminConfirmation, AdminDialog, type AdminDecision } from '../components/AdminDialog';
import { adminSection, type AdminSection } from '../lib/adminWorkspace';
import { useAuth } from '../context/AuthContext';
import ManagedProfilesAdmin from '../components/ManagedProfilesAdmin';
import SpecialAccountsAdmin from '../components/SpecialAccountsAdmin';
import {
  usePlatformQuery,
  platformApi,
  reviewVerification,
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
import AdminReports from '../components/AdminReports';
import AdminLedger from '../components/AdminLedger';
import AdminFinance from '../components/AdminFinance';
import AdminModeration from '../components/AdminModeration';
import AdminErrors from '../components/AdminErrors';
import AdminInfra from '../components/AdminInfra';
import AdminProspects from '../components/AdminProspects';
import { backend } from '../lib/backend';
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

const roleName = { fan: 'Fan', creator: 'Creador', admin: 'Administrador' } as const;

const AdminDashboard: React.FC = () => {
  const [caseReference,setCaseReference]=useState<string>();
  const { user, listAccounts } = useAuth();
  const { data: accounts, reload: reloadAccounts, loading: accountsLoading, error: accountsError } = usePlatformQuery(listAccounts, [], []);
  const { data: platform, loading: platformLoading, error: platformError, reload: reloadPlatform } = usePlatformQuery(
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
  const { data: moderation, loading: moderationLoading, error: moderationError, reload: reloadModeration } = usePlatformQuery(() => backend.moderationQueue(), [], []);
  const pendingMedia = moderation.filter((m) => m.status === 'pending' || m.status === 'review').length;
  const [params, setParams] = useSearchParams();
  const activeTab = adminSection(params.get('section'));
  const setActiveTab = (section: AdminSection) => { setParams(previous => { const next = new URLSearchParams(previous); next.set('section', section); return next; }); setNotice(null); };
  const [decision, setDecision] = useState<AdminDecision | null>(null);
  const [userPage, setUserPage] = useState(0);
  const [userFilter, setUserFilter] = useState('all');
  const [userQuery, setUserQuery] = useState('');
  const [viewing, setViewing] = useState<VerificationRequest | null>(null);
  const [managing, setManaging] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const pendingVerifications = platform.verifications.filter((v) => v.status === 'pending');
  const reports = [...platform.reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pendingReports = reports.filter((r) => r.status === 'pending');
  const payouts = [...platform.payouts].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  // Sales PayPal gave back to the fan (refund, chargeback) or froze (dispute).
  const moneyBack = platform.transactions.filter((t) => (t.status === 'refunded' || t.status === 'disputed') && t.kind !== 'referral');
  const reviewMoney = moneyBack.filter(t => t.status === 'disputed').length;
  const pendingTotal = pendingVerifications.length + pendingReports.length + pendingMedia + reviewMoney;
  const loading = accountsLoading || platformLoading || moderationLoading;
  const loadError = accountsError || platformError || moderationError;
  // A failed content query must not hide the independent payments or error panels.
  const independent = activeTab === 'finance' || activeTab === 'errors' || activeTab === 'prospects';
  const sectionLoading = independent ? false : activeTab === 'moderation' ? moderationLoading : activeTab === 'overview' ? loading : accountsLoading || platformLoading;
  const sectionError = independent ? '' : activeTab === 'moderation' ? moderationError : activeTab === 'overview' ? loadError : accountsError || platformError;
  const refresh = () => { void Promise.all([reloadAccounts(), reloadPlatform(), reloadModeration()]); };
  const toggleCover = (id: string, cover: boolean) => {
    const sale = moneyBack.find(t => t.id === id);
    if (!sale) return;
    setDecision({ title: 'Revisar quién asume esta devolución', person: `${sale.creatorName} · Venta ${money(sale.amount)}`,
      effect: cover ? 'Fans Reserve asumirá la cobertura y el creador conservará la parte prevista por esta operación.' : 'Se retirará la cobertura de Fans Reserve y se reflejará la pérdida correspondiente al creador.',
      after: 'La responsabilidad debe estar comprobada. La revisión no devuelve ni envía dinero mediante PayPal.', label: 'Confirmar responsabilidad',
      run: () => coverRefund(id, cover) });
  };

  const matchingUsers = [...accounts]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((u) => {
      const q = userQuery.trim().toLowerCase();
      const matches = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
      const restriction = platform.restrictions.find(r => r.userId === u.id);
      return matches && (userFilter === 'all' || userFilter === u.role || userFilter === 'restricted' && (isSuspendedNow(restriction) || restriction?.payoutsFrozen));
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
      isAdmin: u.role === 'admin' || (u.id === user?.id && user?.isOwner === true),
      suspended: isSuspendedNow(platform.restrictions.find((r) => r.userId === u.id)),
      frozen: !!platform.restrictions.find((r) => r.userId === u.id)?.payoutsFrozen,
    }));
  const pageCount = Math.max(1, Math.ceil(matchingUsers.length / 20));
  const currentPage = Math.min(userPage, pageCount - 1);
  const recentUsers = matchingUsers.slice(currentPage * 20, currentPage * 20 + 20);
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

  const review = (v: VerificationRequest, approve: boolean) => {
    const reason = rejectReason.trim();
    if (!approve && !reason) { setNotice({ok:false,text:'Explica el motivo antes de rechazar la solicitud.'}); return; }
    setDecision({ title: approve ? 'Aprobar identidad' : 'Rechazar solicitud de identidad', person: v.userName,
      effect: approve ? 'Se aprobará su identidad y podrá continuar con las funciones que requieren verificación. Confirma que revisaste su documento, su rostro y su mayoría de edad.' : `La solicitud no se aprobará. Motivo: ${reason}`,
      after: 'La decisión quedará registrada. No se envía dinero ni se eliminan otros controles de la cuenta.', label: approve ? 'Confirmar identidad aprobada' : 'Confirmar rechazo',
      run: async () => { const result = await reviewVerification(v.id, approve, reason); if (result.ok) { setViewing(null); setRejectReason(''); } return result; } });
  };

  const verificationRow = (v: VerificationRequest, compact = false) => (
    <div key={v.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-gray-50">
      <div>
        <p className="font-medium text-gray-900 text-sm">
          {v.userName}
          <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-normal ${v.provider === 'didit' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
            {v.provider === 'didit' ? 'Didit pidió revisión' : 'Formulario manual'}
          </span>
        </p>
        <p className="text-xs text-gray-500">{displayEmail(v.email)} • {roleName[v.role]} • {ago(v.submittedAt)}</p>
        {!compact && <p className="text-xs text-gray-400">{docTypeLabel[v.docType]} • {v.country}</p>}
      </div>
      <button onClick={() => { setViewing(v); setRejectReason(''); }} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200">
        <i aria-hidden="true" className="fas fa-eye mr-1"></i> Revisar documentos
      </button>
    </div>
  );

  return (
    <div className="admin-workspace min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Panel de administración</h1>
            <p className="text-gray-600">Bienvenido, {user?.name}</p>
          </div>
          <div className="mt-4 sm:mt-0 flex flex-wrap items-center gap-2">
            <button type="button" onClick={refresh} disabled={loading} className="min-h-11 whitespace-nowrap px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50">{loading ? 'Consultando…' : 'Actualizar todo'}</button>
            <span className={`${pendingTotal > 0 ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-700'} px-3 py-2 rounded-lg text-sm font-medium`}>
              {loading ? 'Consultando pendientes' : loadError ? 'Pendientes sin confirmar' : `${pendingTotal} pendientes en esta consulta`}
            </span>
          </div>
        </div>

        {notice && (
          <div role={notice.ok ? 'status' : 'alert'} className={`px-4 py-3 rounded-xl mb-6 border ${notice.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {notice.text}
          </div>
        )}

        <AdminNavigation section={activeTab} onOpen={section => { setCaseReference(undefined); setActiveTab(section); }} counts={loading || loadError ? {} : { verifications: pendingVerifications.length, reports: pendingReports.length, moderation: pendingMedia, payouts: reviewMoney }} />

        <AdminDataState loading={sectionLoading} error={sectionError} onRetry={refresh}>

        {/* Overview */}
        {activeTab === 'overview' && (
          <>
          <AdminAttention counts={{ verifications: pendingVerifications.length, reports: pendingReports.length, moderation: pendingMedia, payouts: reviewMoney }} onOpen={section => { setCaseReference(undefined); setActiveTab(section); }} />
          <details className="group"><summary className="min-h-11 py-3 font-semibold text-gray-900 cursor-pointer">Ver cuentas y actividad del periodo</summary>
          <AdminOverview
            accounts={accounts}
            transactions={platform.transactions}
            coins={platform.coins}
            payouts={platform.payouts}
            pending={{ verifications: pendingVerifications.length, reports: pendingReports.length, disputes: moneyBack.filter((t) => !t.platformCovers).length, media: pendingMedia }}
            onOpen={(tab) => { setActiveTab(adminSection(tab)); }}
          />
          </details></>
        )}

        {activeTab === 'moderation' && <AdminModeration />}

        {activeTab === 'errors' && <AdminErrors />}
        {activeTab === 'finance' && <AdminFinance caseReference={caseReference}/>}

        {activeTab === 'prospects' && <AdminProspects />}

        {activeTab === 'infra' && <AdminInfra transactions={platform.transactions} coins={platform.coins} />}

        {activeTab === 'ledger' && <AdminLedger transactions={platform.transactions} coins={platform.coins.map((c) => ({ ...c, userName: accounts.find((a) => a.id === c.userId)?.name }))} payouts={platform.payouts} />}

        {/* Verifications */}
        {activeTab === 'verifications' && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden" data-testid="admin-verifications">
            <div className="p-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Verificar identidades</h3>
              <p className="text-sm text-gray-600 mt-1">Didit aprueba solo a los creadores mayores de edad. Aquí llegan únicamente los casos que Didit deja en revisión o los del formulario manual de respaldo: compara la cara del selfie con la foto del documento y confirma que es mayor de edad antes de aprobar.</p>
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
                    <div key={v.id} className="flex flex-col sm:flex-row sm:justify-between gap-1 text-sm" data-testid="reviewed-verification">
                      <span className="text-gray-700">
                        {v.userName} · {displayEmail(v.email)}
                        <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${v.provider === 'didit' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                          {v.provider === 'didit' ? 'Con Didit (automático)' : 'Formulario manual (revisado a mano)'}
                        </span>
                      </span>
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

        {activeTab === 'reports' && <AdminReports reports={reports} removedPosts={platform.removedPosts} />}

        {/* Payouts */}
        {activeTab === 'payouts' && (
          <>
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-6" data-testid="admin-money-back">
            <div className="p-5 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">Reembolsos, contracargos y disputas</h3>
              <p className="text-sm text-gray-600 mt-1">
                El estado confirmado por PayPal se refleja en el saldo. Revisa la causa, la evidencia y la responsabilidad en su expediente; si no fue culpa del creador, se aplica la cobertura de Fans Reserve prevista en el contrato.
              </p>
            </div>
            <div className="divide-y divide-gray-100">
              {moneyBack.length === 0 && <p className="p-6 text-center text-sm text-gray-500">No hay reembolsos ni disputas</p>}
              {moneyBack.map((t) => (
                <div key={t.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2" data-testid="money-back-row">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{transactionLabel[t.kind]} · {t.payerName} → {t.creatorName} · {money(t.amount)}</p>
                    <p className="text-xs text-gray-500">
                      {formatPayoutDate(t.createdAt)} • {t.status === 'disputed' ? 'En disputa con PayPal' : 'Reembolsado al fan'} • Parte del creador {money(creatorCut(t))}
                    </p>
                  </div>
                  {backend.finance.caseList?<button type="button" onClick={()=>{setCaseReference(t.id);setActiveTab('finance');}} className="text-xs px-3 py-1.5 rounded-full border border-gray-300 text-gray-700">Revisar expediente{t.platformCovers?' · Con cobertura':''}</button>:t.platformCovers ? (
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
                      {p.paidAt && ` • Pagado el ${formatPayoutDate(p.paidAt)}`}
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
          <AdminDialog title={`Revisar identidad de ${viewing.userName}`} onClose={() => setViewing(null)} wide>
              <p className="text-sm text-gray-600 mb-4">{displayEmail(viewing.email)} · {roleName[viewing.role]}</p>
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
                aria-label="Motivo del rechazo" placeholder="Motivo del rechazo (obligatorio para rechazar)"
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
          </AdminDialog>
        )}

        {/* Users */}
        {activeTab === 'managed' && <ManagedProfilesAdmin transactions={platform.transactions} />}

        {activeTab === 'special' && <SpecialAccountsAdmin accounts={accounts} transactions={platform.transactions} />}

        {activeTab === 'users' && (
          <div className="space-y-6">
          <details className="bg-white rounded-2xl shadow-sm overflow-hidden" data-testid="admin-countries"><summary className="p-5 min-h-11 font-semibold cursor-pointer">Ver personas por país</summary>
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
          </details>
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <h3 className="font-bold text-gray-900">Buscar personas</h3>
              <div className="relative">
                <i aria-hidden="true" className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                <input aria-label="Buscar por nombre o correo" type="search" value={userQuery} onChange={(e) => { setUserQuery(e.target.value); setUserPage(0); }} placeholder="Nombre o correo" className="min-h-11 w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-pink-500 outline-none" />
              </div>
            </div>
            <div className="px-5 py-3 flex flex-wrap items-center gap-3 text-sm border-b border-gray-100"><label>Mostrar <select aria-label="Tipo de persona" value={userFilter} onChange={e => { setUserFilter(e.target.value); setUserPage(0); }} className="min-h-11 border border-gray-300 rounded-lg px-2 ml-2"><option value="all">Todas</option><option value="creator">Creadores</option><option value="fan">Fans</option><option value="admin">Administradores</option><option value="restricted">Con restricciones</option></select></label><p className="text-gray-600">{matchingUsers.length} resultados entre las personas cargadas.</p></div>
            <div className="divide-y divide-gray-100">
              {recentUsers.length === 0 && (
                <p className="p-6 text-center text-sm text-gray-500">No hay personas que coincidan con estos filtros. Prueba otro nombre, correo o tipo de cuenta.</p>
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
                    {(
                      <button onClick={() => setManaging(u.id)} className="min-h-11 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700">
                        Abrir ficha
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-t border-gray-100 text-sm"><p>Página {currentPage + 1} de {pageCount}</p><div className="flex gap-2"><button type="button" disabled={currentPage === 0} onClick={() => setUserPage(currentPage - 1)} className="min-h-11 px-3 border rounded-lg disabled:opacity-40">Anterior</button><button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setUserPage(currentPage + 1)} className="min-h-11 px-3 border rounded-lg disabled:opacity-40">Siguiente</button></div></div>
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
            payouts={platform.payouts}
            verifications={platform.verifications.filter(v => v.userId === managed.id)}
            readOnly={managed.role === 'admin' || managed.isOwner === true || managed.id === user.id}
            onVerification={() => { setManaging(null); setActiveTab('verifications'); }}
            onClose={() => setManaging(null)}
            onReviewPayouts={backend.finance.caseList?()=>{setCaseReference(managed.id);setActiveTab('finance');setManaging(null);}:undefined}
            onDone={(text) => {
              reloadAccounts();
              setNotice({ ok: true, text });
              setManaging(null);
            }}
          />
        )}

        {decision && <AdminConfirmation decision={decision} onClose={() => setDecision(null)} onDone={() => { setDecision(null); refresh(); setNotice({ ok: true, text: 'Cambio confirmado y guardado.' }); }} />}
        </AdminDataState>

      </div>
    </div>
  );
};

export default AdminDashboard;
