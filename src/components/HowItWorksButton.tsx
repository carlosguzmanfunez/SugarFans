import React, { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDismiss } from '../hooks/useDismiss';
import { useLanguage } from '../context/LanguageContext';
import Icon from './Icon';

type Side = 'fan' | 'creator';

const STEPS: Record<Side, { icon: string; key: string }[]> = {
  fan: [
    { icon: 'fa-heart', key: 'howItWorks.fan.1' },
    { icon: 'fa-unlock', key: 'howItWorks.fan.2' },
    { icon: 'fa-video', key: 'howItWorks.fan.3' },
  ],
  creator: [
    { icon: 'fa-shield-halved', key: 'howItWorks.creator.1' },
    { icon: 'fa-pen', key: 'howItWorks.creator.2' },
    { icon: 'fa-hand-holding-dollar', key: 'howItWorks.creator.3' },
  ],
};

// "?" in the top pill: how Fans Reserve works, in three lines for a fan and three
// for a creator. Opens on the side that matches the account (creators see theirs).
const HowItWorksButton: React.FC<{ role?: string }> = ({ role }) => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<Side>(role === 'creator' ? 'creator' : 'fan');
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const panelId = useId();

  const toggle = () => {
    if (!open) setSide(role === 'creator' ? 'creator' : 'fan');
    setOpen((v) => !v);
  };
  const tab = (value: Side, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={side === value}
      onClick={() => setSide(value)}
      data-testid={`how-tab-${value}`}
      className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold transition-colors ${
        side === value ? 'bg-white text-ink shadow-sm' : 'text-ink/60 hover:text-ink'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t('howItWorks.button')}
        title={t('howItWorks.button')}
        data-testid="how-it-works-button"
        className="flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-full px-2.5 text-ink/70 ring-1 ring-line transition hover:text-ink hover:ring-brand-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 xl:px-3.5"
      >
        <Icon name="fa-circle-question" className="text-base" />
        <span className="hidden text-sm font-medium xl:inline">{t('howItWorks.button')}</span>
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={t('howItWorks.title')}
          data-testid="how-it-works-panel"
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          className="fixed inset-x-3 top-[5.75rem] z-50 rounded-3xl border border-line bg-white p-4 shadow-[var(--shadow-lift)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[22rem]"
        >
          <p className="text-base font-bold text-ink">{t('howItWorks.title')}</p>
          <div role="tablist" className="mt-3 flex gap-1 rounded-full bg-canvas p-1">
            {tab('fan', t('howItWorks.tab.fan'))}
            {tab('creator', t('howItWorks.tab.creator'))}
          </div>
          <ol className="mt-3 space-y-2.5" data-testid={`how-steps-${side}`}>
            {STEPS[side].map((step, i) => (
              <li key={step.key} className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm text-brand-700">
                  <Icon name={step.icon} />
                </span>
                <p className="pt-1 text-sm leading-snug text-ink/80">
                  <span className="font-semibold text-ink">{i + 1}. </span>
                  {t(step.key)}
                </p>
              </li>
            ))}
          </ol>
          <Link
            to="/#journey"
            onClick={() => setOpen(false)}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800"
          >
            {t('howItWorks.more')} <Icon name="fa-arrow-right" className="text-xs" />
          </Link>
        </div>
      )}
    </div>
  );
};

export default HowItWorksButton;
