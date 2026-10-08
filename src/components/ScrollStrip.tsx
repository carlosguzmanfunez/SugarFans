import React, { useCallback, useEffect, useRef, useState } from 'react';

// A horizontal strip that scrolls sideways (the creator panel tabs), with a thin
// rail under it showing that there is more to the right and how far you are, plus a
// soft fade on the side that still has options. Nothing extra shows when it all fits.
const ScrollStrip: React.FC<{ id?: string; className?: string; outerClassName?: string; children: React.ReactNode }> = ({ id, className = '', outerClassName = '', children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ overflow: false, size: 1, pos: 0, atStart: true, atEnd: true });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const overflow = max > 2;
    setView({
      overflow,
      size: overflow ? el.clientWidth / el.scrollWidth : 1,
      pos: overflow ? el.scrollLeft / max : 0,
      atStart: el.scrollLeft <= 2,
      atEnd: el.scrollLeft >= max - 2,
    });
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div id={id} className={outerClassName}>
      <div className="relative">
        <div ref={ref} onScroll={measure} className={`overflow-x-auto scrollbar-hide ${className}`}>
          {children}
        </div>
        {view.overflow && !view.atEnd && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-px right-px w-12 rounded-r-full bg-gradient-to-l from-white to-transparent" />
        )}
        {view.overflow && !view.atStart && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-px left-px w-8 rounded-l-full bg-gradient-to-r from-white to-transparent" />
        )}
      </div>
      {view.overflow && (
        <div aria-hidden="true" data-testid="scroll-rail" className="mx-auto mt-2 h-1 w-24 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-brand-500"
            style={{ width: `${view.size * 100}%`, marginLeft: `${view.pos * (1 - view.size) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
};

export default ScrollStrip;
