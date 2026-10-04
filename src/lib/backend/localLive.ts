// Browser-only implementation of creator Lives and their alerts (dev and offline
// tests). Followers come from the local social store, subscribers from the local
// accounts; notifications reach other tabs of the same browser through the storage event.
import { readJSON, writeJSONChecked, newId } from '../storage';
import { moderate } from '../moderation';
import type { AuthResult, User } from './types';
import { LIVE_MAX_HOURS, LIVE_REALERT_MINUTES, LIVE_STALE_MINUTES, type AppNotification, type BroadcastAccess, type LiveBackend, type LiveBroadcast } from './liveTypes';
import { ENABLE_OPEN_LIVE } from '../../config/features';

interface StoredBroadcast extends Omit<LiveBroadcast, 'mode'> {
  // Missing on Lives stored before modes existed: those are open Lives.
  mode?: LiveBroadcast['mode'];
  endedAt?: string;
  lastSeenAt?: string;
}

interface Store {
  broadcasts: StoredBroadcast[];
  notifications: Record<string, AppNotification[]>; // user id -> newest first
  alertsOff: Record<string, string[]>; // creator profile id -> user ids who turned the bell off
}

interface Deps {
  followers(creatorProfileId: string): string[];
  // Fans with an active subscription to this creator.
  subscribers(creatorProfileId: string): string[];
  currentUserId(): string | null;
  onChange(cb: () => void): () => void;
  notify(): void;
}

const KEY = 'live';
const MAX_NOTIFICATIONS = 50;
const ok: AuthResult = { ok: true };
const fail = (error: string): AuthResult => ({ ok: false, error });
const expired = (b: StoredBroadcast) =>
  Date.now() - new Date(b.startedAt).getTime() > LIVE_MAX_HOURS * 3600_000 ||
  (!!b.lastSeenAt && Date.now() - new Date(b.lastSeenAt).getTime() > LIVE_STALE_MINUTES * 60_000);

export const createLocalLive = (deps: Deps): LiveBackend => {
  const load = (): Store => ({ broadcasts: [], notifications: {}, alertsOff: {}, ...readJSON<Partial<Store>>(KEY, {}) });
  const save = (st: Store) => {
    if (!writeJSONChecked(KEY, st)) return false;
    deps.notify();
    return true;
  };
  const closeLive = (user: User) => {
    const st = load();
    const now = new Date().toISOString();
    save({
      ...st,
      broadcasts: st.broadcasts.map((b) => (b.creatorProfileId === user.creatorProfileId && !b.endedAt ? { ...b, endedAt: now } : b)),
    });
  };

  const open = (st: Store, creatorProfileId: string) =>
    st.broadcasts.find((b) => b.creatorProfileId === creatorProfileId && !b.endedAt && !expired(b));

  // Only the LiveKit test (npm run e2e:live) builds with VITE_LIVE_LOCAL_API: it
  // serves api/live-token.ts and treats the local user id as the session token.
  const liveToken = async (payload: Record<string, string>, unavailable: string): Promise<AuthResult & { access?: BroadcastAccess }> => {
    if (!import.meta.env.VITE_LIVE_LOCAL_API) return fail(unavailable);
    const userId = deps.currentUserId();
    if (!userId) return fail('Inicia sesión para entrar.');
    const r = await fetch('/api/live-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${userId}` },
      body: JSON.stringify(payload),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.token) return fail(body.error ?? 'No se pudo conectar al video.');
    return { ok: true, access: { url: body.url, token: body.token, host: !!body.host } };
  };

  return {
    async currentLive(creatorProfileId) {
      const b = open(load(), creatorProfileId);
      return b ? { id: b.id, creatorProfileId: b.creatorProfileId, title: b.title, startedAt: b.startedAt, mode: b.mode ?? 'open' } : null;
    },

    async startLive(user, rawTitle, mode = 'subscriber') {
      if (mode === 'open' && !ENABLE_OPEN_LIVE) return fail('El Live abierto está desactivado. Usa el Live para suscriptores.');
      const profile = user.creatorProfileId;
      if (!profile || user.role !== 'creator') return fail('Solo los creators pueden iniciar un Live');
      const title = rawTitle.trim();
      if (title.length < 3 || title.length > 80) return fail('El título del Live debe tener entre 3 y 80 caracteres');
      if (!moderate(title, 'experience').ok) return fail('Ese título no está permitido en Fans Reserve');
      const st = load();
      if (open(st, profile)) return { ok: true, notified: 0 };
      const now = new Date();
      const recent = st.broadcasts.some(
        (b) => b.creatorProfileId === profile && now.getTime() - new Date(b.startedAt).getTime() < LIVE_REALERT_MINUTES * 60_000
      );
      const broadcasts = [
        ...st.broadcasts.map((b) => (b.creatorProfileId === profile && !b.endedAt ? { ...b, endedAt: now.toISOString() } : b)),
        { id: newId(), creatorProfileId: profile, title, startedAt: now.toISOString(), mode },
      ].slice(-100);
      const notifications = { ...st.notifications };
      let notified = 0;
      if (!recent) {
        const off = st.alertsOff[profile] ?? [];
        // A Subscriber Live alerts active subscribers; an Open Live, followers.
        const audience = mode === 'subscriber' ? deps.subscribers(profile) : deps.followers(profile);
        for (const fan of audience) {
          if (fan === user.id || off.includes(fan)) continue;
          const n: AppNotification = {
            id: newId(),
            kind: 'live_started',
            creatorProfileId: profile,
            title: mode === 'subscriber' ? `${user.name} empezó un Live para suscriptores` : `${user.name} está en Live`,
            body: title,
            link: `/en-vivo/${profile}`,
            createdAt: now.toISOString(),
            read: false,
          };
          notifications[fan] = [n, ...(notifications[fan] ?? [])].slice(0, MAX_NOTIFICATIONS);
          notified += 1;
        }
      }
      if (!save({ ...st, broadcasts, notifications })) return fail('No se pudo guardar: el almacenamiento del navegador está lleno');
      return { ok: true, notified };
    },

    async endLive(user) {
      closeLive(user);
      return ok;
    },

    endLiveOnExit: closeLive,

    async liveHeartbeat(user) {
      const st = load();
      const b = user.creatorProfileId ? open(st, user.creatorProfileId) : undefined;
      if (!b) return false;
      const now = new Date().toISOString();
      // No notify(): a check-in changes nothing on screen.
      writeJSONChecked(KEY, { ...st, broadcasts: st.broadcasts.map((x) => (x === b ? { ...x, lastSeenAt: now } : x)) });
      return true;
    },

    async liveAlerts(creatorProfileId, user) {
      return !(load().alertsOff[creatorProfileId] ?? []).includes(user.id);
    },

    async setLiveAlerts(user, creatorProfileId, on) {
      const st = load();
      const off = (st.alertsOff[creatorProfileId] ?? []).filter((id) => id !== user.id);
      return save({ ...st, alertsOff: { ...st.alertsOff, [creatorProfileId]: on ? off : [...off, user.id] } })
        ? ok
        : fail('No se pudo guardar: el almacenamiento del navegador está lleno');
    },

    async notifications(user) {
      return load().notifications[user.id] ?? [];
    },

    async markNotificationsRead(user) {
      const st = load();
      const mine = st.notifications[user.id];
      if (!mine?.some((n) => !n.read)) return;
      save({ ...st, notifications: { ...st.notifications, [user.id]: mine.map((n) => ({ ...n, read: true })) } });
    },

    broadcastAccess(creatorProfileId) {
      return liveToken({ creatorProfileId }, 'El video del Live solo funciona en la web publicada.');
    },

    callAccess(bookingId) {
      return liveToken({ bookingId }, 'La videollamada solo funciona en la web publicada.');
    },

    watchNotifications(_userId, cb) {
      return deps.onChange(cb);
    },
  };
};
