import React from 'react';
import { Link } from 'react-router-dom';
import { creators, categories } from '../data/mockData';
import { useLanguage } from '../context/LanguageContext';

const Landing: React.FC = () => {
  const { t } = useLanguage();

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
              {t('landing.hero.title1')} <span className="text-yellow-300">{t('landing.hero.title2')}</span>
            </h1>
            <p className="text-lg md:text-xl text-pink-100 mb-8">
              {t('landing.hero.subtitle')}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/register" className="bg-white text-purple-700 px-8 py-4 rounded-full font-bold text-lg hover:bg-yellow-300 hover:text-purple-800 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5">
                {t('landing.hero.cta1')}
              </Link>
              <Link to="/explore" className="border-2 border-white text-white px-8 py-4 rounded-full font-bold text-lg hover:bg-white hover:text-purple-700 transition-all">
                {t('landing.hero.cta2')}
              </Link>
            </div>
            <div className="mt-12 flex justify-center items-center space-x-8 text-sm text-pink-200">
              <div className="flex items-center"><i className="fas fa-users mr-2"></i> {t('landing.hero.stats1')}</div>
              <div className="flex items-center"><i className="fas fa-shield-alt mr-2"></i> {t('landing.hero.stats2')}</div>
              <div className="flex items-center"><i className="fas fa-lock mr-2"></i> {t('landing.hero.stats3')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Creators */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">{t('landing.featured.title')}</h2>
            <p className="text-gray-600">{t('landing.featured.subtitle')}</p>
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
                        ${creator.subscriptionPrice}{t('common.perMonth')}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <div className="text-center mt-10">
            <Link to="/explore" className="inline-flex items-center text-pink-600 font-medium hover:text-pink-700">
              {t('landing.featured.viewAll')} <i className="fas fa-arrow-right ml-2"></i>
            </Link>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">{t('landing.categories.title')}</h2>
            <p className="text-gray-600">{t('landing.categories.subtitle')}</p>
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
            <h2 className="text-3xl font-bold text-gray-900 mb-4">{t('landing.how.title')}</h2>
            <p className="text-gray-600">{t('landing.how.subtitle')}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-pink-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-user-plus text-2xl text-pink-600"></i>
              </div>
              <h3 className="font-bold text-lg mb-2">{t('landing.how.step1.title')}</h3>
              <p className="text-gray-600">{t('landing.how.step1.desc')}</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-search text-2xl text-purple-600"></i>
              </div>
              <h3 className="font-bold text-lg mb-2">{t('landing.how.step2.title')}</h3>
              <p className="text-gray-600">{t('landing.how.step2.desc')}</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-heart text-2xl text-indigo-600"></i>
              </div>
              <h3 className="font-bold text-lg mb-2">{t('landing.how.step3.title')}</h3>
              <p className="text-gray-600">{t('landing.how.step3.desc')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* VIP Experiences Banner */}
      <section className="py-16 bg-gradient-to-br from-purple-600 via-pink-600 to-yellow-500 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%23ffffff%22%20fill-opacity%3D%220.1%22%3E%3Cpath%20d%3D%22M36%2034v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6%2034v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6%204V0H4v4H0v2h4v4h2V6h4V4H6z%22%2F%3E%3C%2Fg%3E%3C%2Fg%3E%3C%2Fsvg%3E')]"></div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="flex-1 text-center md:text-left">
              <div className="inline-block mb-4">
                <span className="text-5xl">👑</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                Experiencias VIP Exclusivas
              </h2>
              <p className="text-lg text-white/90 mb-6 max-w-xl">
                Vive momentos únicos con tus creadores favoritos. Meet & greets, sesiones privadas, 
                contenido personalizado y mucho más. ¡Reserva tu experiencia ahora!
              </p>
              <div className="flex flex-wrap gap-4 justify-center md:justify-start">
                <Link to="/vip-experiences" className="bg-white text-purple-700 px-8 py-4 rounded-full font-bold text-lg hover:bg-yellow-300 hover:text-purple-800 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5">
                  Explorar Experiencias
                </Link>
                <div className="flex items-center space-x-6 text-sm">
                  <div className="flex items-center">
                    <i className="fas fa-star text-yellow-300 mr-2"></i>
                    <span>500+ Experiencias</span>
                  </div>
                  <div className="flex items-center">
                    <i className="fas fa-heart text-pink-300 mr-2"></i>
                    <span>4.9★ Rating</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex-shrink-0">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/20 backdrop-blur-sm rounded-2xl p-6 text-center">
                  <div className="text-3xl mb-2">👋</div>
                  <p className="font-semibold text-sm">Meet & Greet</p>
                </div>
                <div className="bg-white/20 backdrop-blur-sm rounded-2xl p-6 text-center">
                  <div className="text-3xl mb-2">💬</div>
                  <p className="font-semibold text-sm">Sesiones Q&A</p>
                </div>
                <div className="bg-white/20 backdrop-blur-sm rounded-2xl p-6 text-center">
                  <div className="text-3xl mb-2">🎨</div>
                  <p className="font-semibold text-sm">Contenido Custom</p>
                </div>
                <div className="bg-white/20 backdrop-blur-sm rounded-2xl p-6 text-center">
                  <div className="text-3xl mb-2">🚀</div>
                  <p className="font-semibold text-sm">Acceso Anticipado</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-gradient-to-r from-pink-500 to-purple-600 text-white">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-4">{t('landing.cta.title')}</h2>
          <p className="text-pink-100 text-lg mb-8">
            {t('landing.cta.subtitle')}
          </p>
          <Link to="/register" className="bg-white text-purple-700 px-8 py-4 rounded-full font-bold text-lg hover:bg-yellow-300 transition-all inline-block">
            {t('landing.cta.button')}
          </Link>
        </div>
      </section>
    </div>
  );
};

export default Landing;
