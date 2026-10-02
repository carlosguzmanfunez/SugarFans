import React, { useId, useState } from 'react';
import { COVER_PALETTES, COVER_STYLES, hashSeed, type CoverStyle } from '../config/theme';

// Generated, on-brand artwork for creator covers, VIP experiences and demo media.
// Each seed always renders the same style and palette, so profiles look different
// from each other but stay consistent. A real photo replaces it without any
// layout change (see CoverImage).

// Empty values, demo media ('art:...') and the stock links older rows still
// store are never loaded: the generated art stands in until the creator uploads
// their own image.
export const isPlaceholderImage = (src?: string | null) => !src || src.startsWith('art:') || /images\.unsplash\.com|image\.qwenlm\.ai/.test(src);

export const coverStyleFor = (seed: string): { style: CoverStyle; palette: (typeof COVER_PALETTES)[number] } => {
  const h = hashSeed(seed);
  return { style: COVER_STYLES[h % COVER_STYLES.length], palette: COVER_PALETTES[(h >>> 4) % COVER_PALETTES.length] };
};

export const CoverArt: React.FC<{ seed: string; style?: CoverStyle; className?: string }> = ({ seed, style, className = '' }) => {
  const uid = useId().replace(/:/g, '');
  const picked = coverStyleFor(seed);
  const kind = style ?? picked.style;
  const { base, a, b, c } = picked.palette;
  const id = (name: string) => `${name}-${uid}`;
  const url = (name: string) => `url(#${id(name)})`;

  return (
    <svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className={`absolute inset-0 h-full w-full ${className}`}>
      <defs>
        <radialGradient id={id('ga')} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor={a} stopOpacity="0.95" />
          <stop offset="1" stopColor={a} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('gb')} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor={b} stopOpacity="0.85" />
          <stop offset="1" stopColor={b} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('gc')} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor={c} stopOpacity="0.7" />
          <stop offset="1" stopColor={c} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('lab')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
        <linearGradient id={id('shade')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.45" stopColor={base} stopOpacity="0" />
          <stop offset="1" stopColor={base} stopOpacity="0.55" />
        </linearGradient>
        <pattern id={id('lines')} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="10" stroke={c} strokeOpacity="0.09" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="400" height="200" fill={base} />

      {kind === 'aurora' && (
        <>
          <ellipse cx="90" cy="40" rx="190" ry="120" fill={url('ga')} />
          <ellipse cx="320" cy="150" rx="200" ry="130" fill={url('gb')} />
          <ellipse cx="250" cy="20" rx="120" ry="70" fill={url('gc')} />
        </>
      )}

      {kind === 'prism' && (
        <>
          <ellipse cx="300" cy="60" rx="220" ry="140" fill={url('gb')} />
          <polygon points="140,-10 230,-10 110,210 20,210" fill={a} opacity="0.55" />
          <polygon points="250,-10 300,-10 180,210 130,210" fill={c} opacity="0.22" />
          <polygon points="330,-10 420,-10 300,210 210,210" fill={url('lab')} opacity="0.45" />
        </>
      )}

      {kind === 'orbit' && (
        <>
          <ellipse cx="80" cy="170" rx="200" ry="110" fill={url('gb')} />
          {[40, 70, 100, 130, 160].map((r) => (
            <circle key={r} cx="300" cy="100" r={r} fill="none" stroke={c} strokeOpacity="0.16" strokeWidth="1" />
          ))}
          <circle cx="300" cy="100" r="34" fill={url('lab')} />
          <circle cx="300" cy="100" r="90" fill={url('ga')} opacity="0.55" />
          <circle cx="370" cy="40" r="5" fill={c} opacity="0.85" />
        </>
      )}

      {kind === 'dune' && (
        <>
          <ellipse cx="320" cy="20" rx="160" ry="110" fill={url('gc')} />
          <path d="M0 120 C 90 80 170 150 260 110 S 380 70 400 90 V200 H0 Z" fill={a} opacity="0.75" />
          <path d="M0 150 C 110 120 190 180 290 140 S 380 120 400 130 V200 H0 Z" fill={b} opacity="0.7" />
          <path d="M0 178 C 120 160 230 200 400 168 V200 H0 Z" fill={base} opacity="0.55" />
        </>
      )}

      {kind === 'grid' && (
        <>
          <ellipse cx="200" cy="40" rx="230" ry="130" fill={url('ga')} />
          <ellipse cx="380" cy="190" rx="160" ry="100" fill={url('gb')} />
          <g stroke={c} strokeOpacity="0.18" strokeWidth="1">
            {Array.from({ length: 11 }, (_, i) => (
              <line key={`v${i}`} x1={200 + (i - 5) * 22} y1="95" x2={200 + (i - 5) * 90} y2="200" />
            ))}
            {[105, 120, 140, 166, 200].map((y) => (
              <line key={`h${y}`} x1="0" y1={y} x2="400" y2={y} />
            ))}
          </g>
        </>
      )}

      {kind === 'noir' && (
        <>
          <rect width="400" height="200" fill={url('lines')} />
          <ellipse cx="360" cy="10" rx="210" ry="140" fill={url('gb')} />
          <ellipse cx="40" cy="200" rx="160" ry="90" fill={url('ga')} opacity="0.7" />
          <path d="M-20 170 Q 200 40 420 150" fill="none" stroke={c} strokeOpacity="0.45" strokeWidth="1.5" />
        </>
      )}

      <rect width="400" height="200" fill={url('shade')} />
    </svg>
  );
};

// A cover or media slot: shows the photo when there is a real one, otherwise (or
// if it fails to load) the generated art for `seed`.
export const CoverImage: React.FC<{
  src?: string | null;
  seed: string;
  alt?: string;
  className?: string;
  imgClassName?: string;
  children?: React.ReactNode;
}> = ({ src, seed, alt = '', className = '', imgClassName = '', children }) => {
  const [failed, setFailed] = useState(false);
  const usePhoto = !isPlaceholderImage(src) && !failed;
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <CoverArt seed={seed} />
      {usePhoto && (
        <img
          src={src!}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover ${imgClassName}`}
        />
      )}
      {children}
    </div>
  );
};

export default CoverArt;
