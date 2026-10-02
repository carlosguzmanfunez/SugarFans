import React from 'react';
import { Link } from 'react-router-dom';
import { BRAND } from '../config/brand';

// Provisional typographic identity until the final logo exists: a monogram
// tile plus the FANS RESERVE wordmark. "light" sits on white, "dark" on dark
// backgrounds.

type Size = 'sm' | 'md' | 'lg';

const tile: Record<Size, string> = {
  sm: 'w-8 h-8 text-[11px] rounded-lg',
  md: 'w-10 h-10 text-[13px] rounded-xl',
  lg: 'w-14 h-14 text-lg rounded-2xl',
};

const word: Record<Size, string> = {
  sm: 'text-[15px]',
  md: 'text-lg',
  lg: 'text-2xl',
};

export const BrandMark: React.FC<{ size?: Size; className?: string }> = ({ size = 'sm', className = '' }) => (
  <span
    aria-hidden="true"
    className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-[#2a1340] font-semibold tracking-[0.08em] text-white shadow-sm ${tile[size]} ${className}`}
  >
    <span className="absolute inset-0 bg-gradient-to-br from-pink-500/90 via-fuchsia-600/70 to-transparent" />
    <span className="absolute inset-[3px] rounded-[inherit] ring-1 ring-white/25" />
    <span className="relative">FR</span>
  </span>
);

export const BrandWordmark: React.FC<{ size?: Size; tone?: 'light' | 'dark' }> = ({ size = 'sm', tone = 'light' }) => (
  <span className={`whitespace-nowrap uppercase leading-none tracking-[0.18em] ${word[size]}`}>
    <span className={`font-bold ${tone === 'dark' ? 'text-white' : 'text-gray-900'}`}>Fans</span>{' '}
    <span className={`font-light ${tone === 'dark' ? 'text-pink-300' : 'text-fuchsia-700'}`}>Reserve</span>
  </span>
);

const BrandLogo: React.FC<{ size?: Size; tone?: 'light' | 'dark'; to?: string | null; className?: string }> = ({
  size = 'sm',
  tone = 'light',
  to = '/',
  className = '',
}) => {
  const content = (
    <>
      <BrandMark size={size} />
      <BrandWordmark size={size} tone={tone} />
    </>
  );
  const cls = `inline-flex items-center gap-2.5 ${className}`;
  return to === null ? (
    <span className={cls} aria-label={BRAND.name}>{content}</span>
  ) : (
    <Link to={to} className={cls} aria-label={`${BRAND.name}, inicio`}>{content}</Link>
  );
};

export default BrandLogo;
