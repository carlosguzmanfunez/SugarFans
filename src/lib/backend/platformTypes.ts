// Types and backend contract for the features the Help/Pricing FAQs promise:
// identity verification, payment methods and charges, creator payouts,
// content reports and blocks. Implemented by localPlatform.ts and supabasePlatform.ts.
import type { AuthResult, User } from './types';

export type DocType = 'dni' | 'passport' | 'license';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface VerificationInput {
  legalName: string;
  birthDate: string; // YYYY-MM-DD
  country: string;
  docType: DocType;
  docNumber: string;
  docFront: string; // front of the ID, data URL (downscaled JPEG)
  selfie: string; // front-facing selfie, compared with the ID photo
}

export interface VerificationRequest extends VerificationInput {
  id: string;
  userId: string;
  userName: string;
  email: string;
  role: User['role'];
  status: ReviewStatus;
  rejectionReason?: string;
  submittedAt: string;
  reviewedAt?: string;
}

export type PaymentKind = 'card' | 'paypal' | 'google_pay';

// Only masked data: card brand + last 4, or the masked PayPal / Google account email.
export interface NewPaymentMethod {
  kind: PaymentKind;
  label: string; // "Visa •••• 4242"
  detail: string; // "Expira 12/28", "Cuenta PayPal"
}

export interface PaymentMethod extends NewPaymentMethod {
  id: string;
  userId: string;
  isDefault: boolean;
  createdAt: string;
}

export interface Transaction {
  id: string;
  payerId: string | null; // null once the payer deleted their account
  payerName: string;
  creatorProfileId: string;
  creatorName: string;
  // referral: the 5% bonus a creator earns on what a creator they invited sells.
  kind: 'subscription' | 'renewal' | 'tip' | 'gift' | 'referral';
  amount: number;
  note?: string; // the fan's message with a tip or gift
  share?: number; // creator's cut; 80% unless set (gifts pay 60%)
  giftId?: string;
  methodLabel: string;
  status: 'paid' | 'failed' | 'refunded';
  createdAt: string;
}

export interface PayoutAccount {
  holder: string;
  bank: string;
  accountLast4: string;
}

export interface Payout {
  id: string;
  userId: string;
  creatorName: string;
  amount: number;
  accountLabel: string;
  // Paid at once when the creator withdraws (always the whole credited balance).
  status: 'paid';
  availableBefore: number; // balance the creator had when withdrawing
  requestedAt: string;
  paidAt: string;
}

export type ReportKind = 'post' | 'creator' | 'support' | 'other';

export interface ReportInput {
  kind: ReportKind;
  targetId?: string;
  targetLabel: string;
  reason: string;
  description: string;
  contactEmail?: string;
}

export interface Report extends ReportInput {
  id: string;
  reporterId?: string;
  reporterName: string;
  status: 'pending' | 'resolved' | 'dismissed';
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface Block {
  blockerId: string;
  // Set when a creator blocks someone, so fans can tell which public profile blocked them.
  blockerProfileId?: string;
  targetId: string; // a user id, or a public creator profile id
  targetName: string;
  createdAt: string;
}

export interface Subscriber {
  id: string;
  name: string;
  avatar: string;
  since: string;
}

// A creator profile run by the platform itself (admins/owners), e.g. an AI-generated
// persona. It needs no identity verification because no real person is behind it;
// AI personas carry a small "P-IA" tag.
export interface ManagedProfileInput {
  name: string;
  username: string;
  bio: string;
  avatar: string; // URL or downscaled data URL
  cover: string;
  category: string;
  subscriptionPrice: number;
  isAi: boolean;
}

export interface ManagedProfile extends ManagedProfileInput {
  id: string; // "m-…", used as the creator profile id everywhere else
  hidden: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformBackend {
  myVerification(userId: string): Promise<VerificationRequest | null>;
  submitVerification(user: User, input: VerificationInput): Promise<AuthResult>;
  listVerifications(): Promise<VerificationRequest[]>; // admin
  reviewVerification(id: string, approve: boolean, reason: string): Promise<AuthResult>; // admin

  paymentMethods(userId: string): Promise<PaymentMethod[]>;
  addPaymentMethod(user: User, method: NewPaymentMethod): Promise<AuthResult & { id?: string }>;
  removePaymentMethod(user: User, id: string): Promise<AuthResult>;
  setDefaultPaymentMethod(user: User, id: string): Promise<AuthResult>;
  // Charges the method and starts the subscription in one step.
  subscribeAndPay(user: User, creatorProfileId: string, creatorName: string, price: number, methodId: string): Promise<AuthResult>;
  // Bills every monthly cycle that came due since each subscription started (idempotent).
  billDueRenewals(user: User, creatorNames: Record<string, string>): Promise<void>;
  // One-off tip to a creator (optionally for a post), charged to a saved method.
  sendTip(user: User, creatorProfileId: string, creatorName: string, amount: number, methodId: string, postId?: string, message?: string): Promise<AuthResult>;
  myPayments(userId: string): Promise<Transaction[]>;
  creatorSales(creatorProfileId: string): Promise<Transaction[]>;
  allPayments(): Promise<Transaction[]>; // admin
  mySubscribers(user: User): Promise<Subscriber[]>;

  payoutAccount(userId: string): Promise<PayoutAccount | null>;
  setPayoutAccount(user: User, account: PayoutAccount): Promise<AuthResult>;
  myPayouts(userId: string): Promise<Payout[]>;
  // Withdraws the whole credited balance (minimum $50); returns the amount paid.
  requestPayout(user: User): Promise<AuthResult & { amount?: number }>;
  listPayouts(): Promise<Payout[]>; // admin

  submitReport(reporter: User | null, input: ReportInput): Promise<AuthResult>;
  listReports(): Promise<Report[]>; // admin
  resolveReport(id: string, action: 'remove' | 'resolve' | 'dismiss'): Promise<AuthResult>; // admin
  removedPosts(): Promise<string[]>;
  restorePost(postId: string): Promise<AuthResult>; // admin

  // Blocks the user made and blocks that target them.
  blocks(user: User): Promise<Block[]>;
  block(user: User, targetId: string, targetName: string): Promise<AuthResult>;
  unblock(user: User, targetId: string): Promise<AuthResult>;

  // Platform-run profiles: anyone reads the visible ones, only admins manage them.
  managedProfiles(includeHidden?: boolean): Promise<ManagedProfile[]>;
  saveManagedProfile(admin: User, input: ManagedProfileInput, id?: string): Promise<AuthResult & { id?: string }>;
  setManagedProfileHidden(admin: User, id: string, hidden: boolean): Promise<AuthResult>;
  deleteManagedProfile(admin: User, id: string): Promise<AuthResult>;

}
