// Browser-only creator rewards (dev and offline tests). Referrals are recorded at
// sign-up; levels, goals and featured spots are worked out from the platform's books.
import { readJSON, writeJSON } from '../storage';
import { round2 } from '../platformRules';
import {
  GOALS,
  LEVELS,
  REFERRAL_DAYS,
  activeFans,
  attractedFans,
  baseShare,
  goalBonus,
  levelFor,
  inviteBonusFor,
  inviteWindow,
  monthStart,
  shareFor,
  type CreatorInvite,
  type Referral,
} from '../rewardRules';
import type { LocalLedger } from './localPlatform';
import type { Transaction } from './platformTypes';
import type { User } from './types';
import type { FeaturedCreator, RewardsBackend } from './rewardTypes';

interface Deps {
  ledger: () => LocalLedger;
  listAccounts(): User[];
  // Every public creator profile id (demo, registered and managed) for the featured list.
  creatorProfileIds(): string[];
}

const KEY = 'referrals';
const INVITES_KEY = 'creator_invites';
type Row = Transaction & { key: string };
const DAY = 86_400_000;

export const createLocalRewards = (deps: Deps): RewardsBackend & {
  // A fan joins as a referral; a creator joins as an invited creator.
  recordReferral(userId: string, role: 'fan' | 'creator', creatorProfileId: string): void;
  withInviteBonuses(transactions: Row[]): Row[];
  shareFor(fanId: string, creatorProfileId: string, at?: Date): number;
  purgeUser(userId: string): Promise<void>;
} => {
  const refs = () => readJSON<Referral[]>(KEY, []);
  const invites = () => readJSON<CreatorInvite[]>(INVITES_KEY, []);
  const txs = () => deps.ledger().transactions();
  const levelOf = (id: string) => levelFor(activeFans(txs(), id)).id;

  return {
    recordReferral(userId, role, creatorProfileId) {
      const joinedAt = new Date().toISOString();
      if (role === 'fan') {
        if (!refs().some((r) => r.fanId === userId)) writeJSON(KEY, [...refs(), { fanId: userId, creatorProfileId, joinedAt }]);
      } else if (!invites().some((i) => i.creatorProfileId === userId)) {
        writeJSON(INVITES_KEY, [...invites(), { creatorProfileId: userId, referrerProfileId: creatorProfileId, joinedAt }]);
      }
    },

    // Paid sales of an invited creator during the bonus month get a bonus row for
    // the creator who invited them; the row follows the sale if it is refunded.
    withInviteBonuses(transactions) {
      const all = invites();
      if (!all.length) return transactions;
      const byId = new Map(transactions.map((t) => [t.id, t]));
      const has = new Set(transactions.filter((t) => t.kind === 'referral').map((t) => t.key));
      const names = new Map(deps.listAccounts().flatMap((a) => (a.creatorProfileId ? [[a.creatorProfileId, a.name] as const] : [])));
      const synced = transactions.map((t) => {
        const sale = t.kind === 'referral' ? byId.get(t.key.slice('bonus:'.length)) : undefined;
        return sale && sale.status !== t.status ? { ...t, status: sale.status } : t;
      });
      const added: Row[] = [];
      for (const t of transactions) {
        if (t.kind === 'referral' || t.kind === 'gift' || t.status !== 'paid' || has.has(`bonus:${t.id}`)) continue;
        const inv = all.find((i) => i.creatorProfileId === t.creatorProfileId);
        const window = inv && inviteWindow(inv, all);
        const amount = inviteBonusFor(t);
        if (!inv || !window || t.createdAt < window.from || t.createdAt >= window.until || amount < 0.01) continue;
        added.push({
          id: `bonus-${t.id}`,
          key: `bonus:${t.id}`,
          payerId: null,
          payerName: 'SugarFans',
          creatorProfileId: inv.referrerProfileId,
          creatorName: names.get(inv.referrerProfileId) ?? 'Creador',
          kind: 'referral',
          amount,
          share: 1,
          note: `Por ${t.creatorName}`,
          methodLabel: 'Bono de invitación',
          status: 'paid',
          createdAt: t.createdAt,
        });
      }
      return added.length ? [...synced, ...added] : synced;
    },

    shareFor: (fanId, creatorProfileId, at = new Date()) => shareFor(refs(), txs(), fanId, creatorProfileId, at),

    async purgeUser(userId) {
      writeJSON(KEY, refs().filter((r) => r.fanId !== userId));
      writeJSON(INVITES_KEY, invites().filter((i) => i.creatorProfileId !== userId));
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
        invitedCreators: invites()
          .filter((i) => i.referrerProfileId === id)
          .sort((a, b) => b.joinedAt.localeCompare(a.joinedAt))
          .map((i) => {
            const sales = new Set(books.filter((t) => t.creatorProfileId === i.creatorProfileId).map((t) => `bonus:${t.id}`));
            const bonus = (books as Row[]).filter((t) => t.kind === 'referral' && t.status === 'paid' && sales.has(t.key));
            const window = inviteWindow(i, invites());
            return {
              name: names.get(i.creatorProfileId) ?? 'Creador',
              joinedAt: i.joinedAt,
              ...(window ?? {}),
              bonus: round2(bonus.reduce((s, t) => s + t.amount, 0)),
            };
          }),
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
