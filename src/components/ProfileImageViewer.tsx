import React, { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import { CoverArt, isPlaceholderImage } from './CoverArt';
import ProfileImageButton from './ProfileImageButton';
import ZoomablePostImage from './ZoomablePostImage';
import type { ProfileImageKind } from '../lib/profileImage';

interface Props {
  kind: ProfileImageKind;
  src?: string | null;
  name: string;
  seed: string; // the cover's generated art when there is no photo yet
  canEdit: boolean;
  onDone: (message: string, ok: boolean) => void;
  onClose: () => void;
}

// The profile photo or the cover at full size, like Facebook: the owner can
// change it right there. Pinch / double-tap zooms like the post photos, and
// pulling it down closes it like the back button.
const ProfileImageViewer: React.FC<Props> = ({ kind, src, name, seed, canEdit, onDone, onClose }) => {
  const closeBtn = useRef<HTMLButtonElement>(null);
  const hasPhoto = !!src && !isPlaceholderImage(src);
  const [pull, setPull] = useState(0);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const vertical = useRef<boolean | null>(null);

  // The phone's back button closes it instead of leaving the profile.
  const closedByBack = useRef(false);
  useEffect(() => {
    window.history.pushState({ ...(window.history.state ?? {}), profileImage: true }, '');
    const onPop = () => {
      closedByBack.current = true;
      onClose();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!closedByBack.current && window.history.state?.profileImage) window.history.back();
    };
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const reset = () => { start.current = null; vertical.current = null; setPull(0); };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return; // computers use X / Esc
    start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    vertical.current = null;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (vertical.current === null && Math.abs(dx) + Math.abs(dy) > 8) vertical.current = Math.abs(dy) > Math.abs(dx);
    if (vertical.current) setPull(Math.max(0, dy));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dy = e.clientY - start.current.y;
    if (vertical.current && (dy > 110 || (dy > 40 && Date.now() - start.current.t < 250))) {
      start.current = null;
      onClose();
      return;
    }
    reset();
  };
  const fade = Math.max(0, 1 - pull / 400);

  const title = kind === 'avatar' ? `Foto de perfil de ${name}` : `Portada de ${name}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="profile-image-viewer"
      className="fixed inset-0 z-[80] text-white flex flex-col select-none"
      style={{ backgroundColor: `rgba(0,0,0,${fade})`, transition: pull ? 'none' : 'background-color 200ms' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))', opacity: pull ? fade : 1 }}>
        <p className="min-w-0 flex-1 font-semibold text-sm truncate">{title}</p>
        <button
          ref={closeBtn}
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-xl"
        >
          <i aria-hidden="true" className="fas fa-times"></i>
        </button>
      </div>

      <div
        className="flex-1 min-h-0 flex items-center justify-center p-4 touch-none"
        style={{ transform: `translateY(${pull}px)`, transition: pull ? 'none' : 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        onClick={(e) => e.target === e.currentTarget && onClose()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={reset}
        data-testid="profile-image-frame"
      >
        {hasPhoto ? (
          <ZoomablePostImage src={src!} alt={title} onGestureStart={reset} testId="profile-image-full" />
        ) : kind === 'avatar' ? (
          <Avatar name={name} size={240} decorative />
        ) : (
          <div className="relative w-full max-w-4xl aspect-[3/1] overflow-hidden rounded-lg">
            <CoverArt seed={seed} />
          </div>
        )}
      </div>

      {canEdit && (
        <div className="shrink-0 flex justify-center px-4 pt-2" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))', opacity: pull ? fade : 1 }}>
          <ProfileImageButton kind={kind} onDone={onDone} withLabel className="h-12 px-6 rounded-full" />
        </div>
      )}
    </div>
  );
};

export default ProfileImageViewer;
