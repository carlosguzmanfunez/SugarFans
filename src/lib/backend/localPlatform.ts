// Browser-only implementation of the platform features (dev and offline tests).
// Everything lives in one localStorage key; accounts are touched through the
// callbacks local.ts passes in.
import { readJSON, writeJSONChecked, newId } from '../storage';
import { addMonths, round2, validateReport, validateTip, validateVerification, computeEarnings, MIN_PAYOUT, money, buildManagedProfile } from '../platformRules';
import { creators as catalogue } from '../../data/mockData';
import type { AuthResult, User } from './types';
import type { Block, ManagedProfile, PaymentMethod, Payout, PayoutAccount, PlatformBackend, Report, Transaction, VerificationRequest } from './platformTypes';

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
}

interface Deps {
  listAccounts(): User[];
  setSubscription(userId: string, creatorId: string, price: number): void;
  setVerified(userId: string): void;
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
});

const now = () => new Date().toISOString();
const ok: AuthResult = { ok: true };
const fail = (error: string): AuthResult => ({ ok: false, error });
const byNewest = <T,>(key: keyof T) => (a: T, b: T) => String(b[key]).localeCompare(String(a[key]));

// purgeUser removes personal data when an account is deleted; sales stay in the
// creator's books, anonymised (Supabase does the same with foreign keys and a trigger).
export const createLocalPlatform = (deps: Deps): PlatformBackend & { purgeUser(userId: string): Promise<void> } => {
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
    if (!writeJSONChecked(KEY, fn(load()))) return fail('No se pudo guardar: el almacenamiento del navegador está lleno');
    deps.notify();
    return ok;
  };

  const creatorBlockedFan = (s: Store, fanId: string, creatorProfileId: string) =>
    s.blocks.some((b) => b.targetId === fanId && b.blockerProfileId === creatorProfileId);
  const cutOff = (s: Store, fanId: string, creatorProfileId: string) =>
    s.blocks.some((b) => b.blockerId === fanId && b.targetId === creatorProfileId) || creatorBlockedFan(s, fanId, creatorProfileId);

  const earningsOf = (s: Store, user: User) => {
    const profileId = user.creatorProfileId ?? user.id;
    return computeEarnings(
      s.transactions.filter((t) => t.creatorProfileId === profileId),
      s.payouts.filter((p) => p.userId === user.id)
    );
  };

  return {
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
    async subscribeAndPay(user, creatorProfileId, creatorName, price, methodId) {
      const s = load();
      const method = s.paymentMethods.find((m) => m.id === methodId && m.userId === user.id);
      if (!method) return fail('Elige un método de pago');
      if (cutOff(s, user.id, creatorProfileId)) return fail('No puedes suscribirte a este perfil');
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
            methodLabel: method?.label ?? 'Sin método de pago',
            status: method ? 'paid' : 'failed',
            createdAt: addMonths(sub.since, n).toISOString(),
          });
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
    // INTEGRATION: Stripe Connect / PayPal Payouts would send the money here.
    async requestPayout(user) {
      const s = load();
      if (user.role !== 'creator') return fail('Solo los creadores pueden retirar');
      if (!user.isVerified) return fail('Verifica tu identidad antes de solicitar un retiro');
      const account = s.payoutAccounts[user.id];
      if (!account) return fail('Añade una cuenta bancaria para retiros');
      const { available } = earningsOf(s, user);
      if (available < MIN_PAYOUT)
        return fail(`Necesitas al menos ${money(MIN_PAYOUT)} USD acreditados para retirar; tu saldo disponible es ${money(available)}`);
      const result = commit((data) => ({
        ...data,
        payouts: [
          ...data.payouts,
          {
            id: newId(),
            userId: user.id,
            creatorName: user.name,
            amount: available,
            accountLabel: `${account.bank} •••• ${account.accountLast4}`,
            status: 'paid',
            availableBefore: available,
            requestedAt: now(),
            paidAt: now(),
          },
        ],
      }));
      return result.ok ? { ...result, amount: available } : result;
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
