// Types and backend contract for Terrones (coin packs), gifts, the creator's gift
// settings and the video / video-call perks earned before gift perks were retired.
// Implemented by localGifts.ts and supabaseGifts.ts.
import type { AuthResult, User } from './types';
import type { MediaUpload } from './socialTypes';

export type GiftCategory = 'Dulces' | 'Repostería' | 'Romance' | 'Lujo' | 'Fantasía';

export interface Gift {
  id: string;
  name: string;
  category: GiftCategory;
  coins: number;
  icon: string;
}

export interface CoinPack {
  id: string;
  name: string;
  price: number; // what the fan pays (USD)
  coins: number;
}

export interface CoinPurchase {
  id: string;
  userId: string;
  packId: string;
  coins: number;
  price: number;
  methodLabel: string;
  createdAt: string;
}

export interface Wallet {
  coins: number;
  purchases: CoinPurchase[];
  spentToday: number; // USD bought in the last 24 hours
}

// A gift the fan sent (the creator sees it among their sales).
export interface SentGift {
  id: string;
  creatorProfileId: string;
  creatorName: string;
  giftId: string;
  coins: number;
  status: 'paid' | 'refunded' | 'disputed';
  createdAt: string;
}

export interface CreatorGiftSettings {
  circleMin: number; // USD a fan must gift to join the Círculo
  offersVideo: boolean;
  offersCall: boolean;
}

export type PerkKind = 'video' | 'call';
export type PerkStatus = 'pending' | 'scheduled' | 'delivered' | 'refunded';

export interface PerkRequest {
  id: string;
  transactionId: string;
  fanId: string;
  fanName: string;
  creatorProfileId: string;
  creatorName: string;
  kind: PerkKind;
  request: string;
  status: PerkStatus;
  dueAt: string;
  createdAt: string;
  deliveredAt?: string;
  mediaPath?: string;
  mediaType?: MediaUpload['type'];
  mediaUrl?: string;
  bookingId?: string;
}

export interface SendGiftInput {
  creatorProfileId: string;
  creatorName: string;
  giftId: string;
  postId?: string;
  message?: string;
  request?: string; // what the fan wants in a personalised video
}

export interface GiftsBackend {
  wallet(user: User): Promise<Wallet>;
  buyCoins(user: User, packId: string, methodId: string): Promise<AuthResult>;
  sendGift(user: User, input: SendGiftInput): Promise<AuthResult>;
  sentGifts(user: User): Promise<SentGift[]>;
  giftSettings(creatorProfileId: string): Promise<CreatorGiftSettings>;
  saveGiftSettings(user: User, settings: CreatorGiftSettings): Promise<AuthResult>;
  // Perks the fan is owed (fan) or owes (creator). Refunds the overdue ones first.
  perkRequests(user: User): Promise<PerkRequest[]>;
  deliverVideo(user: User, perkId: string, media: MediaUpload): Promise<AuthResult>;
  scheduleCall(user: User, perkId: string, date: string, time: string): Promise<AuthResult>;
}
