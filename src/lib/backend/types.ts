// Shared domain types and the contract every data backend implements.
import type { PlatformBackend } from './platformTypes';
import type { MediaUpload, SocialBackend } from './socialTypes';
import type { GiftsBackend } from './giftTypes';
import type { RewardsBackend } from './rewardTypes';
import type { LiveBackend } from './liveTypes';
import type { SpecialBackend } from './specialTypes';
import type { ApprovalMode, CancellationPolicyId, LocationType, PurposeId, ReserveModality } from '../../config/reserve';
export type * from './platformTypes';
export type * from './socialTypes';
export type * from './giftTypes';

// Two backends exist: Supabase (real, shared across devices) and a local
// browser-only one used when Supabase is not configured (dev, tests).

export type UserRole = 'fan' | 'creator' | 'admin';

// Sign-in buttons: Google, and Microsoft (Supabase calls it "azure").
export type SocialProvider = 'google' | 'azure';

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
  // How the user signs in: 'email' (password), 'google' or 'azure' (Microsoft).
  authProvider?: string;
  // False right after a Google/Microsoft sign-up, until the user picks fan or
  // creator and accepts the terms (18+).
  signupCompleted?: boolean;
  // ISO country code chosen at sign-up ('ZZ' = other), and the optional phone in
  // international format (+50499998888). Private: only the user and admins see them.
  country?: string;
  phone?: string;
}

// Asked at sign-up besides name, email and password.
export interface SignupExtras {
  country?: string;
  phone?: string;
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

// pending: waiting for the creator · countered: the creator proposed other
// terms, waiting for the fan · accepted: waiting for the fan's payment ·
// confirmed: paid, confirmation email sent · rejected / cancelled: closed ·
// expired: nobody answered within RESERVE_RESPONSE_HOURS (nothing was charged).
// reschedule_requested, completed and disputed are reserved for the next phase
// (the database accepts them; "realizada" is derived from the date for now).
export type BookingStatus =
  | 'pending'
  | 'countered'
  | 'accepted'
  | 'confirmed'
  | 'rejected'
  | 'cancelled'
  | 'reschedule_requested'
  | 'completed'
  | 'disputed'
  | 'expired';

// Terms a creator proposes instead of the requested ones.
export interface CounterOffer {
  price: number;
  date: string;
  time: string;
  durationMinutes?: number;
  note: string;
  at: string;
}

// What a Reserve booking was for (vip_bookings.details). Empty on bookings made
// before Reserve: those are virtual, for one person.
export interface BookingDetails {
  // event = one seat in a Reserve Event (same day and time for every participant).
  kind?: 'experience' | 'custom' | 'event';
  typeId?: string;
  modality?: ReserveModality;
  purpose?: PurposeId;
  participants?: number;
  locationType?: LocationType;
  city?: string;
  venue?: string;
  // Price before a subscriber discount, and the discount applied.
  listPrice?: number;
  discountPercent?: number;
  counter?: CounterOffer;
  // Moderation flags for the creator's review (never blocking ones).
  flags?: string[];
  // Booked with a Meta de experiencia ticket (no payment), and the wheel's extra.
  ticketId?: string;
  ticketBonus?: string;
}

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
  // Minutes of the experience (the live video session when it is virtual).
  durationMinutes?: number;
  details?: BookingDetails;
  // When the creator first saw the request (the fan sees "Vista").
  seenAt?: string;
  // Deadline to answer a pending request (creator) or a counter-offer (fan);
  // past it the booking becomes 'expired'.
  respondBy?: string;
}

// The creator, title and price come from the experience itself (server side).
export interface BookingInput {
  experienceId: string;
  date: string;
  time: string;
  message: string;
  participants?: number;
}

// "Solicitar experiencia personalizada": a structured proposal to a creator.
export interface CustomRequestInput {
  creatorProfileId: string;
  modality: ReserveModality;
  purpose: PurposeId;
  purposeNote: string;
  date: string;
  time: string;
  durationMinutes: number;
  participants: number;
  locationType: LocationType;
  city: string;
  venue: string;
  budget: number;
  message: string;
}

export interface CounterInput {
  price: number;
  date: string;
  time: string;
  durationMinutes?: number;
  note: string;
}

export type ReserveFormat = 'private' | 'event';

// The five original ids plus the Reserve catalogue (src/config/reserve.ts).
export type ExperienceType = string;

// How an experience is offered (vip_experiences.details). Experiences created
// before Reserve have none: they read as virtual, online, manual approval.
export interface ReserveDetails {
  modality: ReserveModality;
  locationTypes: LocationType[];
  city?: string;
  venue?: string;
  includes: string[];
  excludes: string[];
  requirements: { verifiedFans: boolean; subscribersOnly: boolean; notes?: string };
  minNoticeHours: number;
  maxParticipants: number;
  approval: ApprovalMode;
  cancellationPolicy: CancellationPolicyId;
  conditions?: string;
  // Explicit subscriber perk: % off this experience.
  subscriberDiscount?: number;
  // Days (0–6) and hours this experience can be booked, within the creator's availability.
  days?: number[];
  hours?: string[];
  // 'event' = Reserve Event: a group experience on a fixed day and time where each fan
  // books one seat (maxParticipants = seats). Absent or 'private' = Reserve 1:1 or
  // another private experience, booked on the creator's calendar.
  format?: ReserveFormat;
  eventDate?: string; // YYYY-MM-DD, creator's local time
  eventTime?: string; // HH:MM
}

export interface VipExperienceInput {
  title: string;
  description: string;
  type: ExperienceType;
  price: number;
  // Minutes of the experience; undefined for delivered content without a session.
  durationMinutes?: number;
  image: string;
  active: boolean;
  details?: ReserveDetails;
}

export interface VipExperience extends VipExperienceInput {
  id: string;
  creatorProfileId: string;
  creatorName: string;
  createdAt: string;
}

export type ProfilePatch = Partial<Pick<User, 'name' | 'email' | 'avatar' | 'bio' | 'subscriptionPrice' | 'settings' | 'ageVerified' | 'country' | 'phone'>>;

export interface Backend {
  mode: 'supabase' | 'local';
  // The signed-in session's token for the app's own server functions (null in the local store).
  accessToken(): Promise<string | null>;
  getCurrentUser(): Promise<User | null>;
  // Fires when the session or the signed-in user's data may have changed elsewhere.
  onChange(cb: () => void): () => void;
  login(email: string, password: string, remember: boolean): Promise<AuthResult>;
  register(name: string, email: string, password: string, role: UserRole, ref?: string, extras?: SignupExtras): Promise<AuthResult & { needsConfirmation?: boolean }>;
  // Leaves the site for the provider's sign-in page; comes back to `redirectTo`.
  signInWithProvider(provider: SocialProvider, redirectTo: string): Promise<AuthResult>;
  // Finishes a Google/Microsoft sign-up: account type, 18+ and terms.
  completeSocialSignup(role: UserRole, ref?: string, extras?: SignupExtras): Promise<AuthResult>;
  logout(): Promise<void>;
  updateProfile(user: User, patch: ProfilePatch): Promise<AuthResult>;
  changePassword(user: User, current: string, next: string): Promise<AuthResult>;
  // `password` is ignored for Google/Microsoft accounts, which have none.
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
  // Reserve Event: one seat for the signed-in fan (day and time come from the event).
  bookEventSeat(user: User, experienceId: string, message: string): Promise<AuthResult>;
  // Seats already held per event (pending, accepted or confirmed), without who holds them.
  eventSeats(experienceIds: string[]): Promise<Record<string, number>>;
  // Creator accepts/rejects, fan cancels. Paying goes through payBooking.
  updateBooking(user: User, bookingId: string, next: BookingStatus): Promise<AuthResult>;
  // Reserve: a fan's structured custom request, the creator's counter-offer
  // (other price, date, time or duration, or a request for changes) and the fan's answer.
  requestCustomExperience(user: User, input: CustomRequestInput): Promise<AuthResult>;
  counterOffer(user: User, bookingId: string, input: CounterInput): Promise<AuthResult>;
  respondCounter(user: User, bookingId: string, accept: boolean): Promise<AuthResult>;
  // Charges an accepted booking to a saved payment method and confirms it.
  payBooking(user: User, bookingId: string, methodId: string): Promise<AuthResult>;
  // Active experiences of every creator, plus the signed-in creator's inactive ones.
  listExperiences(): Promise<VipExperience[]>;
  saveExperience(user: User, input: VipExperienceInput, id?: string): Promise<AuthResult>;
  deleteExperience(user: User, id: string): Promise<AuthResult>;
  fanBookings(fanId: string): Promise<VipBooking[]>;
  // The creator opened their requests: the waiting ones count as seen.
  markBookingsSeen(user: User): Promise<void>;
  // This device's Web Push subscription (phone alerts), tied to the signed-in person.
  savePushSubscription(sub: { endpoint: string; p256dh: string; auth: string }): Promise<AuthResult>;
  deletePushSubscription(endpoint: string): Promise<void>;
  creatorBookings(creatorProfileId: string): Promise<VipBooking[]>;

  // Verification, payments, payouts, reports and blocks (see platformTypes.ts).
  platform: PlatformBackend;
  // Likes, comments, uploads and live rooms (see socialTypes.ts).
  social: SocialBackend;
  // Terrones, gifts and gift perks (see giftTypes.ts).
  gifts: GiftsBackend;
  // Creator rewards: referral link, levels, monthly goals, featured (see rewardTypes.ts).
  rewards: RewardsBackend;
  // Special accounts: admin links with Reserve al neto and extra visibility (see specialTypes.ts).
  special: SpecialBackend;
  // Free Live state, the fans' bell and their notifications (see liveTypes.ts).
  live: LiveBackend;
}
