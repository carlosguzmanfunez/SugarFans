import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getAvailability,
  setAvailability,
  bookingsForCreator,
  updateBooking,
  statusLabel,
  formatLongDate,
  useVipStore,
  WEEKDAYS,
  ALL_HOURS,
  MAX_BOOKING_MONTHS,
} from '../lib/vip';

const CreatorDashboard: React.FC = () => {
  const { user, addPost, deletePost, updateUser } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [showNewPost, setShowNewPost] = useState(false);
  const [postText, setPostText] = useState('');
  const [postLocked, setPostLocked] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const [displayName, setDisplayName] = useState(user?.name ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [price, setPrice] = useState(String(user?.subscriptionPrice ?? 9.99));
  const [category, setCategory] = useState(user?.settings.category ?? 'Modelaje');

  useVipStore();
  const profileId = user?.creatorProfileId ?? user?.id ?? '';
  const [availDays, setAvailDays] = useState<number[]>(() => getAvailability(profileId).days);
  const [availHours, setAvailHours] = useState<string[]>(() => getAvailability(profileId).hours);
  const vipBookings = bookingsForCreator(profileId);
  const pendingVip = vipBookings.filter((b) => b.status === 'pending').length;

  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const handleSaveAvailability = () => {
    if (availDays.length === 0 || availHours.length === 0) {
      setNotice({ ok: false, text: 'Elige al menos un día y una hora' });
      return;
    }
    setAvailability(profileId, { days: availDays, hours: availHours });
    setNotice({ ok: true, text: 'Horarios guardados' });
  };

  const handleBookingDecision = (id: string, next: 'accepted' | 'rejected') => {
    const result = updateBooking(id, { role: 'creator', creatorProfileId: profileId }, next);
    setNotice(result.ok
      ? { ok: true, text: next === 'accepted' ? 'Reserva aceptada. El fan ya puede pagar.' : 'Reserva rechazada' }
      : { ok: false, text: result.error || 'Error' });
  };

  const handlePublish = () => {
    if (!postText.trim()) {
      setNotice({ ok: false, text: 'Escribe algo antes de publicar' });
      return;
    }
    addPost(postText, postLocked);
    setPostText('');
    setPostLocked(false);
    setShowNewPost(false);
    setActiveTab('content');
    setNotice({ ok: true, text: 'Publicación creada' });
  };

  const handleSaveSettings = () => {
    const parsed = parseFloat(price);
    if (Number.isNaN(parsed)) {
      setNotice({ ok: false, text: 'Introduce un precio válido' });
      return;
    }
    const result = updateUser({
      name: displayName,
      bio,
      subscriptionPrice: Math.round(parsed * 100) / 100,
      settings: { ...user!.settings, category },
    });
    setNotice(result.ok ? { ok: true, text: 'Cambios guardados exitosamente' } : { ok: false, text: result.error || 'Error al guardar' });
  };

  const stats = [
    { label: 'Ingresos del mes', value: '$2,450.00', change: '+12%', icon: 'fa-dollar-sign', color: 'green' },
    { label: 'Suscriptores activos', value: '245', change: '+8', icon: 'fa-users', color: 'blue' },
    { label: 'Publicaciones', value: String(user?.posts ?? 0), change: '+12', icon: 'fa-image', color: 'purple' },
    { label: 'Me gusta totales', value: '89.2K', change: '+5.2K', icon: 'fa-heart', color: 'pink' },
  ];

  const recentTransactions = [
    { id: '1', type: 'Suscripción', user: 'Carlos M.', amount: '$9.99', date: 'Hoy, 10:30', status: 'completed' },
    { id: '2', type: 'Propina', user: 'Ana R.', amount: '$5.00', date: 'Hoy, 09:15', status: 'completed' },
    { id: '3', type: 'PPV', user: 'Miguel S.', amount: '$4.99', date: 'Ayer, 22:00', status: 'completed' },
    { id: '4', type: 'Suscripción', user: 'Laura P.', amount: '$9.99', date: 'Ayer, 18:45', status: 'completed' },
    { id: '5', type: 'Suscripción', user: 'Pedro G.', amount: '$9.99', date: 'Ayer, 15:30', status: 'pending' },
  ];

  const subscribers = [
    { id: '1', name: 'Carlos M.', avatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=carlos', since: 'Ene 2024', plan: 'Mensual' },
    { id: '2', name: 'Ana R.', avatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=ana', since: 'Dic 2023', plan: 'Anual' },
    { id: '3', name: 'Miguel S.', avatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=miguel', since: 'Ene 2024', plan: 'Mensual' },
    { id: '4', name: 'Laura P.', avatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=laura', since: 'Nov 2023', plan: 'Mensual' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Panel de Creador</h1>
            <p className="text-gray-600">Bienvenida, {user?.name}</p>
          </div>
          <button
            onClick={() => setShowNewPost(!showNewPost)}
            className="mt-4 sm:mt-0 bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-medium hover:opacity-90 transition shadow-lg"
          >
            <i className="fas fa-plus mr-2"></i> Nueva Publicación
          </button>
        </div>

        {/* New Post Modal */}
        {showNewPost && (
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-8 border border-pink-100">
            <h3 className="font-bold text-lg mb-4">Crear nueva publicación</h3>
            <textarea
              value={postText}
              onChange={(e) => setPostText(e.target.value)}
              className="w-full p-4 border border-gray-200 rounded-xl resize-none h-24 focus:ring-2 focus:ring-pink-500 outline-none"
              placeholder="¿Qué quieres compartir con tus fans?"
            ></textarea>
            <div className="flex items-center justify-between mt-4">
              <div className="flex space-x-3">
                <button className="flex items-center text-sm text-gray-600 hover:text-pink-500 transition">
                  <i className="fas fa-image mr-1"></i> Foto
                </button>
                <button className="flex items-center text-sm text-gray-600 hover:text-pink-500 transition">
                  <i className="fas fa-video mr-1"></i> Video
                </button>
                <button
                  type="button"
                  aria-pressed={postLocked}
                  onClick={() => setPostLocked(!postLocked)}
                  className={`flex items-center text-sm transition ${postLocked ? 'text-pink-600 font-medium' : 'text-gray-600 hover:text-pink-500'}`}
                >
                  <i className="fas fa-lock mr-1"></i> Exclusivo{postLocked ? ' ✓' : ''}
                </button>
              </div>
              <div className="flex space-x-3">
                <button onClick={() => setShowNewPost(false)} className="px-4 py-2 text-gray-600 hover:text-gray-800">
                  Cancelar
                </button>
                <button onClick={handlePublish} className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-2 rounded-xl font-medium hover:opacity-90">
                  Publicar
                </button>
              </div>
            </div>
          </div>
        )}

        {notice && (
          <div role={notice.ok ? 'status' : 'alert'} className={`px-4 py-3 rounded-xl mb-6 border ${notice.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {notice.text}
          </div>
        )}

        {/* Tabs */}
        <div className="flex space-x-1 bg-white rounded-xl p-1 shadow-sm mb-8 overflow-x-auto">
          {[
            { id: 'overview', label: 'Resumen', icon: 'fa-chart-pie' },
            { id: 'content', label: 'Contenido', icon: 'fa-images' },
            { id: 'subscribers', label: 'Suscriptores', icon: 'fa-users' },
            { id: 'earnings', label: 'Ingresos', icon: 'fa-wallet' },
            { id: 'vip', label: `Experiencias VIP${pendingVip ? ` (${pendingVip})` : ''}`, icon: 'fa-crown' },
            { id: 'settings', label: 'Configuración', icon: 'fa-cog' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setNotice(null); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                activeTab === tab.id ? 'bg-pink-100 text-pink-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <i className={`fas ${tab.icon} mr-1`}></i> {tab.label}
            </button>
          ))}
        </div>

        {/* Stats Grid */}
        {activeTab === 'overview' && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {stats.map((stat, i) => (
                <div key={i} className="bg-white rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div className={`w-10 h-10 rounded-xl bg-${stat.color}-100 flex items-center justify-center`}>
                      <i className={`fas ${stat.icon} text-${stat.color}-600`}></i>
                    </div>
                    <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded-full">
                      {stat.change}
                    </span>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                  <p className="text-sm text-gray-500 mt-1">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Revenue Chart Placeholder */}
            <div className="bg-white rounded-2xl p-6 shadow-sm mb-8">
              <h3 className="font-bold text-gray-900 mb-4">Ingresos últimos 7 días</h3>
              <div className="flex items-end space-x-2 h-40">
                {[65, 45, 80, 55, 90, 70, 95].map((height, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center">
                    <div
                      className="w-full bg-gradient-to-t from-pink-500 to-purple-500 rounded-t-lg transition-all hover:opacity-80"
                      style={{ height: `${height}%` }}
                    ></div>
                    <span className="text-xs text-gray-500 mt-2">
                      {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'][i]}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Transactions */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-gray-100">
                <h3 className="font-bold text-gray-900">Transacciones Recientes</h3>
              </div>
              <div className="divide-y divide-gray-100">
                {recentTransactions.map((tx) => (
                  <div key={tx.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                    <div className="flex items-center space-x-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        tx.type === 'Suscripción' ? 'bg-blue-100' : tx.type === 'Propina' ? 'bg-green-100' : 'bg-purple-100'
                      }`}>
                        <i className={`fas ${
                          tx.type === 'Suscripción' ? 'fa-user-plus text-blue-600' : tx.type === 'Propina' ? 'fa-gift text-green-600' : 'fa-film text-purple-600'
                        } text-xs`}></i>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{tx.type} - {tx.user}</p>
                        <p className="text-xs text-gray-500">{tx.date}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-gray-900">{tx.amount}</p>
                      <span className={`text-xs ${tx.status === 'completed' ? 'text-green-600' : 'text-yellow-600'}`}>
                        {tx.status === 'completed' ? '✓ Completado' : '⏳ Pendiente'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === 'content' && (
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <h3 className="font-bold text-gray-900 mb-4">Gestión de Contenido</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {user?.createdPosts.map((post) => (
                <div key={post.id} data-testid="created-post" className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <span className="text-sm font-medium text-gray-900 break-words">{post.content}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${post.isLocked ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                      {post.isLocked ? 'Exclusivo' : 'Público'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{new Date(post.createdAt).toLocaleString('es')}</span>
                    <button onClick={() => deletePost(post.id)} className="text-red-500 hover:text-red-700">
                      <i className="fas fa-trash mr-1"></i>Eliminar
                    </button>
                  </div>
                </div>
              ))}
              <div className="border border-gray-200 rounded-xl p-4 hover:border-pink-300 transition cursor-pointer">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-900">Set de fotos - Playa</span>
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Público</span>
                </div>
                <div className="flex items-center space-x-3 text-xs text-gray-500">
                  <span><i className="fas fa-heart mr-1"></i>342</span>
                  <span><i className="fas fa-comment mr-1"></i>56</span>
                  <span><i className="fas fa-eye mr-1"></i>1.2K</span>
                </div>
              </div>
              <div className="border border-gray-200 rounded-xl p-4 hover:border-pink-300 transition cursor-pointer">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-900">Video exclusivo - Sesión</span>
                  <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Exclusivo</span>
                </div>
                <div className="flex items-center space-x-3 text-xs text-gray-500">
                  <span><i className="fas fa-heart mr-1"></i>890</span>
                  <span><i className="fas fa-comment mr-1"></i>123</span>
                  <span><i className="fas fa-dollar-sign mr-1"></i>$4.99</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'subscribers' && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-gray-900">Suscriptores ({subscribers.length})</h3>
              <button className="text-sm text-pink-600 hover:text-pink-700">
                <i className="fas fa-envelope mr-1"></i> Enviar mensaje a todos
              </button>
            </div>
            <div className="divide-y divide-gray-100">
              {subscribers.map((sub) => (
                <div key={sub.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                  <div className="flex items-center space-x-3">
                    <img src={sub.avatar} alt="" className="w-10 h-10 rounded-full" />
                    <div>
                      <p className="font-medium text-gray-900">{sub.name}</p>
                      <p className="text-xs text-gray-500">Suscriptor desde {sub.since} • {sub.plan}</p>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <button className="p-2 text-gray-400 hover:text-pink-500 transition">
                      <i className="fas fa-envelope"></i>
                    </button>
                    <button className="p-2 text-gray-400 hover:text-red-500 transition">
                      <i className="fas fa-ban"></i>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'earnings' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm p-6">
              <h3 className="font-bold text-gray-900 mb-4">Resumen de Ingresos</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-green-50 rounded-xl p-4">
                  <p className="text-sm text-green-700">Este mes</p>
                  <p className="text-2xl font-bold text-green-900">$2,450.00</p>
                </div>
                <div className="bg-blue-50 rounded-xl p-4">
                  <p className="text-sm text-blue-700">Mes anterior</p>
                  <p className="text-2xl font-bold text-blue-900">$2,180.00</p>
                </div>
                <div className="bg-purple-50 rounded-xl p-4">
                  <p className="text-sm text-purple-700">Total acumulado</p>
                  <p className="text-2xl font-bold text-purple-900">$15,890.00</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-6">
              <h3 className="font-bold text-gray-900 mb-4">Desglose por tipo</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Suscripciones</span>
                  <span className="font-bold">$1,850.00 (75%)</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-pink-500 h-2 rounded-full" style={{ width: '75%' }}></div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Contenido PPV</span>
                  <span className="font-bold">$420.00 (17%)</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-purple-500 h-2 rounded-full" style={{ width: '17%' }}></div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Propinas</span>
                  <span className="font-bold">$180.00 (8%)</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-green-500 h-2 rounded-full" style={{ width: '8%' }}></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'vip' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl shadow-sm p-6" data-testid="vip-availability">
              <h3 className="font-bold text-gray-900 mb-1">Mis horarios para experiencias VIP</h3>
              <p className="text-sm text-gray-500 mb-5">
                Los fans solo podrán reservar en estos días y horas, con hasta {MAX_BOOKING_MONTHS} meses de antelación.
              </p>
              <p className="text-sm font-medium text-gray-700 mb-2">Días</p>
              <div className="flex flex-wrap gap-2 mb-5">
                {WEEKDAYS.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={availDays.includes(i)}
                    onClick={() => setAvailDays(toggle(availDays, i))}
                    className={`w-12 py-2 rounded-xl text-sm font-medium border transition ${
                      availDays.includes(i) ? 'bg-purple-600 text-white border-purple-600' : 'border-gray-200 text-gray-600 hover:border-purple-300'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <p className="text-sm font-medium text-gray-700 mb-2">Horas</p>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 mb-6">
                {ALL_HOURS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    aria-pressed={availHours.includes(h)}
                    onClick={() => setAvailHours(toggle(availHours, h))}
                    className={`py-2 rounded-xl text-sm font-medium border transition ${
                      availHours.includes(h) ? 'bg-pink-500 text-white border-pink-500' : 'border-gray-200 text-gray-600 hover:border-pink-300'
                    }`}
                  >
                    {h}
                  </button>
                ))}
              </div>
              <button onClick={handleSaveAvailability} className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-medium hover:opacity-90 transition">
                Guardar horarios
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm p-6" data-testid="vip-requests">
              <h3 className="font-bold text-gray-900 mb-4">Solicitudes de reserva</h3>
              {vipBookings.length === 0 ? (
                <p className="text-sm text-gray-500">Aún no tienes solicitudes.</p>
              ) : (
                <div className="space-y-3">
                  {vipBookings.map((b) => (
                    <div key={b.id} data-testid="vip-request" className="border border-gray-100 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{b.title}</p>
                          <p className="text-xs text-gray-500">
                            {b.fanName} · <span className="first-letter:uppercase">{formatLongDate(b.date)}</span> · {b.time}
                          </p>
                        </div>
                        <span className="text-sm font-bold text-gray-900">${b.price}</span>
                      </div>
                      {b.message && <p className="text-sm text-gray-600 mt-2 italic">“{b.message}”</p>}
                      <div className="flex items-center justify-between mt-3">
                        <span className={`text-xs px-2 py-1 rounded-full ${statusLabel[b.status].className}`}>{statusLabel[b.status].text}</span>
                        {b.status === 'pending' && (
                          <div className="flex gap-2">
                            <button onClick={() => handleBookingDecision(b.id, 'rejected')} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                              Rechazar
                            </button>
                            <button onClick={() => handleBookingDecision(b.id, 'accepted')} className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700">
                              Aceptar
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <h3 className="font-bold text-gray-900 mb-6">Configuración del Perfil</h3>
            <div className="space-y-6 max-w-lg">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de visualización</label>
                <input type="text" name="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Biografía</label>
                <textarea name="bio" value={bio} onChange={(e) => setBio(e.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none h-24 resize-none"></textarea>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Precio de suscripción (USD/mes)</label>
                <input type="number" name="price" min="0.99" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Categoría principal</label>
                <select name="category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none">
                  <option>Modelaje</option>
                  <option>Fitness</option>
                  <option>Arte</option>
                  <option>Música</option>
                  <option>Lifestyle</option>
                </select>
              </div>
              <button onClick={handleSaveSettings} className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-medium hover:opacity-90 transition">
                Guardar cambios
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CreatorDashboard;
