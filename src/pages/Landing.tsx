import React, { useRef } from 'react';
import { useCreatorCatalog } from '../lib/catalog';
import Hero from '../components/landing/Hero';
import CategoryGrid from '../components/landing/CategoryGrid';
import HappeningNow from '../components/landing/HappeningNow';
import HowItWorks from '../components/landing/HowItWorks';
import VipShowcase from '../components/landing/VipShowcase';
import CreatorCta from '../components/landing/CreatorCta';
import { useLandingMotion } from '../components/landing/landingBits';
import '../components/landing/landing.css';

const Landing: React.FC = () => {
  const { creators } = useCreatorCatalog();
  const root = useRef<HTMLDivElement>(null);
  useLandingMotion(root);

  return (
    <div ref={root} className="lv2 min-h-screen">
      <Hero creators={creators} />
      <CategoryGrid creators={creators} />
      <HappeningNow creators={creators} />
      <HowItWorks />
      <VipShowcase />
      <CreatorCta />
    </div>
  );
};

export default Landing;
