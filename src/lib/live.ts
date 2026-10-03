// UI access to free Live alerts: the creator's "En Live" switch, the fan's bell
// per creator and the notifications inbox. Mutations reload mounted screens.
import { useEffect } from 'react';
import { backend } from './backend';
import type { AuthResult, User } from './backend/types';
import { platformChanged, usePlatformQuery } from './platform';

export type * from './backend/liveTypes';

const l = backend.live;
export const liveApi = l;

const after = async <T extends AuthResult>(result: Promise<T>): Promise<T> => {
  const r = await result;
  if (r.ok) platformChanged();
  return r;
};

export const startLive = (user: User, title: string) => after(l.startLive(user, title));
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

// The signed-in person's notifications, refreshed when a new one arrives.
export const useNotifications = (user: User | null) => {
  const query = usePlatformQuery(() => (user ? l.notifications(user) : Promise.resolve([])), [user?.id], []);
  const { reload } = query;
  const userId = user?.id;
  useEffect(() => (userId ? l.watchNotifications(userId, reload) : undefined), [userId, reload]);
  return query;
};
