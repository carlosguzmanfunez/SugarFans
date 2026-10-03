import React from 'react';

// Anti-recording deterrent for live video (Carlos, 2026-10-03: Lives and video
// calls are never recorded). No web page can block a screen recorder or a
// second phone, so the viewer's own name and account code sit, small and
// static, in the top-left corner of the video: any copy that leaks shows who
// made it. Carlos asked for it fixed in a corner, not floating.
const ViewerWatermark: React.FC<{ name: string; userId: string }> = ({ name, userId }) => (
  <div
    aria-hidden="true"
    data-testid="viewer-watermark"
    className="pointer-events-none absolute top-3 left-3 max-w-[60%] select-none truncate text-[11px] sm:text-xs font-medium text-white/40 [text-shadow:0_1px_2px_rgba(0,0,0,.5)]"
  >
    {name} · {userId.slice(0, 8)}
  </div>
);

export default ViewerWatermark;

// Props for <video> elements that show someone else's live video.
export const noCaptureVideoProps = {
  disablePictureInPicture: true,
  controlsList: 'nodownload noremoteplayback noplaybackrate',
  onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
} as const;
