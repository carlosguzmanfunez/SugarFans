// UI access to the platform features (verification, payments, payouts, reports,
// blocks). Data goes through the backend (Supabase or the local store); every
// mutation here tells mounted screens to reload.
import { useEffect } from 'react';
import { backend } from './backend';
import { useBackendData } from './useBackendData';
import type { AuthResult, User } from './backend/types';
import type { Block, ManagedProfileInput, PayoutAccount, ReportInput, VerificationInput } from './backend/platformTypes';
import { buildPaymentMethod, buildPayoutAccount, type PaymentMethodInput } from './platformRules';

export * from './platformRules';
export type * from './backend/platformTypes';

const p = backend.platform;
const listeners = new Set<() => void>();
export const platformChanged = () => listeners.forEach((l) => l());

const after = async <T extends AuthResult>(result: Promise<T>): Promise<T> => {
  const r = await result;
  if (r.ok) platformChanged();
  return r;
};

// Like useBackendData, but also reloads after any platform mutation.
export function usePlatformQuery<T>(load: () => Promise<T>, deps: unknown[], initial: T) {
  const query = useBackendData(load, deps, initial);
  const { reload } = query;
  useEffect(() => {
    listeners.add(reload);
    return () => {
      listeners.delete(reload);
    };
  }, [reload]);
  return query;
}

export const submitVerification = (user: User, input: VerificationInput) => after(p.submitVerification(user, input));
export const reviewVerification = (id: string, approve: boolean, reason = '') => after(p.reviewVerification(id, approve, reason));

export const addPaymentMethod = async (user: User, input: PaymentMethodInput): Promise<AuthResult & { id?: string }> => {
  const built = buildPaymentMethod(input);
  if (!built.method) return { ok: false, error: built.error };
  return after(p.addPaymentMethod(user, built.method));
};
export const removePaymentMethod = (user: User, id: string) => after(p.removePaymentMethod(user, id));
export const setDefaultPaymentMethod = (user: User, id: string) => after(p.setDefaultPaymentMethod(user, id));

export const setPayoutAccount = async (user: User, paypalEmail: string): Promise<AuthResult> => {
  const built = buildPayoutAccount(paypalEmail);
  if (!built.account) return { ok: false, error: built.error };
  return after(p.setPayoutAccount(user, built.account as PayoutAccount));
};
export const requestPayout = (user: User) => after(p.requestPayout(user));
export const cancelPayout = (user: User, payoutId: string) => after(p.cancelPayout(user, payoutId));

export const submitReport = (reporter: User | null, input: ReportInput) => after(p.submitReport(reporter, input));
export const resolveReport = (id: string, action: 'remove' | 'resolve' | 'dismiss') => after(p.resolveReport(id, action));
export const restorePost = (postId: string) => after(p.restorePost(postId));
export const coverRefund = (transactionId: string, cover: boolean) => after(p.coverRefund(transactionId, cover));

export const saveManagedProfile = (admin: User, input: ManagedProfileInput, id?: string) => after(p.saveManagedProfile(admin, input, id));
export const setManagedProfileHidden = (admin: User, id: string, hidden: boolean) => after(p.setManagedProfileHidden(admin, id, hidden));
export const deleteManagedProfile = (admin: User, id: string) => after(p.deleteManagedProfile(admin, id));

export const blockUser = (user: User, targetId: string, targetName: string) => after(p.block(user, targetId, targetName));
export const unblockUser = (user: User, targetId: string) => after(p.unblock(user, targetId));

// A fan and a creator profile are cut off when either blocked the other.
export const iBlocked = (blocks: Block[], me: string, targetId: string) => blocks.some((b) => b.blockerId === me && b.targetId === targetId);
export const blockedByProfile = (blocks: Block[], me: string, creatorProfileId: string) =>
  blocks.some((b) => b.targetId === me && b.blockerProfileId === creatorProfileId);
export const isCutOff = (blocks: Block[], me: string, creatorProfileId: string) =>
  iBlocked(blocks, me, creatorProfileId) || blockedByProfile(blocks, me, creatorProfileId);

export const platformApi = p;

// GDPR export: everything the platform keeps about the user (without document images).
export const exportUserData = async (user: User) => {
  const [verification, paymentMethods, payments, payoutAccount, payouts, blocks] = await Promise.all([
    p.myVerification(user.id),
    p.paymentMethods(user.id),
    p.myPayments(user.id),
    p.payoutAccount(user.id),
    p.myPayouts(user.id),
    p.blocks(user),
  ]);
  const { docFront: _f, selfie: _s, ...verificationData } = verification ?? ({} as Record<string, unknown>);
  return {
    exportedAt: new Date().toISOString(),
    account: user,
    identityVerification: verification ? verificationData : null,
    paymentMethods,
    payments,
    payoutAccount,
    payouts,
    blockedUsers: blocks.filter((b) => b.blockerId === user.id),
  };
};
