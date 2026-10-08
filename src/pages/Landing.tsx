import React, { useRef } from 'react';
import { useCreatorCatalog } from '../lib/catalog';
import Hero from '../components/landing/Hero';
import CreatorHome from '../components/landing/CreatorHome';
import { useAuth } from '../context/AuthContext';
import CategoryGrid from '../components/landing/CategoryGrid';
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
  const root = useRef<HTMLDivElement>(null);
  useLandingMotion(root);

  return (
    <div ref={root} className="lv2 min-h-screen">
      {/* Creators get their own top: their day, not the fans' pitch. */}
      {user?.role === 'creator' ? <CreatorHome /> : <Hero creators={creators} />}
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
