import React from 'react';
import { useCreatorCatalog } from '../lib/catalog';
import { useFeatured } from '../lib/rewards';
import Hero from '../components/landing/Hero';
import FeaturedCreators from '../components/landing/FeaturedCreators';
import CategoryGrid from '../components/landing/CategoryGrid';
import HowItWorks from '../components/landing/HowItWorks';
import VipShowcase from '../components/landing/VipShowcase';
import CreatorCta from '../components/landing/CreatorCta';

const Landing: React.FC = () => {
  const { creators } = useCreatorCatalog();
  const featured = useFeatured();

  return (
    <div className="min-h-screen bg-canvas">
      <Hero creators={creators} />
      <CategoryGrid />
      <FeaturedCreators creators={creators} featured={featured} />
      <HowItWorks />
      <VipShowcase />
      <CreatorCta />
    </div>
  );
};

export default Landing;
