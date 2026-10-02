import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { categories, posts } from '../data/mockData';
import { useCreatorCatalog, useVipCreatorIds } from '../lib/catalog';
import CreatorCard from '../components/CreatorCard';
import Avatar from '../components/Avatar';
import { CoverImage } from '../components/CoverArt';
import { categoryVisual } from '../config/theme';
import { featuredFirst, useFeatured } from '../lib/rewards';
import { useAuth } from '../context/AuthContext';
import { usePlatformQuery, platformApi, isCutOff } from '../lib/platform';

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
    return categories.some((c) => c.name === requested) ? requested : '';
  });
  const [viewMode, setViewMode] = useState<'creators' | 'posts'>('creators');

  const filteredCreators = featuredFirst(creators, featured).filter(c => {
    if (hidden(c.id)) return false;
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.username.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = !selectedCategory || c.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        {/* Search & Filters */}
        <div className="mb-8">
          <h1 className="text-display-md text-ink text-center">Explora creadores</h1>
          <div className="relative max-w-2xl mx-auto mt-6">
            <i className="fas fa-search absolute left-5 top-1/2 -translate-y-1/2 text-ink/35" aria-hidden="true"></i>
            <input
              type="search"
              aria-label="Buscar creadores"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-4 bg-white border border-line rounded-2xl shadow-[var(--shadow-card)] focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none text-base md:text-lg"
              placeholder="Buscar creadores, contenido..."
            />
          </div>

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

        {/* View Toggle */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex space-x-2">
            <button
              onClick={() => setViewMode('creators')}
              aria-pressed={viewMode === 'creators'}
              className={`px-4 py-2 rounded-full text-sm font-medium ${viewMode === 'creators' ? 'bg-brand-50 text-brand-700' : 'text-ink/60 hover:bg-white'}`}
            >
              <i aria-hidden="true" className="fas fa-users mr-1"></i> Creadores
            </button>
            <button
              onClick={() => setViewMode('posts')}
              aria-pressed={viewMode === 'posts'}
              className={`px-4 py-2 rounded-full text-sm font-medium ${viewMode === 'posts' ? 'bg-brand-50 text-brand-700' : 'text-ink/60 hover:bg-white'}`}
            >
              <i aria-hidden="true" className="fas fa-th mr-1"></i> Publicaciones
            </button>
          </div>
          <span className="text-sm text-gray-500">{filteredCreators.length} resultados</span>
        </div>

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
        {viewMode === 'posts' && (
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
