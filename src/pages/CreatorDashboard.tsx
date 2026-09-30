import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import CreatorPayouts from '../components/CreatorPayouts';
import CreatorGiftsPanel from '../components/CreatorGiftsPanel';
import { usePlatformQuery, platformApi, computeEarnings, iBlocked, blockUser, unblockUser, money, CREATOR_SHARE, creatorCut, transactionLabel } from '../lib/platform';
import { statusLabel, formatLongDate, WEEKDAYS, ALL_HOURS, MAX_BOOKING_MONTHS, DEFAULT_AVAILABILITY } from '../lib/vip';
import { backend } from '../lib/backend';
import { useBackendData } from '../lib/useBackendData';
import NewPostForm from '../components/NewPostForm';
import LiveRoomButton from '../components/LiveRoomButton';
import { socialApi, compactCount } from '../lib/social';
import { posts as catalogPosts } from '../data/mockData';

const CreatorDashboard: React.FC = () => {
  const { user, deletePost, updateUser } = useAuth();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview');
  const [showNewPost, setShowNewPost] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const [displayName, setDisplayName] = useState(user?.name ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [price, setPrice] = useState(String(user?.subscriptionPrice ?? 9.99));
  const [category, setCategory] = useState(user?.settings.category ?? 'Modelaje');

  const profileId = user?.creatorProfileId ?? user?.id ?? '';
  const [availDays, setAvailDays] = useState<number[]>(DEFAULT_AVAILABILITY.days);
  const [availHours, setAvailHours] = useState<string[]>(DEFAULT_AVAILABILITY.hours);
  useEffect(() => {
    backend.getAvailability(profileId).then((a) => {
      setAvailDays(a.days);
      setAvailHours(a.hours);
    });
  }, [profileId]);
  const { data: vipBookings, reload: reloadBookings } = useBackendData(() => backend.creatorBookings(profileId), [profileId], []);
  const pendingVip = vipBookings.filter((b) => b.status === 'pending').length;

  // Real verification state, fan payments (80% for the creator), subscribers and blocks.
  const verified = !!user?.isVerified;
  const { data: live } = usePlatformQuery(
    async () => {
      if (!user) return null;
      const [verification, sales, payouts, subs, blocks] = await Promise.all([
        platformApi.myVerification(user.id),
        platformApi.creatorSales(profileId),
        platformApi.myPayouts(user.id),
        platformApi.mySubscribers(user),
        platformApi.blocks(user),
      ]);
      return { verification, sales, payouts, subs, blocks };
    },
    [user?.id, profileId],
    null
  );
  const verificationStatus = live?.verification?.status;
  const earnings = live ? computeEarnings(live.sales, live.payouts) : null;
  const monthName = (iso: string) => new Date(iso).toLocaleDateString('es', { month: 'short', year: 'numeric' });

  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const show = (result: { ok: boolean; error?: string }, okText: string) =>
    setNotice(result.ok ? { ok: true, text: okText } : { ok: false, text: result.error || 'Error al guardar' });

  const handleSaveAvailability = async () => {
    show(await backend.setAvailability(profileId, { days: availDays, hours: availHours }), 'Horarios guardados');
  };

  const handleBookingDecision = async (id: string, next: 'accepted' | 'rejected') => {
    if (!user) return;
    show(await backend.updateBooking(user, id, next), next === 'accepted' ? 'Reserva aceptada. El fan ya puede pagar.' : 'Reserva rechazada');
    await reloadBookings();
  };

  // My published posts (with their photo/video) and likes/comments on everything on my profile.
  const { data: content } = usePlatformQuery(
    async () => {
      const mine = await socialApi.postsByCreator(profileId);
      const catalog = catalogPosts.filter((p) => p.creatorId === profileId);
      const engagement = await socialApi.engagement([...mine.map((p) => p.id), ...catalog.map((p) => p.id)], user);
      const likes = catalog.reduce((sum, p) => sum + p.likes, 0) + Object.values(engagement).reduce((sum, e) => sum + e.likes, 0);
      return { mine, engagement, likes };
    },
    [profileId, user?.id],
    { mine: [] as Awaited<ReturnType<typeof socialApi.postsByCreator>>, engagement: {} as Awaited<ReturnType<typeof socialApi.engagement>>, likes: 0 }
  );

  const handlePublished = () => {
    setShowNewPost(false);
    setActiveTab('content');
    show({ ok: true }, 'Publicación creada. Ya aparece en tu perfil público.');
  };

  const handleDeletePost = async (id: string) => {
    if (!window.confirm('¿Eliminar esta publicación? También se borrará su foto o video.')) return;
    show(await deletePost(id), 'Publicación eliminada');
  };

  const handleSaveSettings = async () => {
    const parsed = parseFloat(price);
    if (Number.isNaN(parsed)) {
      setNotice({ ok: false, text: 'Introduce un precio válido' });
      return;
    }
    const result = await updateUser({
      name: displayName,
      bio,
      subscriptionPrice: Math.round(parsed * 100) / 100,
      settings: { ...user!.settings, category },
    });
    show(result, 'Cambios guardados exitosamente');
  };

  const subscribers = (live?.subs ?? []).map((sub) => ({ ...sub, since: monthName(sub.since), plan: 'Mensual' }));
  const isBlocked = (fanId: string) => !!user && !!live && iBlocked(live.blocks, user.id, fanId);
  const activeSubscribers = subscribers.filter((sub) => !isBlocked(sub.id)).length;

  const stats = [
    { label: 'Por acreditar el día 1', value: money(earnings?.pending ?? 0), change: `${CREATOR_SHARE * 100}%`, icon: 'fa-dollar-sign', color: 'green' },
    { label: 'Suscriptores activos', value: String(activeSubscribers), change: 'activos', icon: 'fa-users', color: 'blue' },
    { label: 'Publicaciones', value: String(user?.posts ?? 0), change: '+12', icon: 'fa-image', color: 'purple' },
    { label: 'Me gusta totales', value: compactCount(content.likes), change: 'total', icon: 'fa-heart', color: 'pink' },
  ];

  const recentTransactions = (live?.sales ?? []).slice(0, 5).map((t) => ({
    id: t.id,
    type: transactionLabel[t.kind],
    user: t.payerName,
    amount: `+${money(creatorCut(t))}`,
    date: new Date(t.createdAt).toLocaleString('es'),
    status: 'completed',
  }));

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
            onClick={() => { setShowNewPost(!showNewPost); setNotice(null); }}
            className="mt-4 sm:mt-0 bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-medium hover:opacity-90 transition shadow-lg"
          >
            <i className="fas fa-plus mr-2"></i> Nueva Publicación
          </button>
        </div>

        {!verified && live && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3" data-testid="verification-banner">
            <p className="text-sm text-yellow-800">
              <i className="fas fa-id-card mr-2"></i>
              {verificationStatus === 'pending'
                ? 'Tu verificación de identidad está en revisión. Podrás publicar y cobrar en cuanto se apruebe.'
                : verificationStatus === 'rejected'
                  ? 'Tu verificación fue rechazada. Revisa el motivo y envíala de nuevo para poder publicar.'
                  : 'Verifica tu identidad para publicar contenido y recibir pagos.'}
            </p>
            {verificationStatus !== 'pending' && (
              <Link to="/settings?section=verification" className="bg-yellow-500 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap hover:bg-yellow-600">
                Verificar identidad
              </Link>
            )}
          </div>
        )}

        {/* New post: text + photo or video */}
        {showNewPost && (
          <div className="mb-8">
            <NewPostForm verified={verified} onPublished={handlePublished} onCancel={() => setShowNewPost(false)} />
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
            { id: 'gifts', label: 'Regalos', icon: 'fa-gift' },
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
                {recentTransactions.length === 0 && <p className="p-6 text-center text-sm text-gray-500">Aún no hay pagos de fans</p>}
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="font-bold text-gray-900">Gestión de Contenido</h3>
                <p className="text-sm text-gray-500">Aquí subes fotos y videos. Lo que publiques aparece en tu perfil público.</p>
              </div>
              <div className="flex gap-2">
                <Link to={`/creator/${profileId}`} className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-700 hover:border-pink-300">
                  <i className="fas fa-eye mr-1"></i> Ver mi perfil
                </Link>
                {!showNewPost && (
                  <button onClick={() => { setShowNewPost(true); setNotice(null); }} className="px-4 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white text-sm font-medium">
                    <i className="fas fa-upload mr-1"></i> Subir foto o video
                  </button>
                )}
              </div>
            </div>
            {content.mine.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">Aún no has publicado nada. Pulsa “Subir foto o video” para empezar.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {content.mine.map((post) => {
                  const e = content.engagement[post.id];
                  return (
                    <div key={post.id} data-testid="created-post" className="border border-gray-200 rounded-xl overflow-hidden flex flex-col">
                      {post.mediaUrl ? (
                        post.mediaType === 'video' ? (
                          <video src={post.mediaUrl} controls playsInline preload="metadata" className="w-full h-44 object-cover bg-black" />
                        ) : (
                          <img src={post.mediaUrl} alt="" className="w-full h-44 object-cover" />
                        )
                      ) : (
                        <div className="w-full h-20 bg-gradient-to-br from-pink-50 to-purple-50 flex items-center justify-center text-gray-300">
                          <i className="fas fa-align-left text-2xl"></i>
                        </div>
                      )}
                      <div className="p-4 flex-1 flex flex-col">
                        <div className="flex items-start justify-between mb-2 gap-2">
                          <span className="text-sm font-medium text-gray-900 break-words">{post.content || (post.mediaType === 'video' ? 'Video' : 'Foto')}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${post.isLocked ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                            {post.isLocked ? 'Exclusivo' : 'Público'}
                          </span>
                        </div>
                        <div className="mt-auto flex items-center justify-between text-xs text-gray-500">
                          <span className="flex gap-3">
                            <span><i className="fas fa-heart mr-1"></i>{e?.likes ?? 0}</span>
                            <span><i className="fas fa-comment mr-1"></i>{e?.comments ?? 0}</span>
                            <span>{new Date(post.createdAt).toLocaleDateString('es')}</span>
                          </span>
                          <button onClick={() => handleDeletePost(post.id)} className="text-red-500 hover:text-red-700">
                            <i className="fas fa-trash mr-1"></i>Eliminar
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
              {subscribers.length === 0 && <p className="p-6 text-center text-sm text-gray-500">Aún no tienes suscriptores</p>}
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
                    {isBlocked(sub.id) ? (
                      <button onClick={() => user && unblockUser(user, sub.id)} className="px-3 py-1 text-xs text-pink-600 hover:text-pink-700">
                        Desbloquear
                      </button>
                    ) : (
                      <button
                        onClick={() => user && window.confirm(`¿Bloquear a ${sub.name}? No podrá ver tu contenido ni contactarte.`) && blockUser(user, sub.id, sub.name)}
                        aria-label={`Bloquear a ${sub.name}`}
                        className="p-2 text-gray-400 hover:text-red-500 transition"
                      >
                        <i className="fas fa-ban"></i>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'earnings' && <CreatorPayouts />}

        {activeTab === 'gifts' && <CreatorGiftsPanel />}

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
                        {b.status === 'confirmed' && <LiveRoomButton booking={b} />}
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
