import React from 'react';
import { Link } from 'react-router-dom';

const Pricing: React.FC = () => {
  const plans = [
    {
      name: 'Fan Gratuito',
      price: '$0',
      period: '/mes',
      description: 'Perfecto para explorar la plataforma',
      features: [
        'Explorar perfiles de creadores',
        'Ver contenido público',
        'Seguir creadores',
        'Enviar mensajes básicos',
        'Notificaciones personalizadas',
      ],
      notIncluded: [
        'Contenido exclusivo',
        'Mensajes privados ilimitados',
        'Sin anuncios',
      ],
      cta: 'Registrarse Gratis',
      popular: false,
    },
    {
      name: 'Fan Premium',
      price: '$4.99',
      period: '/mes',
      description: 'Para fans que quieren más',
      features: [
        'Todo lo del plan gratuito',
        'Sin anuncios',
        'Mensajes privados ilimitados',
        'Descuentos en contenido PPV',
        'Badge exclusivo',
        'Soporte prioritario',
      ],
      notIncluded: [],
      cta: 'Suscribirse',
      popular: true,
    },
    {
      name: 'Creador',
      price: 'Gratis',
      period: '',
      description: 'Para creadores que quieren monetizar',
      features: [
        'Perfil verificado',
        'Publicar contenido ilimitado',
        'Fijar precio de suscripción',
        'Vender contenido individual (PPV)',
        'Recibir propinas',
        'Panel de estadísticas',
        'Mensajería con suscriptores',
        'Retiro de ganancias',
      ],
      notIncluded: [],
      cta: 'Ser Creador',
      popular: false,
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Planes y Precios</h1>
          <p className="text-xl text-gray-600">Elige el plan que mejor se adapte a ti</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {plans.map((plan, i) => (
            <div key={i} className={`bg-white rounded-2xl shadow-sm overflow-hidden relative ${plan.popular ? 'ring-2 ring-pink-500 shadow-lg' : ''}`}>
              {plan.popular && (
                <div className="absolute top-0 right-0 bg-gradient-to-r from-pink-500 to-purple-600 text-white px-4 py-1 text-xs font-bold rounded-bl-xl">
                  MÁS POPULAR
                </div>
              )}
              <div className="p-6">
                <h3 className="text-xl font-bold text-gray-900">{plan.name}</h3>
                <p className="text-gray-500 text-sm mt-1">{plan.description}</p>
                <div className="mt-4">
                  <span className="text-4xl font-bold text-gray-900">{plan.price}</span>
                  <span className="text-gray-500">{plan.period}</span>
                </div>
              </div>
              <div className="px-6 pb-6">
                <ul className="space-y-3">
                  {plan.features.map((feature, j) => (
                    <li key={j} className="flex items-center text-sm text-gray-700">
                      <i className="fas fa-check text-green-500 mr-3"></i> {feature}
                    </li>
                  ))}
                  {plan.notIncluded.map((feature, j) => (
                    <li key={j} className="flex items-center text-sm text-gray-400">
                      <i className="fas fa-times text-gray-300 mr-3"></i> {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/register"
                  className={`mt-6 block text-center py-3 rounded-xl font-bold transition ${
                    plan.popular
                      ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white hover:opacity-90 shadow-lg'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            </div>
          ))}
        </div>

        {/* FAQ */}
        <div className="max-w-3xl mx-auto mt-16">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">Preguntas Frecuentes</h2>
          <div className="space-y-4">
            {[
              { q: '¿Puedo cancelar mi suscripción en cualquier momento?', a: 'Sí, sin permanencia. Cancélala desde Configuración > Pagos, desde tu perfil o desde el perfil del creador.', link: { to: '/settings?section=payments', label: 'Gestionar suscripciones' } },
              { q: '¿Cómo se procesan los pagos?', a: 'Pagas con tarjeta Visa o Mastercard, PayPal o Google Pay desde un formulario seguro. De tu tarjeta solo guardamos la marca y los últimos 4 dígitos; el CVC nunca se almacena.', link: { to: '/settings?section=payments', label: 'Mis métodos de pago' } },
              { q: '¿Cuánto gana un creador?', a: 'Los creadores reciben el 80% de lo que pagan sus fans. El saldo se ve en Panel > Ingresos y se retira desde $50 USD, con pago el día 1 de cada mes.', link: { to: '/creator/dashboard?tab=earnings', label: 'Ver ingresos' } },
              { q: '¿Es seguro usar SugarFans?', a: 'Sí. Todos los creadores deben verificar su identidad con documento oficial y selfie antes de publicar o cobrar, y cualquier usuario puede reportar contenido o bloquear perfiles.', link: { to: '/help', label: 'Centro de Ayuda' } },
            ].map((faq, i) => (
              <details key={i} className="bg-white rounded-xl shadow-sm group">
                <summary className="p-5 cursor-pointer font-medium text-gray-900 hover:text-pink-600 transition flex items-center justify-between">
                  {faq.q}
                  <i className="fas fa-chevron-down text-gray-400 group-open:rotate-180 transition-transform"></i>
                </summary>
                <div className="px-5 pb-5 text-gray-600 text-sm">
                  {faq.a}
                  <Link to={faq.link.to} className="block mt-2 font-medium text-pink-600 hover:text-pink-700">{faq.link.label} →</Link>
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Pricing;
