import React, { useEffect, useRef, useState } from 'react';
import { createLocalVideoTrack, VideoPresets, type LocalVideoTrack } from 'livekit-client';
import LookPicker from './LookPicker';
import type { CameraLook } from '../hooks/useCameraLook';

// Before joining: try the camera with the chosen look. The camera only opens when the
// person asks ("Ver cómo me veo") and closes when this unmounts (on joining).
const CameraPreview: React.FC<{ cam: CameraLook }> = ({ cam }) => {
  const [on, setOn] = useState(false);
  const [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<LocalVideoTrack | null>(null);
  const { bind, captureOptions } = cam;

  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    (async () => {
      let track: LocalVideoTrack;
      try {
        track = await createLocalVideoTrack({ resolution: VideoPresets.h720.resolution, ...captureOptions() }).catch(() =>
          createLocalVideoTrack({ resolution: VideoPresets.h720.resolution })
        );
      } catch {
        if (!cancelled) {
          setError('No pudimos abrir tu cámara. Revisa los permisos del navegador.');
          setOn(false);
        }
        return;
      }
      if (cancelled) {
        track.stop();
        return;
      }
      trackRef.current = track;
      if (video.current) track.attach(video.current);
      bind(track);
    })();
    return () => {
      cancelled = true;
      bind(null);
      const t = trackRef.current;
      trackRef.current = null;
      if (t) {
        t.detach();
        t.stop(); // also tears down the look processor
      }
    };
  }, [on, bind, captureOptions]);

  return (
    <div className="bg-gray-900 text-white rounded-2xl p-3 text-left" data-testid="camera-preview">
      <div className="relative aspect-video rounded-xl overflow-hidden bg-black mb-3">
        <video ref={video} autoPlay playsInline muted className={`w-full h-full object-cover -scale-x-100 ${on ? '' : 'hidden'}`} />
        {!on && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
            <button type="button" onClick={() => { setError(''); setOn(true); }} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-medium">
              <i aria-hidden="true" className="fas fa-camera mr-2"></i>Ver cómo me veo
            </button>
            {error && <p className="text-xs text-red-300">{error}</p>}
          </div>
        )}
      </div>
      <LookPicker cam={cam} />
    </div>
  );
};

export default CameraPreview;
