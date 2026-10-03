import React, { useId } from 'react';

// Illustrated backdrop of a creator's room for the hero video call: warm wall,
// window light, a ring light behind the creator, a shelf with a plant and books
// and a framed print. Pure SVG in brand colours, no external images.
const VideoCallRoom: React.FC<{ className?: string }> = ({ className = '' }) => {
  const uid = useId().replace(/:/g, '');
  const id = (name: string) => `${name}-${uid}`;
  return (
    <svg viewBox="0 0 400 320" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={id('wall')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbeef2" />
          <stop offset="1" stopColor="#f1d6e1" />
        </linearGradient>
        <radialGradient id={id('sun')} cx="0.08" cy="0.05" r="0.9">
          <stop offset="0" stopColor="#fff7e8" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#fff1e0" stopOpacity="0.25" />
          <stop offset="1" stopColor="#fff1e0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('ring')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#fbe7b5" />
          <stop offset="1" stopColor="#f7639b" />
        </linearGradient>
        <radialGradient id={id('glow')} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('print')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7639b" />
          <stop offset="1" stopColor="#6d3ce6" />
        </linearGradient>
        <linearGradient id={id('floor')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9c6d6" />
          <stop offset="1" stopColor="#d9aec3" />
        </linearGradient>
      </defs>

      <rect width="400" height="320" fill={`url(#${id('wall')})`} />
      <rect width="400" height="320" fill={`url(#${id('sun')})`} />
      {/* Window light falling across the wall */}
      <path d="M0 0 H120 L250 320 H120 Z" fill="#ffffff" opacity="0.28" />
      <path d="M140 0 H175 L300 320 H262 Z" fill="#ffffff" opacity="0.18" />

      {/* Framed print */}
      <rect x="34" y="62" width="62" height="78" rx="4" fill="#ffffff" stroke="#e7cbd8" />
      <rect x="41" y="69" width="48" height="64" rx="2" fill={`url(#${id('print')})`} />
      <circle cx="65" cy="94" r="12" fill="#fbe7b5" opacity="0.9" />
      <path d="M41 122 Q58 104 72 116 T89 112 V133 H41 Z" fill="#160d1f" opacity="0.25" />

      {/* Shelf with plant and books */}
      <rect x="292" y="132" width="96" height="5" rx="2.5" fill="#c99ab1" />
      <rect x="300" y="104" width="9" height="28" rx="2" fill="#6d3ce6" />
      <rect x="311" y="98" width="8" height="34" rx="2" fill="#e3a93a" />
      <rect x="321" y="108" width="10" height="24" rx="2" fill="#c81b63" transform="rotate(8 326 120)" />
      <path d="M352 132 h24 l-3 -20 h-18 z" fill="#d9825b" />
      <ellipse cx="356" cy="98" rx="7" ry="15" fill="#3f8f6b" transform="rotate(-25 356 98)" />
      <ellipse cx="371" cy="96" rx="7" ry="16" fill="#4fa57c" transform="rotate(20 371 96)" />
      <ellipse cx="364" cy="90" rx="6" ry="17" fill="#2f7a59" />

      {/* Ring light behind the creator */}
      <circle cx="200" cy="138" r="84" fill={`url(#${id('glow')})`} opacity="0.75" />
      <circle cx="200" cy="138" r="70" fill="none" stroke={`url(#${id('ring')})`} strokeWidth="9" />
      <circle cx="200" cy="138" r="70" fill="none" stroke="#ffffff" strokeOpacity="0.9" strokeWidth="2" />

      {/* Bokeh */}
      <circle cx="120" cy="40" r="9" fill="#ffffff" opacity="0.5" />
      <circle cx="270" cy="54" r="6" fill="#ffffff" opacity="0.45" />
      <circle cx="330" cy="40" r="11" fill="#fbe7b5" opacity="0.35" />
      <circle cx="60" cy="200" r="7" fill="#ffffff" opacity="0.35" />

      {/* Floor line */}
      <rect y="262" width="400" height="58" fill={`url(#${id('floor')})`} />
    </svg>
  );
};

export default VideoCallRoom;
