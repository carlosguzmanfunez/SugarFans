import React, { useRef } from 'react';
import { useCreatorCatalog } from '../lib/catalog';
import Hero from '../components/landing/Hero';
import CategoryGrid from '../components/landing/CategoryGrid';
import HappeningNow from '../components/landing/HappeningNow';
import HowItWorks from '../components/landing/HowItWorks';
import VipShowcase from '../components/landing/VipShowcase';
import CreatorCta from '../components/landing/CreatorCta';
import PresentationCover from '../components/landing/PresentationCover';
import { useAuth, MEMBER_DEVICE_KEY } from '../context/AuthContext';
import { readJSON } from '../lib/storage';
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
      {/* The presentation film is the sign-up entrance for visitors. Anyone who has signed in on
          this device (fan or creator, even after logging out) starts at the hero. */}
      {!loading && !user && !readJSON<boolean>(MEMBER_DEVICE_KEY, false) && <PresentationCover />}
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
