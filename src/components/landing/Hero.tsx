import React from 'react';
import { Link } from 'react-router-dom';
import type { Creator } from '../../data/mockData';
import { HERO } from '../../content/landing';
import { useAuth } from '../../context/AuthContext';
import Avatar from '../Avatar';
import HeroShowcase from './HeroShowcase';

const Hero: React.FC<{ creators: Creator[] }> = ({ creators }) => {
  const { user } = useAuth();
  const faces = creators.filter((c) => c.avatar).slice(0, 5);
  const member = user ? HERO.member[user.role] : null;
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden">
      {/* Backdrop: warm canvas, two soft brand glows and a faint grid */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(247,99,155,0.20),transparent)]" />
        <div className="absolute -right-32 top-24 h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,rgba(109,60,230,0.14),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(22,13,31,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(22,13,31,0.045)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
      </div>

      <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-10 sm:px-6 md:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:px-8 lg:pb-24 lg:pt-20">
        <div className="text-center lg:text-left">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-white/80 px-3.5 py-1.5 text-xs font-medium text-ink/80 shadow-sm backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true"></span>
            {HERO.eyebrow}
          </p>
          <h1 id="hero-title" className="text-display-xl mx-auto mt-6 max-w-2xl text-ink lg:mx-0">
            {HERO.titleLead} <span className="text-reserve">{HERO.titleAccent}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-lg leading-relaxed text-muted md:text-xl lg:mx-0">{HERO.subtitle}</p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
            {member ? (
              <>
                <Link to={member.primary.to} className="btn btn-primary btn-lg">
                  {member.primary.label} <i className="fas fa-arrow-right text-sm" aria-hidden="true"></i>
                </Link>
                <Link to={member.secondary.to} className="btn btn-outline btn-lg">
                  <i className={`fas ${member.secondary.icon} text-sm text-brand-600`} aria-hidden="true"></i> {member.secondary.label}
                </Link>
              </>
            ) : (
              <>
                <Link to="/register" className="btn btn-primary btn-lg">
                  {HERO.primaryCta} <i className="fas fa-arrow-right text-sm" aria-hidden="true"></i>
                </Link>
                <Link to="/explore" className="btn btn-outline btn-lg">
                  <i className="fas fa-compass text-sm text-brand-600" aria-hidden="true"></i> {HERO.secondaryCta}
                </Link>
              </>
            )}
          </div>

          {faces.length > 0 && (
            <div className="mt-8 hidden items-center gap-3 sm:flex sm:flex-row sm:justify-center lg:justify-start">
              <div className="flex -space-x-2.5">
                {faces.map((c) => (
                  <Avatar key={c.id} src={c.avatar} name={c.name} size={36} decorative className="ring-2 ring-canvas" />
                ))}
              </div>
              <p className="text-sm text-muted">{HERO.socialProof}</p>
            </div>
          )}

          <ul className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13px] text-ink/70 sm:gap-x-6 sm:text-sm lg:justify-start">
            {HERO.trust.map((item) => (
              <li key={item.label} className="inline-flex items-center gap-2">
                <i className={`fas ${item.icon} text-iris-600`} aria-hidden="true"></i>
                {item.label}
              </li>
            ))}
          </ul>
        </div>

        <HeroShowcase />
      </div>
    </section>
  );
};

export default Hero;
