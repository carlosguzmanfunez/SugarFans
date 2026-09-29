import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { creators, categories, posts } from '../data/mockData';
import { useAuth } from '../context/AuthContext';

const Explore: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [viewMode, setViewMode] = useState<'creators' | 'posts'>('creators');

  const filteredCreators = creators.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.username.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = !selectedCategory || c.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search & Filters */}
        <div className="mb-8">
          <div className="relative max-w-2xl mx-auto">
            <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-4 bg-white border border-gray-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none text-lg"
              placeholder="Buscar creadores, contenido..."
            />
          </div>

          {/* Categories */}
          <div className="flex flex-wrap justify-center gap-2 mt-6">
            <button
              onClick={() => setSelectedCategory('')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                !selectedCategory ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              Todos
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.name)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                  selectedCategory === cat.name ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                {cat.icon} {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* View Toggle */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex space-x-2">
            <button
              onClick={() => setViewMode('creators')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${viewMode === 'creators' ? 'bg-pink-100 text-pink-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <i className="fas fa-users mr-1"></i> Creadores
            </button>
            <button
              onClick={() => setViewMode('posts')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${viewMode === 'posts' ? 'bg-pink-100 text-pink-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <i className="fas fa-th mr-1"></i> Publicaciones
            </button>
          </div>
          <span className="text-sm text-gray-500">{filteredCreators.length} resultados</span>
        </div>

        {/* Creators Grid */}
        {viewMode === 'creators' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCreators.map((creator) => (
              <Link to={`/creator/${creator.id}`} key={creator.id} className="bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all overflow-hidden group">
                <div className="h-28 relative overflow-hidden">
                  <img src={creator.cover} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent"></div>
                </div>
                <div className="p-5 -mt-8 relative">
                  <div className="flex items-end space-x-3">
                    <img src={creator.avatar} alt={creator.name} className="w-14 h-14 rounded-full border-3 border-white shadow-md" />
                    <div className="pb-1">
                      <div className="flex items-center">
                        <h3 className="font-bold text-gray-900 text-sm">{creator.name}</h3>
                        {creator.isVerified && <i className="fas fa-check-circle text-blue-500 ml-1 text-xs"></i>}
                      </div>
                      <p className="text-xs text-gray-500">@{creator.username}</p>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 mt-3 line-clamp-2">{creator.bio}</p>
                  <div className="flex justify-between items-center mt-4">
                    <div className="flex space-x-3 text-xs text-gray-500">
                      <span><i className="fas fa-users mr-1"></i>{(creator.followers / 1000).toFixed(1)}K</span>
                      <span><i className="fas fa-heart mr-1"></i>{(creator.likes / 1000).toFixed(1)}K</span>
                      <span><i className="fas fa-image mr-1"></i>{creator.postsCount}</span>
                    </div>
                    <span className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-3 py-1 rounded-full text-xs font-bold">
                      ${creator.subscriptionPrice}/mes
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Posts Grid */}
        {viewMode === 'posts' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {posts.map((post) => (
              <div key={post.id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="p-4 flex items-center space-x-3">
                  <img src={post.creatorAvatar} alt="" className="w-10 h-10 rounded-full" />
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{post.creatorName}</p>
                    <p className="text-xs text-gray-500">{new Date(post.createdAt).toLocaleDateString('es')}</p>
                  </div>
                </div>
                <div className="relative">
                  {post.media && <img src={post.media} alt="" className="w-full h-64 object-cover" />}
                  {post.isLocked && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                      <div className="text-center text-white">
                        <i className="fas fa-lock text-3xl mb-2"></i>
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
                      <i className="fas fa-heart mr-1"></i> {post.likes}
                    </button>
                    <button className="flex items-center text-sm hover:text-pink-500 transition">
                      <i className="fas fa-comment mr-1"></i> {post.comments}
                    </button>
                    <button className="flex items-center text-sm hover:text-pink-500 transition">
                      <i className="fas fa-gift mr-1"></i> Propina
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
