import React from 'react';
import { Link } from 'react-router-dom';
import { creators, categories } from '../data/mockData';

const Landing: React.FC = () => {
  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-pink-500 via-purple-600 to-indigo-700 text-white overflow-hidden">
        <div className="absolute inset-0 opacity-30">
          <img src="https://image.qwenlm.ai/generated-images/90608979-d217-4abb-837f-cf9db9913897/_result.png" alt="" className="w-full h-full object-cover" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-br from-pink-500/80 via-purple-600/80 to-indigo-700/80"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-32 relative z-10">
          <div className="text-center max-w-3xl mx-auto">
            <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight">
              Conecta con tus <span className="text-yellow-300">creadores favoritos</span>
            </h1>
            <p className="text-lg md:text-xl text-pink-100 mb-8">
              Descubre contenido exclusivo de miles de creadores. Suscríbete, apoya y disfruta de experiencias únicas.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/register" className="bg-white text-purple-700 px-8 py-4 rounded-full font-bold text-lg hover:bg-yellow-300 hover:text-purple-800 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5">
                Comenzar Gratis
              </Link>
              <Link to="/explore" className="border-2 border-white text-white px-8 py-4 rounded-full font-bold text-lg hover:bg-white hover:text-purple-700 transition-all">
                Explorar Creadores
              </Link>
            </div>
            <div className="mt-12 flex justify-center items-center space-x-8 text-sm text-pink-200">
              <div className="flex items-center"><i className="fas fa-users mr-2"></i> +50K Creadores</div>
              <div className="flex items-center"><i className="fas fa-shield-alt mr-2"></i> 100% Seguro</div>
              <div className="flex items-center"><i className="fas fa-lock mr-2"></i> Pagos Seguros</div>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Creators */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Creadores Destacados</h2>
            <p className="text-gray-600">Descubre a los creadores más populares de nuestra plataforma</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {creators.slice(0, 6).map((creator) => (
              <Link to={`/creator/${creator.id}`} key={creator.id} className="bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all overflow-hidden group">
                <div className="h-32 bg-gradient-to-r from-pink-400 to-purple-500 relative overflow-hidden">
                  <img src={creator.cover} alt="" className="w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-300" />
                </div>
                <div className="p-5 -mt-10 relative">
                  <img src={creator.avatar} alt={creator.name} className="w-16 h-16 rounded-full border-4 border-white shadow-md" />
                  <div className="mt-3">
                    <div className="flex items-center">
                      <h3 className="font-bold text-gray-900">{creator.name}</h3>
                      {creator.isVerified && <i className="fas fa-check-circle text-blue-500 ml-1 text-sm"></i>}
                    </div>
                    <p className="text-sm text-gray-500 mt-1 line-clamp-2">{creator.bio}</p>
                    <div className="flex justify-between items-center mt-4">
                      <span className="text-sm text-gray-500">
                        <i className="fas fa-users mr-1"></i> {(creator.followers / 1000).toFixed(1)}K
                      </span>
                      <span className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-3 py-1 rounded-full text-sm font-medium">
                        ${creator.subscriptionPrice}/mes
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <div className="text-center mt-10">
            <Link to="/explore" className="inline-flex items-center text-pink-600 font-medium hover:text-pink-700">
              Ver todos los creadores <i className="fas fa-arrow-right ml-2"></i>
            </Link>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Explora por Categorías</h2>
            <p className="text-gray-600">Encuentra exactamente lo que buscas</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {categories.map((cat) => (
              <Link to="/explore" key={cat.id} className="bg-white rounded-xl p-6 text-center shadow-sm hover:shadow-md transition-all hover:-translate-y-1 border border-gray-100">
                <div className="text-4xl mb-3">{cat.icon}</div>
                <h3 className="font-semibold text-gray-900">{cat.name}</h3>
                <p className="text-sm text-gray-500 mt-1">{cat.count.toLocaleString()} creadores</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 bg-gradient-to-br from-purple-50 to-pink-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">¿Cómo funciona?</h2>
            <p className="text-gray-600">Es fácil comenzar en SugarFans</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-pink-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-user-plus text-2xl text-pink-600"></i>
              </div>
              <h3 className="font-bold text-lg mb-2">1. Crea tu cuenta</h3>
              <p className="text-gray-600">Regístrate gratis y verifica tu edad para acceder a todo el contenido.</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-search text-2xl text-purple-600"></i>
              </div>
              <h3 className="font-bold text-lg mb-2">2. Descubre creadores</h3>
              <p className="text-gray-600">Explora perfiles, encuentra tu contenido favorito y suscríbete.</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-heart text-2xl text-indigo-600"></i>
              </div>
              <h3 className="font-bold text-lg mb-2">3. Disfruta y apoya</h3>
              <p className="text-gray-600">Accede a contenido exclusivo, envía mensajes y apoya a tus favoritos.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-gradient-to-r from-pink-500 to-purple-600 text-white">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-4">¿Eres creador de contenido?</h2>
          <p className="text-pink-100 text-lg mb-8">
            Únete a SugarFans y monetiza tu contenido. Controla tus precios, conecta con tus fans y crece tu comunidad.
          </p>
          <Link to="/register" className="bg-white text-purple-700 px-8 py-4 rounded-full font-bold text-lg hover:bg-yellow-300 transition-all inline-block">
            Comenzar como Creador
          </Link>
        </div>
      </section>
    </div>
  );
};

export default Landing;
