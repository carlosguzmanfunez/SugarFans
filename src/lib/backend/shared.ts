// Defaults and validation shared by every backend.
import { isValidEmail } from '../storage';
import { MIN_SUBSCRIPTION } from '../platformRules';
import type { AuthResult, ProfilePatch, SignupExtras, UserRole, UserSettings } from './types';
import { isCountryCode, isValidPhone } from '../../config/countries';
import { cleanSocials, normalizeUsername, usernameError } from '../creatorLinks';

export { DEMO_PASSWORD } from '../../config/demoAccounts';

export const defaultSettings = (): UserSettings => ({
  notifications: {
    newPosts: true,
    messages: true,
    tips: true,
    subscribers: true,
    promotions: false,
    platform: false,
    email: true,
    push: true,
  },
  privacy: { profileVisible: true, showActivity: false, contentProtection: true },
  twoFactor: false,
});

export const mergeSettings = (settings?: Partial<UserSettings> | null): UserSettings => {
  const base = defaultSettings();
  return {
    ...base,
    ...settings,
    notifications: { ...base.notifications, ...settings?.notifications },
    privacy: { ...base.privacy, ...settings?.privacy },
  };
};

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const avatarFor = (seed: string) => `https://api.dicebear.com/7.0/adventurer/svg?seed=${encodeURIComponent(seed)}`;

export const validateRegistration = (name: string, email: string, password: string, role: UserRole): AuthResult => {
  if (!name.trim()) return { ok: false, error: 'El nombre es obligatorio' };
  if (!isValidEmail(email)) return { ok: false, error: 'Introduce un email válido' };
  if (password.length < 8) return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres' };
  if (role !== 'fan' && role !== 'creator') return { ok: false, error: 'Tipo de cuenta no permitido' };
  return { ok: true };
};

// Country is required for a new account; the phone is optional (already in +… format).
export const validateSignupExtras = (extras?: SignupExtras): AuthResult => {
  if (!isCountryCode(extras?.country)) return { ok: false, error: 'Elige tu país' };
  if (extras?.phone && !isValidPhone(extras.phone)) return { ok: false, error: 'Revisa tu número de teléfono' };
  return { ok: true };
};

// Returns a cleaned patch, or an error.
export const cleanPatch = (patch: ProfilePatch): { patch?: ProfilePatch; error?: string } => {
  const next: ProfilePatch = { ...patch };
  if (next.email !== undefined) {
    next.email = normalizeEmail(next.email);
    if (!isValidEmail(next.email)) return { error: 'Introduce un email válido' };
  }
  if (next.name !== undefined) {
    next.name = next.name.trim();
    if (!next.name) return { error: 'El nombre es obligatorio' };
  }
  // '' clears the field.
  if (next.country !== undefined && next.country !== '' && !isCountryCode(next.country)) return { error: 'Elige tu país' };
  if (next.phone !== undefined) {
    next.phone = next.phone.trim();
    if (next.phone && !isValidPhone(next.phone)) return { error: 'Revisa tu número de teléfono' };
  }
  if (next.username !== undefined) {
    next.username = normalizeUsername(next.username);
    const bad = usernameError(next.username);
    if (bad) return { error: bad };
  }
  if (next.settings?.socials) next.settings = { ...next.settings, socials: cleanSocials(next.settings.socials) };
  if (next.subscriptionPrice !== undefined && !(next.subscriptionPrice >= MIN_SUBSCRIPTION && next.subscriptionPrice <= 999)) {
    return { error: `El precio debe estar entre $${MIN_SUBSCRIPTION} y $999` };
  }
  return { patch: next };
};

export const WRONG_CREDENTIALS = 'Email o contraseña incorrectos';
export const ACCOUNT_SUSPENDED = 'Tu cuenta está suspendida. Escríbenos a support@fansreserve.com';

// Passed as the payment method once api/paypal.ts has charged and fulfilled a
// purchase: the client only refreshes, it doesn't call the purchase RPC again.
export const PAID_WITH_PAYPAL = 'paid-with-paypal';
