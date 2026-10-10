import React, { useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { BRAND } from '../config/brand';
import { RESERVE_POLICIES, LEGAL_REVIEW_NOTICE, LEGAL_UPDATED } from '../content/reservePolicies';
import { CREATOR_SHARE, MIN_PAYOUT } from '../lib/platformRules';
import { LEVELS as CREATOR_LEVELS, MAX_SHARE, REFERRAL_DAYS, REFERRAL_SHARE, pct } from '../lib/rewardRules';
import { GIFT_SHARE } from '../lib/giftRules';

const LegalPolicies: React.FC = () => {
  const { t } = useLanguage();
  const policies = [
    { id: 'terms', name: 'Términos y Condiciones', icon: 'fa-file-contract' },
    { id: 'privacy', name: 'Política de Privacidad', icon: 'fa-lock' },
    { id: 'creator', name: 'Contrato de Creadores', icon: 'fa-handshake' },
    { id: 'minors', name: 'Protección de menores', icon: 'fa-user-shield' },
    { id: 'cookies', name: 'Política de Cookies', icon: 'fa-cookie-bite' },
    { id: 'dmca', name: 'Política DMCA', icon: 'fa-scale-balanced' },
    ...RESERVE_POLICIES.map(({ id, name, icon }) => ({ id, name, icon })),
  ];
  const reserveDoc = (id: string) => RESERVE_POLICIES.find((d) => d.id === id);
  // The open document lives in the address (?doc=<id>), so footer links switch it
  // even while /legal is already open, and back/forward move between documents.
  const [params, setParams] = useSearchParams();
  const requested = params.get('doc');
  const activePolicy = policies.some((p) => p.id === requested) ? requested! : 'terms';
  // On phones the list sits above the text: after picking a document, show it.
  const contentRef = useRef<HTMLDivElement>(null);
  const setActivePolicy = (id: string) => {
    setParams({ doc: id }, { replace: true });
    if (window.matchMedia('(max-width: 1023px)').matches) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      requestAnimationFrame(() => contentRef.current?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' }));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Políticas legales</h1>
          <p className="text-xl text-gray-600">Documentos legales y políticas de {BRAND.name}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl shadow-sm p-4 sticky top-4">
              <h3 className="font-bold text-gray-900 mb-4 px-2">Documentos</h3>
              <nav className="space-y-1">
                {policies.map((policy) => (
                  <button
                    key={policy.id}
                    onClick={() => setActivePolicy(policy.id)}
                    className={`w-full text-left px-4 py-3 rounded-xl transition flex items-center space-x-3 ${
                      activePolicy === policy.id
                        ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <i className={`fas ${policy.icon} w-5 text-center`} aria-hidden="true"></i>
                    <span className="font-medium text-sm">{policy.name}</span>
                  </button>
                ))}
              </nav>
            </div>
          </div>

          {/* Content */}
          <div ref={contentRef} className="lg:col-span-3 scroll-mt-28" data-testid="legal-content">
            <div className="bg-white rounded-2xl shadow-sm p-8">
              {!reserveDoc(activePolicy) && (
                <p role="note" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <i aria-hidden="true" className="fas fa-scale-balanced mr-2"></i>
                  <strong>Borrador.</strong> {LEGAL_REVIEW_NOTICE} Requiere revisión legal antes del lanzamiento a producción. La plataforma está en modo de prueba: los pagos se procesan con PayPal en su entorno de pruebas (sandbox).
                </p>
              )}

              {activePolicy === 'terms' && (
                <div>
                  <h2 className="text-3xl font-bold text-gray-900 mb-6">Términos y Condiciones de Servicio</h2>
                  <div className="prose prose-sm max-w-none text-gray-600 space-y-4">
                    <p className="text-sm text-gray-500"><strong>Última actualización:</strong> {LEGAL_UPDATED}</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">1. Aceptación de los Términos</h3>
                    <p>Al acceder o utilizar {BRAND.name}, usted acepta estar legalmente vinculado por estos Términos y Condiciones. Si no está de acuerdo con alguna parte, no debe utilizar la Plataforma.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">2. Elegibilidad y Edad</h3>
                    <p><strong>RESTRICCIÓN DE EDAD:</strong> Debe tener al menos DIECIOCHO (18) AÑOS de edad. Al entrar y al registrarse confirma que tiene 18 años o más.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">3. Cuentas de Usuario</h3>
                    <p>Para crear una cuenta debe proporcionar información veraz. Los Creadores verifican su identidad con una foto del frente de su documento oficial y un selfie de frente; las imágenes se eliminan al aprobarse la verificación.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">4. Contenido del Usuario</h3>
                    <p>Usted conserva los derechos de su Contenido original. Al publicar, nos otorga licencia para distribuirlo en la Plataforma. Todo el Contenido debe cumplir con nuestras políticas.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">5. Contenido y Servicios prohibidos</h3>
                    <ul className="list-disc pl-5 space-y-2">
                      <li>Contenido que involucre menores de 18 años</li>
                      <li>Contenido sexual explícito y cualquier servicio o actividad sexual (glamour permitido)</li>
                      <li>Contenido sin consentimiento verificable</li>
                      <li>Contenido ilegal, violento o que infrinja derechos de terceros</li>
                      <li>Spam, fraude o actividades engañosas</li>
                      <li>Enlazar, promocionar o redirigir a plataformas o páginas de contenido explícito, en el perfil, las publicaciones, los Lives, las experiencias o las redes enlazadas</li>
                      <li>Los servicios descritos en <a href="/legal?doc=prohibited-services" className="underline">Servicios prohibidos</a></li>
                    </ul>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">6. Reserve</h3>
                    <p>{BRAND.name} permite reservar experiencias, no personas. Los servicios profesionales con un propósito definido están permitidos; vender la compañía o la intimidad de una persona no. Si el creador no cumple lo publicado, el fan recibe el reembolso completo, previa verificación. Las videollamadas y los Lives no se graban y está prohibido grabarlos. Las reservas se rigen por la <a href="/legal?doc=reserve-policy" className="underline">Política de Reserve</a> y la de <a href="/legal?doc=cancellation" className="underline">Cancelación y No-show</a>.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">7. Pagos y Comisiones</h3>
                    <p>Métodos de pago: tarjetas Visa y Mastercard, PayPal y Google Pay. Todos los precios y pagos son en dólares estadounidenses (USD). Los Creadores reciben el 80% del neto (lo pagado menos la comisión de PayPal por ese pago) de suscripciones, propinas y reservas de Reserve, más según su nivel y sus recompensas, nunca más del 90% del neto, y el 60% de los regalos. Suscripción mínima $4.99 USD al mes y propina mínima $3 USD. Los ingresos se acreditan el día 1 de cada mes y se retiran a la cuenta PayPal del Creador desde $50 USD ($25 en Oro y Diamante); la comisión de PayPal por enviar el retiro (2%, máximo $20) se descuenta del monto retirado.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">8. Propiedad Intelectual</h3>
                    <p>Los Creadores conservan derechos de autor de su Contenido. La Plataforma posee derechos sobre el software, diseño y marcas.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">9. Limitación de Responsabilidad</h3>
                    <p>La Plataforma se proporciona "TAL CUAL". No garantizamos resultados específicos. Nuestra responsabilidad máxima está limitada a los pagos recibidos en los últimos 12 meses.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">10. Terminación</h3>
                    <p>Puede cerrar su cuenta en cualquier momento desde Configuración. Podemos suspender cuentas que violen estos Términos.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">11. Ley Aplicable</h3>
                    <p>Las leyes del país donde esté constituida la sociedad que opera {BRAND.name}, sin perjuicio de los derechos irrenunciables del consumidor en su país. Los delitos e infracciones cometidos a través de la Plataforma se someten a las leyes y autoridades del lugar donde se cometan, y cooperamos con ellas.</p>

                    <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                      <p className="text-sm text-blue-800">
                        <strong>Documento Completo:</strong> Este es un resumen. Para el documento completo, consulte{' '}
                        <a href="/legal/TERMS_AND_CONDITIONS.md" className="underline" target="_blank">Términos completos</a>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {activePolicy === 'privacy' && (
                <div>
                  <h2 className="text-3xl font-bold text-gray-900 mb-6">Política de Privacidad</h2>
                  <div className="prose prose-sm max-w-none text-gray-600 space-y-4">
                    <p className="text-sm text-gray-500"><strong>Última actualización:</strong> {LEGAL_UPDATED}</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">1. Información que Recopilamos</h3>
                    <p>Datos de cuenta (nombre o alias, email, país, teléfono si decide darlo, foto de perfil), actividad en la Plataforma (publicaciones, mensajes, suscripciones, reservas), datos de verificación de los Creadores y, de los métodos de pago, solo la marca y los últimos 4 dígitos.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">2. Cómo Usamos su Información</h3>
                    <ul className="list-disc pl-5 space-y-2">
                      <li>Proporcionar y mejorar el servicio</li>
                      <li>Procesar pagos, suscripciones y reservas</li>
                      <li>Verificar la identidad y la edad de los Creadores</li>
                      <li>Prevenir fraude, revisar reportes y aplicar nuestras políticas</li>
                      <li>Ver cuántos usuarios hay por país (en totales, sin datos individuales) y, en el caso de los Creadores, filtrarlos por país en Explorar y en el Top del mes de su país. El teléfono es opcional, solo lo usa el equipo para contactarle sobre su cuenta o sus reservas, y nunca se muestra en su perfil ni se comparte con otros usuarios</li>
                      <li>Cumplir con obligaciones legales</li>
                    </ul>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">3. Con quién la compartimos</h3>
                    <p>Solo con los proveedores que hacen funcionar el servicio: Supabase (base de datos, cuentas y archivos), Vercel (alojamiento web), LiveKit (video en vivo) y Google si inicia sesión con su cuenta de Google. No vendemos datos personales.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">4. Sus Derechos</h3>
                    <p>Tiene derecho a acceder, rectificar, eliminar y portar sus datos. Desde Configuración &gt; Privacidad puede descargar sus datos o eliminar su cuenta.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">5. Seguridad</h3>
                    <p>Las comunicaciones van cifradas (TLS), las contraseñas se guardan con hash y el acceso a los datos está limitado por cuenta en la base de datos.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">6. Retención de Datos</h3>
                    <p>Conservamos los datos mientras su cuenta esté activa; al eliminarla se borran su cuenta, sus métodos de pago y sus documentos. Las imágenes de verificación se eliminan al aprobarse. Los registros de pagos pueden conservarse el tiempo que exija la ley fiscal.</p>

                    <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                      <p className="text-sm text-blue-800">
                        <strong>Documento Completo:</strong> Consulte{' '}
                        <a href="/legal/PRIVACY_POLICY.md" className="underline" target="_blank">Política completa</a>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {activePolicy === 'creator' && (
                <div>
                  <h2 className="text-3xl font-bold text-gray-900 mb-6">Contrato de Creadores</h2>
                  <div className="prose prose-sm max-w-none text-gray-600 space-y-4">
                    <p className="text-sm text-gray-500"><strong>Última actualización:</strong> {LEGAL_UPDATED}</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">1. Relación entre las Partes</h3>
                    <p>Usted es contratista independiente, no empleado. Este contrato no es exclusivo y usted decide cuándo y cuánto publica.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">2. Obligaciones del Creador</h3>
                    <ul className="list-disc pl-5 space-y-2">
                      <li>Completar la verificación de identidad (frente del documento y selfie)</li>
                      <li>Obtener consentimiento de todas las personas en su Contenido</li>
                      <li>Cumplir lo publicado en sus suscripciones y experiencias de Reserve</li>
                      <li>Mantener la comunicación y los pagos dentro de la Plataforma</li>
                      <li>Cumplir con todas las leyes, permisos e impuestos aplicables</li>
                    </ul>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">3. Estructura de Ingresos</h3>
                    <div className="bg-gray-50 p-4 rounded-xl">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2">Nivel</th>
                            <th className="text-left py-2">Fans activos o ventas en 30 días</th>
                            <th className="text-left py-2">Usted recibe del neto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {CREATOR_LEVELS.map((l) => (
                            <tr key={l.id} className="border-b last:border-0">
                              <td className="py-2">{l.name}</td>
                              <td className="py-2">{l.minFans === 0 ? 'Al empezar' : `${l.minFans}+ o $${l.minSales.toLocaleString('en-US')}`}</td>
                              <td className="py-2">{pct(l.share)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p>Aplica a suscripciones, renovaciones, propinas y reservas de Reserve, sobre el neto: lo que paga el fan menos la comisión de PayPal por ese pago. Desde Plata se pide no tener reportes confirmados en 90 días, y desde Oro responder a tiempo el 95% de las solicitudes de Reserve. Los fans de su enlace de invitación le dejan el {pct(REFERRAL_SHARE)} durante {REFERRAL_DAYS} días, y el bono por invitar creadores lo paga la Plataforma; nada supera el {pct(MAX_SHARE)} del neto. Los regalos le dejan el {pct(GIFT_SHARE)}. Los ingresos se acreditan el día 1 de cada mes y se retiran completos, a su cuenta PayPal, desde ${MIN_PAYOUT} USD (${CREATOR_LEVELS[2].payoutMin} USD en Oro y Diamante). Todo se paga en dólares estadounidenses (USD). La comisión de PayPal por enviar cada retiro (2%, máximo $20) la paga usted y se descuenta del monto retirado. Si PayPal no puede entregar un retiro (por ejemplo, el email no tiene cuenta PayPal y no se reclama), el monto vuelve a su saldo.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">4. Propiedad Intelectual</h3>
                    <p>Usted conserva derechos de autor. Nos otorga licencia para distribuir su Contenido en la Plataforma.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">5. Impuestos</h3>
                    <p>Usted es responsable de declarar y pagar impuestos sobre sus ingresos. Su historial de ingresos y retiros está en su panel.</p>

                    <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                      <p className="text-sm text-blue-800">
                        <strong>Documento Completo:</strong> Consulte{' '}
                        <a href="/legal/CREATOR_AFFILIATE_AGREEMENT.md" className="underline" target="_blank">Contrato completo</a>
                        {' '}y el <a href="/legal?doc=reserve-agreement" className="underline">Acuerdo de Creator (Reserve)</a>.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {activePolicy === 'minors' && (
                <div>
                  <h2 className="text-3xl font-bold text-gray-900 mb-6">Política de Protección de menores</h2>
                  <div className="bg-red-50 border-2 border-red-300 rounded-xl p-6 mb-6">
                    <div className="flex items-start space-x-3">
                      <span className="text-3xl">⚠️</span>
                      <div>
                        <h3 className="font-bold text-red-900 text-lg mb-2">POLÍTICA DE TOLERANCIA CERO</h3>
                        <p className="text-red-800">
                          {BRAND.name} mantiene una política de TOLERANCIA CERO hacia cualquier forma de explotación, 
                          abuso o contenido que involucre menores de edad.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="prose prose-sm max-w-none text-gray-600 space-y-4">
                    <h3 className="text-xl font-bold text-gray-900 mt-6">1. Restricciones Absolutas</h3>
                    <ul className="list-disc pl-5 space-y-2 text-red-700 font-medium">
                      <li>PROHIBIDO: Registro de menores de 18 años</li>
                      <li>PROHIBIDO: Acceso de menores a la Plataforma</li>
                      <li>PROHIBIDO: Contenido que represente menores</li>
                      <li>PROHIBIDO: Cualquier material de abuso sexual infantil (CSAM)</li>
                    </ul>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">2. Verificación de Edad</h3>
                    <p>Todos los Usuarios confirman que son mayores de 18 años al entrar y al registrarse. Los Creadores verifican su edad con documento oficial y selfie, y deben verificar la edad de todas las personas que aparecen en su Contenido. Ninguna experiencia de Reserve puede involucrar a menores.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">3. Monitoreo y Detección</h3>
                    <p>Combinamos una revisión automática básica de textos, los reportes de los usuarios y la revisión humana del equipo. Herramientas especializadas de detección (como PhotoDNA) están previstas antes del lanzamiento a producción.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">4. Cooperación con Autoridades</h3>
                    <p>Reportamos inmediatamente a NCMEC, Europol, Interpol y autoridades locales. Cooperamos totalmente con investigaciones.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">5. Consecuencias</h3>
                    <p>Violaciones resultan en: terminación inmediata, retención de fondos, reporte a autoridades, acciones legales civiles y penales.</p>

                    <div className="mt-8 p-4 bg-yellow-50 border border-yellow-300 rounded-xl">
                      <p className="text-sm text-yellow-800 font-medium mb-2">
                        📞 ¿Necesita reportar contenido con menores?
                      </p>
                      <p className="text-sm text-yellow-700">
                        <strong>Email urgente:</strong> {BRAND.emails.minors}<br/>
                        <strong>NCMEC:</strong> 1-800-843-5678
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {activePolicy === 'cookies' && (
                <div>
                  <h2 className="text-3xl font-bold text-gray-900 mb-6">Política de Cookies</h2>
                  <div className="prose prose-sm max-w-none text-gray-600 space-y-4">
                    <p className="text-sm text-gray-500"><strong>Última actualización:</strong> {LEGAL_UPDATED}</p>
                    <h3 className="text-xl font-bold text-gray-900 mt-6">¿Qué usamos?</h3>
                    <p>{BRAND.name} no usa cookies de publicidad ni de analítica de terceros. Para funcionar guarda en el almacenamiento local de su navegador su sesión y sus preferencias.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">Tipos de almacenamiento</h3>
                    <ul className="list-disc pl-5 space-y-2">
                      <li><strong>Esencial:</strong> mantener su sesión iniciada y la seguridad de la cuenta</li>
                      <li><strong>Funcional:</strong> recordar preferencias como el idioma o avisos ya vistos</li>
                    </ul>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">Gestión</h3>
                    <p>Puede borrar estos datos desde la configuración de su navegador; al hacerlo se cerrará su sesión. Si en el futuro añadimos analítica o publicidad, actualizaremos esta política y pediremos su consentimiento.</p>
                  </div>
                </div>
              )}

              {activePolicy === 'dmca' && (
                <div>
                  <h2 className="text-3xl font-bold text-gray-900 mb-6">Política DMCA y Derechos de Autor</h2>
                  <div className="prose prose-sm max-w-none text-gray-600 space-y-4">
                    <h3 className="text-xl font-bold text-gray-900 mt-6">Respeto por Derechos de Autor</h3>
                    <p>Respetamos los derechos de propiedad intelectual y esperamos que nuestros Usuarios hagan lo mismo.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">Notificación de infracción</h3>
                    <p>Si cree que su trabajo ha sido copiado ilegalmente, envíe una notificación DMCA a: <strong>{BRAND.emails.dmca}</strong></p>
                    <p>Debe incluir:</p>
                    <ul className="list-disc pl-5 space-y-2">
                      <li>Identificación de la obra protegida</li>
                      <li>Ubicación del material infractor</li>
                      <li>Su información de contacto</li>
                      <li>Declaración de buena fe</li>
                      <li>Su firma</li>
                    </ul>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">Contra-notificación</h3>
                    <p>Si cree que su Contenido fue eliminado erróneamente, puede enviar una contra-notificación.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">Infractores reincidentes</h3>
                    <p>Las cuentas que infrinjan derechos de autor repetidamente serán terminadas.</p>
                  </div>
                </div>
              )}

              {reserveDoc(activePolicy) && (() => {
                const doc = reserveDoc(activePolicy)!;
                return (
                  <div data-testid="reserve-policy-doc">
                    <h2 className="text-3xl font-bold text-gray-900 mb-4">{doc.name}</h2>
                    <p role="note" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <i aria-hidden="true" className="fas fa-scale-balanced mr-2"></i>
                      <strong>Borrador.</strong> {LEGAL_REVIEW_NOTICE} Requiere revisión legal antes del lanzamiento a producción.
                    </p>
                    <div className="space-y-4 text-gray-600">
                      <p>{doc.intro}</p>
                      {doc.sections.map((sec) => (
                        <section key={sec.heading}>
                          <h3 className="text-xl font-bold text-gray-900 mt-6 mb-2">{sec.heading}</h3>
                          {sec.paragraphs?.map((x) => <p key={x} className="mb-2">{x}</p>)}
                          {sec.bullets && (
                            <ul className="list-disc space-y-1 pl-6">
                              {sec.bullets.map((x) => <li key={x}>{x}</li>)}
                            </ul>
                          )}
                        </section>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div className="mt-12 pt-8 border-t border-gray-200">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-500">
                    © {new Date().getFullYear()} {BRAND.name}. Todos los derechos reservados.
                  </p>
                  <a href={`mailto:${BRAND.emails.legal}`} className="text-sm text-pink-600 hover:text-pink-700 font-medium">
                    <i aria-hidden="true" className="fas fa-envelope mr-2"></i>
                    Contactar Departamento Legal
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LegalPolicies;
