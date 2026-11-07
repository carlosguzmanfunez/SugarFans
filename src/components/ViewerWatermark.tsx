import React, { useEffect, useState } from 'react';

// Anti-leak deterrent (Carlos, 2026-11-06). No web page can block a screen
// recorder or a second phone, so whoever is watching sees their own @usuario
// (or name) and account code, very faint and small, jumping to a new spot every
// few seconds: any copy that leaks shows who made it, and a moving mark can't be
// cropped out. Each viewer only sees their own; the creator never sees one over
// their own content or camera. Used on live video (1:1, Meet & Greet, events,
// Lives). Not on posts: Carlos removed it from photos and videos 2026-11-07.

type Viewer = { id: string; name: string; username?: string };

// "@usuario · 1a2b3c4d": the handle when there is one, otherwise the name.
export const watermarkLabel = (viewer: Viewer) =>
  `${viewer.username ? `@${viewer.username}` : viewer.name} · ${viewer.id.slice(0, 8)}`;

// Spots spread over the frame; the mark hops between them.
const SPOTS = [
  { top: '8%', left: '6%' },
  { top: '18%', left: '52%' },
  { top: '38%', left: '14%' },
  { top: '46%', left: '58%' },
  { top: '64%', left: '28%' },
  { top: '74%', left: '60%' },
  { top: '84%', left: '8%' },
];
export const WATERMARK_MOVE_MS = 4000;

const ViewerWatermark: React.FC<{ viewer: Viewer; compact?: boolean }> = ({ viewer, compact = false }) => {
  // Each mark starts at its own spot so a grid of photos doesn't line them all up.
  const [spot, setSpot] = useState(() => Math.floor(Math.random() * SPOTS.length));
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSpot((current) => (current + 1 + Math.floor(Math.random() * (SPOTS.length - 1))) % SPOTS.length);
    }, WATERMARK_MOVE_MS);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[5] overflow-hidden select-none">
      <span
        data-testid="viewer-watermark"
        data-spot={spot}
        className={`absolute max-w-[70%] truncate whitespace-nowrap font-semibold text-white opacity-[0.14] [text-shadow:0_0_2px_rgba(0,0,0,.9)] transition-[top,left] duration-700 ease-in-out motion-reduce:transition-none ${compact ? 'text-[9px]' : 'text-[11px] sm:text-xs'}`}
        style={SPOTS[spot]}
      >
        {watermarkLabel(viewer)}
      </span>
    </div>
  );
};

export default ViewerWatermark;

// Props for <video> elements that show someone else's video: no download button,
// no picture-in-picture window, no "Guardar video como…".
export const noCaptureVideoProps = {
  disablePictureInPicture: true,
  controlsList: 'nodownload noremoteplayback noplaybackrate',
  onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
} as const;

// Wrapper for subscriber photos and videos: no right-click menu, no dragging the
// file out, no long-press "Guardar imagen" on phones (see .protected-media in index.css).
export const ProtectedMedia: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div
    className={`protected-media relative ${className}`}
    data-testid="protected-media"
    onContextMenu={(e) => e.preventDefault()}
    onDragStart={(e) => e.preventDefault()}
  >
    {children}
  </div>
);
