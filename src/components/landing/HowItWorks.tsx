import React from 'react';
import { HOW } from '../../content/landing';
import SectionHeading from './SectionHeading';

// Three steps on a progression line (horizontal on desktop, vertical on mobile).
const HowItWorks: React.FC = () => (
  <section aria-labelledby="how-title" className="reveal border-y border-line bg-surface py-16 md:py-24">
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <SectionHeading id="how-title" eyebrow={HOW.eyebrow} title={HOW.title} align="center" />
      <ol className="relative grid gap-6 md:grid-cols-3 md:gap-8">
        {/* Progression line */}
        <span aria-hidden="true" className="absolute left-[27px] top-6 bottom-6 w-px bg-gradient-to-b from-brand-300 via-iris-300 to-gold-300 md:left-[16%] md:right-[16%] md:top-[27px] md:bottom-auto md:h-px md:w-auto md:bg-gradient-to-r" />
        {HOW.steps.map((step, i) => (
          <li key={step.title} className="relative flex gap-5 md:flex-col md:items-center md:text-center">
            <span className="relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-lg text-brand-600 shadow-[var(--shadow-card)] ring-1 ring-line">
              <i className={`fas ${step.icon}`} aria-hidden="true"></i>
              <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-ink font-display text-[11px] font-semibold text-white">
                {i + 1}
              </span>
            </span>
            <div className="pt-1 md:pt-5">
              <h3 className="font-display text-lg font-semibold text-ink">{step.title}</h3>
              <p className="mt-1.5 max-w-xs text-[15px] leading-relaxed text-muted md:mx-auto">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  </section>
);

export default HowItWorks;
