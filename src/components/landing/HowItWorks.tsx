import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { HOW } from '../../content/landing';
import { RESERVE_COPY } from '../../config/reserve';
import { useLanguage } from '../../context/LanguageContext';

// Independent options, rather than steps the fan has to complete in order.
const options = [
  {
    key: 'subscription',
    title: 'Suscríbete',
    description: 'Accede cada mes a las fotos, videos y publicaciones exclusivas de tu creador.',
  },
  {
    key: 'reserve',
    title: 'Reserve',
    description: 'Elige una videollamada, clase o evento que el creador ya publicó.',
  },
  {
    key: 'proposal',
    title: 'Propón tu experiencia',
    description: 'Envía tu propia idea al creador con la fecha y el presupuesto que tienes en mente.',
  },
];

export const RESERVE_EXPLAINER = 'Reserve Events en grupo, videollamadas 1:1 y experiencias definidas por tus creadores. Cada una con su fecha, duración, precio, alcance y reglas.';

// withProposal=false where the big "Propón tu experiencia" section follows right
// below (signed-in home), so the idea isn't told twice (Carlos 2026-11-13).
const HowItWorks: React.FC<{ withProposal?: boolean }> = ({ withProposal = true }) => {
  const { t } = useLanguage();
  const shown = withProposal ? options : options.filter((o) => o.key !== 'proposal');
  const { hash } = useLocation();
  const optionsRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = optionsRef.current;
    if (!element || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.2 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Preserve menu links without opening a panel or starting a timer.
  useEffect(() => {
    const go = () => {
      if (window.location.hash === '#suscribirse') {
        document.getElementById('suscribirse')?.scrollIntoView({ block: 'start' });
      }
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, [hash]);

  return (
    <section className="sec journey" id="journey" aria-labelledby="how-title" data-testid="how-it-works">
      <div className="wrap">
        <div className="j-head">
          <h2 id="how-title">{HOW.titleLead} <em>{HOW.titleAccent}</em></h2>
        </div>
        <div ref={optionsRef} className={`journey-options${shown.length === 2 ? ' journey-two' : ''}${inView ? ' is-in-view' : ''}`} data-testid="journey-options">
          {shown.map((option) => (
              <article key={option.key} id={option.key === 'subscription' ? 'suscribirse' : undefined} className={`journey-option journey-${option.key}${option.key === 'reserve' && !withProposal ? ' journey-reserve-full' : ''}`} aria-labelledby={`how-${option.key}`}>
                {option.key === 'reserve' && !withProposal ? (
                  // Signed-in home: the explanation that used to head the Reserve page,
                  // same look and sizes (Carlos 2026-11-13).
                  <div className="journey-copy">
                    <span className="journey-reserve-icon" aria-hidden="true"><i className="fas fa-ticket"></i></span>
                    <h3 id={`how-${option.key}`}>{option.title}</h3>
                    <p>{RESERVE_EXPLAINER}</p>
                    <p className="journey-reserve-principle">{RESERVE_COPY.principle}</p>
                  </div>
                ) : (
                  <div className="journey-copy">
                    {/* Desktop, signed-in: Suscríbete mirrors the Reserve card (icon, big
                        title, one closing line) so the pair is balanced; hidden on phones. */}
                    {option.key === 'subscription' && !withProposal && <span className="journey-sub-icon" aria-hidden="true">
                      {/* Padlock that opens: the shackle lifts, then swings on its right leg. */}
                      <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
                        <path className="lock-shackle" d="M8 11V7.5a4 4 0 0 1 8 0V11" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                        <rect x="5" y="10.5" width="14" height="10" rx="2.6" fill="currentColor" />
                        <circle cx="12" cy="15.5" r="1.4" fill="var(--grad-main)" />
                      </svg>
                    </span>}
                    <h3 id={`how-${option.key}`}>{option.title}</h3>
                    <p>{option.description}</p>
                    {option.key === 'subscription' && !withProposal && <p className="journey-sub-principle">{t('how.subscriptionPrinciple')}</p>}
                  </div>
                )}
              </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
