import React, { useState } from 'react';
import type { Gift } from '../lib/gifts';

// 3D illustration of a gift (Microsoft Fluent Emoji 3D, MIT licence, in public/gifts).
// Falls back to the emoji if the image can't load.
const GiftArt: React.FC<{ gift: Pick<Gift, 'id' | 'icon' | 'name'>; size?: number; className?: string; float?: boolean }> = ({
  gift,
  size = 48,
  className = '',
  float = false,
}) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span aria-hidden="true" className={className} style={{ fontSize: size * 0.8, lineHeight: `${size}px` }}>
        {gift.icon}
      </span>
    );
  }
  return (
    <img
      src={`/gifts/${gift.id}.png`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      className={`gift-art ${float ? 'gift-float' : ''} ${className}`}
      style={{ width: size, height: size }}
    />
  );
};

export default GiftArt;
