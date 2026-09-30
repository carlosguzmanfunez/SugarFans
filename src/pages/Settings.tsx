import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, defaultSettings, UserSettings } from '../context/AuthContext';

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

const sections = ['profile', 'security', 'notifications', 'privacy', 'payments', 'blocking'];

const Settings: React.FC = () => {
  const { user, updateUser, changePassword, deleteAccount } = useAuth();
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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">Configuración</h1>

        {saved && (
          <div role="status" className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl mb-6 flex items-center">
            <i className="fas fa-check-circle mr-2"></i> {saved}
          </div>
        )}
        {error && (
          <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-6 flex items-center">
            <i className="fas fa-exclamation-circle mr-2"></i> {error}
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-6">
          {/* Sidebar */}
          <div className="md:w-64 flex-shrink-0">
            <div className="bg-white rounded-2xl shadow-sm p-4 space-y-1">
              {[
                { id: 'profile', label: 'Perfil', icon: 'fa-user' },
                { id: 'security', label: 'Seguridad', icon: 'fa-lock' },
                { id: 'notifications', label: 'Notificaciones', icon: 'fa-bell' },
                { id: 'privacy', label: 'Privacidad', icon: 'fa-eye-slash' },
                { id: 'payments', label: 'Pagos', icon: 'fa-credit-card' },
                { id: 'blocking', label: 'Bloqueos', icon: 'fa-ban' },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-sm font-medium transition ${
                    activeSection === item.id ? 'bg-pink-50 text-pink-700' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <i className={`fas ${item.icon} w-5`}></i>
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
                    <input type="email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none" />
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
                  <div>
                    <h3 className="font-medium text-gray-900 mb-2">Cambiar contraseña</h3>
                    <div className="space-y-3">
                      <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Contraseña actual" className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none" />
                      <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Nueva contraseña" className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none" />
                      <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirmar nueva contraseña" className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none" />
                    </div>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900 mb-2">Autenticación de dos factores</h3>
                    <div className="flex items-center justify-between bg-gray-50 rounded-xl p-4">
                      <div>
                        <p className="text-sm text-gray-700">2FA con aplicación autenticadora</p>
                        <p className="text-xs text-gray-500">Añade una capa extra de seguridad</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateSettings({ twoFactor: !settings.twoFactor })}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                          settings.twoFactor ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-pink-100 text-pink-700 hover:bg-pink-200'
                        }`}
                      >
                        {settings.twoFactor ? 'Activado · Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900 mb-2">Sesiones activas</h3>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between bg-gray-50 rounded-xl p-4">
                        <div className="flex items-center space-x-3">
                          <i className="fas fa-laptop text-gray-400"></i>
                          <div>
                            <p className="text-sm text-gray-700">Chrome - Windows</p>
                            <p className="text-xs text-gray-500">Sesión actual</p>
                          </div>
                        </div>
                        <span className="text-xs text-green-600 bg-green-100 px-2 py-1 rounded-full">Activa</span>
                      </div>
                    </div>
                  </div>
                  <button onClick={handleSaveSecurity} className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-medium hover:opacity-90 transition">
                    Actualizar contraseña
                  </button>
                </div>
              </div>
            )}

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
                  <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-xl">
                    <h3 className="font-medium text-red-800 mb-2">Zona de peligro</h3>
                    <p className="text-sm text-red-600 mb-3">Eliminar tu cuenta es permanente y no se puede deshacer.</p>
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
                        <input
                          type="password"
                          autoComplete="current-password"
                          value={deletePassword}
                          onChange={(e) => setDeletePassword(e.target.value)}
                          placeholder="Tu contraseña"
                          className="w-full px-4 py-2 border border-red-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-400"
                        />
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

            {activeSection === 'payments' && (
              <div className="bg-white rounded-2xl shadow-sm p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-6">Métodos de Pago</h2>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 border border-gray-200 rounded-xl">
                    <div className="flex items-center space-x-3">
                      <i className="fab fa-cc-visa text-2xl text-blue-700"></i>
                      <div>
                        <p className="text-sm font-medium text-gray-900">Visa •••• 4242</p>
                        <p className="text-xs text-gray-500">Expira 12/25</p>
                      </div>
                    </div>
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">Principal</span>
                  </div>
                  <button className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-pink-300 hover:text-pink-500 transition">
                    <i className="fas fa-plus mr-2"></i> Añadir método de pago
                  </button>
                </div>
                {user?.role === 'creator' && (
                  <div className="mt-8">
                    <h3 className="font-medium text-gray-900 mb-4">Cuenta para retiros</h3>
                    <div className="p-4 bg-gray-50 rounded-xl">
                      <p className="text-sm text-gray-600">Balance disponible: <strong className="text-green-600">$1,245.00</strong></p>
                      <button className="mt-3 bg-gradient-to-r from-pink-500 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90">
                        Solicitar retiro
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeSection === 'blocking' && (
              <div className="bg-white rounded-2xl shadow-sm p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-6">Usuarios Bloqueados</h2>
                <div className="text-center py-8 text-gray-500">
                  <i className="fas fa-shield-alt text-4xl text-gray-300 mb-3"></i>
                  <p>No has bloqueado a ningún usuario</p>
                  <p className="text-sm mt-1">Los usuarios bloqueados no podrán interactuar contigo</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
