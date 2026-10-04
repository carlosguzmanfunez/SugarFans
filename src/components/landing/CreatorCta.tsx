import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CREATOR_CTA } from '../../content/landing';
import { useAuth } from '../../context/AuthContext';

// Call to creators: one bold panel, with a few notifications of what running a
// community here looks like. Earnings terms live in the creator signup and panel,
// not on the landing. Signed-in fans and admins can't sign up again, so they don't
// see it; creators get a shortcut to their panel instead of the signup.
const CreatorCta: React.FC = () => {
  const { user } = useAuth();
  const panel = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = panel.current;
    if (!el || !('IntersectionObserver' in window)) return setShown(true);
    const io = new IntersectionObserver((es) => es[0].isIntersecting && setShown(true), { threshold: 0.3 });
    io.observe(el);
    const t = window.setTimeout(() => setShown(true), 2500);
    return () => {
      io.disconnect();
      window.clearTimeout(t);
    };
  }, []);
  if (user && user.role !== 'creator') return null;
  const isCreator = user?.role === 'creator';
  return (
    <section className="sec" id="creadores" aria-labelledby="creator-cta-title" style={{ paddingTop: 20 }}>
      <div className="wrap">
        <div ref={panel} className={`cta v-reveal ${shown ? 'in' : ''}`}>
          <div>
            <h2 id="creator-cta-title">{CREATOR_CTA.title}</h2>
            <p>{CREATOR_CTA.subtitle}</p>
            <div className="ctas">
              <Link to={isCreator ? '/creator/dashboard' : '/register?role=creator'} className="v-btn v-gold magnet">
                {isCreator ? CREATOR_CTA.memberCta : CREATOR_CTA.cta}
              </Link>
            </div>
          </div>
          <div className="stack" aria-hidden="true">
            {CREATOR_CTA.notifications.map((n, i) => (
              <div key={n.title} className="v-card" style={[{ left: 20, top: 10 }, { left: 90, top: 96 }, { left: 40, top: 182 }][i]}>
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
