import React, { useState } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { posts } from '../data/mockData';
import { useCreatorCatalog } from '../lib/catalog';
import ManagedBadge from '../components/ManagedBadge';
import { useAuth } from '../context/AuthContext';
import CheckoutDialog from '../components/CheckoutDialog';
import ReportDialog from '../components/ReportDialog';
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

const CreatorProfile: React.FC = () => {
  const { id } = useParams();
  const { isAuthenticated, user, isSubscribed: hasSubscription, toggleSubscription, refreshUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<'posts' | 'media' | 'about'>('posts');
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

  const { creators, loading: catalogLoading } = useCreatorCatalog();
  const creator = creators.find(c => c.id === id);

  if (!creator && catalogLoading) return null;
  if (!creator) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <i className="fas fa-user-slash text-5xl text-gray-300 mb-4"></i>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Creador no encontrado</h1>
          <p className="text-gray-600 mb-6">Este perfil no existe o fue eliminado.</p>
          <Link to="/explore" className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-medium">
            Explorar creadores
          </Link>
        </div>
      </div>
    );
  }

  const creatorPosts = posts.filter(p => p.creatorId === creator.id && !platform.removedPosts.includes(p.id));
  const iBlocked = !!user && hasBlocked(platform.blocks, user.id, creator.id);
  const blockedMe = !!user && blockedByProfile(platform.blocks, user.id, creator.id);
  const isSubscribed = hasSubscription(creator.id) && !iBlocked && !blockedMe;

  const handleSubscribe = () => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: location.pathname } });
      return;
    }
    if (isSubscribed) {
      if (window.confirm(`¿Cancelar tu suscripción a ${creator.name}?`)) toggleSubscription(creator.id, creator.subscriptionPrice);
      return;
    }
    setCheckout(true);
  };

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
          <i className="fas fa-user-lock text-5xl text-gray-300 mb-4"></i>
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
      <div className="relative h-48 md:h-64 overflow-hidden">
        <img src={creator.cover} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent"></div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Profile Header */}
        <div className="relative -mt-16 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-end sm:space-x-6">
            <img
              src={creator.avatar}
              alt={creator.name}
              className="w-28 h-28 rounded-full border-4 border-white shadow-lg"
            />
            <div className="mt-4 sm:mt-0 flex-1">
              <div className="flex items-center space-x-2">
                <h1 className="text-2xl font-bold text-gray-900">{creator.name}</h1>
                {creator.isVerified && (
                  <span className="flex items-center bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-medium">
                    <i className="fas fa-check-circle mr-1"></i> Verificado
                  </span>
                )}
                <ManagedBadge creator={creator} size="md" />
              </div>
              <p className="text-gray-500">@{creator.username}</p>
              {creator.managed === 'ai' && (
                <p className="text-xs text-purple-700 mt-1">Personaje creado con inteligencia artificial y gestionado por SugarFans. No es una persona real.</p>
              )}
            </div>
            <div className="mt-4 sm:mt-0 flex items-center gap-2">
              {iBlocked ? (
                <button onClick={handleBlock} className="px-6 py-3 rounded-full font-bold bg-gray-200 text-gray-700 hover:bg-gray-300">
                  <i className="fas fa-unlock mr-2"></i>Desbloquear
                </button>
              ) : isAuthenticated && user?.role !== 'creator' ? (
                <button
                  onClick={handleSubscribe}
                  className={`px-6 py-3 rounded-full font-bold transition-all ${
                    isSubscribed
                      ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      : 'bg-gradient-to-r from-pink-500 to-purple-600 text-white hover:opacity-90 shadow-lg'
                  }`}
                >
                  {isSubscribed ? (
                    <><i className="fas fa-check mr-2"></i>Suscrito · Cancelar</>
                  ) : (
                    <><i className="fas fa-star mr-2"></i>Suscribirse ${creator.subscriptionPrice}/mes</>
                  )}
                </button>
              ) : !isAuthenticated ? (
                <Link to="/login" state={{ from: location.pathname }} className="px-6 py-3 rounded-full font-bold bg-gradient-to-r from-pink-500 to-purple-600 text-white hover:opacity-90 shadow-lg inline-block">
                  Iniciar sesión para suscribirse
                </Link>
              ) : null}
              {isAuthenticated && !iBlocked && (
                <button onClick={handleBlock} title="Bloquear" aria-label="Bloquear" className="w-11 h-11 rounded-full bg-white border border-gray-200 text-gray-500 hover:text-red-500">
                  <i className="fas fa-ban"></i>
                </button>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="flex space-x-6 mt-6 text-sm">
            <div className="text-center">
              <p className="font-bold text-gray-900">{(creator.followers / 1000).toFixed(1)}K</p>
              <p className="text-gray-500">Seguidores</p>
            </div>
            <div className="text-center">
              <p className="font-bold text-gray-900">{creator.postsCount}</p>
              <p className="text-gray-500">Publicaciones</p>
            </div>
            <div className="text-center">
              <p className="font-bold text-gray-900">{(creator.likes / 1000).toFixed(1)}K</p>
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

        {/* Tabs */}
        <div className="flex space-x-1 bg-white rounded-xl p-1 shadow-sm mb-6">
          <button
            onClick={() => setActiveTab('posts')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition ${activeTab === 'posts' ? 'bg-pink-100 text-pink-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <i className="fas fa-stream mr-1"></i> Publicaciones
          </button>
          <button
            onClick={() => setActiveTab('media')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition ${activeTab === 'media' ? 'bg-pink-100 text-pink-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <i className="fas fa-images mr-1"></i> Media
          </button>
          <button
            onClick={() => setActiveTab('about')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition ${activeTab === 'about' ? 'bg-pink-100 text-pink-700' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            <i className="fas fa-info-circle mr-1"></i> Acerca de
          </button>
        </div>

        {iBlocked && (
          <div className="bg-white rounded-2xl p-6 shadow-sm mb-6 text-center text-gray-600">
            <i className="fas fa-ban text-3xl text-gray-300 mb-2"></i>
            <p>Has bloqueado a {creator.name}. Desbloquéalo para volver a ver su contenido.</p>
          </div>
        )}

        {/* Content */}
        {!iBlocked && activeTab === 'posts' && (
          <div className="space-y-6">
            {creatorPosts.length > 0 ? creatorPosts.map((post) => (
              <div key={post.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="p-4 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <img src={post.creatorAvatar} alt="" className="w-10 h-10 rounded-full" />
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{post.creatorName}</p>
                      <p className="text-xs text-gray-500">{new Date(post.createdAt).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                    </div>
                  </div>
                  {post.price && !isSubscribed && (
                    <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-xs font-medium">
                      <i className="fas fa-lock mr-1"></i>${post.price}
                    </span>
                  )}
                </div>
                <div className="relative">
                  {post.media && <img src={post.media} alt="" className="w-full h-72 object-cover" />}
                  {(post.isLocked && !isSubscribed) && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                      <div className="text-center text-white p-6">
                        <i className="fas fa-lock text-4xl mb-3"></i>
                        <p className="font-bold text-lg">Contenido exclusivo para suscriptores</p>
                        <p className="text-sm mt-2 text-pink-200">Suscríbete para desbloquear todo el contenido</p>
                        <button
                          onClick={handleSubscribe}
                          className="mt-4 bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-2 rounded-full font-medium hover:opacity-90"
                        >
                          Suscribirse ${creator.subscriptionPrice}/mes
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <p className="text-gray-700">{post.content}</p>
                  <div className="flex items-center space-x-6 mt-4 text-gray-500">
                    <button className="flex items-center text-sm hover:text-pink-500 transition">
                      <i className="fas fa-heart mr-1"></i> {post.likes}
                    </button>
                    <button className="flex items-center text-sm hover:text-pink-500 transition">
                      <i className="fas fa-comment mr-1"></i> {post.comments}
                    </button>
                    <button className="flex items-center text-sm hover:text-pink-500 transition">
                      <i className="fas fa-gift mr-1"></i> Propina
                    </button>
                    <button className="flex items-center text-sm hover:text-pink-500 transition ml-auto">
                      <i className="fas fa-share mr-1"></i> Compartir
                    </button>
                    <button
                      onClick={() => handleReport('post', post.id, `Publicación de ${creator.name}: "${post.content.slice(0, 40)}"`)}
                      className="flex items-center text-sm hover:text-red-500 transition"
                      aria-label="Reportar publicación"
                    >
                      <i className="fas fa-flag mr-1"></i> Reportar
                    </button>
                  </div>
                </div>
              </div>
            )) : (
              <div className="text-center py-12 bg-white rounded-2xl">
                <i className="fas fa-image text-4xl text-gray-300 mb-4"></i>
                <p className="text-gray-500">No hay publicaciones aún</p>
              </div>
            )}
          </div>
        )}

        {!iBlocked && activeTab === 'media' && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {creatorPosts.filter(p => p.media).map((post) => (
              <div key={post.id} className="relative aspect-square rounded-xl overflow-hidden group cursor-pointer">
                <img src={post.media} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                {post.isLocked && !isSubscribed && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <i className="fas fa-lock text-white text-xl"></i>
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 group-hover:opacity-100 transition">
                  <div className="flex items-center space-x-3 text-white text-xs">
                    <span><i className="fas fa-heart mr-1"></i>{post.likes}</span>
                    <span><i className="fas fa-comment mr-1"></i>{post.comments}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!iBlocked && activeTab === 'about' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h3 className="font-bold text-lg text-gray-900 mb-4">Acerca de {creator.name}</h3>
            <div className="space-y-4 text-gray-600">
              <div className="flex items-center space-x-3">
                <i className="fas fa-map-marker-alt text-pink-500 w-5"></i>
                <span>Latinoamérica</span>
              </div>
              <div className="flex items-center space-x-3">
                <i className="fas fa-calendar text-pink-500 w-5"></i>
                <span>Miembro desde Enero 2024</span>
              </div>
              <div className="flex items-center space-x-3">
                <i className="fas fa-shield-alt text-pink-500 w-5"></i>
                <span>Identidad verificada</span>
              </div>
              <div className="flex items-center space-x-3">
                <i className="fas fa-clock text-pink-500 w-5"></i>
                <span>Publica contenido nuevo cada semana</span>
              </div>
            </div>
            <hr className="my-6" />
            <div className="flex space-x-4">
              <button onClick={() => handleReport('creator', creator.id, `Perfil de ${creator.name}`)} className="text-gray-500 hover:text-pink-500 transition">
                <i className="fas fa-flag text-sm"></i> Reportar perfil
              </button>
              <button className="text-gray-500 hover:text-pink-500 transition">
                <i className="fas fa-share text-sm"></i> Compartir perfil
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
          onConfirm={confirmPayment}
          onClose={() => setCheckout(false)}
        />
      )}
      {reporting && (
        <ReportDialog kind={reporting.kind} targetId={reporting.targetId} targetLabel={reporting.label} onClose={() => setReporting(null)} />
      )}
    </div>
  );
};

export default CreatorProfile;
