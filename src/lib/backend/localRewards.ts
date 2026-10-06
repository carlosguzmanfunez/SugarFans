// Browser-only creator rewards and Meta de experiencia (dev and offline tests).
// Referrals are recorded at sign-up; levels, medals and featured spots are worked
// out from the platform's books, like the database does.
import { readJSON, writeJSON, newId } from '../storage';
import { round2 } from '../platformRules';
import {
  REFERRAL_DAYS,
  activeFans,
  attractedFans,
  inviteBonusFor,
  inviteWindow,
  levelFor,
  medalsFor,
  monthStart,
  netShare,
  processorFee,
  qualifiedAt,
  rateFor,
  reliableFrom,
  salesOf,
  type CreatorInvite,
  type Referral,
} from '../rewardRules';
import { TICKET_DAYS, goalProgress, pickBonus, validateGoal } from '../experienceGoalRules';
import type { LocalLedger } from './localPlatform';
import type { Transaction } from './platformTypes';
import type { AuthResult, User, VipBooking, VipExperience } from './types';
import type { ExperienceGoalSettings, ExperienceTicket, FeaturedCreator, RewardsBackend } from './rewardTypes';
import { BRAND } from '../../config/brand';

interface Deps {
  ledger: () => LocalLedger;
  listAccounts(): User[];
  // Every public creator profile id (demo, registered and managed) for the featured list.
  creatorProfileIds(): string[];
  // Special accounts with extra visibility, listed first.
  specialFeatured(): string[];
  bookings(): VipBooking[];
  lives(): { creatorProfileId: string; startedAt: string; mode?: string }[];
  experiences(): VipExperience[];
  // Creates a Reserve request for the ticket's experience (usual rules) and returns its id.
  bookTicket(user: User, experienceId: string, date: string, time: string, message: string): Promise<AuthResult & { bookingId?: string }>;
  // Marks a booking as made with a ticket (price 0); an automatic one is confirmed at once.
  markTicketBooking(bookingId: string, ticketId: string, bonus: string): void;
}

const KEY = 'referrals';
const INVITES_KEY = 'creator_invites';
const GOALS_KEY = 'experience_goals';
const TICKETS_KEY = 'experience_tickets';
type Row = Transaction & { key: string };
type StoredGoal = ExperienceGoalSettings & { since: string };
type StoredTicket = ExperienceTicket & { fanId: string; amount: number };
const DAY = 86_400_000;
const ok: AuthResult = { ok: true };
const fail = (error: string): AuthResult => ({ ok: false, error });

export const createLocalRewards = (deps: Deps): RewardsBackend & {
  // A fan joins as a referral; a creator joins as an invited creator.
  recordReferral(userId: string, role: 'fan' | 'creator', creatorProfileId: string): void;
  withInviteBonuses(transactions: Row[]): Row[];
  shareFor(fanId: string, creatorProfileId: string, at: Date, amount: number): { share: number; gatewayFee: number };
  payoutTermsFor(user: User): { min: number };
  eventSeatCap(creatorProfileId: string): number;
  // Keeps a ticket in step with its booking (confirmed: used; rejected, cancelled or expired: free again).
  syncTicket(bookingId: string, ticketId: string, status: string): void;
  purgeUser(userId: string): Promise<void>;
} => {
  const refs = () => readJSON<Referral[]>(KEY, []);
  const invites = () => readJSON<CreatorInvite[]>(INVITES_KEY, []);
  const goals = () => readJSON<Record<string, StoredGoal>>(GOALS_KEY, {});
  const tickets = () => readJSON<StoredTicket[]>(TICKETS_KEY, []);
  const saveTickets = (list: StoredTicket[]) => writeJSON(TICKETS_KEY, list);
  const txs = () => deps.ledger().transactions();
  const verified = (creatorProfileId: string) => deps.listAccounts().some((a) => a.creatorProfileId === creatorProfileId && a.isVerified);
  const qualified = (books: Transaction[]) => (id: string) => qualifiedAt(books, id, verified(id));

  const levelAt = (id: string, at = new Date(), books = txs()) => {
    const clean = !deps
      .ledger()
      .reports()
      .some((r) => r.kind === 'creator' && r.targetId === id && r.status === 'resolved' && (r.resolvedAt ?? r.createdAt) > new Date(at.getTime() - 90 * DAY).toISOString());
    return levelFor({ fans: activeFans(books, refs(), id, at), sales: salesOf(books, id, at), clean, reliable: reliableFrom(deps.bookings(), id, at) });
  };
  const levelOf = (id: string) => levelAt(id).id;
  const medalsOf = (id: string, at = new Date()) => {
    const books = txs();
    const q = qualified(books);
    return medalsFor({
      creatorProfileId: id,
      bookings: deps.bookings(),
      lives: deps.lives(),
      refs: refs(),
      txs: books,
      qualifiedInvites: invites().filter((i) => i.referrerProfileId === id && q(i.creatorProfileId)).length,
      at,
    });
  };

  return {
    recordReferral(userId, role, creatorProfileId) {
      const joinedAt = new Date().toISOString();
      if (role === 'fan') {
        if (!refs().some((r) => r.fanId === userId)) writeJSON(KEY, [...refs(), { fanId: userId, creatorProfileId, joinedAt }]);
      } else if (!invites().some((i) => i.creatorProfileId === userId)) {
        writeJSON(INVITES_KEY, [...invites(), { creatorProfileId: userId, referrerProfileId: creatorProfileId, joinedAt }]);
      }
    },

    // Paid subscriptions, renewals and tips of an invited creator during the bonus
    // month get a bonus row for the creator who invited them (5% of the net, at most
    // $100 per invited creator); the row follows the sale if it is refunded.
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
      const q = qualified(transactions);
      const paidSoFar = new Map<string, number>();
      for (const t of transactions) {
        if (t.kind !== 'referral' || t.status !== 'paid') continue;
        const sale = byId.get(t.key.slice('bonus:'.length));
        if (sale) paidSoFar.set(sale.creatorProfileId, (paidSoFar.get(sale.creatorProfileId) ?? 0) + t.amount);
      }
      const added: Row[] = [];
      for (const t of [...transactions].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        if (!['subscription', 'renewal', 'tip'].includes(t.kind) || t.status !== 'paid' || has.has(`bonus:${t.id}`)) continue;
        const inv = all.find((i) => i.creatorProfileId === t.creatorProfileId);
        const window = inv && inviteWindow(inv, all, q);
        // The sale that completes the qualification earns nothing (same in the database).
        if (!inv || !window || t.createdAt <= window.from || t.createdAt >= window.until) continue;
        const amount = inviteBonusFor(t, paidSoFar.get(t.creatorProfileId) ?? 0);
        if (amount < 0.01) continue;
        paidSoFar.set(t.creatorProfileId, (paidSoFar.get(t.creatorProfileId) ?? 0) + amount);
        added.push({
          id: `bonus-${t.id}`,
          key: `bonus:${t.id}`,
          payerId: null,
          payerName: BRAND.name,
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

    shareFor(fanId, creatorProfileId, at, amount) {
      const gatewayFee = processorFee(amount);
      return { share: netShare(rateFor(levelAt(creatorProfileId, at), refs(), fanId, creatorProfileId, at), amount, gatewayFee), gatewayFee };
    },

    payoutTermsFor(user) {
      const level = levelAt(user.creatorProfileId ?? user.id);
      return { min: level.payoutMin };
    },

    eventSeatCap: (creatorProfileId) => levelAt(creatorProfileId).eventSeats,

    syncTicket(bookingId, ticketId, status) {
      const list = tickets();
      const t = list.find((x) => x.id === ticketId);
      if (!t) return;
      if (status === 'confirmed') t.status = 'used';
      else if (['rejected', 'cancelled', 'expired'].includes(status) && t.bookingId === bookingId) {
        t.status = 'active';
        delete t.bookingId;
      } else return;
      saveTickets(list);
    },

    async purgeUser(userId) {
      writeJSON(KEY, refs().filter((r) => r.fanId !== userId));
      writeJSON(INVITES_KEY, invites().filter((i) => i.creatorProfileId !== userId));
      saveTickets(tickets().filter((t) => t.fanId !== userId));
    },

    async myRewards(user) {
      const id = user.creatorProfileId ?? user.id;
      const at = new Date();
      const all = refs();
      const books = txs();
      const level = levelAt(id, at, books);
      const names = new Map(deps.listAccounts().map((a) => [a.id, a.name]));
      const payers = new Set(books.filter((t) => t.creatorProfileId === id && t.status === 'paid').map((t) => t.payerId));
      const q = qualified(books);
      return {
        level: level.id,
        activeFans: activeFans(books, all, id, at),
        sales: salesOf(books, id, at),
        clean: !deps.ledger().reports().some((r) => r.kind === 'creator' && r.targetId === id && r.status === 'resolved'),
        reliable: reliableFrom(deps.bookings(), id, at),
        share: level.share,
        attractedThisMonth: attractedFans(all, books, id, monthStart(at), monthStart(at, 1)),
        attractedLastMonth: attractedFans(all, books, id, monthStart(at, -1), monthStart(at)),
        medals: medalsOf(id, at),
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
            const window = inviteWindow(i, invites(), q);
            const qualifiedAt = q(i.creatorProfileId);
            return {
              name: names.get(i.creatorProfileId) ?? 'Creador',
              joinedAt: i.joinedAt,
              ...(qualifiedAt ? { qualifiedAt } : {}),
              ...(window ?? {}),
              bonus: round2(bonus.reduce((s, t) => s + t.amount, 0)),
            };
          }),
      };
    },

    async levels(ids) {
      return Object.fromEntries(ids.map((id) => [id, levelOf(id)]));
    },

    async badges(ids) {
      return Object.fromEntries(
        ids.map((id) => {
          const m = medalsOf(id);
          return [id, { level: levelOf(id), puntual: m.puntual, constante: m.constante }];
        })
      );
    },

    async featured() {
      const at = new Date();
      const now = at.toISOString();
      const books = txs();
      const special = deps.specialFeatured();
      const rows: (FeaturedCreator & { fans: number })[] = [];
      for (const id of deps.creatorProfileIds()) {
        if (special.includes(id)) continue;
        const level = levelAt(id, at, books);
        const boost = medalsOf(id, at).boostUntil;
        const reason: FeaturedCreator['reason'] | null =
          level.id === 'oro' || level.id === 'diamante' ? 'level' : boost && boost > now ? 'medal' : level.id === 'plata' ? 'rising' : null;
        if (reason) rows.push({ creatorProfileId: id, level: level.id, reason, fans: activeFans(books, refs(), id, at) });
      }
      const group = (reason: FeaturedCreator['reason']) =>
        rows
          .filter((r) => r.reason === reason)
          .sort((a, b) => b.fans - a.fans || a.creatorProfileId.localeCompare(b.creatorProfileId))
          .slice(0, 8)
          .map(({ fans: _f, ...f }) => f);
      return [
        ...special.map((id): FeaturedCreator => ({ creatorProfileId: id, level: levelOf(id), reason: 'special' })),
        ...group('level'),
        ...group('medal'),
        ...group('rising'),
      ];
    },

    async monthlyNewFans() {
      const from = monthStart(new Date());
      const first = new Map<string, string>();
      for (const t of txs()) {
        if (t.status !== 'paid' || !t.payerId || t.kind === 'referral') continue;
        const k = `${t.creatorProfileId}|${t.payerId}`;
        if (!first.has(k) || t.createdAt < first.get(k)!) first.set(k, t.createdAt);
      }
      const out: Record<string, number> = {};
      for (const [k, at] of first) if (at >= from) out[k.split('|')[0]] = (out[k.split('|')[0]] ?? 0) + 1;
      return out;
    },

    async payoutTerms(user) {
      const level = levelAt(user.creatorProfileId ?? user.id);
      return { min: level.payoutMin };
    },

    // ---------------------------------------------------------------
    // Meta de experiencia
    // ---------------------------------------------------------------
    async goal(creatorProfileId, user) {
      const g = goals()[creatorProfileId];
      if (!g?.enabled) return null;
      const used = user ? tickets().filter((t) => t.fanId === user.id && t.creatorProfileId === creatorProfileId).reduce((s, t) => s + t.amount, 0) : 0;
      return {
        target: g.target,
        progress: user ? goalProgress(txs(), user.id, creatorProfileId, g.since, used) : 0,
        experiences: deps
          .experiences()
          .filter((e) => g.experienceIds.includes(e.id) && e.active)
          .map((e) => ({ id: e.id, title: e.title, ...(e.durationMinutes ? { durationMinutes: e.durationMinutes } : {}) }))
          .sort((a, b) => a.title.localeCompare(b.title)),
      };
    },

    async myGoalSettings(user) {
      const g = user.creatorProfileId ? goals()[user.creatorProfileId] : undefined;
      return g ? { enabled: g.enabled, target: g.target, experienceIds: g.experienceIds } : null;
    },

    async saveGoal(user, input) {
      const id = user.creatorProfileId;
      if (!id || user.role !== 'creator') return fail('Solo los creadores pueden crear una Meta de experiencia');
      const check = validateGoal(input);
      if (!check.ok) return fail(check.error!);
      const mine = deps.experiences().filter((e) => e.creatorProfileId === id && e.active && e.details?.format !== 'event');
      if (input.experienceIds.some((x) => !mine.some((e) => e.id === x))) return fail('Elige experiencias activas de tu Reserve (no eventos)');
      const all = goals();
      all[id] = { enabled: input.enabled, target: round2(input.target), experienceIds: input.experienceIds, since: all[id]?.since ?? new Date().toISOString() };
      writeJSON(GOALS_KEY, all);
      return ok;
    },

    async claimTicket(user, creatorProfileId, experienceId) {
      const g = goals()[creatorProfileId];
      if (!g?.enabled) return fail('Este creador no tiene una Meta de experiencia activa');
      if (user.creatorProfileId === creatorProfileId) return fail('No puedes llenar tu propia meta');
      if (deps.ledger().cutOff(user.id, creatorProfileId)) return fail('No puedes reservar con este perfil');
      if (!g.experienceIds.includes(experienceId)) return fail('Elige una de las experiencias de la meta');
      const exp = deps.experiences().find((e) => e.id === experienceId && e.creatorProfileId === creatorProfileId && e.active);
      if (!exp) return fail('Esa experiencia ya no está disponible');
      const list = tickets();
      const used = list.filter((t) => t.fanId === user.id && t.creatorProfileId === creatorProfileId).reduce((s, t) => s + t.amount, 0);
      if (goalProgress(txs(), user.id, creatorProfileId, g.since, used) < g.target) return fail('Todavía no llenas la meta');
      const now = new Date();
      const ticket: StoredTicket = {
        id: newId(),
        fanId: user.id,
        amount: g.target,
        creatorProfileId,
        creatorName: exp.creatorName,
        experienceId: exp.id,
        experienceTitle: exp.title,
        bonus: pickBonus(),
        status: 'active',
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + TICKET_DAYS * DAY).toISOString(),
      };
      saveTickets([...list, ticket]);
      const { fanId: _f, amount: _a, ...pub } = ticket;
      return { ok: true, ticket: pub };
    },

    async myTickets(user) {
      return tickets()
        .filter((t) => t.fanId === user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(({ fanId: _f, amount: _a, ...t }) => t);
    },

    async bookWithTicket(user, ticketId, date, time, message) {
      const t = tickets().find((x) => x.id === ticketId && x.fanId === user.id);
      if (!t) return fail('Ticket no encontrado');
      if (t.status !== 'active') return fail('Este ticket ya tiene una reserva');
      if (t.expiresAt < new Date().toISOString()) return fail('Este ticket venció');
      const r = await deps.bookTicket(user, t.experienceId, date, time, message);
      if (!r.ok || !r.bookingId) return r.ok ? fail('No se pudo crear la reserva') : r;
      const list = tickets();
      const mine = list.find((x) => x.id === ticketId)!;
      mine.status = 'reserved';
      mine.bookingId = r.bookingId;
      saveTickets(list);
      // An automatic experience is confirmed at once (syncTicket marks the ticket used).
      deps.markTicketBooking(r.bookingId, t.id, t.bonus);
      return ok;
    },
  };
};

