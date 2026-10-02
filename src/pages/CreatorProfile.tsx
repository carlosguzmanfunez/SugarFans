import React, { useState } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { posts, type Creator } from '../data/mockData';
import { useCreatorCatalog, fromPublic } from '../lib/catalog';
import ManagedBadge from '../components/ManagedBadge';
import Avatar from '../components/Avatar';
import { CoverImage, isPlaceholderImage } from '../components/CoverArt';
import LevelBadge from '../components/LevelBadge';
import GiftCelebration from '../components/GiftCelebration';
import type { Gift } from '../lib/gifts';
import { useLevels } from '../lib/rewards';
import { useAuth } from '../context/AuthContext';
import CheckoutDialog from '../components/CheckoutDialog';
import ReportDialog from '../components/ReportDialog';
import PostCard, { type DisplayPost } from '../components/PostCard';
import TipDialog from '../components/TipDialog';
import GiftDialog from '../components/GiftDialog';
import CircleSection from '../components/CircleSection';
import NewPostForm from '../components/NewPostForm';
import AccessLadder, { useFollow } from '../components/reserve/AccessLadder';
import CreatorReserveSection from '../components/reserve/CreatorReserveSection';
import { ReserveNotice } from '../components/reserve/ReserveBits';
import { backend } from '../lib/backend';
import type { VipExperience } from '../lib/vip';
import { socialApi, compactCount, type PublicCreator } from '../lib/social';
import {
  usePlatformQuery,
  platformApi,
  platformChanged,
  iBlocked as hasBlocked,
  blockedByProfile,
  blockUser,
  unblockUser,
  addMonths,
} from '../lib/platform';

const formatDay = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });

const CreatorProfile: React.FC = () => {
  const { id } = useParams();
  const { isAuthenticated, user, isSubscribed: hasSubscription, toggleSubscription, cancelSubscription, subscriptionOf, refreshUser, deletePost } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<'posts' | 'media' | 'circle' | 'about'>(new URLSearchParams(location.search).get('tab') === 'circle' ? 'circle' : 'posts');
  const { data: platform } = usePlatformQuery(
    async () => {
      const [removedPosts, blocks] = await Promise.all([platformApi.removedPosts(), user ? platformApi.blocks(user) : Promise.resolve([])]);
      return { removedPosts, blocks };
    },
    [user?.id],
    { removedPosts: [] as string[], blocks: [] as Awaited<ReturnType<typeof platformApi.blocks>> }
  );
  const [checkout, setCheckout] = useState(false);
  const [reporting, setReporting] = useState<{ kind: 'post' | 'creator'; targetId: string; label: string } | null>(null);
  const [tipping, setTipping] = useState<{ postId?: string } | null>(null);
  const [tipSent, setTipSent] = useState('');
  const [gifting, setGifting] = useState<{ postId?: string } | null>(null);
  const [celebrating, setCelebrating] = useState<Gift | null>(null);
  const [composing, setComposing] = useState(false);

  // Demo creators and platform-run profiles first, then creators who signed up.
  const { creators, loading: catalogLoading } = useCreatorCatalog();
  const catalogCreator = creators.find(c => c.id === id);
  // Creators who signed up have no catalogue entry: load their public card.
  const { data: signedUp, loading: creatorLoading } = usePlatformQuery(
    () => (catalogCreator || catalogLoading || !id ? Promise.resolve(null) : socialApi.publicCreator(id)),
    [id, catalogLoading, !!catalogCreator],
    null as PublicCreator | null
  );
  const creator: Creator | undefined = catalogCreator ?? (signedUp ? fromPublic(signedUp) : undefined);
  const levels = useLevels(id ? [id] : []);
  const follow = useFollow(id, user);
  const { data: experiences } = usePlatformQuery(
    async () => (await backend.listExperiences()).filter((e) => e.creatorProfileId === id && e.active),
    [id],
    [] as VipExperience[]
  );

  // Posts published from the creator panel, then like/comment totals for every post.
  const { data: feed } = usePlatformQuery(
    async () => {
      if (!id) return { own: [] as DisplayPost[], engagement: {} as Awaited<ReturnType<typeof socialApi.engagement>> };
      const published = await socialApi.postsByCreator(id);
      const own: DisplayPost[] = published.map((p) => ({
        id: p.id,
        creatorProfileId: p.creatorProfileId,
        // Filled in below from the creator card.
        creatorName: '',
        creatorAvatar: '',
        content: p.content,
        mediaUrl: p.mediaUrl,
        mediaType: p.mediaType,
        isLocked: p.isLocked,
        createdAt: p.createdAt,
        baseLikes: 0,
        baseComments: 0,
      }));
      const ids = [...own.map((p) => p.id), ...posts.filter((p) => p.creatorId === id).map((p) => p.id)];
      return { own, engagement: await socialApi.engagement(ids, user) };
    },
    [id, user?.id],
    { own: [] as DisplayPost[], engagement: {} as Awaited<ReturnType<typeof socialApi.engagement>> }
  );

  if (!creator && (catalogLoading || creatorLoading)) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center" role="status" aria-label="Cargando">
        <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!creator) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <i aria-hidden="true" className="fas fa-user-slash text-5xl text-gray-300 mb-4"></i>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Creador no encontrado</h1>
          <p className="text-gray-600 mb-6">Este perfil no existe o fue eliminado.</p>
          <Link to="/explore" className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-medium">
            Explorar creadores
          </Link>
        </div>
      </div>
    );
  }

  const catalogPosts: DisplayPost[] = posts
    .filter((p) => p.creatorId === creator.id)
    .map((p) => ({
      id: p.id,
      creatorProfileId: p.creatorId,
      creatorName: p.creatorName,
      creatorAvatar: p.creatorAvatar,
      content: p.content,
      mediaUrl: p.media,
      mediaType: p.mediaType,
      isLocked: p.isLocked,
      price: p.price,
      createdAt: p.createdAt,
      baseLikes: p.likes,
      baseComments: p.comments,
    }));
  const creatorPosts = [...feed.own.map((p) => ({ ...p, creatorName: creator.name, creatorAvatar: creator.avatar })), ...catalogPosts].filter(
    (p) => !platform.removedPosts.includes(p.id)
  );
  const iBlocked = !!user && hasBlocked(platform.blocks, user.id, creator.id);
  const blockedMe = !!user && blockedByProfile(platform.blocks, user.id, creator.id);
  // Admins run the platform's own profiles (e.g. "Perfil IA") and publish for them.
  const managesProfile = user?.role === 'admin' && !!creator.managed;
  const isOwner = managesProfile || (!!user?.creatorProfileId && user.creatorProfileId === creator.id);
  const isSubscribed = hasSubscription(creator.id) && !iBlocked && !blockedMe;
  const mySub = subscriptionOf(creator.id);
  const canView = (p: DisplayPost) => !p.isLocked || isSubscribed || isOwner;
  const totalLikes = creator.likes + Object.values(feed.engagement).reduce((sum, e) => sum + e.likes, 0);
  const removePost = async (postId: string) => {
    if (!window.confirm('¿Eliminar esta publicación? También se borrará su foto o video.')) return;
    const result = await deletePost(postId);
    if (result.ok) platformChanged();
    setTipSent(result.ok ? 'Publicación eliminada.' : result.error || 'No se pudo eliminar');
  };
  const goLogin = () => navigate('/login', { state: { from: location.pathname } });

  const handleSubscribe = () => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: location.pathname } });
      return;
    }
    if (isSubscribed) {
      if (mySub?.cancelAt) {
        // Still inside the paid month: keep it going, no new charge.
        platformApi.subscribeAndPay(user!, creator.id, creator.name, creator.subscriptionPrice, '').then(async (r) => {
          await refreshUser();
          setTipSent(r.ok ? 'Tu suscripción vuelve a renovarse cada mes.' : r.error || 'No se pudo reactivar');
        });
        return;
      }
      if (!window.confirm(`¿Cancelar tu suscripción a ${creator.name}? Seguirás viendo su contenido hasta el final del mes que ya pagaste.`)) return;
      cancelSubscription(creator.id).then((r) =>
        setTipSent(r.ok ? `Suscripción cancelada. Tienes acceso hasta el ${formatDay(r.until!)}.` : r.error || 'No se pudo cancelar')
      );
      return;
    }
    setCheckout(true);
  };
  const openTip = (postId?: string) => (!isAuthenticated ? goLogin() : setTipping({ postId }));
  const openGift = (postId?: string) => (!isAuthenticated ? goLogin() : setGifting({ postId }));

  const confirmPayment = async (methodId: string) => {
    const result = await platformApi.subscribeAndPay(user!, creator.id, creator.name, creator.subscriptionPrice, methodId);
    if (!result.ok) return result;
    await refreshUser();
    platformChanged();
    setCheckout(false);
    return result;
  };

  const handleReport = (kind: 'post' | 'creator', targetId: string, label: string) => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: location.pathname } });
      return;
    }
    setReporting({ kind, targetId, label });
  };

  const handleBlock = async () => {
    if (!user) return;
    if (iBlocked) {
      await unblockUser(user, creator.id);
      return;
    }
    if (!window.confirm(`¿Bloquear a ${creator.name}? No podrá contactarte ni ver tu actividad, dejarás de ver su contenido y se cancelará tu suscripción.`)) return;
    await blockUser(user, creator.id, creator.name);
    if (hasSubscription(creator.id)) await toggleSubscription(creator.id, creator.subscriptionPrice);
  };

  if (blockedMe) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <i aria-hidden="true" className="fas fa-user-lock text-5xl text-gray-300 mb-4"></i>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Perfil no disponible</h1>
          <p className="text-gray-600 mb-6">No puedes ver el contenido de este perfil.</p>
          <Link to="/explore" className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-medium">
            Explorar creadores
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Cover */}
      <CoverImage src={creator.cover} seed={creator.id + creator.name} className="h-48 md:h-72">
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>
      </CoverImage>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Profile Header */}
        <div className="relative -mt-14 mb-6">
          <Avatar src={creator.avatar} name={creator.name} size={112} className="ring-4 ring-white shadow-lg" />
          <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-display-md text-ink">{creator.name}</h1>
                {creator.isVerified && (
                  <span className="flex items-center bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-medium">
                    <i aria-hidden="true" className="fas fa-check-circle mr-1"></i> Verificado
                  </span>
                )}
                <ManagedBadge creator={creator} size="md" />
                <LevelBadge level={levels[creator.id]} />
              </div>
              <p className="text-gray-500">@{creator.username}</p>

            </div>
            <div className="flex flex-wrap items-center gap-2">
              {iBlocked ? (
                <button onClick={handleBlock} className="px-6 py-3 rounded-full font-bold bg-gray-200 text-gray-700 hover:bg-gray-300">
                  <i aria-hidden="true" className="fas fa-unlock mr-2"></i>Desbloquear
                </button>
              ) : isAuthenticated && user?.role !== 'creator' && !isOwner ? (
                <button
                  onClick={handleSubscribe}
                  className={`px-6 py-3 rounded-full font-bold transition-all ${
                    isSubscribed
                      ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      : 'bg-gradient-to-r from-pink-500 to-purple-600 text-white hover:opacity-90 shadow-lg'
                  }`}
                >
                  {isSubscribed && mySub?.cancelAt ? (
                    <><i aria-hidden="true" className="fas fa-redo mr-2"></i>Activa hasta el {formatDay(mySub.cancelAt)} · Reactivar</>
                  ) : isSubscribed ? (
                    <><i aria-hidden="true" className="fas fa-check mr-2"></i>Suscrito · Cancelar</>
                  ) : (
                    <><i aria-hidden="true" className="fas fa-star mr-2"></i>Suscribirse ${creator.subscriptionPrice}/mes</>
                  )}
                </button>
              ) : !isAuthenticated ? (
                <Link to="/login" state={{ from: location.pathname }} className="px-6 py-3 rounded-full font-bold bg-gradient-to-r from-pink-500 to-purple-600 text-white hover:opacity-90 shadow-lg inline-block">
                  Iniciar sesión para suscribirse
                </Link>
              ) : null}
              {managesProfile && (
                <button
                  onClick={() => setComposing(!composing)}
                  className="px-6 py-3 rounded-full font-bold bg-gradient-to-r from-pink-500 to-purple-600 text-white hover:opacity-90 shadow-lg"
                >
                  <i aria-hidden="true" className="fas fa-plus mr-2"></i>Publicar como {creator.name}
                </button>
              )}
              {isOwner && !managesProfile && (
                <Link to="/creator/dashboard?tab=content" className="px-6 py-3 rounded-full font-bold bg-gradient-to-r from-pink-500 to-purple-600 text-white hover:opacity-90 shadow-lg">
                  <i aria-hidden="true" className="fas fa-plus mr-2"></i>Nueva publicación
                </Link>
              )}
              {!isOwner && !iBlocked && (
                <button
                  onClick={() => openGift()}
                  aria-label="Enviar regalo"
                  className="px-5 py-3 rounded-full font-bold bg-white border border-pink-200 text-pink-600 hover:bg-pink-50"
                >
                  <i aria-hidden="true" className="fas fa-gift mr-2"></i>Regalo
                </button>
              )}
              {!isOwner && !iBlocked && (
                <button
                  onClick={() => openTip()}
                  title="Propina: apoya con un monto libre"
                  aria-label="Enviar propina"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 hover:border-gray-300 hover:text-ink"
                >
                  <i aria-hidden="true" className="fas fa-hand-holding-dollar text-gray-500"></i>
                  <span>Propina</span>
                </button>
              )}
              {isAuthenticated && !iBlocked && !isOwner && (
                <button onClick={handleBlock} title="Bloquear" aria-label="Bloquear" className="w-11 h-11 rounded-full bg-white border border-gray-200 text-gray-500 hover:text-red-500">
                  <i aria-hidden="true" className="fas fa-ban"></i>
                </button>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="flex space-x-6 mt-6 text-sm">
            <div className="text-center">
              <p className="font-bold text-gray-900">{compactCount(creator.followers + follow.count)}</p>
              <p className="text-gray-500">Seguidores</p>
            </div>
            <div className="text-center">
              <p className="font-bold text-gray-900">{catalogCreator ? creator.postsCount + feed.own.length : feed.own.length}</p>
              <p className="text-gray-500">Publicaciones</p>
            </div>
            <div className="text-center">
              <p className="font-bold text-gray-900">{compactCount(totalLikes)}</p>
              <p className="text-gray-500">Me gusta</p>
            </div>
          </div>
        </div>

        {/* Bio */}
        <div className="bg-white rounded-2xl p-6 shadow-sm mb-6">
          <p className="text-gray-700">{creator.bio}</p>
          <div className="flex flex-wrap gap-2 mt-4">
            {creator.tags.map((tag) => (
              <span key={tag} className="bg-pink-50 text-pink-700 px-3 py-1 rounded-full text-sm">
                #{tag}
              </span>
            ))}
          </div>
        </div>

        {!iBlocked && !blockedMe && (
          <>
            <AccessLadder
              creator={{ ...creator, followers: creator.followers + follow.count }}
              user={user}
              isOwner={isOwner}
              isSubscribed={isSubscribed}
              following={follow.following}
              experiences={experiences.length}
              onSubscribe={handleSubscribe}
              onNeedLogin={goLogin}
            />
            <CreatorReserveSection creator={creator} experiences={experiences} user={user} isOwner={isOwner} onNeedLogin={goLogin} />
          </>
        )}

        {/* Tabs */}
        <div className="flex space-x-1 bg-white rounded-xl p-1 shadow-sm mb-6">
          <button
            onClick={() => setActiveTab('posts')}
            className={`flex-auto sm:flex-1 whitespace-nowrap px-2 py-2.5 rounded-lg text-[13px] sm:text-sm font-medium transition ${activeTab === 'posts' ? 'bg-pink-100 text-pink-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <i aria-hidden="true" className="fas fa-stream mr-1 max-sm:hidden!"></i> Publicaciones
          </button>
          <button
            onClick={() => setActiveTab('media')}
            className={`flex-auto sm:flex-1 whitespace-nowrap px-2 py-2.5 rounded-lg text-[13px] sm:text-sm font-medium transition ${activeTab === 'media' ? 'bg-pink-100 text-pink-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <i aria-hidden="true" className="fas fa-images mr-1 max-sm:hidden!"></i> Media
          </button>
          <button
            onClick={() => setActiveTab('circle')}
            className={`flex-auto sm:flex-1 whitespace-nowrap px-2 py-2.5 rounded-lg text-[13px] sm:text-sm font-medium transition ${activeTab === 'circle' ? 'bg-pink-100 text-pink-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <i aria-hidden="true" className="fas fa-users mr-1 max-sm:hidden!"></i> Círculo
          </button>
          <button
            onClick={() => setActiveTab('about')}
            className={`flex-auto sm:flex-1 whitespace-nowrap px-2 py-2.5 rounded-lg text-[13px] sm:text-sm font-medium transition ${activeTab === 'about' ? 'bg-pink-100 text-pink-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <i aria-hidden="true" className="fas fa-info-circle mr-1 max-sm:hidden!"></i> <span className="sm:hidden">Info</span><span className="hidden sm:inline">Acerca de</span>
          </button>
        </div>

        {iBlocked && (
          <div className="bg-white rounded-2xl p-6 shadow-sm mb-6 text-center text-gray-600">
            <i aria-hidden="true" className="fas fa-ban text-3xl text-gray-300 mb-2"></i>
            <p>Has bloqueado a {creator.name}. Desbloquéalo para volver a ver su contenido.</p>
          </div>
        )}

        {/* Content */}
        {!iBlocked && activeTab === 'posts' && (
          <div className="space-y-6">
            {composing && managesProfile && (
              <NewPostForm
                verified
                asProfileId={creator.id}
                onPublished={() => { setComposing(false); setTipSent('Publicación creada.'); }}
                onCancel={() => setComposing(false)}
              />
            )}
            {tipSent && (
              <div role="status" className="px-4 py-3 rounded-xl border bg-green-50 border-green-200 text-green-700">{tipSent}</div>
            )}
            {creatorPosts.length > 0 ? creatorPosts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                engagement={feed.engagement[post.id]}
                viewer={user}
                canView={canView(post)}
                isOwner={isOwner}
                subscribeLabel={`Suscribirse $${creator.subscriptionPrice}/mes`}
                onSubscribe={handleSubscribe}
                onNeedLogin={goLogin}
                onTip={() => openTip(post.id)}
                onGift={() => openGift(post.id)}
                onDelete={feed.own.some((p) => p.id === post.id) && isOwner ? () => removePost(post.id) : undefined}
                onReport={() => handleReport('post', post.id, `Publicación de ${creator.name}: "${post.content.slice(0, 40)}"`)}
              />
            )) : (
              <div className="text-center py-12 bg-white rounded-2xl">
                <i aria-hidden="true" className="fas fa-image text-4xl text-gray-300 mb-4"></i>
                <p className="text-gray-500">No hay publicaciones aún</p>
              </div>
            )}
          </div>
        )}

        {!iBlocked && activeTab === 'media' && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {creatorPosts.filter(p => p.mediaUrl || p.mediaType).map((post) => (
              <a key={post.id} href={`#post-${post.id}`} onClick={() => setActiveTab('posts')} className="relative aspect-square rounded-xl overflow-hidden group cursor-pointer">
                {post.mediaType === 'video' && post.mediaUrl && canView(post) ? (
                  <video src={post.mediaUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                ) : (
                  <CoverImage
                    src={canView(post) && !isPlaceholderImage(post.mediaUrl) ? post.mediaUrl : null}
                    seed={`post-${post.id}`}
                    className="h-full w-full"
                    imgClassName="group-hover:scale-105 transition-transform"
                  />
                )}
                {post.mediaType === 'video' && canView(post) && (
                  <span className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full"><i aria-hidden="true" className="fas fa-play"></i></span>
                )}
                {!canView(post) && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <i aria-hidden="true" className="fas fa-lock text-white text-xl"></i>
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 group-hover:opacity-100 transition">
                  <div className="flex items-center space-x-3 text-white text-xs">
                    <span><i aria-hidden="true" className="fas fa-heart mr-1"></i>{compactCount(post.baseLikes + (feed.engagement[post.id]?.likes ?? 0))}</span>
                    <span><i aria-hidden="true" className="fas fa-comment mr-1"></i>{compactCount(post.baseComments + (feed.engagement[post.id]?.comments ?? 0))}</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}

        {!iBlocked && activeTab === 'circle' && (
          <>
            {tipSent && (
              <div role="status" className="px-4 py-3 mb-6 rounded-xl border bg-green-50 border-green-200 text-green-700">{tipSent}</div>
            )}
            <CircleSection user={user} creatorProfileId={creator.id} creatorName={creator.name} onSubscribe={isOwner || user?.role === 'creator' ? undefined : handleSubscribe} />
          </>
        )}

        {!iBlocked && activeTab === 'about' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h3 className="font-bold text-lg text-gray-900 mb-4">Acerca de {creator.name}</h3>
            <div className="space-y-4 text-gray-600">
              <div className="flex items-center space-x-3">
                <i aria-hidden="true" className="fas fa-map-marker-alt text-pink-500 w-5"></i>
                <span>Latinoamérica</span>
              </div>
              <div className="flex items-center space-x-3">
                <i aria-hidden="true" className="fas fa-calendar text-pink-500 w-5"></i>
                <span>Miembro desde Enero 2024</span>
              </div>
              <div className="flex items-center space-x-3">
                <i aria-hidden="true" className="fas fa-shield-alt text-pink-500 w-5"></i>
                <span>Identidad verificada</span>
              </div>
              <div className="flex items-center space-x-3">
                <i aria-hidden="true" className="fas fa-clock text-pink-500 w-5"></i>
                <span>Publica contenido nuevo cada semana</span>
              </div>
            </div>
            <hr className="my-6" />
            <div className="flex space-x-4">
              <button onClick={() => handleReport('creator', creator.id, `Perfil de ${creator.name}`)} className="text-gray-500 hover:text-pink-500 transition">
                <i aria-hidden="true" className="fas fa-flag text-sm"></i> Reportar perfil
              </button>
              <button className="text-gray-500 hover:text-pink-500 transition">
                <i aria-hidden="true" className="fas fa-share text-sm"></i> Compartir perfil
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="h-16"></div>

      {checkout && user && (
        <CheckoutDialog
          user={user}
          title={`Suscripción a ${creator.name}`}
          amount={creator.subscriptionPrice}
          note={`Mensual. Se renueva el día ${addMonths(new Date().toISOString(), 1).getDate()} de cada mes; cancela cuando quieras.`}
          confirmLabel="Suscribirme y pagar"
          extra={<ReserveNotice kind="subscription" />}
          onConfirm={confirmPayment}
          onClose={() => setCheckout(false)}
        />
      )}
      {tipping && user && (
        <TipDialog
          user={user}
          creatorProfileId={creator.id}
          creatorName={creator.name}
          postId={tipping.postId}
          onDone={(amount) => {
            setTipping(null);
            setTipSent(`¡Gracias! Tu propina de $${amount.toFixed(2)} llegó a ${creator.name}.`);
            setActiveTab('posts');
          }}
          onClose={() => setTipping(null)}
        />
      )}
      {gifting && user && (
        <GiftDialog
          user={user}
          creatorProfileId={creator.id}
          creatorName={creator.name}
          postId={gifting.postId}
          onSent={(gift) => {
            setGifting(null);
            setCelebrating(gift);
            setTipSent(`¡${gift.icon} ${gift.name} enviado a ${creator.name}!`);
          }}
          onClose={() => setGifting(null)}
        />
      )}
      {celebrating && <GiftCelebration gift={celebrating} caption={`¡${celebrating.name} para ${creator.name}!`} onDone={() => setCelebrating(null)} />}
      {reporting && (
        <ReportDialog kind={reporting.kind} targetId={reporting.targetId} targetLabel={reporting.label} onClose={() => setReporting(null)} />
      )}
    </div>
  );
};

export default CreatorProfile;
