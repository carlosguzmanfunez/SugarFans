import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import PresentationCover from '../components/landing/PresentationCover';
import { useLandingMotion } from '../components/landing/landingBits';
import { useCreatorCatalog } from '../lib/catalog';
import { Arrow, Communities, CreatorInvite, FeaturedExperiences, HomeHero, TrustProcess, VisitorHeader } from '../components/home/HomeV3';
import Footer from '../components/Footer';
import '../components/landing/landing.css';

// What visitors without a session get at "/" (V3 "Human Premium"): an editorial
// hero, the real booking process, experiences, communities, the presentation film
// with the sign-up form, and the invitation for creators. No app menus: a compact
// header with Explorar, Experiencias, Cómo funciona, Para creadores and FAQ.
// After signing up, fans land on the main page and creators on their panel.
const JoinPage: React.FC = () => {
  const root = useRef<HTMLDivElement>(null);
  useLandingMotion(root);
  const { creators } = useCreatorCatalog();

  return (
    <div ref={root} className="v3 join min-h-screen">
      <VisitorHeader />
      <HomeHero
        creators={creators}
        primary={{ label: 'Explorar experiencias', to: '/reserve' }}
        secondary={{ label: 'Soy creador', to: '/register?role=creator' }}
        note={<>Crear tu cuenta es gratis. <Link to="/register">Crear cuenta gratis</Link></>}
      />
      <TrustProcess />
      <FeaturedExperiences creators={creators} />
      <Communities />
      <section className="v3-film" aria-label="Presentación de Fans Reserve">
        <PresentationCover variant="film" />
      </section>
      <CreatorInvite />
      <section className="v3-end" aria-labelledby="join-end-title">
        <div className="v3-wrap">
          <h2 id="join-end-title" className="v3-h2">
            Tu próxima experiencia <em>comienza aquí.</em>
          </h2>
          <p className="v3-lead">Crear tu cuenta es gratis y toma menos de un minuto.</p>
          <div className="ctas">
            <Link to="/register" className="v3-btn v3-pri">
              Crear cuenta gratis <Arrow />
            </Link>
            <Link to="/login" className="v3-link">
              ¿Ya tienes cuenta? Inicia sesión
            </Link>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default JoinPage;
