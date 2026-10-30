import React, { useEffect, useRef, useState } from 'react';
import VideoPreview from './VideoPreview';

interface Props {
  src: string;
  seed: string;
  className?: string;
  videoClassName?: string;
  testId?: string;
}

// No source is attached before an explicit click, even in browsers that ignore
// preload hints. A changed URL requires a fresh click instead of auto-playing.
const OnDemandVideo: React.FC<Props> = ({ src, seed, className = '', videoClassName = 'w-full', testId }) => {
  const [requested, setRequested] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (requested !== src || !element) return;
    // Restore on an effect reconnect (for example React StrictMode), then stop
    // the old player explicitly when its slide, access permission or URL changes.
    if (!element.getAttribute('src')) element.src = src;
    element.focus({ preventScroll: true });
    return () => {
      element.pause();
      element.removeAttribute('src');
      element.load();
    };
  }, [requested, src]);
  return requested === src ? (
    <video ref={video} src={src} controls playsInline autoPlay preload="none" className={`${className} ${videoClassName}`} data-testid={testId} />
  ) : (
    <button type="button" onClick={() => setRequested(src)} aria-label="Reproducir video" className={`block w-full max-w-2xl ${className}`} data-testid="play-video">
      <VideoPreview seed={seed} />
    </button>
  );
};

export default OnDemandVideo;
