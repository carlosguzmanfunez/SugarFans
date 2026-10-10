import React from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useCreatorCatalog } from '../lib/catalog';
import { saveRefCode } from '../lib/rewards';

const HANDLE_PATH = /^\/@([A-Za-z0-9_]{3,30})\/?$/;

// fansreserve.com/@usuario: the creator's own link (for their TikTok or Instagram bio).
// Like /r/<id>, the visitor counts as brought by that creator, then sees the profile.
// Any other unknown address is the 404 page.
const HandleLink: React.FC = () => {
  const { pathname } = useLocation();
  const handle = HANDLE_PATH.exec(pathname)?.[1]?.toLowerCase();
  const { creators, loading } = useCreatorCatalog();
  const creator = handle ? creators.find((c) => c.username === handle) : undefined;

  if (creator) {
    saveRefCode(creator.id);
    return <Navigate to={`/creator/${creator.id}`} replace />;
  }
  if (handle && loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-label="Cargando perfil">
        <i aria-hidden="true" className="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
      </div>
    );
  }
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center px-4">
        <h1 className="text-6xl font-bold text-gray-300 mb-4">404</h1>
        <p className="text-gray-600 mb-6">{handle ? `No encontramos a @${handle} en Fans Reserve` : 'Página no encontrada'}</p>
        <Link to={handle ? '/explore' : '/'} className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-6 py-3 rounded-xl font-medium">
          {handle ? 'Explorar creadores' : 'Volver al inicio'}
        </Link>
      </div>
    </div>
  );
};

export default HandleLink;
