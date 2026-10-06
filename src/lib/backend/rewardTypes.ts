// Types and backend contract for creator rewards (levels, referral link, creator
// invites, medals, featured spots, withdrawal terms) and the Meta de experiencia.
// Implemented by localRewards.ts and supabaseRewards.ts.
import type { AuthResult, User } from './types';
import type { MedalState } from '../rewardRules';

export type LevelId = 'bronce' | 'plata' | 'oro' | 'diamante';

export interface ReferredFan {
  name: string;
  joinedAt: string;
  paid: boolean; // has paid the creator
  referralUntil: string; // end of the 60 days at 85%
}

export interface InvitedCreator {
  name: string;
  joinedAt: string;
  qualifiedAt?: string; // verified and $100 sold
  from?: string; // the bonus month, once the inviter has 2 qualified invited creators
  until?: string;
  bonus: number; // earned so far (USD, at most $100)
}

export interface CreatorRewards {
  level: LevelId;
  activeFans: number; // fans from the link count twice
  sales: number; // gross, last 30 days
  clean: boolean; // no report confirmed against the creator in 90 days
  reliable: boolean; // answers 95% of Reserve requests
  share: number; // current rate (of the net) for fans not covered by a referral
  attractedThisMonth: number;
  attractedLastMonth: number;
  medals: MedalState;
  referrals: ReferredFan[];
  invitedCreators: InvitedCreator[];
}

export interface FeaturedCreator {
  creatorProfileId: string;
  level: LevelId;
  // special: an account the admin gave extra visibility; level: Oro or Diamante;
  // medal: a medal's boost; rising: Plata ("En ascenso").
  reason: 'special' | 'level' | 'medal' | 'rising';
}

export interface CreatorBadges {
  level: LevelId;
  puntual: boolean;
  constante: boolean;
}

export interface PayoutTerms {
  min: number;
}

// Meta de experiencia
export type TicketBonus = 'extra-time' | 'live-shoutout' | 'thank-you' | 'photo';

export interface GoalExperience {
  id: string;
  title: string;
  durationMinutes?: number;
}

// What a fan sees on a creator's profile.
export interface ExperienceGoalView {
  target: number;
  progress: number; // the signed-in fan's gifts and tips not yet turned into tickets
  experiences: GoalExperience[];
}

export interface ExperienceGoalSettings {
  enabled: boolean;
  target: number;
  experienceIds: string[];
}

export interface ExperienceTicket {
  id: string;
  creatorProfileId: string;
  creatorName: string;
  experienceId: string;
  experienceTitle: string;
  bonus: TicketBonus;
  status: 'active' | 'reserved' | 'used';
  bookingId?: string;
  createdAt: string;
  expiresAt: string;
}

export interface RewardsBackend {
  // The creator's own dashboard.
  myRewards(user: User): Promise<CreatorRewards>;
  // Public: level of each creator profile (Bronce when unknown).
  levels(creatorProfileIds: string[]): Promise<Record<string, LevelId>>;
  // Public: level and the medals fans see on a profile.
  badges(creatorProfileIds: string[]): Promise<Record<string, CreatorBadges>>;
  // Public: special accounts with extra visibility, then Oro and Diamante, medal
  // boosts and Plata ("En ascenso").
  featured(): Promise<FeaturedCreator[]>;
  // Public: new paying fans of each creator this month (category ranking).
  monthlyNewFans(): Promise<Record<string, number>>;
  // The signed-in creator's withdrawal minimum.
  payoutTerms(user: User): Promise<PayoutTerms>;

  // Meta de experiencia
  goal(creatorProfileId: string, user: User | null): Promise<ExperienceGoalView | null>;
  myGoalSettings(user: User): Promise<ExperienceGoalSettings | null>;
  saveGoal(user: User, input: ExperienceGoalSettings): Promise<AuthResult>;
  // A full goal becomes a ticket for the chosen experience plus the wheel's extra.
  claimTicket(user: User, creatorProfileId: string, experienceId: string): Promise<AuthResult & { ticket?: ExperienceTicket }>;
  myTickets(user: User): Promise<ExperienceTicket[]>;
  bookWithTicket(user: User, ticketId: string, date: string, time: string, message: string): Promise<AuthResult>;
}
