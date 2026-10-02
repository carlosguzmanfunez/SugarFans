import React, { useId } from 'react';
import { Link } from 'react-router-dom';
import { BRAND } from '../config/brand';

// Fans Reserve Identity V1 (design/brand/README.md):
// - Mark: an "R" whose first strokes form an "F" (white) while the bowl and leg
//   (gold) complete the R: Fans inside Reserve. Dark tile with a magenta glow.
// - Wordmark: FANS (bold) RESERVE (light), Sora, wide tracking.
// - Variants: color (main), mono-dark (one ink colour, for light backgrounds) and
//   mono-light (one white colour, for dark backgrounds).
// The same drawing lives in design/brand/*.svg, which produce the favicon, PWA
// icons, coin and OG image (scripts/brand-assets.mjs). Change both together.

type Size = 'xs' | 'sm' | 'md' | 'lg';
type Tone = 'light' | 'dark';
export type MarkVariant = 'color' | 'mono-dark' | 'mono-light';

// Mark geometry on a 40x40 grid (optically centred).
const MARK_GOLD = 'M23 10.5 a4.625 4.625 0 0 1 0 9.25 H20 L28 29.5'; // bowl + leg
const MARK_WHITE = 'M12 29.5 V10.5 H23 M12 19.75 H20'; // F

const markPx: Record<Size, number> = { xs: 24, sm: 34, md: 42, lg: 56 };
const wordCls: Record<Size, string> = {
  xs: 'text-[13px]',
  sm: 'text-[16px] sm:text-[17px]',
  md: 'text-[19px]',
  lg: 'text-2xl',
};
const gapCls: Record<Size, string> = { xs: 'gap-2', sm: 'gap-2.5', md: 'gap-3', lg: 'gap-3.5' };

export const BrandMark: React.FC<{ size?: Size | number; className?: string; tone?: Tone; variant?: MarkVariant }> = ({
  size = 'sm',
  className = '',
  tone = 'light',
  variant = 'color',
}) => {
  const uid = useId().replace(/:/g, '');
  const px = typeof size === 'number' ? size : markPx[size];
  // Heavier strokes at small sizes keep the F/R legible at 16-24 px.
  const stroke = px < 28 ? 4.2 : 3.6;
  if (variant !== 'color') {
    return (
      <svg width={px} height={px} viewBox="0 0 40 40" aria-hidden="true" className={`shrink-0 ${className}`}>
        <defs>
          <mask id={`frm-${uid}`}>
            <rect width="40" height="40" fill="#fff" />
            <g fill="none" stroke="#000" strokeLinecap="round" strokeLinejoin="round" strokeWidth={stroke}>
              <path d={MARK_GOLD} />
              <path d={MARK_WHITE} />
            </g>
          </mask>
        </defs>
        <rect width="40" height="40" rx="11" fill={variant === 'mono-dark' ? '#160d1f' : '#ffffff'} mask={`url(#frm-${uid})`} />
      </svg>
    );
  }
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
      {px >= 28 && <rect x="0.6" y="0.6" width="38.8" height="38.8" rx="10.4" fill="none" stroke="#fff" strokeOpacity="0.14" strokeWidth="0.6" />}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth={stroke}>
        <path d={MARK_GOLD} stroke={`url(#frq-${uid})`} />
        <path d={MARK_WHITE} stroke="#fff" />
      </g>
    </svg>
  );
};

// FANS gets slightly tighter tracking than the light RESERVE (light weights need
// more air); the trailing tracking is cancelled so the lockup centres optically.
export const BrandWordmark: React.FC<{ size?: Size; tone?: Tone; variant?: MarkVariant }> = ({ size = 'sm', tone = 'light', variant = 'color' }) => {
  const mono = variant === 'mono-dark' ? 'text-ink' : variant === 'mono-light' ? 'text-white' : null;
  return (
    <span className={`whitespace-nowrap font-display uppercase leading-none ${wordCls[size]} ${mono ?? ''}`}>
      <span className={`font-bold tracking-[0.11em] ${mono ? '' : tone === 'dark' ? 'text-white' : 'text-ink'}`}>Fans</span>{' '}
      <span className={`font-[350] tracking-[0.16em] -mr-[0.16em] ${mono ? '' : tone === 'dark' ? 'text-gold-200' : 'text-ink/80'}`}>Reserve</span>
    </span>
  );
};

const BrandLogo: React.FC<{ size?: Size; tone?: Tone; variant?: MarkVariant; to?: string | null; className?: string }> = ({
  size = 'sm',
  tone = 'light',
  variant = 'color',
  to = '/',
  className = '',
}) => {
  const content = (
    <>
      <BrandMark size={size} tone={tone} variant={variant} />
      <BrandWordmark size={size} tone={tone} variant={variant} />
    </>
  );
  const cls = `inline-flex items-center ${gapCls[size]} ${className}`;
  return to === null ? (
    <span className={cls} aria-label={BRAND.name}>{content}</span>
  ) : (
    <Link to={to} className={`${cls} rounded-lg`} aria-label={`${BRAND.name}, inicio`}>{content}</Link>
  );
};

export default BrandLogo;
