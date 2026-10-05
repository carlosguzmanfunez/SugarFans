// UI access to creator Lives and their alerts: the creator's Subscriber Live switch,
// the fan's bell per creator and the notifications inbox. Mutations reload mounted screens.
import { useEffect } from 'react';
import { backend } from './backend';
import type { AuthResult, User } from './backend/types';
import { platformChanged, usePlatformQuery } from './platform';
import { ENABLE_OPEN_LIVE } from '../config/features';
import type { BroadcastMode } from './backend/liveTypes';
import { needsCreatorAnswer } from './reserveAlerts';

export type * from './backend/liveTypes';
export { LIVE_HEARTBEAT_SECONDS, LIVE_STALE_MINUTES } from './backend/liveTypes';

const l = backend.live;
export const liveApi = l;

const after = async <T extends AuthResult>(result: Promise<T>): Promise<T> => {
  const r = await result;
  if (r.ok) platformChanged();
  return r;
};

export const startLive = (user: User, title: string, mode: BroadcastMode = 'subscriber') => after(l.startLive(user, title, mode));
export const endLive = (user: User) => after(l.endLive(user));
export const setLiveAlerts = (user: User, creatorProfileId: string, on: boolean) => after(l.setLiveAlerts(user, creatorProfileId, on));
export const markNotificationsRead = async (user: User) => {
  await l.markNotificationsRead(user);
  platformChanged();
};

export const useCurrentLive = (creatorProfileId: string | undefined) =>
  usePlatformQuery(() => (creatorProfileId ? l.currentLive(creatorProfileId) : Promise.resolve(null)), [creatorProfileId], null).data;

export const useLiveAlerts = (creatorProfileId: string | undefined, user: User | null) =>
  usePlatformQuery(
    () => (creatorProfileId && user ? l.liveAlerts(creatorProfileId, user) : Promise.resolve(true)),
    [creatorProfileId, user?.id],
    true
  ).data;

// One Realtime subscription per person, shared by every screen that listens
// (the bell, the Reservas badge): the same channel can't be opened twice.
const watchers = new Map<string, { stop: () => void; listeners: Set<() => void> }>();
export const onNewNotification = (userId: string, cb: () => void) => {
  let w = watchers.get(userId);
  if (!w) {
    const listeners = new Set<() => void>();
    w = { listeners, stop: l.watchNotifications(userId, () => listeners.forEach((fn) => fn())) };
    watchers.set(userId, w);
  }
  w.listeners.add(cb);
  return () => {
    const cur = watchers.get(userId);
    if (!cur) return;
    cur.listeners.delete(cb);
    if (cur.listeners.size === 0) {
      cur.stop();
      watchers.delete(userId);
    }
  };
};

// The signed-in person's notifications, refreshed when a new one arrives.
export const useNotifications = (user: User | null) => {
  const query = usePlatformQuery(() => (user ? l.notifications(user) : Promise.resolve([])), [user?.id], []);
  const { reload } = query;
  const userId = user?.id;
  useEffect(() => (userId ? onNewNotification(userId, reload) : undefined), [userId, reload]);
  return query;
};

// How many Reserve requests the creator still has to answer (the red dot on
// "Reservas"), refreshed as soon as a new request arrives.
export const useReserveInbox = (user: User | null) => {
  const profileId = user?.role === 'creator' ? user.creatorProfileId : undefined;
  const query = usePlatformQuery(
    async () => (profileId ? (await backend.creatorBookings(profileId)).filter((b) => needsCreatorAnswer(b)).length : 0),
    [profileId],
    0
  );
  const { reload } = query;
  const userId = profileId ? user?.id : undefined;
  useEffect(() => (userId ? onNewNotification(userId, reload) : undefined), [userId, reload]);
  return query.data;
};

// Which of these creators are in an Open Live right now (the public LIVE rings and the
// Live tab). Empty while Open Live is disabled: Subscriber Lives are never listed in a
// public directory, they show on the creator's profile for their subscribers.
export const useLiveCreatorIds = (creatorProfileIds: string[]) => {
  const key = ENABLE_OPEN_LIVE ? creatorProfileIds.join(',') : '';
  return usePlatformQuery(
    async () => {
      if (!ENABLE_OPEN_LIVE) return new Set<string>();
      const lives = await Promise.all(creatorProfileIds.map((id) => l.currentLive(id).catch(() => null)));
      return new Set(creatorProfileIds.filter((_, i) => lives[i]?.mode === 'open'));
    },
    [key],
    new Set<string>()
  ).data;
};
