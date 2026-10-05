// Browser-only special accounts (dev and offline tests): same rules as the database,
// see supabase/migrations/20261005000001_special_accounts.sql.
import { readJSON, writeJSON } from '../storage';
import { MAX_TAX_RATE, inviteState, netReserve, validateInvite } from '../specialRules';
import type { SpecialAccount, SpecialBackend, SpecialInvite } from './specialTypes';
import type { User } from './types';

interface Deps {
  currentUser(): User | null;
  notify(): void;
}

const INVITES_KEY = 'special_invites';
const ACCOUNTS_KEY = 'special_accounts';
type StoredInvite = Omit<SpecialInvite, 'uses'>;

const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

export const createLocalSpecial = (deps: Deps): SpecialBackend & {
  // The cut of a Reserve payment for a special account (undefined: the usual rules).
  reserveShare(creatorProfileId: string, amount: number): number | undefined;
  featuredIds(): string[];
} => {
  const invites = () => readJSON<StoredInvite[]>(INVITES_KEY, []);
  const accounts = () => readJSON<SpecialAccount[]>(ACCOUNTS_KEY, []);
  const save = (key: string, value: unknown) => {
    writeJSON(key, value);
    deps.notify();
  };
  const isAdmin = () => deps.currentUser()?.role === 'admin';
  const denied = { ok: false, error: 'Solo el administrador puede hacer esto' } as const;
  const withUses = (i: StoredInvite): SpecialInvite => ({ ...i, uses: accounts().filter((a) => a.inviteCode === i.code).length });
  const active = (id: string) => accounts().find((a) => a.creatorProfileId === id && !a.revokedAt);

  return {
    reserveShare(creatorProfileId, amount) {
      const a = active(creatorProfileId);
      return a?.reserveNet ? netReserve(amount, a.taxRate).share : undefined;
    },
    featuredIds: () =>
      accounts()
        .filter((a) => a.featured && !a.revokedAt)
        .sort((a, b) => a.since.localeCompare(b.since))
        .slice(0, 8)
        .map((a) => a.creatorProfileId),

    async listInvites() {
      return isAdmin() ? invites().map(withUses).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
    },

    async createInvite(input) {
      if (!isAdmin()) return denied;
      const valid = validateInvite(input);
      if (!valid.ok) return valid;
      const code = newCode();
      save(INVITES_KEY, [...invites(), { ...input, label: input.label.trim(), code, createdAt: new Date().toISOString() }]);
      return { ok: true, code };
    },

    async revokeInvite(code) {
      if (!isAdmin()) return denied;
      save(INVITES_KEY, invites().map((i) => (i.code === code && !i.revokedAt ? { ...i, revokedAt: new Date().toISOString() } : i)));
      return { ok: true };
    },

    async listAccounts() {
      return isAdmin() ? [...accounts()].sort((a, b) => b.since.localeCompare(a.since)) : [];
    },

    async updateAccount(creatorProfileId, patch) {
      if (!isAdmin()) return denied;
      if (patch.taxRate !== undefined && !(patch.taxRate >= 0 && patch.taxRate <= MAX_TAX_RATE)) return { ok: false, error: 'El impuesto debe estar entre 0% y 50%' };
      const { active: on, ...terms } = patch;
      save(
        ACCOUNTS_KEY,
        accounts().map((a) =>
          a.creatorProfileId !== creatorProfileId ? a : { ...a, ...terms, ...(on === undefined ? {} : { revokedAt: on ? undefined : new Date().toISOString() }) }
        )
      );
      return { ok: true };
    },

    async mine() {
      const me = deps.currentUser();
      return (me && accounts().find((a) => a.userId === me.id)) ?? null;
    },

    async claim(code) {
      const me = deps.currentUser();
      if (!me) return { ok: false, error: 'Inicia sesión para activar tu cuenta especial' };
      if (me.role !== 'creator' || !me.creatorProfileId) return { ok: false, error: 'Este link es para cuentas de creador' };
      const stored = invites().find((i) => i.code === code.trim());
      if (!stored || stored.revokedAt) return { ok: false, error: 'Este link ya no es válido' };
      const inv = withUses(stored);
      if (inviteState(inv) === 'expired') return { ok: false, error: 'Este link ya venció' };
      const cur = accounts().find((a) => a.userId === me.id);
      if (cur && !cur.revokedAt) {
        if (cur.inviteCode === inv.code) return { ok: true, label: cur.label, already: true };
        return { ok: false, error: 'Tu cuenta ya tiene un plan especial' };
      }
      if (inv.uses >= inv.maxUses) return { ok: false, error: 'Este link ya se usó todas las veces permitidas' };
      const next: SpecialAccount = {
        creatorProfileId: me.creatorProfileId,
        userId: me.id,
        inviteCode: inv.code,
        label: inv.label,
        reserveNet: inv.reserveNet,
        taxRate: inv.taxRate,
        featured: inv.featured,
        since: new Date().toISOString(),
      };
      save(ACCOUNTS_KEY, [...accounts().filter((a) => a.creatorProfileId !== me.creatorProfileId), next]);
      return { ok: true, label: inv.label, already: false };
    },
  };
};
