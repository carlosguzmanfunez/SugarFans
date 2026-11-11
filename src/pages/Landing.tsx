import React, { useRef } from 'react';
import { useCreatorCatalog } from '../lib/catalog';
import Hero from '../components/landing/Hero';
import CreatorHome from '../components/landing/CreatorHome';
import AdminHome from '../components/landing/AdminHome';
import { useAuth } from '../context/AuthContext';
import CreatorMonetization from '../components/landing/CreatorMonetization';
import HappeningNow from '../components/landing/HappeningNow';
import HowItWorks from '../components/landing/HowItWorks';
import VipShowcase from '../components/landing/VipShowcase';
import CreatorCta from '../components/landing/CreatorCta';
import { ENABLE_HAPPENING_NOW } from '../config/features';
import { useLandingMotion } from '../components/landing/landingBits';
import '../components/landing/landing.css';

const Landing: React.FC = () => {
  const { creators } = useCreatorCatalog();
  const { user } = useAuth();
  const isCreator = user?.role === 'creator';
  const root = useRef<HTMLDivElement>(null);
  useLandingMotion(root);

  // Admins (and the owner in admin view) get their own Inicio: what waits for a
  // decision and shortcuts to the panel, not the fans' pitch.
  if (user?.role === 'admin') return <div ref={root} className="lv2 min-h-screen"><AdminHome /></div>;

  return (
    <div ref={root} className="lv2 min-h-screen">
      {/* Creators get their own top: their day, not the fans' pitch. */}
      {isCreator ? <CreatorHome /> : <Hero />}
      {isCreator && <CreatorMonetization />}
      {/* "Está pasando ahora" is off until further notice (ENABLE_HAPPENING_NOW). */}
      {ENABLE_HAPPENING_NOW && <HappeningNow creators={creators} />}
      {!isCreator && <>
        <HowItWorks />
        <VipShowcase />
        <CreatorCta />
      </>}
    </div>
  );
};

export default Landing;
