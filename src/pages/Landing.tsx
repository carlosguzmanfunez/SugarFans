import React, { useRef } from 'react';
import { useCreatorCatalog } from '../lib/catalog';
import CreatorHome from '../components/landing/CreatorHome';
import { useAuth } from '../context/AuthContext';
import HappeningNow from '../components/landing/HappeningNow';
import { ENABLE_HAPPENING_NOW } from '../config/features';
import { useLandingMotion } from '../components/landing/landingBits';
import { HERO } from '../content/landing';
import { BECOME_CREATOR_LINK } from '../lib/becomeCreator';
import { Communities, CreatorInvite, FeaturedExperiences, HomeHero, TrustProcess } from '../components/home/HomeV3';
import '../components/landing/landing.css';

// The signed-in home (V3 "Human Premium"). Fans and admins get the editorial hero
// with their next step; creators keep their own top (their day, not the fans'
// pitch). The earlier sections (Hero deck, CategoryGrid, HowItWorks, VipShowcase,
// CreatorCta) stay in components/landing for reference and rollback.
const Landing: React.FC = () => {
  const { creators } = useCreatorCatalog();
  const { user } = useAuth();
  const root = useRef<HTMLDivElement>(null);
  useLandingMotion(root);
  const member = user ? HERO.member[user.role] : HERO.member.fan;

  return (
    <div ref={root} className="v3 min-h-screen">
      {user?.role === 'creator' ? (
        <div className="lv2"><CreatorHome /></div>
      ) : (
        <HomeHero creators={creators} primary={member.primary} secondary={member.secondary} />
      )}
      {user?.role !== 'creator' && <TrustProcess />}
      <FeaturedExperiences creators={creators} />
      <Communities />
      {/* "Está pasando ahora" is off until further notice (ENABLE_HAPPENING_NOW). */}
      {ENABLE_HAPPENING_NOW && <div className="lv2"><HappeningNow creators={creators} /></div>}
      {user?.role === 'fan' && <CreatorInvite primary={{ label: 'Hazte creador', to: BECOME_CREATOR_LINK }} />}
    </div>
  );
};

export default Landing;
