import React, { useEffect, useState } from 'react';

// Anti-recording deterrent for live video (Carlos, 2026-10-03: Lives and video
// calls are never recorded). No web page can block a screen recorder or a
// second phone, so the viewer's own name, account code and time float over the
// video and move every few seconds: any copy that leaks shows who made it.
const SPOTS = [
  'top-[12%] left-[8%]',
  'top-[30%] right-[10%]',
  'top-[55%] left-[20%]',
  'bottom-[18%] right-[14%]',
  'top-[42%] left-[38%]',
];

const ViewerWatermark: React.FC<{ name: string; userId: string }> = ({ name, userId }) => {
  const [spot, setSpot] = useState(0);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => {
      setSpot((s) => (s + 1) % SPOTS.length);
      setNow(new Date());
    }, 7000);
    return () => window.clearInterval(id);
  }, []);
  const stamp = now.toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return (
    <div aria-hidden="true" data-testid="viewer-watermark" className="pointer-events-none absolute inset-0 select-none overflow-hidden">
      <span className={`absolute ${SPOTS[spot]} whitespace-nowrap rounded px-2 py-1 text-xs sm:text-sm font-semibold text-white/35 [text-shadow:0_1px_2px_rgba(0,0,0,.45)] transition-all duration-1000`}>
        {name} · {userId.slice(0, 8)} · {stamp}
      </span>
    </div>
  );
};

export default ViewerWatermark;

// Props for <video> elements that show someone else's live video.
export const noCaptureVideoProps = {
  disablePictureInPicture: true,
  controlsList: 'nodownload noremoteplayback noplaybackrate',
  onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
} as const;
