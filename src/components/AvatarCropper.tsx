import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cropAvatar } from '../lib/profileImage';

interface Props {
  image: HTMLImageElement;
  onCancel: () => void;
  onSave: (blob: Blob) => void;
}

const MAX_ZOOM = 4;

// Adjust screen for the profile photo, like Instagram's: drag to move the photo
// inside the circle, zoom with the slider, the mouse wheel or two fingers.
const AvatarCropper: React.FC<Props> = ({ image, onCancel, onSave }) => {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => Math.min(320, window.innerWidth - 64));
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const framed = useRef(false);
  const [saving, setSaving] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  const w = image.naturalWidth;
  const h = image.naturalHeight;
  // At zoom 1 the photo just covers the circle's square.
  const scale = (size / Math.min(w, h)) * zoom;
  const dispW = w * scale;
  const dispH = h * scale;

  const clamp = (o: { x: number; y: number }, z = zoom) => {
    const s = (size / Math.min(w, h)) * z;
    const maxX = Math.max(0, (w * s - size) / 2);
    const maxY = Math.max(0, (h * s - size) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, o.x)), y: Math.min(maxY, Math.max(-maxY, o.y)) };
  };

  const setZoomTo = (z: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(1, z));
    setZoom(next);
    setOffset((o) => clamp({ x: (o.x * next) / zoom, y: (o.y * next) / zoom }, next));
  };

  useLayoutEffect(() => {
    const measure = () => setSize(Math.min(320, window.innerWidth - 64));
    measure();
    window.addEventListener('resize', measure);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  // A tall photo starts showing its top, where the face usually is; later the
  // photo keeps covering the circle when the screen size changes.
  useLayoutEffect(() => {
    if (framed.current) return setOffset((o) => clamp(o));
    framed.current = true;
    setOffset(clamp({ x: 0, y: 1e9 }));
  }, [size]);

  // Wheel zoom needs a non-passive listener so the page doesn't scroll.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const down = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) pinch.current = { dist: distance(), zoom };
  };
  const move = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      setZoomTo((pinch.current.zoom * distance()) / pinch.current.dist);
    } else if (pointers.current.size === 1) {
      setOffset((o) => clamp({ x: o.x + e.clientX - prev.x, y: o.y + e.clientY - prev.y }));
    }
  };
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const save = async () => {
    setSaving(true);
    // The circle's square, back in the photo's own pixels.
    const side = size / scale;
    const sx = (dispW / 2 - offset.x - size / 2) / scale;
    const sy = (dispH / 2 - offset.y - size / 2) / scale;
    try {
      onSave(await cropAvatar(image, Math.max(0, sx), Math.max(0, sy), Math.min(side, w, h)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Ajusta tu foto de perfil" data-testid="avatar-cropper">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 flex flex-col items-center gap-4">
        <div className="w-full flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Ajusta tu foto de perfil</h2>
          <button type="button" onClick={onCancel} aria-label="Cerrar" className="w-8 h-8 rounded-full hover:bg-gray-100 text-gray-500">
            <i aria-hidden="true" className="fas fa-times"></i>
          </button>
        </div>
        <div
          ref={box}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className="relative overflow-hidden rounded-xl bg-gray-900 cursor-grab active:cursor-grabbing select-none"
          style={{ width: size, height: size, touchAction: 'none' }}
          data-testid="avatar-cropper-area"
        >
          <img
            src={image.src}
            alt=""
            draggable={false}
            className="absolute max-w-none pointer-events-none"
            style={{ width: dispW, height: dispH, left: size / 2 - dispW / 2 + offset.x, top: size / 2 - dispH / 2 + offset.y }}
          />
          {/* Darkens what falls outside the circle. */}
          <div className="absolute inset-0 rounded-full pointer-events-none" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)', border: '2px solid rgba(255,255,255,0.9)' }} />
        </div>
        <p className="text-xs text-gray-500 text-center">Arrastra la foto para moverla y usa la barra para acercarla.</p>
        <div className="w-full flex items-center gap-3">
          <i aria-hidden="true" className="fas fa-image text-gray-400 text-xs"></i>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoomTo(Number(e.target.value))}
            aria-label="Zoom"
            className="flex-1 accent-pink-600"
            data-testid="avatar-cropper-zoom"
          />
          <i aria-hidden="true" className="fas fa-image text-gray-500 text-base"></i>
        </div>
        <div className="w-full flex gap-2">
          <button type="button" onClick={onCancel} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-black disabled:opacity-60"
            data-testid="avatar-cropper-save"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AvatarCropper;
