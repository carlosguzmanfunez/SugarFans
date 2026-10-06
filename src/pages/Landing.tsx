import React, { useRef } from 'react';
import { useCreatorCatalog } from '../lib/catalog';
import Hero from '../components/landing/Hero';
import CategoryGrid from '../components/landing/CategoryGrid';
import HappeningNow from '../components/landing/HappeningNow';
import HowItWorks from '../components/landing/HowItWorks';
import VipShowcase from '../components/landing/VipShowcase';
import CreatorCta from '../components/landing/CreatorCta';
import PresentationCover from '../components/landing/PresentationCover';
import { useAuth } from '../context/AuthContext';
import { ENABLE_HAPPENING_NOW } from '../config/features';
import { useLandingMotion } from '../components/landing/landingBits';
import '../components/landing/landing.css';

const Landing: React.FC = () => {
  const { creators } = useCreatorCatalog();
  const { user, loading } = useAuth();
  const root = useRef<HTMLDivElement>(null);
  useLandingMotion(root);

  return (
    <div ref={root} className="lv2 min-h-screen">
      {/* The presentation film is for visitors; fans and creators start at the hero. */}
      {!loading && !user && <PresentationCover />}
      <Hero creators={creators} />
      <CategoryGrid creators={creators} />
      {/* "Está pasando ahora" is off until further notice (ENABLE_HAPPENING_NOW). */}
      {ENABLE_HAPPENING_NOW && <HappeningNow creators={creators} />}
      <HowItWorks />
      <VipShowcase />
      <CreatorCta />
    </div>
  );
};

export default Landing;
