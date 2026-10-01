// Shared domain types and the contract every data backend implements.
import type { PlatformBackend } from './platformTypes';
import type { MediaUpload, SocialBackend } from './socialTypes';
import type { GiftsBackend } from './giftTypes';
import type { RewardsBackend } from './rewardTypes';
export type * from './platformTypes';
export type * from './socialTypes';
export type * from './giftTypes';

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
  // Set when the fan cancelled: access lasts until this date, then it ends.
  cancelAt?: string;
}

export interface CreatorPost {
  id: string;
  content: string;
  isLocked: boolean;
  createdAt: string;
  mediaPath?: string;
  mediaType?: MediaUpload['type'];
  // Set when an admin published it as a platform-run profile.
  creatorProfileId?: string;
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
  // Minutes of the live video session, when the experience has one.
  durationMinutes?: number;
}

// The creator, title and price come from the experience itself (server side).
export interface BookingInput {
  experienceId: string;
  date: string;
  time: string;
  message: string;
}

export type ExperienceType = 'meet-greet' | 'qa-session' | 'custom-content' | 'early-access' | 'collaboration';

export interface VipExperienceInput {
  title: string;
  description: string;
  type: ExperienceType;
  price: number;
  // Minutes of the live video session; undefined for experiences without one.
  durationMinutes?: number;
  image: string;
  active: boolean;
}

export interface VipExperience extends VipExperienceInput {
  id: string;
  creatorProfileId: string;
  creatorName: string;
  createdAt: string;
}

export type ProfilePatch = Partial<Pick<User, 'name' | 'email' | 'avatar' | 'bio' | 'subscriptionPrice' | 'settings' | 'ageVerified'>>;

export interface Backend {
  mode: 'supabase' | 'local';
  getCurrentUser(): Promise<User | null>;
  // Fires when the session or the signed-in user's data may have changed elsewhere.
  onChange(cb: () => void): () => void;
  login(email: string, password: string, remember: boolean): Promise<AuthResult>;
  register(name: string, email: string, password: string, role: UserRole, ref?: string): Promise<AuthResult & { needsConfirmation?: boolean }>;
  logout(): Promise<void>;
  updateProfile(user: User, patch: ProfilePatch): Promise<AuthResult>;
  changePassword(user: User, current: string, next: string): Promise<AuthResult>;
  deleteAccount(user: User, password: string): Promise<AuthResult>;
  // Removes a subscription at once (used when blocking a creator).
  setSubscription(user: User, creatorId: string, price: number, subscribed: boolean): Promise<AuthResult>;
  // Stops renewing; access lasts until the end of the paid month (returned as `until`).
  cancelSubscription(user: User, creatorId: string): Promise<AuthResult & { until?: string }>;
  // Emails a link to choose a new password (says nothing about whether the account exists).
  requestPasswordReset(email: string): Promise<AuthResult>;
  // Sets the new password from the emailed link (`token` is only used by the local store).
  resetPassword(password: string, token?: string): Promise<AuthResult>;
  // Admins can publish as a platform-run profile (asProfileId "m-…").
  addPost(user: User, content: string, isLocked: boolean, media?: MediaUpload, asProfileId?: string): Promise<AuthResult>;
  deletePost(user: User, postId: string): Promise<AuthResult>;
  listAccounts(): Promise<User[]>;

  getAvailability(creatorProfileId: string): Promise<Availability>;
  setAvailability(creatorProfileId: string, availability: Availability): Promise<AuthResult>;
  takenSlots(creatorProfileId: string): Promise<TakenSlot[]>;
  createBooking(user: User, input: BookingInput): Promise<AuthResult>;
  // Creator accepts/rejects, fan cancels. Paying goes through payBooking.
  updateBooking(user: User, bookingId: string, next: BookingStatus): Promise<AuthResult>;
  // Charges an accepted booking to a saved payment method and confirms it.
  payBooking(user: User, bookingId: string, methodId: string): Promise<AuthResult>;
  // Active experiences of every creator, plus the signed-in creator's inactive ones.
  listExperiences(): Promise<VipExperience[]>;
  saveExperience(user: User, input: VipExperienceInput, id?: string): Promise<AuthResult>;
  deleteExperience(user: User, id: string): Promise<AuthResult>;
  fanBookings(fanId: string): Promise<VipBooking[]>;
  creatorBookings(creatorProfileId: string): Promise<VipBooking[]>;

  // Verification, payments, payouts, reports and blocks (see platformTypes.ts).
  platform: PlatformBackend;
  // Likes, comments, uploads and live rooms (see socialTypes.ts).
  social: SocialBackend;
  // Terrones, gifts, Círculo privado and gift perks (see giftTypes.ts).
  gifts: GiftsBackend;
  // Creator rewards: referral link, levels, monthly goals, featured (see rewardTypes.ts).
  rewards: RewardsBackend;
}
