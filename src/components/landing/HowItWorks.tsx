import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { creators } from '../../data/mockData';
import { HOW } from '../../content/landing';
import { ArrowRight, clearAvatar } from './landingBits';

// Independent options, rather than steps the fan has to complete in order.
const options = [
  {
    key: 'subscription',
    title: 'Suscríbete',
    description: 'Fotos, videos y publicaciones exclusivas de tu creador, cada mes.',
    action: 'Ver creadores',
    to: '/explore',
    creatorId: '2',
  },
  {
    key: 'reserve',
    title: 'Reserve',
    description: 'Videollamadas 1:1, eventos y actividades con fecha y precio definidos.',
    action: 'Explorar experiencias',
    to: '/reserve',
    creatorId: '1',
  },
  {
    key: 'proposal',
    title: 'Propón tu experiencia',
    description: 'Propón una idea, fecha y presupuesto. El creador responde y acuerdan los detalles.',
    action: 'Elegir creador',
    to: '/explore',
    creatorId: '3',
  },
];

const HowItWorks: React.FC = () => {
  const { hash } = useLocation();

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
        <div className="journey-options" data-testid="journey-options">
          {options.map((option) => {
            const creator = creators.find((person) => person.id === option.creatorId) ?? creators[0];
            const portrait = clearAvatar(creator.avatar);
            return (
              <article key={option.key} id={option.key === 'subscription' ? 'suscribirse' : undefined} className={`journey-option journey-${option.key}`} aria-labelledby={`how-${option.key}`}>
                <div className="journey-copy">
                  <h3 id={`how-${option.key}`}>{option.title}</h3>
                  <p>{option.description}</p>
                </div>
                <div className="journey-portrait" aria-hidden="true">
                  <img src={portrait ?? creator.avatar} className={portrait ? 'cutout' : 'photo'} alt="" loading="lazy" decoding="async" />
                </div>
                <div className="journey-action">
                  <Link to={option.to} className="v-btn">{option.action}<ArrowRight /></Link>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
