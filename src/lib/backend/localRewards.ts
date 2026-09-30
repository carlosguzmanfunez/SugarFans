// Browser-only creator rewards (dev and offline tests). Referrals are recorded at
// sign-up; levels, goals and featured spots are worked out from the platform's books.
import { readJSON, writeJSON } from '../storage';
import {
  GOALS,
  LEVELS,
  REFERRAL_DAYS,
  activeFans,
  attractedFans,
  baseShare,
  goalBonus,
  levelFor,
  monthStart,
  shareFor,
  type Referral,
} from '../rewardRules';
import type { LocalLedger } from './localPlatform';
import type { User } from './types';
import type { FeaturedCreator, RewardsBackend } from './rewardTypes';

interface Deps {
  ledger: () => LocalLedger;
  listAccounts(): User[];
  // Every public creator profile id (demo, registered and managed) for the featured list.
  creatorProfileIds(): string[];
}

const KEY = 'referrals';
const DAY = 86_400_000;

export const createLocalRewards = (deps: Deps): RewardsBackend & {
  recordReferral(fanId: string, creatorProfileId: string): void;
  shareFor(fanId: string, creatorProfileId: string, at?: Date): number;
  purgeUser(userId: string): Promise<void>;
} => {
  const refs = () => readJSON<Referral[]>(KEY, []);
  const txs = () => deps.ledger().transactions();
  const levelOf = (id: string) => levelFor(activeFans(txs(), id)).id;

  return {
    recordReferral(fanId, creatorProfileId) {
      if (refs().some((r) => r.fanId === fanId)) return;
      writeJSON(KEY, [...refs(), { fanId, creatorProfileId, joinedAt: new Date().toISOString() }]);
    },

    shareFor: (fanId, creatorProfileId, at = new Date()) => shareFor(refs(), txs(), fanId, creatorProfileId, at),

    async purgeUser(userId) {
      writeJSON(KEY, refs().filter((r) => r.fanId !== userId));
    },

    async myRewards(user) {
      const id = user.creatorProfileId ?? user.id;
      const at = new Date();
      const all = refs();
      const books = txs();
      const names = new Map(deps.listAccounts().map((a) => [a.id, a.name]));
      const payers = new Set(books.filter((t) => t.creatorProfileId === id && t.status === 'paid').map((t) => t.payerId));
      const lastMonth = attractedFans(all, books, id, monthStart(at, -1), monthStart(at));
      return {
        level: levelOf(id),
        activeFans: activeFans(books, id, at),
        share: baseShare(all, books, id, at),
        bonus: goalBonus(lastMonth),
        attractedThisMonth: attractedFans(all, books, id, monthStart(at), monthStart(at, 1)),
        attractedLastMonth: lastMonth,
        referrals: all
          .filter((r) => r.creatorProfileId === id)
          .sort((a, b) => b.joinedAt.localeCompare(a.joinedAt))
          .map((r) => ({
            name: names.get(r.fanId) ?? 'Fan',
            joinedAt: r.joinedAt,
            paid: payers.has(r.fanId),
            referralUntil: new Date(new Date(r.joinedAt).getTime() + REFERRAL_DAYS * DAY).toISOString(),
          })),
      };
    },

    async levels(ids) {
      return Object.fromEntries(ids.map((id) => [id, levelOf(id)]));
    },

    async featured() {
      const at = new Date();
      const all = refs();
      const books = txs();
      const out: (FeaturedCreator & { fans: number })[] = [];
      for (const id of deps.creatorProfileIds()) {
        const fans = activeFans(books, id, at);
        const level = levelFor(fans);
        const goal =
          attractedFans(all, books, id, monthStart(at), monthStart(at, 1)) >= GOALS[0].fans ||
          attractedFans(all, books, id, monthStart(at, -1), monthStart(at)) >= GOALS[0].fans;
        const high = LEVELS.indexOf(level) >= 2;
        if (high || goal) out.push({ creatorProfileId: id, level: level.id, reason: high ? 'level' : 'goal', fans });
      }
      return out
        .sort((a, b) => b.fans - a.fans)
        .slice(0, 8)
        .map(({ fans: _f, ...f }) => f);
    },
  };
};
