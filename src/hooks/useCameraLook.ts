import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalVideoTrack, VideoCaptureOptions } from 'livekit-client';
import { LookProcessor, type LookFailure } from '../lib/lookProcessor';
import { looksSupported, needsProcessing, saveLook, savedLook, type LookId } from '../lib/videoLooks';

const FAIL_NOTICE: Record<LookFailure, string> = {
  blur: 'Background Blur no está disponible en este dispositivo. Volvimos a Natural.',
  slow: 'Tu dispositivo no da abasto con el filtro. Volvimos a Natural para no cortar el video.',
  gl: 'El filtro se detuvo en este dispositivo. Volvimos a Natural.',
};

// Keeps the chosen camera look and applies it to whichever camera track is bound
// (the lobby preview or the published camera). Any failure falls back to Natural
// without stopping the camera.
export function useCameraLook() {
  const [{ look, enhance }, setChoice] = useState(savedLook);
  const [notice, setNotice] = useState('');
  const choice = useRef({ look, enhance });
  const track = useRef<LocalVideoTrack | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const supported = looksSupported();

  const onFail = useCallback((why: LookFailure) => {
    setNotice(FAIL_NOTICE[why]);
    const next = why === 'blur' ? { look: 'natural' as LookId, enhance: choice.current.enhance } : { look: 'natural' as LookId, enhance: false };
    choice.current = next;
    setChoice(next);
    saveLook(next.look, next.enhance);
    apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Runs one change at a time so quick taps can't race two processors onto the track.
  const apply = useCallback(() => {
    queue.current = queue.current.then(async () => {
      const t = track.current;
      if (!t) return;
      const { look: l, enhance: e } = choice.current;
      const cur = t.getProcessor();
      try {
        if (!supported || !needsProcessing(l, e)) {
          if (cur) await t.stopProcessor();
          return;
        }
        if (cur instanceof LookProcessor && !cur.isFailed) {
          cur.setLook(l, e);
          return;
        }
        if (cur) await t.stopProcessor();
        await t.setProcessor(new LookProcessor(l, e, onFail));
      } catch {
        await t.stopProcessor().catch(() => undefined);
        choice.current = { look: 'natural', enhance: false };
        setChoice(choice.current);
        setNotice(FAIL_NOTICE.gl);
      }
    });
    return queue.current;
  }, [onFail, supported]);

  const choose = useCallback(
    (next: { look?: LookId; enhance?: boolean }) => {
      choice.current = { ...choice.current, ...next };
      setChoice(choice.current);
      saveLook(choice.current.look, choice.current.enhance);
      setNotice('');
      apply();
    },
    [apply]
  );

  /** Points the look at a camera track (or none). */
  const bind = useCallback(
    (t: LocalVideoTrack | null | undefined) => {
      if (track.current === (t ?? null)) return;
      track.current = t ?? null;
      if (t) apply();
    },
    [apply]
  );

  /** Capture options that start the camera already filtered, so no raw frame is sent. */
  const captureOptions = useCallback((): VideoCaptureOptions => {
    const { look: l, enhance: e } = choice.current;
    return supported && needsProcessing(l, e) ? { processor: new LookProcessor(l, e, onFail) } : {};
  }, [onFail, supported]);

  useEffect(() => () => void (track.current = null), []);

  return {
    look,
    enhance,
    notice,
    supported,
    setLook: (l: LookId) => choose({ look: l }),
    toggleEnhance: () => choose({ enhance: !choice.current.enhance }),
    bind,
    captureOptions,
  };
}

export type CameraLook = ReturnType<typeof useCameraLook>;
