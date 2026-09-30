// Supabase implementation of creator rewards. Referrals are recorded by a trigger
// at sign-up and the cut of each payment by a trigger on transactions; see
// supabase/migrations/20260930000008_creator_rewards.sql.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CreatorRewards, FeaturedCreator, LevelId, RewardsBackend } from './rewardTypes';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const EMPTY: CreatorRewards = { level: 'bronce', activeFans: 0, share: 0.8, bonus: 0, attractedThisMonth: 0, attractedLastMonth: 0, referrals: [] };

export const createSupabaseRewards = (sb: SupabaseClient): RewardsBackend => ({
  async myRewards() {
    const { data, error } = await sb.rpc('my_creator_rewards');
    if (error || !data) return EMPTY;
    const r = data as Row;
    return {
      level: r.level,
      activeFans: r.active_fans,
      share: Number(r.share),
      bonus: Number(r.bonus),
      attractedThisMonth: r.attracted_this_month,
      attractedLastMonth: r.attracted_last_month,
      referrals: (r.referrals as Row[]).map((f) => ({ name: f.name, joinedAt: f.joined_at, paid: f.paid, referralUntil: f.referral_until })),
    };
  },

  async levels(ids) {
    if (!ids.length) return {};
    const { data } = await sb.rpc('creator_levels', { p_ids: ids });
    return Object.fromEntries(((data ?? []) as Row[]).map((r) => [r.creator_profile_id, r.level as LevelId]));
  },

  async featured() {
    const { data } = await sb.rpc('featured_creators');
    return ((data ?? []) as Row[]).map((r): FeaturedCreator => ({ creatorProfileId: r.creator_profile_id, level: r.level, reason: r.reason }));
  },
});
