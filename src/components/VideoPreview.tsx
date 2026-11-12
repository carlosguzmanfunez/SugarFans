import React, { useState } from 'react';
import { CoverImage } from './CoverArt';
import { videoPoster } from '../lib/backend/bunnyVideo';

// A cover with no video element: opening a feed or gallery must not download a video
// just to obtain its first frame. Videos already in Bunny show Bunny's small cover image;
// the rest (or if that image fails) show the local art.
const VideoPreview: React.FC<{ seed: string; src?: string; className?: string; testId?: string }> = ({ seed, src, className = 'w-full aspect-video', testId }) => {
  const poster = videoPoster(src);
  const [broken, setBroken] = useState<string | null>(null);
  return (
    <span className={`relative block overflow-hidden bg-black ${className}`} aria-hidden="true" data-testid={testId}>
      {poster && broken !== poster
        ? <img src={poster} alt="" loading="lazy" draggable={false} onError={() => setBroken(poster)} className="w-full h-full object-cover" data-testid="video-poster" />
        : <CoverImage seed={seed} className="w-full h-full" />}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="w-16 h-16 rounded-full bg-black/55 text-white flex items-center justify-center text-2xl">
          <i className="fas fa-play ml-1"></i>
        </span>
      </span>
    </span>
  );
};

export default VideoPreview;
