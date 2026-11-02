import React, { useCallback, useEffect, useRef, useState } from 'react';

type Point = { x: number; y: number };
type View = Point & { zoom: number };
const initial: View = { x: 0, y: 0, zoom: 1 };

// Only the regular-publication viewer uses this. Zoom does not change the file,
// its quality, access checks, or the separate avatar/cover viewer.
const ZoomablePostImage: React.FC<{ src: string; alt: string; onGestureStart: () => void }> = ({ src, alt, onGestureStart }) => {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>(initial);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const ownsGesture = useRef(false);

  const clamp = useCallback((next: View): View => {
    const zoom = Math.max(1, Math.min(4, next.zoom));
    const fit = natural.width && natural.height ? Math.min(1, size.width / natural.width, size.height / natural.height) : 0;
    const limitX = Math.max(0, (natural.width * fit * zoom - size.width) / 2);
    const limitY = Math.max(0, (natural.height * fit * zoom - size.height) / 2);
    return { zoom, x: Math.max(-limitX, Math.min(limitX, next.x)), y: Math.max(-limitY, Math.min(limitY, next.y)) };
  }, [natural, size]);

  const zoomTo = useCallback((amount: number | ((current: number) => number)) => {
    setView((current) => {
      const zoom = Math.max(1, Math.min(4, typeof amount === 'function' ? amount(current.zoom) : amount));
      return clamp({ zoom, x: current.x * zoom / current.zoom, y: current.y * zoom / current.zoom });
    });
  }, [clamp]);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setView((current) => clamp(current)), [clamp]);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.deltaY) zoomTo((zoom) => zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [zoomTo]);

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size > 1 || view.zoom > 1) {
      ownsGesture.current = true;
      onGestureStart();
      event.stopPropagation();
      pointers.current.forEach((_, id) => event.currentTarget.setPointerCapture(id));
    }
    if (pointers.current.size === 2) pinch.current = { distance: distance(), zoom: view.zoom };
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!ownsGesture.current) return; // At normal size, keep the gallery swipe.
    event.stopPropagation();
    if (pointers.current.size >= 2 && pinch.current?.distance) {
      zoomTo(pinch.current.zoom * distance() / pinch.current.distance);
    } else if (view.zoom > 1) {
      setView((current) => clamp({ ...current, x: current.x + event.clientX - previous.x, y: current.y + event.clientY - previous.y }));
    }
  };
  const up = (event: React.PointerEvent<HTMLDivElement>) => {
    if (ownsGesture.current) event.stopPropagation();
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (!pointers.current.size) ownsGesture.current = false;
  };

  return (
    <div className="relative h-full w-full min-h-0" data-testid="post-photo-zoom" data-zoom={view.zoom.toFixed(2)}>
      <div ref={box} className={`flex h-full w-full touch-none items-center justify-center overflow-hidden ${view.zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onDoubleClick={() => zoomTo(view.zoom > 1 ? 1 : 2)}>
        <img src={src} alt={alt} draggable={false} className="max-h-full max-w-full object-contain" data-testid="media-viewer-image"
          onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }} />
      </div>
      <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/85 p-1 text-white" role="group" aria-label="Ampliar foto"
        onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
        <button type="button" aria-label="Reducir foto" disabled={view.zoom <= 1} onClick={() => zoomTo((zoom) => zoom / 1.5)} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/20 disabled:opacity-40"><i className="fas fa-minus" aria-hidden="true" /></button>
        <button type="button" aria-label="Restablecer tamaño de foto" onClick={() => zoomTo(1)} className="h-11 min-w-16 rounded-full px-2 text-sm tabular-nums hover:bg-white/20">{Math.round(view.zoom * 100)}%</button>
        <button type="button" aria-label="Ampliar foto" disabled={view.zoom >= 4} onClick={() => zoomTo((zoom) => zoom * 1.5)} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/20 disabled:opacity-40"><i className="fas fa-plus" aria-hidden="true" /></button>
      </div>
    </div>
  );
};

export default ZoomablePostImage;
