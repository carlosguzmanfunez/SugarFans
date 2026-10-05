// Special accounts: pure rules shared by the UI and both backends. Mirrors
// supabase/migrations/20261005000001_special_accounts.sql: keep both in sync.
import { BRAND } from '../config/brand';
import { round2 } from './platformRules';
import type { AuthResult } from './backend/types';
import type { SpecialInvite, SpecialInviteInput } from './backend/specialTypes';

export type * from './backend/specialTypes';

export const MAX_TAX_RATE = 0.5;
export const MAX_INVITE_USES = 1000;

// Only when the gateway didn't report its fee (e.g. simulated test payments):
// PayPal's usual rate for international commercial payments, 5.4% + $0.30.
export const ESTIMATED_FEE = { rate: 0.054, fixed: 0.3 };
export const estimatedFee = (amount: number) => round2(amount * ESTIMATED_FEE.rate + ESTIMATED_FEE.fixed);

// What a special account keeps from a Reserve payment.
export const netReserve = (amount: number, taxRate: number, fee = estimatedFee(amount)) => {
  const gatewayFee = Math.min(amount, fee);
  const tax = Math.min(amount - gatewayFee, round2(amount * taxRate));
  const share = amount > 0 ? Math.max(0, Math.min(1, Math.round(((amount - gatewayFee - tax) / amount) * 10000) / 10000)) : 0;
  return { gatewayFee, tax, share };
};

export const validateInvite = (input: SpecialInviteInput): AuthResult => {
  const label = input.label.trim();
  if (!label || label.length > 80) return { ok: false, error: 'Ponle un nombre al link (hasta 80 caracteres)' };
  if (!(input.taxRate >= 0 && input.taxRate <= MAX_TAX_RATE)) return { ok: false, error: 'El impuesto debe estar entre 0% y 50%' };
  if (!Number.isInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > MAX_INVITE_USES)
    return { ok: false, error: `Los usos deben estar entre 1 y ${MAX_INVITE_USES}` };
  if (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()) return { ok: false, error: 'La fecha de vencimiento ya pasó' };
  return { ok: true };
};

export type InviteState = 'active' | 'revoked' | 'expired' | 'used';
export const inviteState = (i: SpecialInvite, now = Date.now()): InviteState =>
  i.revokedAt ? 'revoked' : i.expiresAt && new Date(i.expiresAt).getTime() <= now ? 'expired' : i.uses >= i.maxUses ? 'used' : 'active';

// 15% → "15%", 0.075 → "7.5%".
export const ratePct = (rate: number) => `${+(rate * 100).toFixed(2)}%`;

export const specialLink = (code: string) => `${window.location.origin}/especial/${code}`;

// The link's code waits in this tab until the creator is signed in (a Google sign-in
// comes back to the same tab). Not localStorage: another tab signed in to another
// account would pick it up.
const KEY = `${BRAND.storagePrefix}special`;
const TTL_DAYS = 1;

export const saveSpecialCode = (code: string) => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    // ignore
  }
};

export const readSpecialCode = (): string | undefined => {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (v && typeof v.code === 'string' && Date.now() - v.at < TTL_DAYS * 86_400_000) return v.code;
  } catch {
    // ignore
  }
  return undefined;
};

export const clearSpecialCode = () => {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
};
