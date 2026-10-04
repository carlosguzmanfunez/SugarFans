// Creator Lives and their alerts ("campanita"): which creators are live right
// now, each fan's bell per followed creator, and the in-app notifications they
// get. A Live is a Subscriber Live (only active subscribers watch) or an Open
// Live (public; disabled by ENABLE_OPEN_LIVE, see src/config/features.ts).
// Who may enter is decided in src/lib/liveAccess.ts and enforced by api/live-token.ts.
// Implemented by localLive.ts and supabaseLive.ts.
import type { AuthResult, User } from './types';

export type BroadcastMode = 'open' | 'subscriber';

export interface LiveBroadcast {
  id: string;
  creatorProfileId: string;
  title: string;
  startedAt: string;
  // Rows made before modes existed are open Lives.
  mode: BroadcastMode;
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
// The creator's Live page checks in this often; a Live with no check-in for
// LIVE_STALE_MINUTES is closed on the server (creator's phone died, browser crashed).
export const LIVE_HEARTBEAT_SECONDS = 30;
export const LIVE_STALE_MINUTES = 2;
// Restarting a Live within this window doesn't alert followers again.
export const LIVE_REALERT_MINUTES = 30;

export interface LiveBackend {
  // The creator's open Live, if any.
  currentLive(creatorProfileId: string): Promise<LiveBroadcast | null>;
  // Marks the signed-in creator as live. A Subscriber Live (the default) alerts the
  // creator's active subscribers; an Open Live alerts followers with the bell on and
  // is refused while Open Live is disabled.
  startLive(user: User, title: string, mode?: BroadcastMode): Promise<AuthResult & { notified?: number }>;
  endLive(user: User): Promise<AuthResult>;
  // Same as endLive, fired while the creator's tab is closing: it has no answer to
  // wait for and the request must outlive the page.
  endLiveOnExit(user: User): void;
  // The creator's check-in: true while the Live is open, false once it was closed,
  // null when the check-in couldn't be sent.
  liveHeartbeat(user: User): Promise<boolean | null>;
  // The fan's bell for a creator they follow.
  liveAlerts(creatorProfileId: string, user: User): Promise<boolean>;
  setLiveAlerts(user: User, creatorProfileId: string, on: boolean): Promise<AuthResult>;
  notifications(user: User): Promise<AppNotification[]>;
  markNotificationsRead(user: User): Promise<void>;
  // LiveKit access to a creator's Live: the owner publishes; subscribers (Subscriber
  // Live) or anyone signed in (Open Live, when enabled) watch.
  broadcastAccess(creatorProfileId: string): Promise<AuthResult & { access?: BroadcastAccess }>;
  // LiveKit access for a confirmed Reserve booking: a Reserve 1:1 lets in only its fan
  // and its creator, both with camera and microphone (host = the creator); a Reserve
  // Event seat joins the event's group room, where only the creator presents.
  callAccess(bookingId: string): Promise<AuthResult & { access?: BroadcastAccess }>;
  // Calls back when a new notification arrives for this user. Returns the unsubscribe.
  watchNotifications(userId: string, cb: () => void): () => void;
}
