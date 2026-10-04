// Free Live alerts ("campanita"): which creators are live right now, each
// fan's bell per followed creator, and the in-app notifications they get.
// Implemented by localLive.ts and supabaseLive.ts. The video of the free Live
// itself (one creator to many fans) needs a streaming service and isn't here yet.
import type { AuthResult, User } from './types';

export interface LiveBroadcast {
  id: string;
  creatorProfileId: string;
  title: string;
  startedAt: string;
}

export type NotificationKind = 'live_started';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  creatorProfileId?: string;
  title: string;
  body: string;
  link: string;
  createdAt: string;
  read: boolean;
}

export interface BroadcastAccess {
  url: string;
  token: string;
  host: boolean;
}

// A Live left open (closed tab, lost connection) stops counting after this long.
export const LIVE_MAX_HOURS = 4;
// Restarting a Live within this window doesn't alert followers again.
export const LIVE_REALERT_MINUTES = 30;

export interface LiveBackend {
  // The creator's open Live, if any.
  currentLive(creatorProfileId: string): Promise<LiveBroadcast | null>;
  // Marks the signed-in creator as live and alerts followers with the bell on.
  startLive(user: User, title: string): Promise<AuthResult & { notified?: number }>;
  endLive(user: User): Promise<AuthResult>;
  // Same as endLive, fired while the creator's tab is closing: it has no answer to
  // wait for and the request must outlive the page.
  endLiveOnExit(user: User): void;
  // The fan's bell for a creator they follow.
  liveAlerts(creatorProfileId: string, user: User): Promise<boolean>;
  setLiveAlerts(user: User, creatorProfileId: string, on: boolean): Promise<AuthResult>;
  notifications(user: User): Promise<AppNotification[]>;
  markNotificationsRead(user: User): Promise<void>;
  // LiveKit access to a creator's open Live: the owner publishes, everyone else watches.
  broadcastAccess(creatorProfileId: string): Promise<AuthResult & { access?: BroadcastAccess }>;
  // LiveKit access to the private call of a confirmed Reserve booking: only its fan
  // and its creator get in, both with camera and microphone (host = the creator).
  callAccess(bookingId: string): Promise<AuthResult & { access?: BroadcastAccess }>;
  // Calls back when a new notification arrives for this user. Returns the unsubscribe.
  watchNotifications(userId: string, cb: () => void): () => void;
}
