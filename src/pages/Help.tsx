import React, { useState } from 'react';

const Help: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  const helpCategories = [
    { id: '1', name: 'Cuenta y Perfil', icon: 'fa-user', articles: 12 },
    { id: '2', name: 'Pagos y Suscripciones', icon: 'fa-credit-card', articles: 8 },
    { id: '3', name: 'Contenido y Publicaciones', icon: 'fa-image', articles: 15 },
    { id: '4', name: 'Seguridad y Privacidad', icon: 'fa-shield-alt', articles: 10 },
    { id: '5', name: 'Para Creadores', icon: 'fa-star', articles: 20 },
    { id: '6', name: 'Reportes y Bloqueos', icon: 'fa-flag', articles: 6 },
  ];

  const faqs = [
    { category: 'Cuenta y Perfil', q: '¿Cómo creo una cuenta?', a: 'Haz clic en "Registrarse" y completa el formulario. Necesitas ser mayor de 18 años.' },
    { category: 'Cuenta y Perfil', q: '¿Cómo verifico mi identidad?', a: 'Ve a Configuración > Verificación y sube una foto de tu documento de identidad.' },
    { category: 'Pagos', q: '¿Qué métodos de pago aceptan?', a: 'Aceptamos tarjetas de crédito/débito, transferencias bancarias y criptomonedas.' },
    { category: 'Pagos', q: '¿Cuándo se renueva mi suscripción?', a: 'Las suscripciones se renuevan automáticamente cada mes en la misma fecha de contratación.' },
    { category: 'Seguridad', q: '¿Mis datos están seguros?', a: 'Sí, usamos encriptación de extremo a extremo y cumplimos con GDPR y normativas locales.' },
    { category: 'Seguridad', q: '¿Cómo protegen mi privacidad?', a: 'Tu información personal nunca se comparte. Puedes usar un nombre de usuario anónimo.' },
    { category: 'Creadores', q: '¿Cómo puedo monetizar mi contenido?', a: 'Regístrate como creador, verifica tu identidad y comienza a publicar. Fija tu precio de suscripción.' },
    { category: 'Creadores', q: '¿Cuándo recibo mis pagos?', a: 'Los pagos se procesan mensualmente. El mínimo de retiro es $50 USD.' },
    { category: 'Reportes', q: '¿Cómo reporto contenido inapropiado?', a: 'En cada publicación hay un botón de reporte. También puedes escribir a soporte@sugarfans.com' },
    { category: 'Reportes', q: '¿Cómo bloqueo a un usuario?', a: 'Ve al perfil del usuario y haz clic en "Bloquear". No podrá contactarte ni ver tu contenido.' },
  ];

  const filteredFaqs = faqs.filter(faq => {
    const matchesSearch = !searchQuery || faq.q.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = !selectedCategory || faq.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Centro de Ayuda</h1>
          <p className="text-xl text-gray-600 mb-8">¿En qué podemos ayudarte?</p>
          <div className="relative max-w-xl mx-auto">
            <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-4 bg-white border border-gray-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-pink-500 outline-none"
              placeholder="Buscar en la ayuda..."
            />
          </div>
        </div>

        {/* Categories */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-12">
          {helpCategories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(selectedCategory === cat.name ? '' : cat.name)}
              className={`bg-white rounded-xl p-5 text-center shadow-sm hover:shadow-md transition border ${
                selectedCategory === cat.name ? 'border-pink-500 bg-pink-50' : 'border-gray-100'
              }`}
            >
              <i className={`fas ${cat.icon} text-2xl text-pink-500 mb-2`}></i>
              <h3 className="font-medium text-gray-900 text-sm">{cat.name}</h3>
              <p className="text-xs text-gray-500 mt-1">{cat.articles} artículos</p>
            </button>
          ))}
        </div>

        {/* FAQs */}
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            {selectedCategory ? `Preguntas sobre: ${selectedCategory}` : 'Preguntas Frecuentes'}
          </h2>
          {filteredFaqs.map((faq, i) => (
            <details key={i} className="bg-white rounded-xl shadow-sm group">
              <summary className="p-5 cursor-pointer font-medium text-gray-900 hover:text-pink-600 transition flex items-center justify-between">
                {faq.q}
                <i className="fas fa-chevron-down text-gray-400 group-open:rotate-180 transition-transform"></i>
              </summary>
              <div className="px-5 pb-5 text-gray-600">{faq.a}</div>
            </details>
          ))}
          {filteredFaqs.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <i className="fas fa-search text-3xl mb-3"></i>
              <p>No se encontraron resultados</p>
            </div>
          )}
        </div>

        {/* Contact */}
        <div className="mt-12 bg-gradient-to-r from-pink-500 to-purple-600 rounded-2xl p-8 text-white text-center">
          <h3 className="text-2xl font-bold mb-2">¿No encuentras lo que buscas?</h3>
          <p className="text-pink-100 mb-6">Nuestro equipo de soporte está listo para ayudarte</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="mailto:soporte@sugarfans.com" className="bg-white text-purple-700 px-6 py-3 rounded-xl font-bold hover:bg-yellow-300 transition">
              <i className="fas fa-envelope mr-2"></i> Email
            </a>
            <a href="#" className="border-2 border-white text-white px-6 py-3 rounded-xl font-bold hover:bg-white hover:text-purple-700 transition">
              <i className="fas fa-comments mr-2"></i> Chat en Vivo
            </a>
          </div>
        </div>

        {/* Report Content */}
        <div className="mt-8 bg-white rounded-2xl shadow-sm p-6">
          <h3 className="font-bold text-gray-900 mb-4">
            <i className="fas fa-flag text-red-500 mr-2"></i> Reportar Contenido
          </h3>
          <p className="text-gray-600 text-sm mb-4">
            Si encuentras contenido que viola nuestras políticas, puedes reportarlo aquí. Tomamos todos los reportes seriamente.
          </p>
          <form className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de reporte</label>
              <select className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none">
                <option>Contenido inapropiado</option>
                <option>Contenido sin consentimiento</option>
                <option>Violación de derechos de autor</option>
                <option>Spam o fraude</option>
                <option>Menores de edad</option>
                <option>Otro</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
              <textarea className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none h-24 resize-none" placeholder="Describe el problema..."></textarea>
            </div>
            <button type="button" className="bg-red-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-red-700 transition">
              <i className="fas fa-paper-plane mr-2"></i> Enviar Reporte
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Help;
