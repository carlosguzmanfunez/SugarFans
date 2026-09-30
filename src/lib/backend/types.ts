// Shared domain types and the contract every data backend implements.
import type { PlatformBackend } from './platformTypes';
import type { MediaUpload, SocialBackend } from './socialTypes';
export type * from './platformTypes';
export type * from './socialTypes';

// Two backends exist: Supabase (real, shared across devices) and a local
// browser-only one used when Supabase is not configured (dev, tests).

export type UserRole = 'fan' | 'creator' | 'admin';

export interface UserSettings {
  notifications: Record<string, boolean>;
  privacy: {
    profileVisible: boolean;
    showActivity: boolean;
    contentProtection: boolean;
  };
  twoFactor: boolean;
  category?: string;
}

export interface Subscription {
  creatorId: string;
  price: number;
  since: string;
}

export interface CreatorPost {
  id: string;
  content: string;
  isLocked: boolean;
  createdAt: string;
  mediaPath?: string;
  mediaType?: MediaUpload['type'];
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar: string;
  cover?: string;
  bio?: string;
  isVerified?: boolean;
  subscriptionPrice?: number;
  followers?: number;
  following?: number;
  posts?: number;
  ageVerified?: boolean;
  createdAt: string;
  settings: UserSettings;
  subscriptions: Subscription[];
  // Links a creator account to its public creator profile / VIP experiences.
  creatorProfileId?: string;
  createdPosts: CreatorPost[];
}

export interface AuthResult {
  ok: boolean;
  error?: string;
  // Extra information for the user (e.g. "check your inbox").
  notice?: string;
}

export interface Availability {
  days: number[]; // 0 = Sunday … 6 = Saturday
  hours: string[]; // "HH:00"
}

export interface TakenSlot {
  date: string;
  time: string;
}

// pending: waiting for the creator · accepted: waiting for the fan's payment
// confirmed: paid, confirmation email sent · rejected / cancelled: closed
export type BookingStatus = 'pending' | 'accepted' | 'confirmed' | 'rejected' | 'cancelled';

export interface VipBooking {
  id: string;
  experienceId: string;
  creatorProfileId: string;
  title: string;
  creatorName: string;
  price: number;
  fanId: string;
  fanName: string;
  fanEmail: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:00
  message: string;
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
  emailSentAt?: string;
}

export interface BookingInput {
  experienceId: string;
  creatorProfileId: string;
  title: string;
  creatorName: string;
  price: number;
  date: string;
  time: string;
  message: string;
}

export type ProfilePatch = Partial<Pick<User, 'name' | 'email' | 'avatar' | 'bio' | 'subscriptionPrice' | 'settings' | 'ageVerified'>>;

export interface Backend {
  mode: 'supabase' | 'local';
  getCurrentUser(): Promise<User | null>;
  // Fires when the session or the signed-in user's data may have changed elsewhere.
  onChange(cb: () => void): () => void;
  login(email: string, password: string, remember: boolean): Promise<AuthResult>;
  register(name: string, email: string, password: string, role: UserRole): Promise<AuthResult & { needsConfirmation?: boolean }>;
  logout(): Promise<void>;
  updateProfile(user: User, patch: ProfilePatch): Promise<AuthResult>;
  changePassword(user: User, current: string, next: string): Promise<AuthResult>;
  deleteAccount(user: User, password: string): Promise<AuthResult>;
  setSubscription(user: User, creatorId: string, price: number, subscribed: boolean): Promise<AuthResult>;
  addPost(user: User, content: string, isLocked: boolean, media?: MediaUpload): Promise<AuthResult>;
  deletePost(user: User, postId: string): Promise<AuthResult>;
  listAccounts(): Promise<User[]>;

  getAvailability(creatorProfileId: string): Promise<Availability>;
  setAvailability(creatorProfileId: string, availability: Availability): Promise<AuthResult>;
  takenSlots(creatorProfileId: string): Promise<TakenSlot[]>;
  createBooking(user: User, input: BookingInput): Promise<AuthResult>;
  updateBooking(user: User, bookingId: string, next: BookingStatus): Promise<AuthResult>;
  fanBookings(fanId: string): Promise<VipBooking[]>;
  creatorBookings(creatorProfileId: string): Promise<VipBooking[]>;

  // Verification, payments, payouts, reports and blocks (see platformTypes.ts).
  platform: PlatformBackend;
  // Likes, comments, uploads and live rooms (see socialTypes.ts).
  social: SocialBackend;
}
