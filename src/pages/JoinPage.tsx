import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import PresentationCover from '../components/landing/PresentationCover';
import HowItWorks from '../components/landing/HowItWorks';
import { ArrowRight, useLandingMotion } from '../components/landing/landingBits';
import '../components/landing/landing.css';

// Sign-up page: what visitors without a session get at "/". Only the presentation
// film, how it works and the way in (create an account or sign in); no app menus.
// After signing up, fans land on the main page and creators on their panel.
const JoinPage: React.FC = () => {
  const root = useRef<HTMLDivElement>(null);
  useLandingMotion(root);

  return (
    <div ref={root} className="lv2 join min-h-screen">
      <header className="join-top">
        <div className="wrap join-bar">
          <BrandLogo size="sm" tone="dark" />
          <Link to="/login" className="join-login">
            Iniciar sesión
          </Link>
        </div>
      </header>
      <PresentationCover />
      <HowItWorks />
      <section className="join-end" aria-labelledby="join-end-title">
        <div className="wrap">
          <h2 id="join-end-title">
            Tu acceso reservado <em>a quienes te inspiran.</em>
          </h2>
          <p>Crear tu cuenta es gratis y toma menos de un minuto.</p>
          <div className="join-end-ctas">
            <Link to="/register" className="v-btn v-pri">
              Crear cuenta gratis <ArrowRight />
            </Link>
            <Link to="/login" className="pc-login">
              ¿Ya tienes cuenta? <b>Inicia sesión</b>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default JoinPage;
