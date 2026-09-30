// Types and backend contract for post engagement (likes, comments), photo and
// video uploads, public creator cards and live VIP rooms. Implemented by
// localSocial.ts and supabaseSocial.ts.
import type { AuthResult, User } from './types';

export type MediaType = 'image' | 'video';

export interface MediaUpload {
  path: string; // "<author id>/<uuid>.<ext>"
  type: MediaType;
}

// A post a creator published from their panel.
export interface FeedPost {
  id: string;
  creatorProfileId: string;
  authorId: string;
  content: string;
  isLocked: boolean;
  createdAt: string;
  mediaType?: MediaType;
  mediaPath?: string;
  // Missing when the viewer may not see the file (locked post, not subscribed).
  mediaUrl?: string;
}

export interface Engagement {
  likes: number;
  comments: number;
  likedByMe: boolean;
}

export interface PostComment {
  id: string;
  postId: string;
  creatorProfileId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  body: string;
  createdAt: string;
}

// Creators who signed up (the demo catalogue lives in data/mockData.ts).
export interface PublicCreator {
  id: string;
  name: string;
  avatar: string;
  bio: string;
  isVerified: boolean;
  subscriptionPrice: number;
  posts: number;
  createdAt: string;
}

// Messages exchanged in a live room: WebRTC handshake plus chat.
export type LiveSignal =
  | { type: 'hello' | 'bye' }
  | { type: 'offer' | 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit }
  | { type: 'chat'; text: string; name: string; at: string }
  | { type: 'gift'; giftId: string; name: string };

export type LiveMessage = LiveSignal & { from: string };

export interface LiveChannel {
  send(signal: LiveSignal): void;
  close(): void;
}

export interface SocialBackend {
  postsByCreator(creatorProfileId: string): Promise<FeedPost[]>;
  engagement(postIds: string[], viewer: User | null): Promise<Record<string, Engagement>>;
  setLike(user: User, postId: string, liked: boolean): Promise<AuthResult>;
  comments(postId: string): Promise<PostComment[]>;
  addComment(user: User, postId: string, creatorProfileId: string, body: string): Promise<AuthResult>;
  deleteComment(user: User, commentId: string): Promise<AuthResult>;
  uploadMedia(user: User, file: File): Promise<AuthResult & { media?: MediaUpload }>;
  removeMedia(user: User, path: string): Promise<void>;
  publicCreator(creatorProfileId: string): Promise<PublicCreator | null>;
  // Every creator who signed up (the demo catalogue is listed by the app itself).
  publicCreators(): Promise<PublicCreator[]>;
  // Joins the private room of a confirmed VIP booking (fan or creator only).
  joinLive(user: User, bookingId: string, onMessage: (m: LiveMessage) => void): Promise<AuthResult & { channel?: LiveChannel }>;
}
