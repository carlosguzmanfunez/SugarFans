// Current offer for NEW income. A transaction's saved allocation always wins.
export const REVENUE_POLICY = 'revenue-70-30-v1';
export const LEGACY_REVENUE_POLICY = 'revenue-80-20-v1';
export const BASE_CREATOR_SHARE = 0.70;
export const BASE_PLATFORM_SHARE = 0.30;
export const LEGACY_CREATOR_SHARE = 0.80;
export const PROVIDER_RESERVE_PERCENT = 15;

export const originalCreatorAmount = (t: {
  amount: number; share?: number; creatorInitialAmount?: number; kind?: string;
}) => t.creatorInitialAmount ?? t.amount * (t.share ??
  (t.kind === 'gift' ? 0.60 : t.kind === 'referral' ? 1 : LEGACY_CREATOR_SHARE));
