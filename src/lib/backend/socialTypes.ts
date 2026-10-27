// Types and backend contract for post engagement (likes, comments), photo and
// video uploads, public creator cards and live VIP rooms. Implemented by
// localSocial.ts and supabaseSocial.ts.
import type { AuthResult, User } from './types';
import type { SocialLinks } from '../creatorLinks';

export type MediaType = 'image' | 'video';

export interface MediaUpload {
  path: string; // "<author id>/<uuid>.<ext>"
  type: MediaType;
  // Automatic moderation: only "approved" files are shown to anyone else.
  moderation?: ModerationStatus;
}

// pending: not scanned yet · review: an admin decides · rejected: never shown.
export type ModerationStatus = 'pending' | 'review' | 'approved' | 'rejected';

// A file in the admin's "Moderación" tab.
export interface ModerationItem {
  bucket: 'post-media' | 'profile-images';
  path: string;
  ownerId: string;
  ownerName: string;
  kind: 'post' | 'perk_video' | 'avatar' | 'cover';
  mediaType: MediaType;
  status: ModerationStatus;
  reason: string;
  provider: string;
  createdAt: string;
  // Short-lived link for the admin's preview.
  previewUrl?: string;
}

// A production error in the admin's "Errores" tab: the same error within one
// hour is one row with a counter.
export interface AppError {
  id: string;
  source: 'web' | 'api' | 'email';
  message: string;
  detail: string;
  url: string;
  userAgent: string;
  userName: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
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
  // Only its author (and admins) get drafts: they go public once the creator is verified.
  isDraft?: boolean;
  // Only its author (and admins) see it while it isn't approved.
  moderation?: ModerationStatus;
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
  // The creator's category (settings.category); empty when not set.
  category?: string;
  // Cover photo; empty means the generated cover art.
  cover?: string;
  // Their own @usuario (fansreserve.com/@usuario).
  username?: string;
}

// Follow: free, public. Following a creator never grants paid content or Reserve.
export interface FollowState {
  following: boolean;
  // People who follow through the app (demo profiles add their catalogue count).
  count: number;
}

export interface SocialBackend {
  postsByCreator(creatorProfileId: string): Promise<FeedPost[]>;
  engagement(postIds: string[], viewer: User | null): Promise<Record<string, Engagement>>;
  setLike(user: User, postId: string, liked: boolean): Promise<AuthResult>;
  comments(postId: string): Promise<PostComment[]>;
  addComment(user: User, postId: string, creatorProfileId: string, body: string): Promise<AuthResult>;
  deleteComment(user: User, commentId: string): Promise<AuthResult>;
  uploadMedia(user: User, file: File, kind?: 'post' | 'perk_video'): Promise<AuthResult & { media?: MediaUpload }>;
  removeMedia(user: User, path: string): Promise<void>;
  publicCreator(creatorProfileId: string): Promise<PublicCreator | null>;
  // Every creator who signed up (the demo catalogue is listed by the app itself).
  publicCreators(): Promise<PublicCreator[]>;
  // A creator's @usuario and social networks (empty for the demo catalogue).
  creatorLinks(creatorProfileId: string): Promise<{ username?: string; socials: SocialLinks }>;
  // Creator profile id → country code, for creators who set one (demo creators
  // have a test country). Public: nothing else about the account is exposed.
  creatorCountries(): Promise<Record<string, string>>;
  followState(creatorProfileId: string, viewer: User | null): Promise<FollowState>;
  setFollow(user: User, creatorProfileId: string, follow: boolean): Promise<AuthResult>;
  // Creator profile ids the user follows (their own follows only).
  myFollows(user: User): Promise<string[]>;
}
