// "Instalar app": Chrome (Android, computer) offers to install Fans Reserve as an
// app. Installed, it opens from its own icon and its alerts show up as Fans
// Reserve, like any app's, instead of under the browser. The offer arrives once,
// early, so it is kept here from the first moment (imported by main.tsx).
import { useEffect, useState } from 'react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let offer: InstallPromptEvent | null = null;
// Chrome said "installed" during this visit.
let installedNow = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    offer = e as InstallPromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    installedNow = true;
    changed();
  });
}

export const isInstalledApp = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);

// Whether this phone already has the app: opened from its icon, Chrome just
// installed it, or Chrome on Android confirms it is installed (manifest
// related_applications). Safari on iPhone can't tell; there it is learned the
// first time the app is opened from its icon.
export const appInstalledHere = async (): Promise<boolean> => {
  if (isInstalledApp() || installedNow) return true;
  const nav = navigator as { getInstalledRelatedApps?: () => Promise<unknown[]> };
  if (typeof nav.getInstalledRelatedApps !== 'function') return false;
  try {
    return (await nav.getInstalledRelatedApps()).length > 0;
  } catch {
    return false;
  }
};

// Whether the browser can install it right now, and the action that does it.
export const useInstallApp = () => {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  const install = async () => {
    if (!offer) return false;
    const e = offer;
    await e.prompt();
    const { outcome } = await e.userChoice;
    offer = null;
    changed();
    return outcome === 'accepted';
  };
  return { canInstall: !!offer && !isInstalledApp(), install, installedNow };
};
