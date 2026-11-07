import { lazy, type ComponentType } from 'react';

// After each deploy the files of every page get new names. A visitor who still has
// the previous version open asks for a file that no longer exists, the page fails
// to load and the screen stays blank ("Failed to fetch dynamically imported module"
// in Estado del servicio > Problemas de la página). In that case we reload once,
// which brings the new version. If it fails again within 30 s, the error goes on
// as before (no reload loop).
const KEY = 'fr-update-reload';
const WINDOW_MS = 30_000;

// Chrome, Safari, Firefox and Vite's CSS preload use different wording.
export const isStaleChunk = (err: unknown) =>
  /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
    String((err as Error | undefined)?.message ?? err),
  );

// True when it is safe to reload now (and remembers it); false if we already did.
export const claimReload = (storage: Pick<Storage, 'getItem' | 'setItem'>, now = Date.now()) => {
  try {
    const last = Number(storage.getItem(KEY)) || 0;
    if (now - last < WINDOW_MS) return false;
    storage.setItem(KEY, String(now));
    return storage.getItem(KEY) === String(now);
  } catch {
    return false; // storage blocked: never risk a reload loop
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const lazyPage = <T extends ComponentType<any>>(load: () => Promise<{ default: T }>) =>
  lazy(() =>
    load().catch((err: unknown) => {
      if (!isStaleChunk(err) || !claimReload(sessionStorage)) throw err;
      location.reload();
      // Keep showing the loading screen until the new version arrives.
      return new Promise<{ default: T }>(() => {});
    }),
  );
