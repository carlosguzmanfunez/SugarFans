// Browser-only implementation of the platform features (dev and offline tests).
// Everything lives in one localStorage key; accounts are touched through the
// callbacks local.ts passes in.
import { readJSON, writeJSONChecked, newId } from '../storage';
import { addMonths, round2, validateReport, validateTip, validateVerification, computeEarnings, payoutFee, payoutAccountLabel, money, buildManagedProfile } from '../platformRules';
import { creators as catalogue } from '../../data/mockData';
import type { AuthResult, User } from './types';
import type { AccountRestriction, AdminActionLog, Block, ManagedProfile, PaymentMethod, Payout, PayoutAccount, PlatformBackend, Report, Transaction, VerificationRequest } from './platformTypes';

interface Store {
  verifications: VerificationRequest[];
  paymentMethods: PaymentMethod[];
  transactions: (Transaction & { key: string })[];
  payoutAccounts: Record<string, PayoutAccount>;
  payouts: Payout[];
  reports: Report[];
  blocks: Block[];
  removedPosts: string[];
  managedProfiles: ManagedProfile[];
  restrictions: AccountRestriction[];
  adminActions: AdminActionLog[];
}

interface Deps {
  listAccounts(): User[];
  setSubscription(userId: string, creatorId: string, price: number): void;
  // Ends a subscription at `at` (a cancellation or a renewal that could not be charged).
  setCancelAt(userId: string, creatorId: string, at: string | undefined): void;
  // Monthly price of a creator account's profile, or null when no account owns it.
  creatorPrice(creatorProfileId: string): number | null;
  setVerified(userId: string): void;
  setUnverified(userId: string): void;
  // Deletes the account and everything personal (admin cancelling an account).
  deleteAccount(userId: string): Promise<void>;
  // Creator's cut of a subscription, renewal or tip (rewards: level and referral, from the
  // net) and the processor's fee it was taken after.
  shareFor(fanId: string, creatorProfileId: string, at: Date, amount: number): { share: number; gatewayFee: number };
  // Smallest withdrawal and whether Fans Reserve pays PayPal's fee, by the creator's level.
  payoutTerms(user: User): { min: number };
  // Adds (and keeps in step) the 5% bonus rows for creators who invited the seller.
  withInviteBonuses(transactions: Store['transactions']): Store['transactions'];
  notify(): void;
}

const KEY = 'platform';
const SEEDED_KEY = 'platform_seeded_v1';

const empty = (): Store => ({
  verifications: [],
  paymentMethods: [],
  transactions: [],
  payoutAccounts: {},
  payouts: [],
  reports: [],
  blocks: [],
  removedPosts: [],
  managedProfiles: [],
  restrictions: [],
  adminActions: [],
});

const now = () => new Date().toISOString();
const ok: AuthResult = { ok: true };
const fail = (error: string): AuthResult => ({ ok: false, error });
const byNewest = <T,>(key: keyof T) => (a: T, b: T) => String(b[key]).localeCompare(String(a[key]));

// purgeUser removes personal data when an account is deleted; sales stay in the
// creator's books, anonymised (Supabase does the same with foreign keys and a trigger).
// The ledger lets the gifts store (localGifts.ts) charge methods and write
// payments into the same books.
export interface LocalLedger {
  methodLabel(userId: string, methodId: string): string | null;
  cutOff(fanId: string, creatorProfileId: string): boolean;
  // Someone runs this profile (a creator account or a visible managed profile), so it can take money.
  acceptsPayments(creatorProfileId: string): boolean;
  transactions(): Transaction[];
  reports(): Report[];
  addTransaction(t: Omit<Transaction, 'id'> & { key: string }): AuthResult & { id?: string };
  refund(transactionId: string): void;
}

export const createLocalPlatform = (
  deps: Deps
): PlatformBackend & { purgeUser(userId: string): Promise<void>; isSuspended(userId: string): boolean; ledger: LocalLedger } => {
  const load = (): Store => {
    const store = { ...empty(), ...readJSON<Partial<Store>>(KEY, {}) };
    if (!readJSON<boolean>(SEEDED_KEY, false)) {
      // The demo fan starts with the card the old settings screen showed.
      store.paymentMethods.push({
        id: newId(),
        userId: 'demo-fan',
        kind: 'card',
        label: 'Visa •••• 4242',
        detail: 'Expira 12/29',
        isDefault: true,
        createdAt: now(),
      });
      writeJSONChecked(KEY, store);
      writeJSONChecked(SEEDED_KEY, true);
    }
    return store;
  };

  const commit = (fn: (s: Store) => Store): AuthResult => {
    const next = fn(load());
    if (!writeJSONChecked(KEY, { ...next, transactions: deps.withInviteBonuses(next.transactions) })) return fail('No se pudo guardar: el almacenamiento del navegador está lleno');
    deps.notify();
    return ok;
  };

  const suspended = (s: Store, userId: string) => s.restrictions.some((r) => r.userId === userId && !!r.suspendedUntil && r.suspendedUntil > now());
  const ownerOf = (creatorProfileId: string) => deps.listAccounts().find((a) => a.role === 'creator' && a.creatorProfileId === creatorProfileId);

  const creatorBlockedFan = (s: Store, fanId: string, creatorProfileId: string) =>
    s.blocks.some((b) => b.targetId === fanId && b.blockerProfileId === creatorProfileId);
  const cutOff = (s: Store, fanId: string, creatorProfileId: string) =>
    s.blocks.some((b) => b.blockerId === fanId && b.targetId === creatorProfileId) || creatorBlockedFan(s, fanId, creatorProfileId);

  // The price is never taken from the browser: the owning account's price, then a
  // visible managed profile, then the demo catalogue (kept while the site is in test mode).
  const priceOf = (s: Store, creatorProfileId: string): number | null =>
    deps.creatorPrice(creatorProfileId) ??
    s.managedProfiles.find((m) => m.id === creatorProfileId && !m.hidden)?.subscriptionPrice ??
    catalogue.find((c) => c.id === creatorProfileId)?.subscriptionPrice ??
    null;
  const UNKNOWN = 'Este perfil no existe';

  const earningsOf = (s: Store, user: User) => {
    const profileId = user.creatorProfileId ?? user.id;
    return computeEarnings(
      s.transactions.filter((t) => t.creatorProfileId === profileId),
      s.payouts.filter((p) => p.userId === user.id)
    );
  };

  const ledger: LocalLedger = {
    methodLabel: (userId, methodId) => load().paymentMethods.find((m) => m.id === methodId && m.userId === userId)?.label ?? null,
    cutOff: (fanId, creatorProfileId) => cutOff(load(), fanId, creatorProfileId),
    acceptsPayments: (creatorProfileId) => {
      const s = load();
      const owner = ownerOf(creatorProfileId);
      return priceOf(s, creatorProfileId) !== null && !(owner && suspended(s, owner.id));
    },
    transactions: () => load().transactions,
    reports: () => load().reports,
    addTransaction(t) {
      const id = newId();
      const r = commit((s) => ({ ...s, transactions: [...s.transactions, { ...t, id }] }));
      return r.ok ? { ...r, id } : r;
    },
    refund(transactionId) {
      commit((s) => ({
        ...s,
        transactions: s.transactions.map((t) => (t.id === transactionId && t.status === 'paid' ? { ...t, status: 'refunded' } : t)),
      }));
    },
  };

  return {
    ledger,

    async myVerification(userId) {
      return [...load().verifications].reverse().find((v) => v.userId === userId) ?? null;
    },

    async submitVerification(user, input) {
      const check = validateVerification(input);
      if (!check.ok) return check;
      const current = [...load().verifications].reverse().find((v) => v.userId === user.id);
      if (current?.status === 'pending') return fail('Ya tienes una solicitud en revisión');
      if (current?.status === 'approved' || user.isVerified) return fail('Tu identidad ya está verificada');
      return commit((s) => ({
        ...s,
        verifications: [
          // Only the latest request per user is kept, so old document images don't pile up.
          ...s.verifications.filter((v) => v.userId !== user.id),
          {
            ...input,
            legalName: input.legalName.trim(),
            country: input.country.trim(),
            docNumber: input.docNumber.trim().toUpperCase(),
            id: newId(),
            userId: user.id,
            userName: user.name,
            email: user.email,
            role: user.role,
            status: 'pending',
            submittedAt: now(),
          },
        ],
      }));
    },

    async listVerifications() {
      return [...load().verifications].sort(byNewest('submittedAt'));
    },

    async reviewVerification(id, approve, reason) {
      if (!approve && !reason.trim()) return fail('Indica el motivo del rechazo');
      const request = load().verifications.find((v) => v.id === id);
      if (!request || request.status !== 'pending') return fail('La solicitud ya fue revisada');
      const result = commit((s) => ({
        ...s,
        verifications: s.verifications.map((v) =>
          v.id === id
            ? {
                ...v,
                status: approve ? 'approved' : 'rejected',
                rejectionReason: approve ? undefined : reason.trim(),
                reviewedAt: now(),
                // Documents are deleted once approved (data minimisation).
                ...(approve ? { docFront: '', selfie: '' } : {}),
              }
            : v
        ),
      }));
      if (result.ok && approve) deps.setVerified(request.userId);
      return result;
    },

    async paymentMethods(userId) {
      return load().paymentMethods.filter((m) => m.userId === userId);
    },

    async addPaymentMethod(user, method) {
      const id = newId();
      const result = commit((s) => ({
        ...s,
        paymentMethods: [
          ...s.paymentMethods,
          { ...method, id, userId: user.id, isDefault: !s.paymentMethods.some((m) => m.userId === user.id), createdAt: now() },
        ],
      }));
      return result.ok ? { ok: true, id } : result;
    },

    async removePaymentMethod(user, id) {
      return commit((s) => {
        const others = s.paymentMethods.filter((m) => m.userId !== user.id);
        const mine = s.paymentMethods.filter((m) => m.userId === user.id && m.id !== id);
        if (mine.length && !mine.some((m) => m.isDefault)) mine[0] = { ...mine[0], isDefault: true };
        return { ...s, paymentMethods: [...others, ...mine] };
      });
    },

    async setDefaultPaymentMethod(user, id) {
      return commit((s) => ({
        ...s,
        paymentMethods: s.paymentMethods.map((m) => (m.userId === user.id ? { ...m, isDefault: m.id === id } : m)),
      }));
    },

    // INTEGRATION: a real gateway charge (Stripe PaymentIntent / PayPal order) goes here.
    async subscribeAndPay(user, creatorProfileId, creatorName, _price, methodId) {
      const s = load();
      const price = priceOf(s, creatorProfileId);
      if (price === null) return fail(UNKNOWN);
      if (user.creatorProfileId === creatorProfileId) return fail('No puedes suscribirte a tu propio perfil');
      if (cutOff(s, user.id, creatorProfileId)) return fail('No puedes suscribirte a este perfil');
      // Still inside a cancelled month: keep the subscription, no new charge.
      const current = deps.listAccounts().find((a) => a.id === user.id)?.subscriptions.find((x) => x.creatorId === creatorProfileId);
      if (current) {
        deps.setCancelAt(user.id, creatorProfileId, undefined);
        return ok;
      }
      const method = s.paymentMethods.find((m) => m.id === methodId && m.userId === user.id);
      if (!method) return fail('Elige un método de pago');
      const at = now();
      const result = commit((data) => ({
        ...data,
        transactions: [
          ...data.transactions,
          {
            id: newId(),
            key: `sub:${user.id}:${creatorProfileId}:${at}`,
            payerId: user.id,
            payerName: user.name,
            creatorProfileId,
            creatorName,
            kind: 'subscription',
            amount: round2(price),
            ...deps.shareFor(user.id, creatorProfileId, new Date(at), round2(price)),
            methodLabel: method.label,
            status: 'paid',
            createdAt: at,
          },
        ],
      }));
      if (result.ok) deps.setSubscription(user.id, creatorProfileId, price);
      return result;
    },

    async sendTip(user, creatorProfileId, creatorName, amount, methodId, _postId, message) {
      const check = validateTip(amount);
      if (!check.ok) return check;
      if (user.creatorProfileId === creatorProfileId) return fail('No puedes enviarte una propina a ti mismo');
      const s = load();
      if (priceOf(s, creatorProfileId) === null) return fail(UNKNOWN);
      const method = s.paymentMethods.find((m) => m.id === methodId && m.userId === user.id);
      if (!method) return fail('Elige un método de pago');
      if (cutOff(s, user.id, creatorProfileId)) return fail('No puedes enviar propinas a este perfil');
      const at = now();
      const note = (message ?? '').trim().slice(0, 200);
      return commit((data) => ({
        ...data,
        transactions: [
          ...data.transactions,
          {
            id: newId(),
            key: `tip:${user.id}:${newId()}`,
            payerId: user.id,
            payerName: user.name,
            creatorProfileId,
            creatorName,
            kind: 'tip',
            amount: round2(amount),
            ...deps.shareFor(user.id, creatorProfileId, new Date(at), round2(amount)),
            methodLabel: method.label,
            status: 'paid',
            createdAt: at,
            ...(note ? { note } : {}),
          },
        ],
      }));
    },

    // INTEGRATION: in production the gateway's recurring billing + a webhook does this.
    async billDueRenewals(user, creatorNames) {
      const s = load();
      const mine = s.paymentMethods.filter((m) => m.userId === user.id);
      const method = mine.find((m) => m.isDefault) ?? mine[0];
      const at = new Date();
      const missing: Store['transactions'] = [];
      for (const sub of user.subscriptions) {
        if (cutOff(s, user.id, sub.creatorId)) continue;
        for (let n = 1; addMonths(sub.since, n) <= at; n++) {
          const due = addMonths(sub.since, n);
          if (sub.cancelAt && due.toISOString() >= sub.cancelAt) break;
          const key = `renew:${user.id}:${sub.creatorId}:${sub.since}:${n}`;
          if (s.transactions.some((t) => t.key === key)) continue;
          missing.push({
            id: newId(),
            key,
            payerId: user.id,
            payerName: user.name,
            creatorProfileId: sub.creatorId,
            creatorName: creatorNames[sub.creatorId] ?? 'Creador',
            kind: 'renewal',
            amount: round2(sub.price),
            ...deps.shareFor(user.id, sub.creatorId, addMonths(sub.since, n), round2(sub.price)),
            methodLabel: method?.label ?? 'Sin método de pago',
            status: method ? 'paid' : 'failed',
            createdAt: due.toISOString(),
          });
          // A renewal that cannot be charged ends the subscription that day.
          if (!method) {
            deps.setCancelAt(user.id, sub.creatorId, due.toISOString());
            break;
          }
        }
      }
      if (missing.length) commit((data) => ({ ...data, transactions: [...data.transactions, ...missing] }));
    },

    async myPayments(userId) {
      return load().transactions.filter((t) => t.payerId === userId).sort(byNewest('createdAt'));
    },

    async creatorSales(creatorProfileId) {
      return load().transactions.filter((t) => t.creatorProfileId === creatorProfileId).sort(byNewest('createdAt'));
    },

    async allPayments() {
      return load().transactions.sort(byNewest('createdAt'));
    },

    async mySubscribers(user) {
      const profileId = user.creatorProfileId;
      if (!profileId) return [];
      return deps.listAccounts().flatMap((a) => {
        const sub = a.subscriptions.find((x) => x.creatorId === profileId);
        return sub ? [{ id: a.id, name: a.name, avatar: a.avatar, since: sub.since }] : [];
      });
    },

    async payoutAccount(userId) {
      return load().payoutAccounts[userId] ?? null;
    },

    async setPayoutAccount(user, account) {
      return commit((s) => ({ ...s, payoutAccounts: { ...s.payoutAccounts, [user.id]: account } }));
    },

    async myPayouts(userId) {
      return load().payouts.filter((p) => p.userId === userId).sort(byNewest('requestedAt'));
    },

    // Pays the whole credited balance at once; no admin step.
    async requestPayout(user) {
      const s = load();
      if (user.role !== 'creator') return fail('Solo los creadores pueden retirar');
      if (!user.isVerified) return fail('Verifica tu identidad antes de solicitar un retiro');
      if (suspended(s, user.id) || s.restrictions.some((r) => r.userId === user.id && r.payoutsFrozen))
        return fail('Tus retiros están en revisión. Escríbenos a support@fansreserve.com');
      const account = s.payoutAccounts[user.id];
      if (!account) return fail('Añade el email de tu cuenta PayPal para retiros');
      const { available } = earningsOf(s, user);
      const terms = deps.payoutTerms(user);
      const fee = payoutFee(available);
      if (available < terms.min)
        return fail(`Necesitas al menos ${money(terms.min)} USD acreditados para retirar; tu saldo disponible es ${money(available)}`);
      const result = commit((data) => ({
        ...data,
        payouts: [
          ...data.payouts,
          {
            id: newId(),
            userId: user.id,
            creatorName: user.name,
            amount: available,
            fee,
            net: round2(available - fee),
            accountLabel: payoutAccountLabel(account),
            status: 'paid',
            availableBefore: available,
            requestedAt: now(),
            paidAt: now(),
          },
        ],
      }));
      return result.ok ? { ...result, amount: round2(available - fee), status: 'paid' as const } : result;
    },

    // Local withdrawals are paid at once, so there's never one to cancel.
    async cancelPayout() {
      return fail('Este retiro ya no se puede cancelar.');
    },

    async listPayouts() {
      return [...load().payouts].sort(byNewest('requestedAt'));
    },

    async submitReport(reporter, input) {
      const check = validateReport(input, !!reporter);
      if (!check.ok) return check;
      return commit((s) => ({
        ...s,
        reports: [
          ...s.reports,
          {
            ...input,
            targetLabel: input.targetLabel.trim() || 'Sin especificar',
            description: input.description.trim(),
            contactEmail: reporter?.email ?? input.contactEmail?.trim(),
            id: newId(),
            reporterId: reporter?.id,
            reporterName: reporter?.name ?? 'Visitante',
            status: 'pending',
            createdAt: now(),
          },
        ],
      }));
    },

    async listReports() {
      return load().reports.sort(byNewest('createdAt'));
    },

    async resolveReport(id, action) {
      return commit((s) => {
        const report = s.reports.find((r) => r.id === id);
        const removePost = action === 'remove' && report?.kind === 'post' && report.targetId;
        return {
          ...s,
          removedPosts: removePost ? [...new Set([...s.removedPosts, report!.targetId!])] : s.removedPosts,
          reports: s.reports.map((r) =>
            r.id === id
              ? {
                  ...r,
                  status: action === 'dismiss' ? 'dismissed' : 'resolved',
                  resolution: action === 'remove' ? 'Contenido retirado' : action === 'resolve' ? 'Atendido' : 'Descartado',
                  resolvedAt: now(),
                }
              : r
          ),
        };
      });
    },

    async removedPosts() {
      return load().removedPosts;
    },

    async restorePost(postId) {
      return commit((s) => ({ ...s, removedPosts: s.removedPosts.filter((p) => p !== postId) }));
    },

    async coverRefund(transactionId, cover) {
      const t = load().transactions.find((x) => x.id === transactionId);
      if (!t || (t.status !== 'refunded' && t.status !== 'disputed') || t.kind === 'referral') return fail('Solo se cubre una venta reembolsada o en disputa');
      return commit((s) => ({ ...s, transactions: s.transactions.map((x) => (x.id === transactionId ? { ...x, platformCovers: cover } : x)) }));
    },

    async accountRestrictions() {
      return load().restrictions;
    },

    async adminActions() {
      return [...load().adminActions].sort(byNewest('createdAt'));
    },

    async adminAccountAction(admin, userId, action, reason, days) {
      if (admin.role !== 'admin') return fail('Esta acción no está permitida');
      const target = deps.listAccounts().find((a) => a.id === userId);
      if (!target) return fail('Cuenta no encontrada');
      if (target.role === 'admin') return fail('Las cuentas de administrador no se gestionan desde aquí');
      const why = reason.trim().slice(0, 500);
      if (action !== 'unsuspend' && action !== 'unfreeze_payouts' && !why) return fail('Escribe el motivo');
      const until = action === 'suspend' ? new Date(Date.now() + (days ?? 36_500) * 86_400_000).toISOString() : null;
      const log: AdminActionLog = { id: newId(), adminName: admin.name, userId, userName: target.name, action, reason: why, until, createdAt: now() };
      const restrict = (s: Store, patch: Partial<AccountRestriction>) => {
        const current = s.restrictions.find((r) => r.userId === userId) ?? { userId, suspendedUntil: null, suspensionReason: null, payoutsFrozen: false, updatedAt: now() };
        return [...s.restrictions.filter((r) => r.userId !== userId), { ...current, ...patch, updatedAt: now() }];
      };
      const result = commit((s) => ({
        ...s,
        adminActions: [...s.adminActions, log],
        restrictions:
          action === 'suspend'
            ? restrict(s, { suspendedUntil: until, suspensionReason: why })
            : action === 'unsuspend'
              ? restrict(s, { suspendedUntil: null, suspensionReason: null })
              : action === 'freeze_payouts' || action === 'unfreeze_payouts'
                ? restrict(s, { payoutsFrozen: action === 'freeze_payouts' })
                : s.restrictions,
      }));
      if (!result.ok) return result;
      if (action === 'unverify') deps.setUnverified(userId);
      if (action === 'delete') await deps.deleteAccount(userId);
      return ok;
    },

    isSuspended: (userId) => suspended(load(), userId),

    async blocks(user) {
      return load().blocks.filter((b) => b.blockerId === user.id || b.targetId === user.id);
    },

    async block(user, targetId, targetName) {
      if (load().blocks.some((b) => b.blockerId === user.id && b.targetId === targetId)) return ok;
      return commit((s) => ({
        ...s,
        blocks: [...s.blocks, { blockerId: user.id, blockerProfileId: user.creatorProfileId, targetId, targetName, createdAt: now() }],
      }));
    },

    async unblock(user, targetId) {
      return commit((s) => ({ ...s, blocks: s.blocks.filter((b) => !(b.blockerId === user.id && b.targetId === targetId)) }));
    },

    async purgeUser(userId) {
      commit((s) => {
        const { [userId]: _removed, ...payoutAccounts } = s.payoutAccounts;
        return {
          ...s,
          verifications: s.verifications.filter((v) => v.userId !== userId),
          restrictions: s.restrictions.filter((r) => r.userId !== userId),
          paymentMethods: s.paymentMethods.filter((m) => m.userId !== userId),
          transactions: s.transactions.map((t) => (t.payerId === userId ? { ...t, payerId: null, payerName: 'Cuenta eliminada' } : t)),
          payoutAccounts,
          reports: s.reports.map((r) => (r.reporterId === userId ? { ...r, reporterId: undefined, reporterName: 'Cuenta eliminada' } : r)),
          blocks: s.blocks.filter((b) => b.blockerId !== userId && b.targetId !== userId),
        };
      });
    },

    async managedProfiles(includeHidden = false) {
      return load()
        .managedProfiles.filter((m) => includeHidden || !m.hidden)
        .sort(byNewest('createdAt'));
    },

    async saveManagedProfile(admin, input, id) {
      if (admin.role !== 'admin') return fail('Esta acción no está permitida');
      const s = load();
      const existing = id ? s.managedProfiles.find((m) => m.id === id) : undefined;
      if (id && !existing) return fail('El perfil ya no existe');
      const taken = [...catalogue.map((c) => c.username), ...s.managedProfiles.filter((m) => m.id !== id).map((m) => m.username)];
      const { profile, error } = buildManagedProfile(input, taken);
      if (!profile) return fail(error!);
      const saved: ManagedProfile = existing
        ? { ...existing, ...profile, updatedAt: now() }
        : { ...profile, id: `m-${newId()}`, hidden: false, createdBy: admin.id, createdAt: now(), updatedAt: now() };
      const result = commit((st) => ({
        ...st,
        managedProfiles: existing ? st.managedProfiles.map((m) => (m.id === id ? saved : m)) : [...st.managedProfiles, saved],
      }));
      return result.ok ? { ...result, id: saved.id } : result;
    },

    async setManagedProfileHidden(admin, id, hidden) {
      if (admin.role !== 'admin') return fail('Esta acción no está permitida');
      return commit((s) => ({ ...s, managedProfiles: s.managedProfiles.map((m) => (m.id === id ? { ...m, hidden, updatedAt: now() } : m)) }));
    },

    async deleteManagedProfile(admin, id) {
      if (admin.role !== 'admin') return fail('Esta acción no está permitida');
      if (deps.listAccounts().some((u) => u.subscriptions.some((sub) => sub.creatorId === id)))
        return fail('Este perfil tiene suscriptores activos: ocúltalo en lugar de eliminarlo');
      return commit((s) => ({ ...s, managedProfiles: s.managedProfiles.filter((m) => m.id !== id) }));
    },
  };
};
