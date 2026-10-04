import React, { useEffect } from 'react';

// Small pieces shared by the landing sections.

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const ArrowRight: React.FC = () => (
  <svg className="ico" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
    <path d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z" />
  </svg>
);

export const CheckIcon: React.FC = () => (
  <svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
    <path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z" />
  </svg>
);

export const LiveChip: React.FC = () => (
  <span className="chip live">
    <span className="bars"><i></i><i></i><i></i></span> LIVE
  </span>
);

// Demo illustrations with only the background removed, so the figure sits on the
// section's own colour. Real creators use their photo as it is.
const CLEAR = new Set(['valentina', 'diego', 'sofia', 'andres', 'camila', 'mariana']);
export const clearAvatar = (avatar: string) => {
  const m = /^\/creators\/(\w+)\.svg$/.exec(avatar);
  return m && CLEAR.has(m[1]) ? `/creators/clear/${m[1]}.svg` : null;
};

// Sections fade up as they enter the viewport; magnetic buttons follow a mouse
// pointer a little. Both are skipped with reduced motion.
export const useLandingMotion = (root: React.RefObject<HTMLElement>) => {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const items = [...el.querySelectorAll<HTMLElement>('.v-reveal')];
    const show = (t: Element) => t.classList.add('in');
    let io: IntersectionObserver | undefined;
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) items.forEach(show);
    else {
      io = new IntersectionObserver(
        (entries) =>
          entries.forEach((en) => {
            if (en.isIntersecting) {
              show(en.target);
              io?.unobserve(en.target);
            }
          }),
        { threshold: 0.15 }
      );
      items.forEach((t) => io!.observe(t));
    }
    // Never leave content hidden if the observer is slow.
    const fallback = window.setTimeout(() => items.forEach(show), 2500);

    const cleanups: (() => void)[] = [];
    if (!prefersReducedMotion() && window.matchMedia('(pointer:fine)').matches) {
      el.querySelectorAll<HTMLElement>('.magnet').forEach((b) => {
        const move = (e: PointerEvent) => {
          const r = b.getBoundingClientRect();
          b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.18}px,${(e.clientY - r.top - r.height / 2) * 0.28}px)`;
        };
        const leave = () => (b.style.transform = '');
        b.addEventListener('pointermove', move);
        b.addEventListener('pointerleave', leave);
        cleanups.push(() => {
          b.removeEventListener('pointermove', move);
          b.removeEventListener('pointerleave', leave);
        });
      });
    }
    return () => {
      io?.disconnect();
      window.clearTimeout(fallback);
      cleanups.forEach((c) => c());
    };
  }, [root]);
};

// Writes the pointer position into --x/--y so a spotlight can follow it.
export const trackSpot = (e: React.PointerEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--x', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--y', `${e.clientY - r.top}px`);
};
