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
    changed();
  });
}

export const isInstalledApp = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);

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
  return { canInstall: !!offer && !isInstalledApp(), install };
};
