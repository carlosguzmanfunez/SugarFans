import React, { useId } from 'react';
import { Link } from 'react-router-dom';
import { BRAND } from '../config/brand';

// Fans Reserve identity (interim, until the final logo is produced):
// - Mark: an "R" whose first strokes form an "F" (white) while the bowl and leg
//   (gold) complete the R: Fans inside Reserve. Dark tile with a magenta glow.
// - Wordmark: FANS (bold) RESERVE (light), Sora, wide tracking.
// The same drawing is exported as public/favicon.svg and the PWA/OG assets
// (see design/brand/README.md).

type Size = 'xs' | 'sm' | 'md' | 'lg';
type Tone = 'light' | 'dark';

const markPx: Record<Size, number> = { xs: 24, sm: 34, md: 42, lg: 56 };
const wordCls: Record<Size, string> = {
  xs: 'text-[13px]',
  sm: 'text-[16px] sm:text-[17px]',
  md: 'text-[19px]',
  lg: 'text-2xl',
};

export const BrandMark: React.FC<{ size?: Size | number; className?: string; tone?: Tone }> = ({ size = 'sm', className = '', tone = 'light' }) => {
  const uid = useId().replace(/:/g, '');
  const px = typeof size === 'number' ? size : markPx[size];
  return (
    <svg width={px} height={px} viewBox="0 0 40 40" aria-hidden="true" className={`shrink-0 ${className}`}>
      <defs>
        <radialGradient id={`frg-${uid}`} cx="0.12" cy="0.05" r="1.15">
          <stop offset="0" stopColor="#f7639b" />
          <stop offset="0.38" stopColor="#c81b63" stopOpacity="0.85" />
          <stop offset="0.8" stopColor="#4b1d7a" stopOpacity="0.35" />
          <stop offset="1" stopColor="#160d1f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`frq-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbe7b5" />
          <stop offset="1" stopColor="#e3a93a" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={tone === 'dark' ? '#2a1d36' : '#160d1f'} />
      <rect width="40" height="40" rx="11" fill={`url(#frg-${uid})`} />
      <rect x="0.6" y="0.6" width="38.8" height="38.8" rx="10.4" fill="none" stroke="#fff" strokeOpacity="0.14" strokeWidth="0.6" />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth={px < 28 ? 4.2 : 3.6}>
        <path d="M24.5 10.5 a4.6 4.6 0 0 1 0 9.2 M21 19.7 L28 29.5" stroke={`url(#frq-${uid})`} />
        <path d="M13 29.5 V10.5 H24.5 M13 19.7 H21" stroke="#fff" />
      </g>
    </svg>
  );
};

export const BrandWordmark: React.FC<{ size?: Size; tone?: Tone }> = ({ size = 'sm', tone = 'light' }) => (
  <span className={`whitespace-nowrap font-display uppercase leading-none tracking-[0.14em] ${wordCls[size]}`}>
    <span className={`font-bold ${tone === 'dark' ? 'text-white' : 'text-ink'}`}>Fans</span>{' '}
    <span className={`font-light ${tone === 'dark' ? 'text-gold-200' : 'text-ink/80'}`}>Reserve</span>
  </span>
);

const BrandLogo: React.FC<{ size?: Size; tone?: Tone; to?: string | null; className?: string }> = ({
  size = 'sm',
  tone = 'light',
  to = '/',
  className = '',
}) => {
  const content = (
    <>
      <BrandMark size={size} tone={tone} />
      <BrandWordmark size={size} tone={tone} />
    </>
  );
  const cls = `inline-flex items-center gap-2.5 ${className}`;
  return to === null ? (
    <span className={cls} aria-label={BRAND.name}>{content}</span>
  ) : (
    <Link to={to} className={`${cls} rounded-lg`} aria-label={`${BRAND.name}, inicio`}>{content}</Link>
  );
};

export default BrandLogo;
