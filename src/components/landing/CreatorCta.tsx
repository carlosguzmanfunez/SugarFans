import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CREATOR_CTA } from '../../content/landing';
import { useAuth } from '../../context/AuthContext';

// Call to creators: one bold panel, with a person signing up on their phone and a
// few notifications of what running a community here looks like. Earnings terms
// live in the creator signup and panel, not on the landing. Signed-in fans and
// admins can't sign up again, so they don't see it; creators get a shortcut to
// their panel instead of the signup.
const CreatorCta: React.FC = () => {
  const { user } = useAuth();
  const panel = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [shown, setShown] = useState(false);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = panel.current;
    if (!el || !('IntersectionObserver' in window)) {
      setInView(true);
      return setShown(true);
    }
    const io = new IntersectionObserver(
      (es) => {
        setInView(es[0].isIntersecting);
        if (es[0].isIntersecting) setShown(true);
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    const t = window.setTimeout(() => setShown(true), 2500);
    return () => {
      io.disconnect();
      window.clearTimeout(t);
    };
  }, []);
  // The clip only plays while the panel is on screen, and never with reduced motion.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (inView && !reduce) v.play().catch(() => {});
    else v.pause();
  }, [inView]);
  if (user && user.role !== 'creator') return null;
  const isCreator = user?.role === 'creator';
  return (
    <section className="sec" id="creadores" aria-labelledby="creator-cta-title" style={{ paddingTop: 20 }}>
      <div className="wrap">
        <div ref={panel} className={`cta v-reveal ${shown ? 'in' : ''}`}>
          <div className="cta-copy">
            <h2 id="creator-cta-title">{CREATOR_CTA.title}</h2>
            <p>{CREATOR_CTA.subtitle}</p>
            <div className="ctas">
              <Link to={isCreator ? '/creator/dashboard' : '/register?role=creator'} className="v-btn v-gold magnet">
                {isCreator ? CREATOR_CTA.memberCta : CREATOR_CTA.cta}
              </Link>
            </div>
          </div>
          <div className="cta-media" aria-hidden="true">
            <div className="cta-shot" data-testid="creator-cta-media">
              {CREATOR_CTA.video ? (
                <video ref={video} muted loop playsInline preload={inView ? 'auto' : 'none'} poster={CREATOR_CTA.poster}>
                  <source src={CREATOR_CTA.video} type="video/mp4" />
                </video>
              ) : (
                <img src={CREATOR_CTA.poster} alt="" loading="lazy" decoding="async" />
              )}
              <div className="cta-done">
                <i className="fa-solid fa-check"></i>
                <span>{CREATOR_CTA.signupDone}</span>
              </div>
            </div>
            {CREATOR_CTA.notifications.map((n) => (
              <div key={n.title} className="v-card cta-note">
                <b>{n.title}</b>
                <span>{n.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default CreatorCta;
