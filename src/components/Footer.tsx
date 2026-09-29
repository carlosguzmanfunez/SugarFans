import React from 'react';
import { Link } from 'react-router-dom';

const Footer: React.FC = () => {
  return (
    <footer className="bg-gray-900 text-gray-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-1">
            <div className="flex items-center space-x-2 mb-4">
              <div className="w-8 h-8 bg-gradient-to-br from-pink-500 to-purple-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">SF</span>
              </div>
              <span className="text-xl font-bold text-white">SugarFans</span>
            </div>
            <p className="text-sm text-gray-400">
              La plataforma de suscripciones para creadores de contenido. Conecta con tus creadores favoritos.
            </p>
          </div>

          {/* Links */}
          <div>
            <h3 className="text-white font-semibold mb-4">Plataforma</h3>
            <ul className="space-y-2 text-sm">
              <li><Link to="/explore" className="hover:text-pink-400 transition">Explorar</Link></li>
              <li><Link to="/pricing" className="hover:text-pink-400 transition">Precios</Link></li>
              <li><Link to="/help" className="hover:text-pink-400 transition">Centro de Ayuda</Link></li>
              <li><Link to="/register" className="hover:text-pink-400 transition">Ser Creador</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-4">Legal</h3>
            <ul className="space-y-2 text-sm">
              <li><Link to="/policies" className="hover:text-pink-400 transition">Términos de Servicio</Link></li>
              <li><Link to="/policies" className="hover:text-pink-400 transition">Política de Privacidad</Link></li>
              <li><Link to="/policies" className="hover:text-pink-400 transition">Política de Cookies</Link></li>
              <li><Link to="/policies" className="hover:text-pink-400 transition">DMCA</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-white font-semibold mb-4">Seguridad</h3>
            <ul className="space-y-2 text-sm">
              <li><Link to="/help" className="hover:text-pink-400 transition">Reportar Contenido</Link></li>
              <li><Link to="/help" className="hover:text-pink-400 transition">Protección de Menores</Link></li>
              <li><Link to="/help" className="hover:text-pink-400 transition">Verificación de Identidad</Link></li>
              <li><Link to="/help" className="hover:text-pink-400 transition">Derechos de Autor</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 mt-8 pt-8 flex flex-col md:flex-row justify-between items-center">
          <p className="text-sm text-gray-500">
            © 2024 SugarFans. Todos los derechos reservados. Solo para mayores de 18 años.
          </p>
          <div className="flex space-x-4 mt-4 md:mt-0">
            <a href="#" className="text-gray-400 hover:text-pink-400"><i className="fab fa-twitter"></i></a>
            <a href="#" className="text-gray-400 hover:text-pink-400"><i className="fab fa-instagram"></i></a>
            <a href="#" className="text-gray-400 hover:text-pink-400"><i className="fab fa-telegram"></i></a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
