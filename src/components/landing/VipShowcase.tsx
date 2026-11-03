import React from 'react';
import { Link } from 'react-router-dom';
import { VIP } from '../../content/landing';
import { ArrowRight } from './landingBits';

const VipShowcase: React.FC = () => (
  <section className="rsv" id="reserve" aria-labelledby="vip-title" data-testid="reserve-showcase">
    <div className="rsv-line" />
    <div className="wrap rsv-grid">
      <div>
        <h2 id="vip-title">
          {VIP.titleLead} <em>{VIP.titleAccent}</em>
        </h2>
        <p className="lead">{VIP.subtitle}</p>
        <Link to="/explore" className="v-btn v-gold">
          {VIP.cta} <ArrowRight />
        </Link>
      </div>
      <ol className="rsv-steps" aria-label="Cómo proponer una experiencia">
        {VIP.steps.map((step) => (
          <li key={step.title}>
            <h3>{step.title}</h3>
            <p>{step.description}</p>
          </li>
        ))}
      </ol>
    </div>
  </section>
);

export default VipShowcase;
