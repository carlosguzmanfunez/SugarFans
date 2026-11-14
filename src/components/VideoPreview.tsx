import React, { useState } from 'react';
import { CoverImage } from './CoverArt';
import { videoPoster } from '../lib/backend/bunnyVideo';

// A cover with no video element: opening a feed or gallery must not download a video
// just to obtain its first frame. Videos already in Bunny show Bunny's small cover image;
// the rest (or if that image fails) show the local art.
//
// In the feed (default box) the cover keeps the video's real shape, as it looks once
// opened (Carlos 2026-11-13: a vertical video looked stretched/zoomed in a 16:9 crop).
// The box takes the cover's proportions (up to 32rem tall, like the player); if it is
// narrower than the card, the sides show a blurred copy instead of black bars.
// Grid tiles pass their own className (square) and keep the cropped cover.
const VideoPreview: React.FC<{ seed: string; src?: string; className?: string; testId?: string }> = ({ seed, src, className, testId }) => {
  const poster = videoPoster(src);
  const [broken, setBroken] = useState<string | null>(null);
  // "#r=WxH" on Bunny links gives the shape up front (no jump once the cover loads).
  const known = /(?:^|&)r=(\d+)x(\d+)/.exec(src?.split('#')[1] ?? '');
  const [ratio, setRatio] = useState<number | null>(known && +known[2] > 0 ? +known[1] / +known[2] : null);
  const feed = !className;
  const showPoster = poster && broken !== poster;
  const box = feed ? `w-full ${ratio ? 'max-h-[32rem]' : 'aspect-video'}` : className;
  return (
    <span
      className={`relative block overflow-hidden bg-black ${box}`}
      style={feed && ratio ? { aspectRatio: String(Math.max(ratio, 0.5)) } : undefined}
      aria-hidden="true"
      data-testid={testId}
    >
      {showPoster ? (
        <>
          {feed && <img src={poster} alt="" draggable={false} className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl" />}
          <img
            src={poster}
            alt=""
            loading="lazy"
            draggable={false}
            onLoad={(e) => { if (known) return; const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setRatio(i.naturalWidth / i.naturalHeight); }}
            onError={() => setBroken(poster)}
            className={`relative h-full w-full ${feed ? 'object-contain' : 'object-cover'}`}
            data-testid="video-poster"
          />
        </>
      ) : <CoverImage seed={seed} className="w-full h-full" />}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="w-16 h-16 rounded-full bg-black/55 text-white flex items-center justify-center text-2xl">
          <i className="fas fa-play ml-1"></i>
        </span>
      </span>
    </span>
  );
};

export default VideoPreview;
