import React from 'react';
import { CoverImage } from './CoverArt';

// A local cover, with no video element or media URL. Opening a feed or gallery
// must not download a video just to obtain its first frame.
const VideoPreview: React.FC<{ seed: string; className?: string; testId?: string }> = ({ seed, className = 'w-full aspect-video', testId }) => (
  <span className={`relative block overflow-hidden bg-black ${className}`} aria-hidden="true" data-testid={testId}>
    <CoverImage seed={seed} className="w-full h-full" />
    <span className="absolute inset-0 flex items-center justify-center">
      <span className="w-16 h-16 rounded-full bg-black/55 text-white flex items-center justify-center text-2xl">
        <i className="fas fa-play ml-1"></i>
      </span>
    </span>
  </span>
);

export default VideoPreview;
