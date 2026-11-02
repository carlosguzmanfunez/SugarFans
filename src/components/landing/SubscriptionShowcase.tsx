import React from 'react';
import { Link } from 'react-router-dom';
import type { Creator } from '../../data/mockData';
import { formatPrice } from '../CreatorCard';
import { isDemoProfile } from '../../lib/demoProfiles';
import { ArrowRight } from './landingBits';

// Public profile portraits introduce the creators; private post media never
// enters the landing. The profile explains what each subscription includes.
const SubscriptionShowcase: React.FC<{ creators: Creator[] }> = ({ creators }) => {
  const available = creators.filter((creator) => creator.avatar && creator.subscriptionPrice > 0);
  const real = available.filter((creator) => !isDemoProfile(creator));
  const portraits = [...real, ...available.filter(isDemoProfile)].slice(0, 3);

  return (
    <section id="suscripciones" className="subscription-showcase" aria-labelledby="subscription-title" data-testid="subscription-showcase">
      <div className="wrap subscription-layout">
        <div className="subscription-copy">
          <h2 id="subscription-title">Más de tu creador favorito, <em>cada mes.</em></h2>
          <p>Suscríbete y accede a las fotos, videos y publicaciones exclusivas que comparta tu creador favorito.</p>
          <Link to="/explore" className="v-btn v-pri">Descubrir creadores <ArrowRight /></Link>
          <p className="subscription-separate">Las videollamadas 1:1 y los eventos de Reserve se reservan y pagan por separado.</p>
        </div>

        {portraits.length > 0 && (
          <div className="subscription-portraits" aria-label="Creadores y suscripciones mensuales">
            {portraits.map((creator) => (
              <Link key={creator.id} to={`/creator/${creator.id}#suscripcion`} className="subscription-portrait" aria-label={`Ver el contenido y la suscripción de ${creator.name}, ${formatPrice(creator.subscriptionPrice)} al mes`}>
                <img src={creator.avatar} alt="" loading="lazy" decoding="async" />
                <span className="subscription-portrait-info">
                  <strong>{creator.name}</strong>
                  <span>{formatPrice(creator.subscriptionPrice)} <small>al mes</small></span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default SubscriptionShowcase;
