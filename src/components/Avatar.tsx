import React, { useState } from 'react';
import { hashSeed } from '../config/theme';

// Profile picture with a branded fallback: if there is no image or it fails to
// load, the person's initials on a gradient from the brand palette.

const FALLBACKS = [
  'linear-gradient(135deg, #e5337a, #6d3ce6)',
  'linear-gradient(135deg, #6d3ce6, #22b8cf)',
  'linear-gradient(135deg, #e3a93a, #e5337a)',
  'linear-gradient(135deg, #14b8a6, #6d3ce6)',
  'linear-gradient(135deg, #2f2140, #c81b63)',
];

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';

const Avatar: React.FC<{ src?: string | null; name: string; size?: number; className?: string; decorative?: boolean }> = ({
  src,
  name,
  size = 40,
  className = '',
  decorative = false,
}) => {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (!src || failed) {
    return (
      <span
        role={decorative ? undefined : 'img'}
        aria-label={decorative ? undefined : name}
        aria-hidden={decorative || undefined}
        className={`inline-flex shrink-0 items-center justify-center rounded-full font-display font-semibold text-white ${className}`}
        style={{ ...style, background: FALLBACKS[hashSeed(name) % FALLBACKS.length], fontSize: Math.max(10, size * 0.36) }}
      >
        {initials(name)}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={decorative ? '' : name}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-full bg-brand-50 object-cover ${className}`}
      style={style}
    />
  );
};

export default Avatar;
