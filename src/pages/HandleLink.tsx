import React, { Suspense, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useCreatorCatalog } from '../lib/catalog';
import { saveRefCode } from '../lib/rewards';
import { lazyPage } from '../lib/lazyPage';

const CreatorProfile = lazyPage(() => import('./CreatorProfile'));

const HANDLE_PATH = /^\/@([A-Za-z0-9_]{3,30})\/?$/;

// Visitors who arrive from a search engine were brought by Google, not by the
// creator's own link, so they don't earn the creator the link-fan rate.
const SEARCH_REFERRER = /^https?:\/\/([a-z0-9-]+\.)*(google|bing|duckduckgo|yahoo|yandex|ecosia|baidu|brave|startpage)\.[a-z.]+(\/|$)/i;
export const fromSearchEngine = (referrer: string) => SEARCH_REFERRER.test(referrer);

const Spinner = () => (
  <div className="min-h-screen flex items-center justify-center" role="status" aria-label="Cargando perfil">
    <i aria-hidden="true" className="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
  </div>
);

// fansreserve.com/@usuario: the creator's own link (for their TikTok or Instagram bio)
// and the address Google shows for the profile. The profile opens right here, so the
// @usuario stays in the address bar. Like /r/<id>, a visitor from the creator's link
// counts as brought by that creator. Any other unknown address is the 404 page.
const HandleLink: React.FC = () => {
  const { pathname } = useLocation();
  const handle = HANDLE_PATH.exec(pathname)?.[1]?.toLowerCase();
  const { creators, loading } = useCreatorCatalog();
  const creator = handle ? creators.find((c) => c.username === handle) : undefined;
  const creatorId = creator?.id;

  useEffect(() => {
    if (creatorId && !fromSearchEngine(document.referrer)) saveRefCode(creatorId);
  }, [creatorId]);

  if (creator) {
    return (
      <Suspense fallback={<Spinner />}>
        <CreatorProfile profileId={creator.id} />
      </Suspense>
    );
  }
  if (handle && loading) return <Spinner />;
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
