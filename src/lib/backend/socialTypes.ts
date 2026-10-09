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
  // Only its author (and admins) get drafts: they go public once the creator is verified.
  isDraft?: boolean;
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
  uploadMedia(user: User, file: File): Promise<AuthResult & { media?: MediaUpload }>;
  removeMedia(user: User, path: string): Promise<void>;
  publicCreator(creatorProfileId: string): Promise<PublicCreator | null>;
  // Every creator who signed up (the demo catalogue is listed by the app itself).
  publicCreators(): Promise<PublicCreator[]>;
  // Creator profile id → country code, for creators who set one (demo creators
  // have a test country). Public: nothing else about the account is exposed.
  creatorCountries(): Promise<Record<string, string>>;
  followState(creatorProfileId: string, viewer: User | null): Promise<FollowState>;
  setFollow(user: User, creatorProfileId: string, follow: boolean): Promise<AuthResult>;
}
