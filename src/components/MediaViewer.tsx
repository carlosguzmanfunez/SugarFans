import React, { useCallback, useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import { CoverImage, isPlaceholderImage } from './CoverArt';
import type { DisplayPost } from './PostCard';

interface Props {
  posts: DisplayPost[]; // only the ones with a photo or video the viewer may see
  startId: string;
  onClose: () => void;
}

// Swipe distance (share of the screen width) that moves to the next post.
const SWIPE = 0.18;

// Full-screen photo/video viewer, like Facebook's: swipe sideways on a phone,
// arrows (or the keyboard) on a computer, Esc / X / the back button close it.
const MediaViewer: React.FC<Props> = ({ posts, startId, onClose }) => {
  const [index, setIndex] = useState(() => Math.max(0, posts.findIndex((p) => p.id === startId)));
  const [drag, setDrag] = useState(0);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const horizontal = useRef<boolean | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const post = posts[index];

  const go = useCallback((step: number) => setIndex((i) => Math.min(posts.length - 1, Math.max(0, i + step))), [posts.length]);

  // The phone's back button closes the viewer instead of leaving the profile.
  const closedByBack = useRef(false);
  useEffect(() => {
    window.history.pushState({ ...(window.history.state ?? {}), mediaViewer: true }, '');
    const onPop = () => {
      closedByBack.current = true;
      onClose();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!closedByBack.current && window.history.state?.mediaViewer) window.history.back();
    };
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [go, onClose]);

  // Only the video on screen keeps playing.
  useEffect(() => {
    frame.current?.querySelectorAll('video').forEach((v) => {
      if (v.dataset.index !== String(index)) v.pause();
    });
  }, [index]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return; // computers use the arrows
    start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    horizontal.current = null;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (horizontal.current === null && Math.abs(dx) + Math.abs(dy) > 8) horizontal.current = Math.abs(dx) > Math.abs(dy);
    if (!horizontal.current) return;
    // Resist at the first and last post.
    const edge = (index === 0 && dx > 0) || (index === posts.length - 1 && dx < 0);
    setDrag(edge ? dx / 3 : dx);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    const fast = Math.abs(dx) > 40 && Date.now() - start.current.t < 250;
    const width = frame.current?.clientWidth ?? window.innerWidth;
    if (horizontal.current && (Math.abs(dx) > width * SWIPE || fast)) go(dx < 0 ? 1 : -1);
    else if (horizontal.current === false && dy > 120) onClose(); // swipe down closes
    start.current = null;
    horizontal.current = null;
    setDrag(0);
  };

  if (!post) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Publicación ${index + 1} de ${posts.length} de ${post.creatorName}`}
      data-testid="media-viewer"
      className="fixed inset-0 z-[80] bg-black text-white flex flex-col select-none"
    >
      <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <Avatar src={post.creatorAvatar} name={post.creatorName} size={36} decorative />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm truncate">{post.creatorName}</p>
          <p className="text-xs text-white/60">{new Date(post.createdAt).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        {posts.length > 1 && (
          <span className="text-sm text-white/70 tabular-nums" data-testid="media-viewer-count">{index + 1} / {posts.length}</span>
        )}
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
        ref={frame}
        className="relative flex-1 overflow-hidden touch-pan-y"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="flex h-full"
          style={{
            transform: `translateX(calc(${-index * 100}% + ${drag}px))`,
            transition: drag ? 'none' : 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {posts.map((p, i) => (
            <div key={p.id} className="w-full h-full shrink-0 flex items-center justify-center" aria-hidden={i !== index}>
              {Math.abs(i - index) <= 1 &&
                (p.mediaType === 'video' && p.mediaUrl ? (
                  <video
                    src={p.mediaUrl}
                    data-index={i}
                    controls
                    playsInline
                    preload="metadata"
                    className="max-w-full max-h-full"
                    data-testid="media-viewer-video"
                  />
                ) : p.mediaUrl && !isPlaceholderImage(p.mediaUrl) ? (
                  <img src={p.mediaUrl} alt={p.content || 'Foto'} draggable={false} className="max-w-full max-h-full object-contain" data-testid="media-viewer-image" />
                ) : (
                  <CoverImage seed={`post-${p.id}`} className="w-full max-w-2xl aspect-square" />
                ))}
            </div>
          ))}
        </div>

        {index > 0 && (
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Publicación anterior"
            className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-white/15 hover:bg-white/30 items-center justify-center text-2xl transition"
          >
            <i aria-hidden="true" className="fas fa-chevron-left"></i>
          </button>
        )}
        {index < posts.length - 1 && (
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Siguiente publicación"
            className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-white/15 hover:bg-white/30 items-center justify-center text-2xl transition"
          >
            <i aria-hidden="true" className="fas fa-chevron-right"></i>
          </button>
        )}
      </div>

      {post.content && (
        <div className="shrink-0 px-5 pt-3 max-h-[25vh] overflow-y-auto" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
          <p className="max-w-2xl mx-auto text-sm md:text-base text-white/90 whitespace-pre-line" data-testid="media-viewer-caption">{post.content}</p>
        </div>
      )}
    </div>
  );
};

export default MediaViewer;
