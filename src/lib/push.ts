// Phone alerts (Web Push): this browser's subscription. The service worker
// (public/sw.js) shows the alerts; api/push.ts sends them for each new
// notification in the bell. iPhone only allows them once the site is added to
// the home screen (iOS 16.4+), so that case gets its own explanation.
import { backend } from './backend';
import { useEffect, useState } from 'react';

// local: the browser-only demo backend (no alerts at all, nothing to show).
export type PushState = 'local' | 'unsupported' | 'install-first' | 'denied' | 'off' | 'on';
type PushResult = { ok: boolean; error?: string };
let changing = false;
let revision = 0;
const listeners = new Set<() => void>();
const reads = new Map<string, Promise<PushState>>();
const changed = () => { revision++; listeners.forEach(fn => fn()); };
const visible = () => { if (document.visibilityState === 'visible') changed(); };

// The bell, invitations and Settings all follow the same device subscription.
export const usePushState = (userId: string) => {
  const [value, setValue] = useState<{ owner: string; state: PushState | null }>({ owner: userId, state: null });
  const [busy, setBusy] = useState(changing);
  useEffect(() => {
    let alive = true;
    let request = 0;
    const refresh = () => {
      const current = ++request;
      setBusy(changing);
      if (changing) return;
      const key = `${userId}:${revision}`;
      let read = reads.get(key);
      if (!read) { read = pushState().finally(() => reads.delete(key)); reads.set(key, read); }
      read.catch(() => 'off' as PushState).then(state => {
        if (alive && current === request) setValue({ owner: userId, state });
      });
    };
    if (listeners.size === 0) { window.addEventListener('focus', changed); document.addEventListener('visibilitychange', visible); }
    listeners.add(refresh);
    refresh();
    return () => {
      alive = false;
      listeners.delete(refresh);
      if (listeners.size === 0) { window.removeEventListener('focus', changed); document.removeEventListener('visibilitychange', visible); }
    };
  }, [userId]);
  return { state: value.owner === userId ? value.state : null, busy };
};

const change = async (action: () => Promise<PushResult>): Promise<PushResult> => {
  if (changing) return { ok: false, error: 'Espera a que termine el cambio de notificaciones.' };
  changing = true;
  changed();
  try { return await action(); }
  catch { return { ok: false, error: 'No se pudo completar el cambio. Revisa tu conexión e inténtalo de nuevo.' }; }
  finally { changing = false; changed(); }
};

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const registration = async () => (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js');

const toKey = (base64url: string) => {
  const raw = atob((base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const save = (sub: PushSubscription) => {
  const json = sub.toJSON();
  return backend.savePushSubscription({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' });
};

export const pushState = async (): Promise<PushState> => {
  if (backend.mode !== 'supabase') return 'local';
  if (!supported()) return isIOS() && !standalone() ? 'install-first' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return 'off';
  // Keep this device tied to whoever is signed in now.
  return (await save(sub)).ok ? 'on' : 'off';
};

export const enablePush = (): Promise<PushResult> => change(async () => {
  if (backend.mode !== 'supabase') return { ok: false, error: 'Las notificaciones se activan en la versión publicada.' };
  if (!supported()) return { ok: false, error: 'Este navegador no permite avisos.' };
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, error: 'No diste permiso para los avisos. Puedes activarlos en los ajustes del navegador.' };
  try {
    const r = await fetch('/api/push');
    const { publicKey } = (await r.json()) as { publicKey?: string };
    if (!publicKey) return { ok: false, error: 'Los avisos aún no están listos en el servidor.' };
    await registration();
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) }));
    return await save(sub);
  } catch (err) {
    return { ok: false, error: `No se pudieron activar los avisos. (${err instanceof Error ? err.message : 'sin detalle'})` };
  }
});

export const disablePush = (): Promise<PushResult> => change(async () => {
  if (!supported()) return { ok: false, error: 'Este navegador no permite avisos.' };
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return { ok: true };
  const removed = await backend.deletePushSubscription(sub.endpoint);
  if (!removed.ok) return removed;
  return await sub.unsubscribe() ? { ok: true } : { ok: false, error: 'No se pudieron desactivar las notificaciones. Inténtalo de nuevo.' };
});

export const testPush = async (): Promise<{ ok: boolean; error?: string }> => {
  const token = await backend.accessToken();
  const r = await fetch('/api/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ test: true }),
  }).catch(() => null);
  const body = (await r?.json().catch(() => ({}))) as { sent?: number; error?: string } | undefined;
  if (!r?.ok) return { ok: false, error: body?.error || 'No se pudo enviar el aviso de prueba.' };
  return body?.sent ? { ok: true } : { ok: false, error: 'Este dispositivo no está registrado. Vuelve a activar los avisos.' };
};
