// Types and backend contract for creator rewards (referral link, levels, monthly
// goals and featured spots). Implemented by localRewards.ts and supabaseRewards.ts.
import type { User } from './types';

export type LevelId = 'bronce' | 'plata' | 'oro' | 'diamante';

export interface ReferredFan {
  name: string;
  joinedAt: string;
  paid: boolean; // has paid the creator, so it counts for the goals
  referralUntil: string; // end of the 90 days at 90%
}

export interface InvitedCreator {
  name: string;
  joinedAt: string;
  until: string; // end of the 12 months with the 5% bonus
  bonus: number; // earned so far (USD)
}

export interface CreatorRewards {
  level: LevelId;
  activeFans: number;
  share: number; // current cut for fans not covered by a referral
  bonus: number; // goal bonus in force this month
  attractedThisMonth: number;
  attractedLastMonth: number;
  referrals: ReferredFan[];
  invitedCreators: InvitedCreator[];
}

export interface FeaturedCreator {
  creatorProfileId: string;
  level: LevelId;
  reason: 'level' | 'goal';
}

export interface RewardsBackend {
  // The creator's own dashboard.
  myRewards(user: User): Promise<CreatorRewards>;
  // Public: level of each creator profile (Bronce when unknown).
  levels(creatorProfileIds: string[]): Promise<Record<string, LevelId>>;
  // Public: creators featured this month (Oro and Diamante, or a goal reached this month or last).
  featured(): Promise<FeaturedCreator[]>;
}
