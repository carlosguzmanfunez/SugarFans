// Types and backend contract for Terrones (coin packs), gifts, the creator's
// Círculo privado and Bóveda, and the video / video-call perks. Implemented by
// localGifts.ts and supabaseGifts.ts.
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
  status: 'paid' | 'refunded';
  createdAt: string;
}

export interface CreatorGiftSettings {
  circleMin: number; // USD a fan must gift to join the Círculo
  offersVideo: boolean;
  offersCall: boolean;
}

export interface CircleStatus {
  circleUntil?: string;
  vaultUntil?: string;
  owner: boolean; // the creator (or an admin) always has access
}

export interface TopFan {
  name: string;
  value: number; // USD gifted this month
}

export interface CircleMessage {
  id: string;
  creatorProfileId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  body: string;
  fromCreator: boolean;
  createdAt: string;
}

export interface VaultItem {
  id: string;
  creatorProfileId: string;
  title: string;
  mediaPath: string;
  mediaType: MediaUpload['type'];
  mediaUrl?: string;
  createdAt: string;
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
  topFans(creatorProfileId: string): Promise<TopFan[]>;
  circleStatus(user: User | null, creatorProfileId: string): Promise<CircleStatus>;
  circleMessages(user: User, creatorProfileId: string): Promise<CircleMessage[]>;
  postCircleMessage(user: User, creatorProfileId: string, body: string): Promise<AuthResult>;
  vaultItems(user: User, creatorProfileId: string): Promise<VaultItem[]>;
  addVaultItem(user: User, title: string, media: MediaUpload): Promise<AuthResult>;
  deleteVaultItem(user: User, id: string): Promise<AuthResult>;
  // Perks the fan is owed (fan) or owes (creator). Refunds the overdue ones first.
  perkRequests(user: User): Promise<PerkRequest[]>;
  deliverVideo(user: User, perkId: string, media: MediaUpload): Promise<AuthResult>;
  scheduleCall(user: User, perkId: string, date: string, time: string): Promise<AuthResult>;
}
