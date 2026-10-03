import React from 'react';
import { Link } from 'react-router-dom';
import { CREATOR_CTA } from '../../content/landing';
import { BrandMark } from '../BrandLogo';
import { useAuth } from '../../context/AuthContext';

// Call to creators: one bold panel with what they can offer their community.
// Earnings terms live in the creator signup and panel, not on the landing.
// Signed-in fans and admins can't sign up again, so they don't see it; creators
// get a shortcut to their panel instead of the signup.
const CreatorCta: React.FC = () => {
  const { user } = useAuth();
  if (user && user.role !== 'creator') return null;
  const isCreator = user?.role === 'creator';
  return (
  <section aria-labelledby="creator-cta-title" className="reveal py-16 md:py-24">
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="relative overflow-hidden rounded-[2rem] bg-reserve px-6 py-12 text-white sm:px-10 md:px-14 md:py-16">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -bottom-32 left-1/3 h-80 w-80 rounded-full bg-night-950/25 blur-2xl" />
          <BrandMark size={300} className="absolute -bottom-16 -right-12 rotate-[-12deg] opacity-[0.12]" />
        </div>
        <div className="relative grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="eyebrow text-white/80">{CREATOR_CTA.eyebrow}</p>
            <h2 id="creator-cta-title" className="text-display-lg mt-3">{CREATOR_CTA.title}</h2>
            <p className="mt-4 max-w-xl text-lg text-white/85">{CREATOR_CTA.subtitle}</p>
            <Link to={isCreator ? '/creator/dashboard' : '/register?role=creator'} className="btn btn-lg btn-light mt-8 shadow-xl">
              {isCreator ? CREATOR_CTA.memberCta : CREATOR_CTA.cta} <i className="fas fa-arrow-right text-sm text-brand-600" aria-hidden="true"></i>
            </Link>
          </div>
          <ul className="grid grid-cols-2 gap-3">
            {CREATOR_CTA.features.map((f) => (
              <li key={f.label} className="flex items-center gap-3 rounded-2xl bg-white/12 p-4 ring-1 ring-white/20 backdrop-blur-sm">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600">
                  <i className={`fas ${f.icon} text-sm`} aria-hidden="true"></i>
                </span>
                <span className="text-sm font-medium leading-tight">{f.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  </section>
  );
};

export default CreatorCta;
