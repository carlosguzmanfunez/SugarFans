import React, { useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import CreatorPayouts from '../components/CreatorPayouts';
import CreatorGiftsPanel from '../components/CreatorGiftsPanel';
import CreatorRewardsPanel from '../components/CreatorRewardsPanel';
import CreatorGoalsPanel from '../components/CreatorGoalsPanel';
import Avatar from '../components/Avatar';
import CreatorLivePanel from '../components/CreatorLivePanel';
import { usePlatformQuery, platformApi, computeEarnings, iBlocked, blockUser, unblockUser, money, CREATOR_SHARE, creatorCut, transactionLabel } from '../lib/platform';
import { WEEKDAYS, ALL_HOURS, MAX_BOOKING_MONTHS, DEFAULT_AVAILABILITY } from '../lib/vip';
import { backend } from '../lib/backend';
import { useBackendData } from '../lib/useBackendData';
import NewPostForm from '../components/NewPostForm';
import CreatorReservePanel from '../components/reserve/CreatorReservePanel';
import { RedDot } from '../components/MobileTabBar';
import { onNewNotification } from '../lib/live';
import { needsCreatorAnswer } from '../lib/reserveAlerts';
import { CREATOR_CATEGORIES, categoryFor } from '../config/reserve';
import { creators as demoCreators } from '../data/mockData';
import { socialApi, compactCount } from '../lib/social';
import { posts as catalogPosts } from '../data/mockData';
import { BRAND, displayPayer } from '../config/brand';

// "Dinero" in the tab bar: income, gifts and rewards.
const MONEY_TABS = ['earnings', 'gifts', 'rewards'];

const CreatorDashboard: React.FC = () => {
  const { user, deletePost, updateUser } = useAuth();
  // The open tab lives in the address (?tab=vip), so "Reservas" in the menus opens
  // it even when the panel is already on screen, and back/forward move between tabs.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'overview';
  const setActiveTab = (id: string) => setSearchParams(id === 'overview' ? {} : { tab: id }, { replace: true });
  const [showNewPost, setShowNewPost] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const [displayName, setDisplayName] = useState(user?.name ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [price, setPrice] = useState(String(user?.subscriptionPrice ?? 9.99));
  const [category, setCategory] = useState(
    categoryFor(user?.settings.category || demoCreators.find((c) => c.id === user?.creatorProfileId)?.category).name
  );

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
  const pendingVip = vipBookings.filter((b) => needsCreatorAnswer(b)).length;
  // A new request shows up in the list at once.
  const userId = user?.id;
  useEffect(() => (userId ? onNewNotification(userId, reloadBookings) : undefined), [userId, reloadBookings]);

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
    { label: 'Por acreditar el día 1', value: money(earnings?.pending ?? 0), icon: 'fa-dollar-sign' },
    { label: 'Suscriptores activos', value: String(activeSubscribers), icon: 'fa-users' },
    { label: 'Publicaciones', value: String(user?.posts ?? 0), icon: 'fa-image' },
    { label: 'Me gusta totales', value: compactCount(content.likes), icon: 'fa-heart' },
  ];

  // Real income of the last 7 days (the creator's part of each fan payment).
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (6 - i));
    const next = day.getTime() + 86_400_000;
    const total = (live?.sales ?? [])
      .filter((t) => { const at = new Date(t.createdAt).getTime(); return at >= day.getTime() && at < next; })
      .reduce((sum, t) => sum + creatorCut(t), 0);
    return { label: day.toLocaleDateString('es', { weekday: 'short' }).replace('.', ''), total };
  });
  const weekMax = Math.max(...week.map((d) => d.total));
  const [linkCopied, setLinkCopied] = useState(false);
  const copyProfileLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/creator/${profileId}`);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Clipboard blocked: nothing to do, the link is in the profile.
    }
  };

  const recentTransactions = (live?.sales ?? []).slice(0, 5).map((t) => ({
    id: t.id,
    type: transactionLabel[t.kind],
    user: displayPayer(t.payerName),
    amount: `+${money(creatorCut(t))}`,
    date: new Date(t.createdAt).toLocaleString('es'),
    status: 'completed',
  }));

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Panel de creador</h1>
            <p className="text-ink/60">Bienvenida, {user?.name}</p>
          </div>
          <div className="mt-4 sm:mt-0 flex gap-2 sm:gap-3">
            {/* Reservas: same shape as "Nueva publicación", with the red count of requests waiting. */}
            <button
              onClick={() => { setActiveTab('vip'); setNotice(null); }}
              data-testid="dashboard-reservas"
              aria-label={pendingVip ? `Reservas, ${pendingVip} por responder` : 'Reservas'}
              className={`btn btn-md btn-dark relative hidden sm:inline-flex ${activeTab === 'vip' ? 'ring-2 ring-brand-200 ring-offset-2' : ''}`}
            >
              <Icon name="fa-ticket" /> Reservas
              {!!pendingVip && <RedDot count={pendingVip} className="absolute -right-2 -top-2" />}
            </button>
            <button
              onClick={() => { setShowNewPost(!showNewPost); setNotice(null); }}
              className="btn btn-md btn-primary"
            >
              <Icon name="fa-plus" /> Nueva publicación
            </button>
          </div>
        </div>

        {!verified && live && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3" data-testid="verification-banner">
            <p className="text-sm text-yellow-800">
              <i aria-hidden="true" className="fas fa-id-card mr-2"></i>
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

        {user?.creatorProfileId && <CreatorLivePanel user={user} />}

        {/* Tabs: seven sections. "Dinero" groups income, gifts and rewards (their
            old ?tab= addresses still work and pick the sub-section). */}
        <div className="flex gap-1 bg-white border border-line rounded-full p-1 mb-3 overflow-x-auto scrollbar-hide">
          {[
            { id: 'overview', label: 'Resumen', icon: 'fa-chart-pie' },
            { id: 'content', label: 'Contenido', icon: 'fa-images' },
            { id: 'subscribers', label: 'Suscriptores', icon: 'fa-users' },
            { id: 'earnings', label: 'Dinero', icon: 'fa-wallet', group: MONEY_TABS },
            { id: 'goals', label: 'Metas', icon: 'fa-bullseye', goal: true },
            { id: 'vip', label: 'Reservas', icon: 'fa-ticket', badge: pendingVip },
            { id: 'settings', label: 'Configuración', icon: 'fa-cog' },
          ].map((tab) => {
            const on = 'group' in tab && tab.group ? tab.group.includes(activeTab) : activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setNotice(null); }}
                aria-current={on ? 'page' : undefined}
                className={`flex-none px-4 py-2 rounded-full text-sm whitespace-nowrap transition-colors active:scale-[0.97] ${
                  'goal' in tab
                    ? on
                      ? 'font-bold bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-orange-500/30'
                      : 'font-bold text-orange-600 bg-orange-50 hover:bg-orange-100'
                    : on ? 'font-medium bg-ink text-white' : 'font-medium text-ink/60 hover:text-ink hover:bg-canvas'
                }`}
              >
                {/* Metas always stands out, with a soft pulse, so the creator keeps an eye on it */}
                {'goal' in tab && !on && (
                  <span className="relative mr-1.5 inline-flex h-2 w-2 align-[2px]" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75 motion-safe:animate-ping"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500"></span>
                  </span>
                )}
                <Icon name={tab.icon} className={`mr-1.5 ${on || 'goal' in tab ? '' : 'text-ink/40'}`} />{tab.label}
                {'badge' in tab && !!tab.badge && (
                  <>
                    <RedDot count={tab.badge} className="ml-1.5 inline-flex align-[1px]" />
                    <span className="sr-only">, {tab.badge} por responder</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
        {MONEY_TABS.includes(activeTab) ? (
          // Big colored cards so the creator spots their money sections at once.
          <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-8" role="tablist" aria-label="Dinero">
            {[
              { id: 'earnings', label: 'Ingresos', hint: 'Saldo y retiros', icon: 'fa-wallet', on: 'from-emerald-500 to-teal-600 shadow-emerald-500/30', chip: 'bg-emerald-50 text-emerald-600' },
              { id: 'gifts', label: 'Regalos', hint: 'Lo que te regalan', icon: 'fa-gift', on: 'from-brand-500 to-brand-700 shadow-brand-500/30', chip: 'bg-brand-50 text-brand-600' },
              { id: 'rewards', label: 'Recompensas', hint: 'Nivel e invitaciones', icon: 'fa-trophy', on: 'from-iris-500 to-iris-700 shadow-iris-500/30', chip: 'bg-iris-50 text-iris-600' },
            ].map((sub) => {
              const on = activeTab === sub.id;
              return (
                <button
                  key={sub.id}
                  role="tab"
                  aria-selected={on}
                  onClick={() => { setActiveTab(sub.id); setNotice(null); }}
                  className={`group flex flex-col sm:flex-row items-center sm:items-center gap-1.5 sm:gap-3 rounded-2xl p-3 sm:p-4 text-center sm:text-left transition-all active:scale-[0.98] ${
                    on
                      ? `bg-gradient-to-br ${sub.on} text-white shadow-lg -translate-y-0.5`
                      : 'bg-white border border-line text-ink hover:-translate-y-0.5 hover:shadow-md'
                  }`}
                >
                  <span className={`flex h-10 w-10 sm:h-11 sm:w-11 flex-none items-center justify-center rounded-xl text-xl ${on ? 'bg-white/20 text-white' : sub.chip}`}>
                    <Icon name={sub.icon} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm sm:text-base font-bold leading-tight">{sub.label}</span>
                    <span className={`hidden sm:block text-xs mt-0.5 ${on ? 'text-white/80' : 'text-ink/50'}`}>{sub.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mb-8" />
        )}

        {/* Stats Grid */}
        {activeTab === 'overview' && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
              {stats.map((stat) => (
                <div key={stat.label} className="bg-white rounded-2xl border border-line p-4 sm:p-5">
                  <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center mb-3">
                    <Icon name={stat.icon} className="text-base text-brand-600" />
                  </div>
                  <p className="font-display text-2xl font-bold text-ink tabular-nums">{stat.value}</p>
                  <p className="text-xs sm:text-sm text-ink/55 mt-1">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Income of the last 7 days, or what to do while there is none */}
            <div className="bg-white rounded-2xl border border-line p-6 mb-8" data-testid="income-week">
              <h3 className="font-semibold text-ink mb-4">Ingresos últimos 7 días</h3>
              {weekMax > 0 ? (
                <div className="flex items-end gap-2 h-40">
                  {week.map((d) => (
                    <div key={d.label} className="flex-1 h-full flex flex-col items-center justify-end">
                      <div
                        className="w-full rounded-t-lg bg-gradient-to-t from-brand-600 to-iris-500"
                        style={{ height: `${Math.max(4, (d.total / weekMax) * 100)}%` }}
                        title={money(d.total)}
                      ></div>
                      <span className="text-xs text-ink/50 mt-2 capitalize">{d.label}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center text-center py-6">
                  <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center mb-3">
                    <Icon name="fa-chart-line" className="text-brand-600" />
                  </div>
                  <p className="font-medium text-ink">Aún no hay ingresos esta semana</p>
                  <p className="text-sm text-ink/60 mt-1 max-w-sm">Comparte tu perfil en tus redes para conseguir tus primeros suscriptores y reservas.</p>
                  <button type="button" onClick={copyProfileLink} className="btn btn-md btn-outline mt-4 active:scale-[0.97]">
                    <Icon name={linkCopied ? 'fa-check' : 'fa-link'} className={linkCopied ? 'text-emerald-600' : ''} />
                    {linkCopied ? 'Enlace copiado' : 'Copiar enlace de mi perfil'}
                  </button>
                </div>
              )}
            </div>

            {/* Recent Transactions */}
            <div className="bg-white rounded-2xl border border-line overflow-hidden">
              <div className="p-5 border-b border-line">
                <h3 className="font-semibold text-ink">Transacciones recientes</h3>
              </div>
              <div className="divide-y divide-gray-100">
                {recentTransactions.length === 0 && <p className="p-6 text-center text-sm text-gray-500">Aún no hay pagos de fans</p>}
                {recentTransactions.map((tx) => (
                  <div key={tx.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                    <div className="flex items-center space-x-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        tx.type === 'Suscripción' ? 'bg-blue-100' : tx.type === 'Propina' ? 'bg-green-100' : 'bg-purple-100'
                      }`}>
                        <i aria-hidden="true" className={`fas ${
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
          <div className="bg-white rounded-2xl border border-line p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="font-bold text-gray-900">Gestión de contenido</h3>
                <p className="text-sm text-gray-500">Aquí subes fotos y videos. Lo que publiques aparece en tu perfil público.</p>
              </div>
              <div className="flex gap-2">
                <Link to={`/creator/${profileId}`} className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-700 hover:border-pink-300">
                  <i aria-hidden="true" className="fas fa-eye mr-1"></i> Ver mi perfil
                </Link>
                {!showNewPost && (
                  <button onClick={() => { setShowNewPost(true); setNotice(null); }} className="px-4 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white text-sm font-medium">
                    <i aria-hidden="true" className="fas fa-upload mr-1"></i> Subir foto o video
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
                          <i aria-hidden="true" className="fas fa-align-left text-2xl"></i>
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
                            <span><Icon name="fa-heart" className="mr-1" />{e?.likes ?? 0}</span>
                            <span><i aria-hidden="true" className="fas fa-comment mr-1"></i>{e?.comments ?? 0}</span>
                            <span>{new Date(post.createdAt).toLocaleDateString('es')}</span>
                          </span>
                          <button onClick={() => handleDeletePost(post.id)} className="text-red-500 hover:text-red-700">
                            <i aria-hidden="true" className="fas fa-trash mr-1"></i>Eliminar
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
          <div className="bg-white rounded-2xl border border-line overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-gray-900">Suscriptores ({subscribers.length})</h3>
              <button className="text-sm text-pink-600 hover:text-pink-700">
                <i aria-hidden="true" className="fas fa-envelope mr-1"></i> Enviar mensaje a todos
              </button>
            </div>
            <div className="divide-y divide-gray-100">
              {subscribers.length === 0 && <p className="p-6 text-center text-sm text-gray-500">Aún no tienes suscriptores</p>}
              {subscribers.map((sub) => (
                <div key={sub.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                  <div className="flex items-center space-x-3">
                    <Avatar src={sub.avatar} name={sub.name} size={40} decorative />
                    <div>
                      <p className="font-medium text-gray-900">{sub.name}</p>
                      <p className="text-xs text-gray-500">Suscriptor desde {sub.since} • {sub.plan}</p>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <button className="p-2 text-gray-400 hover:text-pink-500 transition">
                      <i aria-hidden="true" className="fas fa-envelope"></i>
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
                        <Icon name="fa-ban" />
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
        {activeTab === 'rewards' && <CreatorRewardsPanel />}
        {activeTab === 'goals' && <CreatorGoalsPanel />}

        {activeTab === 'vip' && (
          <CreatorReservePanel
            availability={{ days: availDays, hours: availHours }}
            bookings={vipBookings}
            reloadBookings={reloadBookings}
            availabilityEditor={
              <div className="bg-white rounded-2xl border border-line p-6" data-testid="vip-availability">
                <h3 className="font-bold text-gray-900 mb-1">Horarios generales de Reserve</h3>
                <p className="text-sm text-gray-500 mb-5">
                  Los fans solo podrán reservar en estos días y horas, con hasta {MAX_BOOKING_MONTHS} meses de antelación. Cada experiencia puede limitarlos aún más.
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
            }
          />
        )}

        {activeTab === 'settings' && (
          <div className="bg-white rounded-2xl border border-line p-6">
            <h3 className="font-bold text-gray-900 mb-6">Configuración del perfil</h3>
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
                <input type="number" name="price" min="4.99" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Categoría principal</label>
                <select name="category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none">
                  {CREATOR_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">No te encasilla: es dónde te encuentran los fans en Explorar y qué experiencias puedes ofrecer en Reserve.</p>
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
