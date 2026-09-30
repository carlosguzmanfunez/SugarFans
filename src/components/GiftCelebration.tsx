import React, { useEffect, useRef } from 'react';
import GiftArt from './GiftArt';
import type { Gift } from '../lib/gifts';

const SPARKS = Array.from({ length: 12 }, (_, i) => i);

// Full-screen moment when a gift is sent or received: the gift pops in with sparkles, then fades.
const GiftCelebration: React.FC<{ gift: Gift; caption: string; onDone: () => void }> = ({ gift, caption, onDone }) => {
  const done = useRef(onDone);
  done.current = onDone;
  // Keyed by gift so a parent re-render doesn't restart the timer.
  useEffect(() => {
    const t = window.setTimeout(() => done.current(), 2600);
    return () => window.clearTimeout(t);
  }, [gift.id]);
  return (
    <div className="gift-celebration fixed inset-0 z-[60] flex items-center justify-center pointer-events-none" data-testid="gift-celebration" aria-hidden="true">
      <div className="relative flex flex-col items-center">
        <div className="gift-halo absolute top-1/2 left-1/2 w-72 h-72 rounded-full" />
        {SPARKS.map((i) => (
          <span key={i} className="gift-spark" style={{ '--a': `${i * 30}deg`, '--d': `${(i % 3) * 0.08}s` } as React.CSSProperties} />
        ))}
        <div className="gift-pop">
          <GiftArt gift={gift} size={180} float />
        </div>
        <p className="gift-caption mt-4 px-5 py-2 rounded-full bg-white/95 shadow-xl text-base font-bold text-gray-900">{caption}</p>
      </div>
    </div>
  );
};

export default GiftCelebration;
