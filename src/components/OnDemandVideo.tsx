import React, { useEffect, useRef, useState } from 'react';
import VideoPreview from './VideoPreview';
import { noCaptureVideoProps } from './ViewerWatermark';
import { isBunnyEmbed } from '../lib/backend/bunnyVideo';

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
  if (requested === src && isBunnyEmbed(src)) {
    // Bunny Stream player (adaptive quality). The link carries its own expiring token;
    // "#r=WxH" (never sent to Bunny) gives the video's shape so it isn't letterboxed.
    const [url, hash = ''] = src.split('#');
    const m = /r=(\d+)x(\d+)/.exec(hash);
    const w = m ? Number(m[1]) : 16;
    const h = m ? Number(m[2]) : 9;
    const ratio = w > 0 && h > 0 ? `${w} / ${h}` : '16 / 9';
    const player = `${url}&autoplay=true&preload=true&playsinline=true&rememberPosition=false`;
    // Vertical phone videos: as tall as the screen allows, width follows the shape.
    const size: React.CSSProperties = h > w ? { height: 'min(80vh, 32rem)', width: 'auto', maxWidth: '100%' } : { width: '100%', maxHeight: 'min(80vh, 32rem)' };
    return (
      <div className={`${className} flex w-full justify-center bg-black`} data-testid={testId}>
        <iframe
          src={player}
          title="Video"
          allow="autoplay; encrypted-media; fullscreen"
          allowFullScreen
          referrerPolicy="origin"
          className="block border-0"
          style={{ aspectRatio: ratio, border: 0, ...size }}
        />
      </div>
    );
  }
  return requested === src ? (
    <video ref={video} src={src} controls playsInline autoPlay preload="none" {...noCaptureVideoProps} className={`${className} ${videoClassName}`} data-testid={testId} />
  ) : (
    <button type="button" onClick={() => setRequested(src)} aria-label="Reproducir video" className={`block w-full max-w-2xl ${className}`} data-testid="play-video">
      <VideoPreview seed={seed} />
    </button>
  );
};

export default OnDemandVideo;
