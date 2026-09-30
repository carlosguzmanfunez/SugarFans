// Defaults and validation shared by every backend.
import { isValidEmail } from '../storage';
import type { AuthResult, ProfilePatch, UserRole, UserSettings } from './types';

export const DEMO_PASSWORD = 'demo1234';

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
  if (next.subscriptionPrice !== undefined && !(next.subscriptionPrice >= 0.99 && next.subscriptionPrice <= 999)) {
    return { error: 'El precio debe estar entre $0.99 y $999' };
  }
  return { patch: next };
};

export const WRONG_CREDENTIALS = 'Email o contraseña incorrectos';
