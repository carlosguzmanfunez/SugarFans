// Creator rewards: a referral link, levels by active fans, monthly goals for
// fans attracted with the link, and featured spots. They raise the creator's
// cut of subscriptions, renewals and tips (gifts keep their fixed 60%). The same
// rules run in the database (migration 20260930000008_creator_rewards.sql): keep
// both in sync.
import type { Transaction } from './backend/platformTypes';
import type { LevelId } from './backend/rewardTypes';
import { addMonths } from './platformRules';

export interface Level {
  id: LevelId;
  name: string;
  icon: string;
  minFans: number; // active fans needed
  share: number; // creator's cut of subscriptions, renewals and tips
}

export const LEVELS: Level[] = [
  { id: 'bronce', name: 'Bronce', icon: '🥉', minFans: 0, share: 0.8 },
  { id: 'plata', name: 'Plata', icon: '🥈', minFans: 10, share: 0.82 },
  { id: 'oro', name: 'Oro', icon: '🥇', minFans: 50, share: 0.84 },
  { id: 'diamante', name: 'Diamante', icon: '💎', minFans: 200, share: 0.85 },
];

// Fans who sign up with the creator's link pay the creator 90% for 90 days.
export const REFERRAL_SHARE = 0.9;
export const REFERRAL_DAYS = 90;
// A creator who invites another creator earns 5% of everything the new creator
// sells for 12 months, paid from SugarFans' part: the new creator loses nothing.
export const CREATOR_INVITE_BONUS = 0.05;
export const CREATOR_INVITE_MONTHS = 12;

// No bonus takes the creator's cut above this.
export const MAX_SHARE = 0.9;
// A fan counts as active with a payment to the creator in the last 30 days.
export const ACTIVE_DAYS = 30;

// Monthly goals: fans who joined with the link that month and have paid the
// creator. Reaching one raises the cut for the whole next month.
export interface Goal {
  fans: number;
  bonus: number; // added to the level's share
  label: string;
}

export const GOALS: Goal[] = [
  { fans: 10, bonus: 0.02, label: 'Atrae 10 fans' },
  { fans: 25, bonus: 0.05, label: 'Atrae 25 fans' },
  { fans: 50, bonus: 0.1, label: 'Atrae 50 fans' },
];

const DAY = 24 * 60 * 60 * 1000;
export const pct = (share: number) => `${Math.round(share * 100)}%`;

export const levelFor = (activeFans: number): Level => [...LEVELS].reverse().find((l) => activeFans >= l.minFans)!;
export const levelById = (id: LevelId) => LEVELS.find((l) => l.id === id)!;
export const nextLevel = (level: Level): Level | undefined => LEVELS[LEVELS.findIndex((l) => l.id === level.id) + 1];

export const goalBonus = (attracted: number) => GOALS.filter((g) => attracted >= g.fans).reduce((b, g) => Math.max(b, g.bonus), 0);

// Month boundaries in UTC, like the monthly credit.
export const monthStart = (at: Date, offset = 0) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + offset, 1)).toISOString();

export interface CreatorInvite {
  creatorProfileId: string; // the invited creator
  referrerProfileId: string;
  joinedAt: string;
}

export const inviteUntil = (joinedAt: string) => addMonths(joinedAt, CREATOR_INVITE_MONTHS).toISOString();

export interface Referral {
  fanId: string;
  creatorProfileId: string;
  joinedAt: string;
}

const paidTo = (txs: Transaction[], creatorProfileId: string) =>
  txs.filter((t) => t.creatorProfileId === creatorProfileId && t.status === 'paid');

export const activeFans = (txs: Transaction[], creatorProfileId: string, at = new Date()) => {
  const since = new Date(at.getTime() - ACTIVE_DAYS * DAY).toISOString();
  const now = at.toISOString();
  return new Set(paidTo(txs, creatorProfileId).filter((t) => t.createdAt > since && t.createdAt <= now && t.payerId).map((t) => t.payerId)).size;
};

// Referred fans who joined in the month starting at `from` and have paid the creator.
export const attractedFans = (refs: Referral[], txs: Transaction[], creatorProfileId: string, from: string, to: string) => {
  const payers = new Set(paidTo(txs, creatorProfileId).map((t) => t.payerId));
  return refs.filter((r) => r.creatorProfileId === creatorProfileId && r.joinedAt >= from && r.joinedAt < to && payers.has(r.fanId)).length;
};

export const referralActive = (ref: Referral | undefined, creatorProfileId: string, at = new Date()) =>
  !!ref && ref.creatorProfileId === creatorProfileId && at.getTime() - new Date(ref.joinedAt).getTime() < REFERRAL_DAYS * DAY;

// The creator's cut of every fan not covered by a referral: level + last month's goal bonus.
export const baseShare = (refs: Referral[], txs: Transaction[], creatorProfileId: string, at = new Date()) => {
  const level = levelFor(activeFans(txs, creatorProfileId, at));
  const bonus = goalBonus(attractedFans(refs, txs, creatorProfileId, monthStart(at, -1), monthStart(at)));
  return Math.min(MAX_SHARE, Math.round((level.share + bonus) * 100) / 100);
};

// The cut recorded on a new subscription, renewal or tip.
export const shareFor = (refs: Referral[], txs: Transaction[], fanId: string, creatorProfileId: string, at = new Date()) =>
  referralActive(refs.find((r) => r.fanId === fanId), creatorProfileId, at) ? REFERRAL_SHARE : baseShare(refs, txs, creatorProfileId, at);

// Referral links look like /r/<creator profile id>; the code waits in the browser until sign-up.
export const REF_KEY = 'sugarfans_ref';
export const REF_TTL_DAYS = 30;

export const saveRefCode = (creatorProfileId: string) => {
  try {
    localStorage.setItem(REF_KEY, JSON.stringify({ id: creatorProfileId, at: Date.now() }));
  } catch {
    // ignore
  }
};

export const readRefCode = (): string | undefined => {
  try {
    const v = JSON.parse(localStorage.getItem(REF_KEY) || 'null');
    if (v && typeof v.id === 'string' && Date.now() - v.at < REF_TTL_DAYS * DAY) return v.id;
  } catch {
    // ignore
  }
  return undefined;
};

export const clearRefCode = () => {
  try {
    localStorage.removeItem(REF_KEY);
  } catch {
    // ignore
  }
};
