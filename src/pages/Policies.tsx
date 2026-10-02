import React from 'react';
import { BRAND } from '../config/brand';

const Policies: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Políticas y Términos</h1>

        <div className="space-y-8">
          {/* Terms of Service */}
          <section className="bg-white rounded-2xl shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
              <i aria-hidden="true" className="fas fa-file-contract text-pink-500 mr-3"></i> Términos de Servicio
            </h2>
            <div className="prose prose-sm text-gray-600 space-y-4">
              <p><strong>Última actualización:</strong> Enero 2024</p>
              <p>Bienvenido a {BRAND.name}. Al utilizar nuestra plataforma, aceptas estos términos de servicio. Lee cuidadosamente antes de usar el servicio.</p>
              
              <h3 className="text-lg font-semibold text-gray-900 mt-6">1. Elegibilidad</h3>
              <p>Debes tener al menos 18 años de edad para usar {BRAND.name}. Al registrarte, declaras y garantizas que cumples con este requisito. Los menores de edad tienen estrictamente prohibido el uso de la plataforma.</p>
              
              <h3 className="text-lg font-semibold text-gray-900 mt-6">2. Cuentas de Creadores</h3>
              <p>Los creadores deben verificar su identidad con un documento oficial válido. Todo contenido publicado debe contar con el consentimiento expreso de todas las personas que aparezcan en él. La plataforma se reserva el derecho de rechazar o eliminar cuentas que no cumplan con estos requisitos.</p>
              
              <h3 className="text-lg font-semibold text-gray-900 mt-6">3. Contenido Prohibido</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>Contenido que involucre menores de edad</li>
                <li>Contenido sin consentimiento de las personas involucradas</li>
                <li>Contenido violento extremo o ilegal</li>
                <li>Contenido que viole derechos de propiedad intelectual de terceros</li>
                <li>Spam, fraude o actividades engañosas</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-900 mt-6">4. Pagos y Reembolsos</h3>
              <p>Las suscripciones se renuevan automáticamente. Los reembolsos se evalúan caso por caso. Los creadores reciben el 80% de los ingresos generados, con pagos mensuales.</p>

              <h3 className="text-lg font-semibold text-gray-900 mt-6">5. Propiedad Intelectual</h3>
              <p>Los creadores mantienen los derechos de su contenido. Al publicar en {BRAND.name}, otorgan una licencia limitada para la distribución a través de la plataforma. Reporta cualquier violación de derechos de autor mediante nuestro sistema DMCA.</p>
            </div>
          </section>

          {/* Privacy Policy */}
          <section className="bg-white rounded-2xl shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
              <i aria-hidden="true" className="fas fa-lock text-pink-500 mr-3"></i> Política de Privacidad
            </h2>
            <div className="prose prose-sm text-gray-600 space-y-4">
              <p><strong>Última actualización:</strong> Enero 2024</p>
              <p>En {BRAND.name} nos tomamos tu privacidad muy seriamente. Esta política describe cómo recopilamos, usamos y protegemos tu información.</p>

              <h3 className="text-lg font-semibold text-gray-900 mt-6">Datos que recopilamos</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>Información de cuenta (nombre, email, fecha de nacimiento)</li>
                <li>Datos de verificación de identidad (solo para creadores)</li>
                <li>Información de pago (procesada por terceros seguros)</li>
                <li>Datos de uso y navegación</li>
                <li>Comunicaciones entre usuarios</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-900 mt-6">Cómo usamos tus datos</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>Proporcionar y mejorar el servicio</li>
                <li>Verificar identidad y edad</li>
                <li>Procesar pagos</li>
                <li>Enviar notificaciones relevantes</li>
                <li>Cumplir obligaciones legales</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-900 mt-6">Tus derechos</h3>
              <p>Tienes derecho a acceder, rectificar, eliminar y portar tus datos. También puedes oponerte al procesamiento y solicitar la limitación del mismo. Para ejercer estos derechos, contacta a {BRAND.emails.privacy}</p>

              <h3 className="text-lg font-semibold text-gray-900 mt-6">Seguridad</h3>
              <p>Implementamos medidas de seguridad de nivel bancario incluyendo encriptación TLS/SSL, almacenamiento seguro de datos y auditorías regulares de seguridad.</p>
            </div>
          </section>

          {/* Cookie Policy */}
          <section className="bg-white rounded-2xl shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
              <i aria-hidden="true" className="fas fa-cookie-bite text-pink-500 mr-3"></i> Política de Cookies
            </h2>
            <div className="prose prose-sm text-gray-600 space-y-4">
              <p>Utilizamos cookies para mejorar tu experiencia en {BRAND.name}.</p>
              <h3 className="text-lg font-semibold text-gray-900 mt-6">Tipos de cookies</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Esenciales:</strong> Necesarias para el funcionamiento de la plataforma</li>
                <li><strong>Analíticas:</strong> Nos ayudan a entender cómo usas el servicio</li>
                <li><strong>Funcionales:</strong> Recuerdan tus preferencias</li>
              </ul>
              <p>Puedes gestionar tus preferencias de cookies desde la configuración de tu navegador.</p>
            </div>
          </section>

          {/* DMCA */}
          <section className="bg-white rounded-2xl shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
              <i aria-hidden="true" className="fas fa-gavel text-pink-500 mr-3"></i> Política DMCA
            </h2>
            <div className="prose prose-sm text-gray-600 space-y-4">
              <p>{BRAND.name} respeta los derechos de propiedad intelectual. Si crees que tu trabajo ha sido copiado de manera que constituye infracción de derechos de autor, puedes enviar una notificación DMCA.</p>
              <h3 className="text-lg font-semibold text-gray-900 mt-6">Cómo enviar una notificación</h3>
              <p>Envía un email a {BRAND.emails.dmca} incluyendo:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Identificación de la obra protegida</li>
                <li>Ubicación del contenido infractor en la plataforma</li>
                <li>Tu información de contacto</li>
                <li>Declaración de buena fe</li>
                <li>Firma (electrónica o física)</li>
              </ul>
            </div>
          </section>

          {/* Protection of Minors */}
          <section className="bg-white rounded-2xl shadow-sm p-6 border-2 border-red-200">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
              <i aria-hidden="true" className="fas fa-child text-red-500 mr-3"></i> Protección de Menores
            </h2>
            <div className="prose prose-sm text-gray-600 space-y-4">
              <p className="font-medium text-red-700">{BRAND.name} tiene TOLERANCIA CERO con cualquier contenido que involucre menores de edad.</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Todos los creadores deben verificar su mayoría de edad con documento oficial</li>
                <li>Se requiere verificación de consentimiento de todas las personas en el contenido</li>
                <li>Utilizamos sistemas automatizados y revisión humana para detectar contenido inapropiado</li>
                <li>Reportamos activamente a las autoridades cualquier sospecha de contenido con menores</li>
                <li>Las cuentas vinculadas a menores son eliminadas inmediatamente y reportadas</li>
              </ul>
              <p className="mt-4">Si sospechas de contenido con menores, contacta inmediatamente a <strong>{BRAND.emails.safety}</strong> o reporta a las autoridades locales.</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default Policies;
