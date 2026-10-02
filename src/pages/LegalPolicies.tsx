import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { BRAND } from '../config/brand';
import { RESERVE_POLICIES, LEGAL_REVIEW_NOTICE } from '../content/reservePolicies';

const LegalPolicies: React.FC = () => {
  const { t } = useLanguage();
  const policies = [
    { id: 'terms', name: 'Términos y Condiciones', icon: 'fa-file-contract' },
    { id: 'privacy', name: 'Política de Privacidad', icon: 'fa-lock' },
    { id: 'creator', name: 'Contrato de Creadores', icon: 'fa-handshake' },
    { id: 'minors', name: 'Protección de Menores', icon: 'fa-user-shield' },
    { id: 'cookies', name: 'Política de Cookies', icon: 'fa-cookie-bite' },
    { id: 'dmca', name: 'Política DMCA', icon: 'fa-scale-balanced' },
    ...RESERVE_POLICIES.map(({ id, name, icon }) => ({ id, name, icon })),
  ];
  const reserveDoc = (id: string) => RESERVE_POLICIES.find((d) => d.id === id);
  // ?doc=<id> opens a document directly (footer links).
  const [params] = useSearchParams();
  const requested = params.get('doc');
  const [activePolicy, setActivePolicy] = useState(policies.some((p) => p.id === requested) ? requested! : 'terms');

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Políticas Legales</h1>
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
          <div className="lg:col-span-3">
            <div className="bg-white rounded-2xl shadow-sm p-8">
              {activePolicy === 'terms' && (
                <div>
                  <h2 className="text-3xl font-bold text-gray-900 mb-6">Términos y Condiciones de Servicio</h2>
                  <div className="prose prose-sm max-w-none text-gray-600 space-y-4">
                    <p className="text-sm text-gray-500"><strong>Última actualización:</strong> Enero 2024</p>
                    
                    <h3 className="text-xl font-bold text-gray-900 mt-6">1. Aceptación de los Términos</h3>
                    <p>Al acceder o utilizar {BRAND.name}, usted acepta estar legalmente vinculado por estos Términos y Condiciones. Si no está de acuerdo con alguna parte, no debe utilizar la Plataforma.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">2. Elegibilidad y Edad</h3>
                    <p><strong>RESTRICCIÓN DE EDAD:</strong> Debe tener al menos DIECIOCHO (18) AÑOS de edad. Al registrarse, declara bajo juramento que tiene 18 años o más.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">3. Cuentas de Usuario</h3>
                    <p>Para crear una cuenta debe proporcionar información veraz y completa. Los Creadores deben completar verificación de identidad con documentación oficial.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">4. Contenido del Usuario</h3>
                    <p>Usted conserva los derechos de su Contenido original. Al publicar, nos otorga licencia para distribuirlo en la Plataforma. Todo el Contenido debe cumplir con nuestras políticas.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">5. Contenido Prohibido</h3>
                    <ul className="list-disc pl-5 space-y-2">
                      <li>Contenido que involucre menores de 18 años</li>
                      <li>Contenido sin consentimiento verificable</li>
                      <li>Contenido ilegal, violento o que infrinja derechos de terceros</li>
                      <li>Spam, fraude o actividades engañosas</li>
                    </ul>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">6. Pagos y Comisiones</h3>
                    <p>La Plataforma retiene 20% de comisión. Los Creadores reciben 80%. Pagos mensuales con mínimo de retiro de $50 USD.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">7. Propiedad Intelectual</h3>
                    <p>Los Creadores conservan derechos de autor de su Contenido. La Plataforma posee derechos sobre el software, diseño y marcas.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">8. Limitación de Responsabilidad</h3>
                    <p>La Plataforma se proporciona "TAL CUAL". No garantizamos resultados específicos. Nuestra responsabilidad máxima está limitada a los pagos recibidos en los últimos 12 meses.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">9. Terminación</h3>
                    <p>Puede cerrar su cuenta en cualquier momento. Podemos suspender cuentas que violen estos Términos.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">10. Ley Aplicable</h3>
                    <p>Estos Términos se rigen por las leyes de su jurisdicción de residencia.</p>

                    <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                      <p className="text-sm text-blue-800">
                        <strong>Documento Completo:</strong> Este es un resumen. Para el documento completo, consulte{' '}
                        <a href="/legal/TERMS_AND_CONDITIONS.md" className="underline" target="_blank">Términos Completos</a>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {activePolicy === 'privacy' && (
                <div>
                  <h2 className="text-3xl font-bold text-gray-900 mb-6">Política de Privacidad</h2>
                  <div className="prose prose-sm max-w-none text-gray-600 space-y-4">
                    <p className="text-sm text-gray-500"><strong>Última actualización:</strong> Enero 2024</p>
                    <p className="text-sm text-gray-500"><strong>Cumplimiento:</strong> GDPR, CCPA, LGPD</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">1. Información que Recopilamos</h3>
                    <p>Recopilamos información personal (nombre, email, fecha de nacimiento), información de uso (IP, dispositivo, actividad) e información de pago (procesada por terceros seguros).</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">2. Cómo Usamos su Información</h3>
                    <ul className="list-disc pl-5 space-y-2">
                      <li>Proporcionar y mejorar el servicio</li>
                      <li>Procesar pagos y suscripciones</li>
                      <li>Verificar identidad y edad</li>
                      <li>Prevenir fraude y actividades ilegales</li>
                      <li>Cumplir con obligaciones legales</li>
                    </ul>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">3. Sus Derechos</h3>
                    <p>Tiene derecho a acceder, rectificar, eliminar y portar sus datos. Puede oponerse al procesamiento y solicitar limitación.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">4. Seguridad</h3>
                    <p>Implementamos encriptación TLS/SSL, AES-256, autenticación de dos factores y monitoreo 24/7.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">5. Retención de Datos</h3>
                    <p>Conservamos datos mientras su cuenta esté activa + 30 días. Datos financieros: 7 años. Datos de verificación: 5 años post-cierre.</p>

                    <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                      <p className="text-sm text-blue-800">
                        <strong>Documento Completo:</strong> Consulte{' '}
                        <a href="/legal/PRIVACY_POLICY.md" className="underline" target="_blank">Política Completa</a>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {activePolicy === 'creator' && (
                <div>
                  <h2 className="text-3xl font-bold text-gray-900 mb-6">Contrato para Creadores y Afiliados</h2>
                  <div className="prose prose-sm max-w-none text-gray-600 space-y-4">
                    <p className="text-sm text-gray-500"><strong>Última actualización:</strong> Enero 2024</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">1. Relación entre las Partes</h3>
                    <p>Usted es contratista independiente, no empleado. Este contrato no es exclusivo.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">2. Obligaciones del Creador</h3>
                    <ul className="list-disc pl-5 space-y-2">
                      <li>Completar verificación de identidad</li>
                      <li>Mantener estándares de calidad</li>
                      <li>Obtener consentimiento de todas las personas en su Contenido</li>
                      <li>Publicar regularmente (mínimo 1 vez cada 30 días)</li>
                      <li>Cumplir con todas las leyes aplicables</li>
                    </ul>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">3. Estructura de Pagos</h3>
                    <div className="bg-gray-50 p-4 rounded-xl">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2">Nivel</th>
                            <th className="text-left py-2">Suscriptores</th>
                            <th className="text-left py-2">Comisión</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b">
                            <td className="py-2">Estándar</td>
                            <td className="py-2">0-499</td>
                            <td className="py-2">20%</td>
                          </tr>
                          <tr className="border-b">
                            <td className="py-2">Premium</td>
                            <td className="py-2">500-1999</td>
                            <td className="py-2">15%</td>
                          </tr>
                          <tr>
                            <td className="py-2">Élite</td>
                            <td className="py-2">2000+</td>
                            <td className="py-2">10%</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">4. Propiedad Intelectual</h3>
                    <p>Usted conserva derechos de autor. Nos otorga licencia para distribuir su Contenido en la Plataforma.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">5. Impuestos</h3>
                    <p>Usted es responsable de declarar y pagar impuestos sobre sus ingresos. Proporcionamos reportes fiscales anuales.</p>

                    <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                      <p className="text-sm text-blue-800">
                        <strong>Documento Completo:</strong> Consulte{' '}
                        <a href="/legal/CREATOR_AFFILIATE_AGREEMENT.md" className="underline" target="_blank">Contrato Completo</a>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {activePolicy === 'minors' && (
                <div>
                  <h2 className="text-3xl font-bold text-gray-900 mb-6">Política de Protección de Menores</h2>
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
                    <p>Todos los Usuarios deben verificar su edad con documentación oficial. Los Creadores deben verificar la edad de todas las personas que aparecen en su Contenido.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">3. Monitoreo y Detección</h3>
                    <p>Utilizamos IA especializada, PhotoDNA, análisis de contenido y revisión humana para detectar y eliminar contenido con menores.</p>

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
                        <strong>Teléfono 24/7:</strong> [Número de emergencia]<br/>
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
                    <h3 className="text-xl font-bold text-gray-900 mt-6">¿Qué son las Cookies?</h3>
                    <p>Las cookies son pequeños archivos de texto que se almacenan en su dispositivo para hacer que el sitio web funcione mejor.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">Tipos de Cookies</h3>
                    <ul className="list-disc pl-5 space-y-2">
                      <li><strong>Esenciales:</strong> Necesarias para el funcionamiento (sesión, seguridad)</li>
                      <li><strong>Funcionales:</strong> Mejoran la experiencia (preferencias, idioma)</li>
                      <li><strong>Analíticas:</strong> Nos ayudan a entender el uso (Google Analytics)</li>
                      <li><strong>Marketing:</strong> Para anuncios relevantes (Facebook Pixel)</li>
                    </ul>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">Gestión de Cookies</h3>
                    <p>Puede controlar cookies desde la configuración de su navegador o desde su panel de preferencias en {BRAND.name}.</p>
                  </div>
                </div>
              )}

              {activePolicy === 'dmca' && (
                <div>
                  <h2 className="text-3xl font-bold text-gray-900 mb-6">Política DMCA y Derechos de Autor</h2>
                  <div className="prose prose-sm max-w-none text-gray-600 space-y-4">
                    <h3 className="text-xl font-bold text-gray-900 mt-6">Respeto por Derechos de Autor</h3>
                    <p>Respetamos los derechos de propiedad intelectual y esperamos que nuestros Usuarios hagan lo mismo.</p>

                    <h3 className="text-xl font-bold text-gray-900 mt-6">Notificación de Infracción</h3>
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

                    <h3 className="text-xl font-bold text-gray-900 mt-6">Infractores Reincidentes</h3>
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
