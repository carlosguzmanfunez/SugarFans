import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth, defaultSettings, UserSettings } from '../context/AuthContext';
import { useCreatorCatalog } from '../lib/catalog';
import IdentityVerification from '../components/IdentityVerification';
import WalletPanel from '../components/WalletPanel';
import PaymentMethodForm, { paymentKindIcon } from '../components/PaymentMethodForm';
import {
  usePlatformQuery,
  platformApi,
  removePaymentMethod,
  setDefaultPaymentMethod,
  unblockUser,
  exportUserData,
  nextRenewal,
  money,
  transactionLabel,
  computeEarnings,
} from '../lib/platform';
import { BRAND } from '../config/brand';
import { VIRTUAL_CURRENCY, displayMethodLabel } from '../config/currency';
import { displayEmail, isDemoEmail } from '../config/demoAccounts';

const notificationItems: { key: string; label: string }[] = [
  { key: 'newPosts', label: 'Nuevas publicaciones de creadores que sigues' },
  { key: 'messages', label: 'Mensajes privados' },
  { key: 'tips', label: 'Propinas recibidas' },
  { key: 'subscribers', label: 'Nuevos suscriptores' },
  { key: 'promotions', label: 'Promociones y ofertas' },
  { key: 'platform', label: 'Actualizaciones de la plataforma' },
  { key: 'email', label: 'Notificaciones por email' },
  { key: 'push', label: 'Notificaciones push' },
];

const sections = ['profile', 'security', 'verification', 'notifications', 'privacy', 'payments', 'wallet', 'blocking'];

const fmtDate = (iso: string | Date) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

const PROVIDER_LABELS: Record<string, string> = { google: 'Google', azure: 'Microsoft' };

const Settings: React.FC = () => {
  const { user, updateUser, changePassword, deleteAccount, cancelSubscription } = useAuth();
  // Accounts created with Google/Microsoft have no password to change or confirm.
  const socialProvider = user?.authProvider && user.authProvider !== 'email' ? PROVIDER_LABELS[user.authProvider] ?? user.authProvider : null;
  const { creators } = useCreatorCatalog();
  const userId = user?.id ?? '';
  const { data: platform } = usePlatformQuery(
    async () => {
      if (!user) return { methods: [], payments: [], blocks: [], unpaid: 0 };
      const creatorId = user.role === 'creator' ? user.creatorProfileId : undefined;
      const [methods, payments, blocks, sales, payouts] = await Promise.all([
        platformApi.paymentMethods(user.id),
        platformApi.myPayments(user.id),
        platformApi.blocks(user),
        creatorId ? platformApi.creatorSales(creatorId) : Promise.resolve([]),
        creatorId ? platformApi.myPayouts(user.id) : Promise.resolve([]),
      ]);
      // Earnings not withdrawn yet (credited + pending), lost if the account is deleted.
      const e = computeEarnings(sales, payouts);
      const unpaid = Math.max(0, e.available) + e.pending;
      return { methods, payments, blocks: blocks.filter((b) => b.blockerId === user.id), unpaid };
    },
    [userId],
    {
      methods: [] as Awaited<ReturnType<typeof platformApi.paymentMethods>>,
      payments: [] as Awaited<ReturnType<typeof platformApi.myPayments>>,
      blocks: [] as Awaited<ReturnType<typeof platformApi.blocks>>,
      unpaid: 0,
    }
  );
  const [addingMethod, setAddingMethod] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSection = searchParams.get('section');
  const [activeSection, setActiveSectionState] = useState(
    initialSection && sections.includes(initialSection) ? initialSection : 'profile'
  );
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  // Profile form (controlled, so "Guardar" actually saves what was typed)
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [price, setPrice] = useState(String(user?.subscriptionPrice ?? 9.99));
  const [avatarSeed, setAvatarSeed] = useState('');

  // Security form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Delete account
  const [showDelete, setShowDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const settings: UserSettings = user?.settings ?? defaultSettings();

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(''), 3000);
    return () => clearTimeout(t);
  }, [saved]);

  const setActiveSection = (id: string) => {
    setActiveSectionState(id);
    setError('');
    setSearchParams({ section: id }, { replace: true });
  };

  const showResult = (result: { ok: boolean; error?: string }, message = 'Cambios guardados exitosamente') => {
    if (result.ok) {
      setError('');
      setSaved(message);
    } else {
      setSaved('');
      setError(result.error || 'No se pudieron guardar los cambios');
    }
    return result.ok;
  };

  const handleSaveProfile = async () => {
    const data: Parameters<typeof updateUser>[0] = { name, email };
    if (avatarSeed) data.avatar = `https://api.dicebear.com/7.0/adventurer/svg?seed=${encodeURIComponent(avatarSeed)}`;
    if (user?.role === 'creator') {
      data.bio = bio;
      const parsed = parseFloat(price);
      if (Number.isNaN(parsed)) return showResult({ ok: false, error: 'Introduce un precio válido' });
      data.subscriptionPrice = Math.round(parsed * 100) / 100;
    }
    const result = await updateUser(data);
    if (showResult(result, result.notice || undefined)) setAvatarSeed('');
  };

  const handleSaveSecurity = async () => {
    if (!currentPassword && !newPassword && !confirmPassword) {
      return showResult({ ok: false, error: 'Escribe tu contraseña actual y la nueva' });
    }
    if (newPassword !== confirmPassword) {
      return showResult({ ok: false, error: 'Las contraseñas nuevas no coinciden' });
    }
    if (showResult(await changePassword(currentPassword, newPassword), 'Contraseña actualizada')) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  const updateSettings = async (next: Partial<UserSettings>) => {
    showResult(await updateUser({ settings: { ...settings, ...next } }), 'Preferencia guardada');
  };

  const handleDelete = async () => {
    if (deleteConfirm !== 'ELIMINAR') {
      return showResult({ ok: false, error: 'Escribe ELIMINAR para confirmar' });
    }
    const result = await deleteAccount(deletePassword);
    if (result.ok) navigate('/', { replace: true });
    else showResult(result);
  };

  const downloadMyData = async () => {
    if (!user) return;
    const blob = new Blob([JSON.stringify(await exportUserData(user), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${BRAND.compactName.toLowerCase()}-mis-datos-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setSaved('Descarga de tus datos iniciada');
  };

  const { methods: myMethods, payments: myPayments, blocks: myBlocks } = platform;
  const mySubscriptions = (user?.subscriptions ?? []).map((sub) => ({
    sub,
    name: creators.find((c) => c.id === sub.creatorId)?.name ?? 'Creador',
  }));

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">Configuración</h1>

        {saved && (
          <div role="status" className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl mb-6 flex items-center">
            <i aria-hidden="true" className="fas fa-check-circle mr-2"></i> {saved}
          </div>
        )}
        {error && (
          <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-6 flex items-center">
            <i aria-hidden="true" className="fas fa-exclamation-circle mr-2"></i> {error}
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-6">
          {/* Sidebar */}
          <div className="md:w-64 flex-shrink-0">
            <div className="bg-white rounded-2xl shadow-sm p-4 space-y-1">
              {[
                { id: 'profile', label: 'Perfil', icon: 'fa-user' },
                { id: 'security', label: 'Seguridad', icon: 'fa-lock' },
                { id: 'verification', label: 'Verificación', icon: 'fa-id-card' },
                { id: 'notifications', label: 'Notificaciones', icon: 'fa-bell' },
                { id: 'privacy', label: 'Privacidad', icon: 'fa-eye-slash' },
                { id: 'payments', label: 'Pagos', icon: 'fa-credit-card' },
                { id: 'wallet', label: VIRTUAL_CURRENCY.displayName, icon: 'fa-coins' },
                { id: 'blocking', label: 'Bloqueos', icon: 'fa-ban' },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-sm font-medium transition ${
                    activeSection === item.id ? 'bg-pink-50 text-pink-700' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <i aria-hidden="true" className={`fas ${item.icon} w-5`}></i>
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1">
            {activeSection === 'profile' && (
              <div className="bg-white rounded-2xl shadow-sm p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-6">Editar Perfil</h2>
                <div className="flex items-center space-x-4 mb-6">
                  <img
                    src={avatarSeed ? `https://api.dicebear.com/7.0/adventurer/svg?seed=${encodeURIComponent(avatarSeed)}` : user?.avatar}
                    alt=""
                    className="w-20 h-20 rounded-full"
                  />
                  <div>
                    <button
                      type="button"
                      onClick={() => setAvatarSeed(Math.random().toString(36).slice(2, 10))}
                      className="text-sm text-pink-600 font-medium hover:text-pink-700"
                    >
                      Cambiar foto de perfil
                    </button>
                    <p className="text-xs text-gray-500 mt-1">Genera un nuevo avatar; se aplica al guardar</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                    <input type="text" name="name" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    {isDemoEmail(user?.email) ? (
                      <input type="text" readOnly value={displayEmail(user?.email)} aria-label="Correo de la cuenta demo" title="Las cuentas demo no cambian su correo" className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-gray-50 text-gray-500 outline-none" />
                    ) : (
                      <input type="email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none" />
                    )}
                  </div>
                  {user?.role === 'creator' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Biografía</label>
                        <textarea name="bio" value={bio} onChange={(e) => setBio(e.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none h-24 resize-none" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Precio de suscripción</label>
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                          <input type="number" name="price" min="0.99" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full pl-8 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none" />
                        </div>
                      </div>
                    </>
                  )}
                  <button onClick={handleSaveProfile} className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-medium hover:opacity-90 transition">
                    Guardar cambios
                  </button>
                </div>
              </div>
            )}

            {activeSection === 'security' && (
              <div className="bg-white rounded-2xl shadow-sm p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-6">Seguridad</h2>
                <div className="space-y-6">
                  {socialProvider ? (
                    <div data-testid="social-account-note">
                      <h3 className="font-medium text-gray-900 mb-2">Inicio de sesión</h3>
                      <p className="text-sm text-gray-600 bg-gray-50 rounded-xl p-4">
                        Entras con tu cuenta de {socialProvider}, así que no necesitas contraseña en {BRAND.name}. Para cambiar tu contraseña o la seguridad de tu cuenta, hazlo en {socialProvider}.
                      </p>
                    </div>
                  ) : (
                  <div>
                    <h3 className="font-medium text-gray-900 mb-2">Cambiar contraseña</h3>
                    <div className="space-y-3">
                      <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Contraseña actual" className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none" />
                      <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Nueva contraseña" className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none" />
                      <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirmar nueva contraseña" className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none" />
                    </div>
                  </div>
                  )}
                  {!socialProvider && (
                  <button onClick={handleSaveSecurity} className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-medium hover:opacity-90 transition">
                    Actualizar contraseña
                  </button>
                  )}
                </div>
              </div>
            )}

            {activeSection === 'verification' && <IdentityVerification />}

            {activeSection === 'notifications' && (
              <div className="bg-white rounded-2xl shadow-sm p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-6">Notificaciones</h2>
                <div className="space-y-4">
                  {notificationItems.map((item) => (
                    <div key={item.key} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                      <span className="text-sm text-gray-700">{item.label}</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          aria-label={item.label}
                          checked={!!settings.notifications[item.key]}
                          onChange={(e) => updateSettings({ notifications: { ...settings.notifications, [item.key]: e.target.checked } })}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-pink-300 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-500"></div>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeSection === 'privacy' && (
              <div className="bg-white rounded-2xl shadow-sm p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-6">Privacidad</h2>
                <div className="space-y-4">
                  <div className="flex items-center justify-between py-3 border-b border-gray-100">
                    <div>
                      <p className="text-sm font-medium text-gray-700">Perfil visible</p>
                      <p className="text-xs text-gray-500">Tu perfil puede ser encontrado en búsquedas</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        aria-label="Perfil visible"
                        checked={settings.privacy.profileVisible}
                        onChange={(e) => updateSettings({ privacy: { ...settings.privacy, profileVisible: e.target.checked } })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-500"></div>
                    </label>
                  </div>
                  <div className="flex items-center justify-between py-3 border-b border-gray-100">
                    <div>
                      <p className="text-sm font-medium text-gray-700">Mostrar actividad</p>
                      <p className="text-xs text-gray-500">Otros pueden ver cuándo estás en línea</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        aria-label="Mostrar actividad"
                        checked={settings.privacy.showActivity}
                        onChange={(e) => updateSettings({ privacy: { ...settings.privacy, showActivity: e.target.checked } })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-500"></div>
                    </label>
                  </div>
                  <div className="flex items-center justify-between py-3 border-b border-gray-100">
                    <div>
                      <p className="text-sm font-medium text-gray-700">Protección de contenido</p>
                      <p className="text-xs text-gray-500">Deshabilita capturas de pantalla en tu contenido</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        aria-label="Protección de contenido"
                        checked={settings.privacy.contentProtection}
                        onChange={(e) => updateSettings({ privacy: { ...settings.privacy, contentProtection: e.target.checked } })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-500"></div>
                    </label>
                  </div>
                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-700">Descargar mis datos</p>
                      <p className="text-xs text-gray-500">Copia de tu cuenta, pagos, verificación y bloqueos en formato JSON (GDPR)</p>
                    </div>
                    <button type="button" onClick={downloadMyData} className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200">
                      <i aria-hidden="true" className="fas fa-download mr-1"></i> Descargar
                    </button>
                  </div>
                  <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-xl">
                    <h3 className="font-medium text-red-800 mb-2">Zona de peligro</h3>
                    <p className="text-sm text-red-600 mb-3">Eliminar tu cuenta es permanente y no se puede deshacer.</p>
                    {platform.unpaid > 0 && (
                      <p data-testid="delete-balance-warning" className="text-sm font-medium text-red-700 mb-3">
                        Tienes {money(platform.unpaid)} de ganancias sin retirar. Si eliminas la cuenta los perderás: retíralas antes desde tu panel de creador.
                      </p>
                    )}
                    {!showDelete ? (
                      <button
                        type="button"
                        onClick={() => setShowDelete(true)}
                        className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition"
                      >
                        Eliminar mi cuenta
                      </button>
                    ) : (
                      <div className="space-y-3">
                        {!socialProvider && (
                        <input
                          type="password"
                          autoComplete="current-password"
                          value={deletePassword}
                          onChange={(e) => setDeletePassword(e.target.value)}
                          placeholder="Tu contraseña"
                          className="w-full px-4 py-2 border border-red-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-400"
                        />
                        )}
                        <input
                          type="text"
                          value={deleteConfirm}
                          onChange={(e) => setDeleteConfirm(e.target.value)}
                          placeholder="Escribe ELIMINAR para confirmar"
                          className="w-full px-4 py-2 border border-red-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-400"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => { setShowDelete(false); setDeletePassword(''); setDeleteConfirm(''); setError(''); }}
                            className="px-4 py-2 rounded-lg text-sm font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={handleDelete}
                            className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition"
                          >
                            Eliminar definitivamente
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'payments' && user && (
              <div className="space-y-6">
                <div className="bg-white rounded-2xl shadow-sm p-6" data-testid="payment-methods">
                  <h2 className="text-lg font-bold text-gray-900 mb-2">Métodos de Pago</h2>
                  <p className="text-sm text-gray-500 mb-6">Aceptamos tarjetas Visa y Mastercard, PayPal y Google Pay.</p>
                  <div className="space-y-3">
                    {myMethods.length === 0 && <p className="text-sm text-gray-500">Aún no tienes métodos de pago.</p>}
                    {myMethods.map((m) => (
                      <div key={m.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-xl">
                        <div className="flex items-center space-x-3">
                          <i className={`text-2xl text-gray-600 ${paymentKindIcon[m.kind]}`}></i>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{m.label}</p>
                            <p className="text-xs text-gray-500">{m.detail}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {m.isDefault ? (
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">Principal</span>
                          ) : (
                            <button type="button" onClick={() => setDefaultPaymentMethod(user, m.id)} className="text-xs text-pink-600 hover:text-pink-700">
                              Hacer principal
                            </button>
                          )}
                          <button type="button" aria-label={`Eliminar ${m.label}`} onClick={() => removePaymentMethod(user, m.id)} className="p-2 text-gray-400 hover:text-red-500">
                            <i aria-hidden="true" className="fas fa-trash"></i>
                          </button>
                        </div>
                      </div>
                    ))}
                    {addingMethod ? (
                      <PaymentMethodForm
                        user={user}
                        onAdded={() => { setAddingMethod(false); setSaved('Método de pago añadido'); }}
                        onCancel={() => setAddingMethod(false)}
                      />
                    ) : (
                      <button type="button" onClick={() => setAddingMethod(true)} className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-pink-300 hover:text-pink-500 transition">
                        <i aria-hidden="true" className="fas fa-plus mr-2"></i> Añadir método de pago
                      </button>
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm p-6" data-testid="settings-subscriptions">
                  <h2 className="text-lg font-bold text-gray-900 mb-2">Suscripciones</h2>
                  <p className="text-sm text-gray-500 mb-4">Se renuevan cada mes en la misma fecha en que te suscribiste. Puedes cancelar cuando quieras, sin permanencia: conservas el acceso hasta el final del mes que ya pagaste.</p>
                  {mySubscriptions.length === 0 ? (
                    <p className="text-sm text-gray-500">No tienes suscripciones activas.</p>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {mySubscriptions.map(({ sub, name }) => (
                        <div key={sub.creatorId} className="py-3 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-900">{name} · {money(sub.price)}/mes</p>
                            <p className="text-xs text-gray-500">
                              {sub.cancelAt ? `Cancelada: tienes acceso hasta el ${fmtDate(new Date(sub.cancelAt))}` : `Próxima renovación: ${fmtDate(nextRenewal(sub.since))}`}
                            </p>
                          </div>
                          {!sub.cancelAt && (
                            <button
                              type="button"
                              onClick={() => window.confirm(`¿Cancelar tu suscripción a ${name}? Seguirás viendo su contenido hasta el final del mes que ya pagaste.`) && cancelSubscription(sub.creatorId)}
                              className="text-xs text-red-600 hover:text-red-700"
                            >
                              Cancelar suscripción
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-2xl shadow-sm p-6" data-testid="payment-history">
                  <h2 className="text-lg font-bold text-gray-900 mb-4">Historial de pagos</h2>
                  {myPayments.length === 0 ? (
                    <p className="text-sm text-gray-500">Aún no has realizado pagos.</p>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {myPayments.map((t) => (
                        <div key={t.id} className="py-3 flex items-center justify-between text-sm">
                          <div>
                            <p className="font-medium text-gray-900">{transactionLabel[t.kind]} · {t.creatorName}</p>
                            <p className="text-xs text-gray-500">{fmtDate(t.createdAt)} · {displayMethodLabel(t.methodLabel)}</p>
                          </div>
                          <span className={t.status === 'paid' ? 'font-bold text-gray-900' : 'text-red-600 text-xs'}>
                            {t.status === 'paid' ? money(t.amount) : 'Pago fallido'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {user.role === 'creator' && (
                  <div className="bg-white rounded-2xl shadow-sm p-6">
                    <h2 className="text-lg font-bold text-gray-900 mb-2">Cuenta para retiros</h2>
                    <p className="text-sm text-gray-600">Tu saldo, tu cuenta PayPal y los retiros se gestionan en el panel de creador.</p>
                    <Link to="/creator/dashboard?tab=earnings" className="mt-3 inline-block bg-gradient-to-r from-pink-500 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90">
                      Gestionar retiros
                    </Link>
                  </div>
                )}
              </div>
            )}

            {activeSection === 'wallet' && user && <WalletPanel user={user} />}

            {activeSection === 'blocking' && (
              <div className="bg-white rounded-2xl shadow-sm p-6" data-testid="blocked-users">
                <h2 className="text-lg font-bold text-gray-900 mb-6">Usuarios Bloqueados</h2>
                {myBlocks.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <i aria-hidden="true" className="fas fa-shield-alt text-4xl text-gray-300 mb-3"></i>
                    <p>No has bloqueado a ningún usuario</p>
                    <p className="text-sm mt-1">Los usuarios bloqueados no podrán interactuar contigo</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {myBlocks.map((b) => (
                      <div key={b.targetId} className="py-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{b.targetName}</p>
                          <p className="text-xs text-gray-500">Bloqueado el {fmtDate(b.createdAt)}</p>
                        </div>
                        <button type="button" onClick={() => user && unblockUser(user, b.targetId)} className="text-sm text-pink-600 hover:text-pink-700">
                          Desbloquear
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
