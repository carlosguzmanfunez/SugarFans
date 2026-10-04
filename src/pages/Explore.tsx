import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { categories, posts } from '../data/mockData';
import { useCreatorCatalog, useVipCreatorIds } from '../lib/catalog';
import CreatorCard from '../components/CreatorCard';
import Avatar from '../components/Avatar';
import { CoverImage } from '../components/CoverArt';
import { categoryVisual } from '../config/theme';
import { categoryFor, isKnownCategory } from '../config/reserve';
import { featuredFirst, useFeatured } from '../lib/rewards';
import { useAuth } from '../context/AuthContext';
import { usePlatformQuery, platformApi, isCutOff } from '../lib/platform';
import { useLiveCreatorIds } from '../lib/live';
import { LiveRail, ReserveRail, RailHeading } from '../components/AppRails';

const Explore: React.FC = () => {
  const { isAuthenticated, user } = useAuth();
  const { creators } = useCreatorCatalog();
  const featured = useFeatured();
  const featuredIds = new Map(featured.map((f) => [f.creatorProfileId, f.level]));
  const vipIds = useVipCreatorIds();
  const [params] = useSearchParams();
  const { data: platform } = usePlatformQuery(
    async () => {
      const [removedPosts, blocks] = await Promise.all([platformApi.removedPosts(), user ? platformApi.blocks(user) : Promise.resolve([])]);
      return { removedPosts, blocks };
    },
    [user?.id],
    { removedPosts: [] as string[], blocks: [] as Awaited<ReturnType<typeof platformApi.blocks>> }
  );
  // Blocked profiles (either direction) and posts removed by moderation are hidden.
  const hidden = (creatorId: string) => !!user && isCutOff(platform.blocks, user.id, creatorId);
  const visiblePosts = posts.filter((p) => !platform.removedPosts.includes(p.id) && !hidden(p.creatorId));
  const [searchQuery, setSearchQuery] = useState('');
  // ?category=<name> preselects a category (landing tiles link here).
  const [selectedCategory, setSelectedCategory] = useState(() => {
    const requested = params.get('category') ?? '';
    const match = categories.find((c) => c.name === requested || (isKnownCategory(requested) && categoryFor(requested).id === c.id));
    return match?.name ?? '';
  });
  const [viewMode, setViewMode] = useState<'creators' | 'posts'>('creators');
  // ?live=1 (the Live tab) shows only the creators in Live right now.
  const liveOnly = params.has('live');
  const visibleCreators = creators.filter((c) => !hidden(c.id));
  const liveIds = useLiveCreatorIds(visibleCreators.map((c) => c.id));
  const browsing = !searchQuery && !selectedCategory && !liveOnly;

  const filteredCreators = featuredFirst(creators, featured).filter(c => {
    if (hidden(c.id)) return false;
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.username.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = !selectedCategory || (!!c.category && categoryFor(c.category).id === categoryFor(selectedCategory).id);
    return matchesSearch && matchesCategory && (!liveOnly || liveIds.has(c.id));
  });

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        {/* Search & Filters */}
        <div className="mb-8">
          <h1 className="text-display-md text-ink md:text-center">
            {liveOnly ? (
              <><span className="live-dot mr-3 inline-block h-3 w-3 rounded-full bg-red-500 align-middle" aria-hidden="true"></span>En Live ahora</>
            ) : 'Explora creadores'}
          </h1>
          <div className="relative max-w-2xl mx-auto mt-5 md:mt-6">
            <i className="fas fa-search absolute left-5 top-1/2 -translate-y-1/2 text-ink/35" aria-hidden="true"></i>
            <input
              type="search"
              aria-label="Buscar creadores"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3.5 md:py-4 bg-white border border-line rounded-2xl shadow-[var(--shadow-card)] focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none text-base md:text-lg"
              placeholder="Buscar creadores, contenido..."
            />
          </div>

          {!liveOnly && (
            <section aria-label="Creadores y Live" className="mx-auto mt-6 max-w-5xl">
              <LiveRail creators={visibleCreators} liveIds={liveIds} className="md:justify-center" />
            </section>
          )}

          {/* Categories */}
          <div className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide md:mx-0 md:flex-wrap md:justify-center md:px-0">
            <button
              onClick={() => setSelectedCategory('')}
              aria-pressed={!selectedCategory}
              className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium transition ${
                !selectedCategory ? 'bg-ink text-white' : 'bg-white text-ink/70 hover:bg-white hover:text-ink border border-line'
              }`}
            >
              Todos
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.name)}
                aria-pressed={selectedCategory === cat.name}
                className={`shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition ${
                  selectedCategory === cat.name ? 'bg-ink text-white' : 'bg-white text-ink/70 hover:text-ink border border-line'
                }`}
              >
                <i className={`fas ${categoryVisual(cat.name).icon} text-xs ${selectedCategory === cat.name ? 'text-gold-200' : 'text-brand-600'}`} aria-hidden="true"></i>
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {browsing && (
          <section aria-labelledby="reserve-rail-title" className="mb-10">
            <RailHeading id="reserve-rail-title" title="Reserve disponible" to="/reserve" icon="fa-ticket" tone="text-gold-600" />
            <ReserveRail creators={visibleCreators} />
          </section>
        )}

        {liveOnly && filteredCreators.length === 0 && (
          <div className="mb-10 rounded-3xl border border-line bg-white px-6 py-10 text-center" data-testid="live-empty">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-xl text-red-600">
              <i className="fas fa-tower-broadcast" aria-hidden="true"></i>
            </span>
            <p className="text-lg font-semibold text-ink">Nadie está en Live en este momento</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              Sigue a tus creators y activa la campanita en su perfil: te avisamos apenas empiecen un Live.
            </p>
            <Link to="/explore" className="btn btn-dark btn-md mt-6">Ver creadores</Link>
          </div>
        )}

        {/* View Toggle */}
        {!liveOnly && <div className="flex items-center justify-between mb-6">
          <div className="flex space-x-2">
            <button
              onClick={() => setViewMode('creators')}
              aria-pressed={viewMode === 'creators'}
              className={`whitespace-nowrap px-3 sm:px-4 py-2 rounded-full text-sm font-medium ${viewMode === 'creators' ? 'bg-brand-50 text-brand-700' : 'text-ink/60 hover:bg-white'}`}
            >
              <i aria-hidden="true" className="fas fa-users mr-1"></i> Creadores
            </button>
            <button
              onClick={() => setViewMode('posts')}
              aria-pressed={viewMode === 'posts'}
              className={`whitespace-nowrap px-3 sm:px-4 py-2 rounded-full text-sm font-medium ${viewMode === 'posts' ? 'bg-brand-50 text-brand-700' : 'text-ink/60 hover:bg-white'}`}
            >
              <i aria-hidden="true" className="fas fa-th mr-1"></i> Publicaciones
            </button>
          </div>
          <span className="whitespace-nowrap text-xs text-muted sm:text-sm">{filteredCreators.length} resultados</span>
        </div>}

        {/* Creators Grid */}
        {viewMode === 'creators' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCreators.map((creator) => (
              <CreatorCard
                key={creator.id}
                creator={creator}
                level={featuredIds.get(creator.id)}
                featured={featuredIds.has(creator.id)}
                vip={vipIds.has(creator.id)}
              />
            ))}
          </div>
        )}

        {/* Posts Grid */}
        {viewMode === 'posts' && !liveOnly && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {visiblePosts.map((post) => (
              <div key={post.id} className="card overflow-hidden">
                <div className="p-4 flex items-center space-x-3">
                  <Avatar src={post.creatorAvatar} name={post.creatorName} size={40} decorative />
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{post.creatorName}</p>
                    <p className="text-xs text-gray-500">{new Date(post.createdAt).toLocaleDateString('es')}</p>
                  </div>
                </div>
                <div className="relative">
                  {post.media && <CoverImage src={post.media} seed={`post-${post.id}`} className="h-64" />}
                  {post.isLocked && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                      <div className="text-center text-white">
                        <i aria-hidden="true" className="fas fa-lock text-3xl mb-2"></i>
                        <p className="font-medium">Contenido exclusivo</p>
                        {post.price && <p className="text-sm mt-1">Desbloquear por ${post.price}</p>}
                        {!isAuthenticated && <p className="text-xs mt-2 text-pink-200">Inicia sesión para ver</p>}
                      </div>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <p className="text-sm text-gray-700">{post.content}</p>
                  <div className="flex items-center space-x-6 mt-3 text-gray-500">
                    <button className="flex items-center text-sm hover:text-pink-500 transition">
                      <i aria-hidden="true" className="fas fa-heart mr-1"></i> {post.likes}
                    </button>
                    <button className="flex items-center text-sm hover:text-pink-500 transition">
                      <i aria-hidden="true" className="fas fa-comment mr-1"></i> {post.comments}
                    </button>
                    <button className="flex items-center text-sm hover:text-pink-500 transition">
                      <i aria-hidden="true" className="fas fa-gift mr-1"></i> Propina
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Explore;
