import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { submitReport } from '../lib/platform';
import { REPORT_REASONS } from '../components/ReportDialog';

interface Faq {
  category: string;
  q: string;
  a: string;
  link?: { to: string; label: string };
}

// Every answer here describes a feature that exists in the app, with a link to it.
export const faqs: Faq[] = [
  { category: 'Cuenta y Perfil', q: '¿Cómo creo una cuenta?', a: 'Haz clic en "Registrarse" y completa el formulario eligiendo si eres fan o creador. Necesitas ser mayor de 18 años.', link: { to: '/register', label: 'Crear cuenta' } },
  { category: 'Cuenta y Perfil', q: '¿Cómo verifico mi identidad?', a: 'Ve a Configuración > Verificación, completa tus datos y sube una foto de tu documento de identidad (frente y reverso, o la página de datos del pasaporte) y un selfie sosteniéndolo. Nuestro equipo lo revisa y verás el estado en esa misma pantalla. Al aprobarse obtienes la insignia "Verificado" y tus imágenes se eliminan.', link: { to: '/settings?section=verification', label: 'Ir a Verificación' } },
  { category: 'Cuenta y Perfil', q: '¿Cómo elimino mi cuenta?', a: 'En Configuración > Privacidad, "Eliminar mi cuenta". Te pediremos tu contraseña; se borran tu cuenta, tus métodos de pago y tus documentos de verificación.', link: { to: '/settings?section=privacy', label: 'Ir a Privacidad' } },
  { category: 'Pagos y Suscripciones', q: '¿Qué métodos de pago aceptan?', a: 'Tarjetas de crédito/débito, transferencia bancaria y criptomonedas (USDT, Ethereum y Bitcoin). Añádelos y elige el principal en Configuración > Pagos.', link: { to: '/settings?section=payments', label: 'Ir a Pagos' } },
  { category: 'Pagos y Suscripciones', q: '¿Cuándo se renueva mi suscripción?', a: 'Cada mes en la misma fecha en que te suscribiste, con tu método de pago principal. Ves la próxima fecha de cobro y tu historial de pagos en Configuración > Pagos y en tu perfil.', link: { to: '/settings?section=payments', label: 'Ver mis suscripciones' } },
  { category: 'Pagos y Suscripciones', q: '¿Puedo cancelar mi suscripción en cualquier momento?', a: 'Sí, sin permanencia. Cancélala desde Configuración > Pagos, desde tu perfil o desde el perfil del creador; no se te volverá a cobrar.', link: { to: '/settings?section=payments', label: 'Gestionar suscripciones' } },
  { category: 'Seguridad y Privacidad', q: '¿Mis datos están seguros?', a: 'Tu contraseña se guarda cifrada (hash con sal), de tu tarjeta solo guardamos la marca y los últimos 4 dígitos, y los documentos de identidad se borran tras la verificación. Conforme al GDPR puedes descargar todos tus datos o eliminar tu cuenta desde Configuración > Privacidad.', link: { to: '/settings?section=privacy', label: 'Descargar mis datos' } },
  { category: 'Seguridad y Privacidad', q: '¿Cómo protegen mi privacidad?', a: 'Tu información personal nunca se comparte. Puedes usar un alias como nombre visible (Configuración > Perfil) y ocultar tu perfil de las búsquedas o tu actividad en Configuración > Privacidad.', link: { to: '/settings?section=privacy', label: 'Ajustes de privacidad' } },
  { category: 'Para Creadores', q: '¿Cómo puedo monetizar mi contenido?', a: 'Regístrate como creador, verifica tu identidad (es obligatorio para publicar y cobrar), fija tu precio de suscripción en el panel y empieza a publicar. Recibes el 80% de lo que pagan tus fans.', link: { to: '/creator/dashboard', label: 'Ir al panel de creador' } },
  { category: 'Para Creadores', q: '¿Cuándo recibo mis pagos?', a: 'Tu saldo se acumula en Panel > Ingresos. Solicita un retiro desde $50 USD a tu cuenta bancaria; los retiros se pagan una vez al mes, el día 1.', link: { to: '/creator/dashboard?tab=earnings', label: 'Ver mis ingresos' } },
  { category: 'Para Creadores', q: '¿Cómo publico contenido exclusivo?', a: 'En el panel de creador pulsa "Nueva Publicación" y marca "Exclusivo": solo lo verán tus suscriptores.', link: { to: '/creator/dashboard', label: 'Nueva publicación' } },
  { category: 'Reportes y Bloqueos', q: '¿Cómo reporto contenido inapropiado?', a: 'Cada publicación tiene un botón "Reportar", y cada perfil uno en "Acerca de". También puedes usar el formulario al final de esta página o escribir a soporte@sugarfans.com. El equipo de moderación revisa cada reporte y puede retirar el contenido.' },
  { category: 'Reportes y Bloqueos', q: '¿Cómo bloqueo a un usuario?', a: 'Ve al perfil del usuario y pulsa el botón de bloquear. No podrá contactarte ni ver tu contenido, y dejarás de verlo en Explorar. Gestiona y desbloquea a quien quieras en Configuración > Bloqueos.', link: { to: '/settings?section=blocking', label: 'Ver bloqueados' } },
];

const helpCategories = [
  { name: 'Cuenta y Perfil', icon: 'fa-user' },
  { name: 'Pagos y Suscripciones', icon: 'fa-credit-card' },
  { name: 'Seguridad y Privacidad', icon: 'fa-shield-alt' },
  { name: 'Para Creadores', icon: 'fa-star' },
  { name: 'Reportes y Bloqueos', icon: 'fa-flag' },
];

const Help: React.FC = () => {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [reportKind, setReportKind] = useState<'other' | 'support'>('other');
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [target, setTarget] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [reportResult, setReportResult] = useState<{ ok: boolean; text: string } | null>(null);

  const filteredFaqs = faqs.filter(faq => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch = !q || faq.q.toLowerCase().includes(q) || faq.a.toLowerCase().includes(q);
    const matchesCategory = !selectedCategory || faq.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const sendReport = () => {
    const result = submitReport(user, {
      kind: reportKind,
      targetLabel: reportKind === 'support' ? 'Consulta a soporte' : target,
      reason: reportKind === 'support' ? 'Consulta a soporte' : reason,
      description,
      contactEmail: email,
    });
    if (!result.ok) return setReportResult({ ok: false, text: result.error || 'No se pudo enviar' });
    setReportResult({ ok: true, text: reportKind === 'support' ? 'Mensaje enviado. Soporte te responderá por email.' : 'Reporte enviado. Nuestro equipo de moderación lo revisará.' });
    setTarget('');
    setDescription('');
  };

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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-12">
          {helpCategories.map((cat) => (
            <button
              key={cat.name}
              onClick={() => setSelectedCategory(selectedCategory === cat.name ? '' : cat.name)}
              className={`bg-white rounded-xl p-5 text-center shadow-sm hover:shadow-md transition border ${
                selectedCategory === cat.name ? 'border-pink-500 bg-pink-50' : 'border-gray-100'
              }`}
            >
              <i className={`fas ${cat.icon} text-2xl text-pink-500 mb-2`}></i>
              <h3 className="font-medium text-gray-900 text-sm">{cat.name}</h3>
              <p className="text-xs text-gray-500 mt-1">{faqs.filter((f) => f.category === cat.name).length} artículos</p>
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
              <div className="px-5 pb-5 text-gray-600">
                {faq.a}
                {faq.link && (
                  <Link to={faq.link.to} className="block mt-3 text-sm font-medium text-pink-600 hover:text-pink-700">
                    {faq.link.label} <i className="fas fa-arrow-right ml-1 text-xs"></i>
                  </Link>
                )}
              </div>
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
            <a
              href="#report-form"
              onClick={() => { setReportKind('support'); setReportResult(null); }}
              className="border-2 border-white text-white px-6 py-3 rounded-xl font-bold hover:bg-white hover:text-purple-700 transition"
            >
              <i className="fas fa-comments mr-2"></i> Escribir a soporte
            </a>
          </div>
        </div>

        {/* Report Content / contact support */}
        <div id="report-form" className="mt-8 bg-white rounded-2xl shadow-sm p-6">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4 max-w-sm">
            <button type="button" onClick={() => { setReportKind('other'); setReportResult(null); }} className={`flex-1 py-2 rounded-md text-sm font-medium ${reportKind === 'other' ? 'bg-white shadow text-red-600' : 'text-gray-600'}`}>
              <i className="fas fa-flag mr-1"></i> Reportar contenido
            </button>
            <button type="button" onClick={() => { setReportKind('support'); setReportResult(null); }} className={`flex-1 py-2 rounded-md text-sm font-medium ${reportKind === 'support' ? 'bg-white shadow text-purple-700' : 'text-gray-600'}`}>
              <i className="fas fa-life-ring mr-1"></i> Soporte
            </button>
          </div>
          <p className="text-gray-600 text-sm mb-4">
            {reportKind === 'support'
              ? 'Escríbenos tu consulta y te responderemos por email.'
              : 'Si encuentras contenido que viola nuestras políticas, repórtalo aquí. Tomamos todos los reportes seriamente.'}
          </p>
          <div className="space-y-4">
            {reportKind === 'other' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="report-reason">Tipo de reporte</label>
                  <select id="report-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none">
                    {REPORT_REASONS.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="report-target">Perfil o enlace reportado</label>
                  <input id="report-target" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="@usuario o enlace a la publicación" className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none" />
                </div>
              </>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="report-description">{reportKind === 'support' ? 'Tu mensaje' : 'Descripción'}</label>
              <textarea id="report-description" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none h-24 resize-none" placeholder="Describe el problema..."></textarea>
            </div>
            {!user && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="report-email">Tu email</label>
                <input id="report-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="para poder responderte" className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none" />
              </div>
            )}
            {reportResult && (
              <p role={reportResult.ok ? 'status' : 'alert'} className={`text-sm rounded-lg px-3 py-2 border ${reportResult.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                {reportResult.text}
              </p>
            )}
            <button type="button" onClick={sendReport} className={`${reportKind === 'support' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700'} text-white px-6 py-3 rounded-xl font-medium transition`}>
              <i className="fas fa-paper-plane mr-2"></i> {reportKind === 'support' ? 'Enviar mensaje' : 'Enviar Reporte'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Help;
