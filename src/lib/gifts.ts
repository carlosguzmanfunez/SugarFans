// UI access to Terrones, gifts, the Círculo privado, the Bóveda and gift perks.
// Mutations tell mounted screens to reload (same listener set as the platform).
import { backend } from './backend';
import type { AuthResult, User } from './backend/types';
import type { CreatorGiftSettings, MediaUpload, SendGiftInput } from './backend/types';
import { platformChanged } from './platform';

export * from './giftRules';
export type * from './backend/giftTypes';

const g = backend.gifts;
export const giftsApi = g;

const after = async <T extends AuthResult>(result: Promise<T>): Promise<T> => {
  const r = await result;
  if (r.ok) platformChanged();
  return r;
};

export const buyCoins = (user: User, packId: string, methodId: string) => after(g.buyCoins(user, packId, methodId));
export const sendGift = (user: User, input: SendGiftInput) => after(g.sendGift(user, input));
export const saveGiftSettings = (user: User, settings: CreatorGiftSettings) => after(g.saveGiftSettings(user, settings));
export const postCircleMessage = (user: User, creatorProfileId: string, body: string) => after(g.postCircleMessage(user, creatorProfileId, body));
export const addVaultItem = (user: User, title: string, media: MediaUpload) => after(g.addVaultItem(user, title, media));
export const deleteVaultItem = (user: User, id: string) => after(g.deleteVaultItem(user, id));
export const deliverVideo = (user: User, perkId: string, media: MediaUpload) => after(g.deliverVideo(user, perkId, media));
export const scheduleCall = (user: User, perkId: string, date: string, time: string) => after(g.scheduleCall(user, perkId, date, time));
