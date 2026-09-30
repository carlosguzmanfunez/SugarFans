// Browser-only backend (localStorage). Used when Supabase is not configured,
// e.g. local development and the offline E2E suite. Data is per browser.
import { readJSON, writeJSON, removeKey, hashPassword, newId } from '../storage';
import { ACTIVE_STATUSES, DEFAULT_AVAILABILITY, bookingWindow, freeHoursOn, formatLongDate, normalizeAvailability } from '../vip';
import {
  DEMO_PASSWORD,
  WRONG_CREDENTIALS,
  avatarFor,
  cleanPatch,
  defaultSettings,
  mergeSettings,
  normalizeEmail,
  validateRegistration,
} from './shared';
import type { Availability, Backend, BookingStatus, User, VipBooking } from './types';
import { createLocalPlatform } from './localPlatform';
import { createLocalSocial } from './localSocial';

interface StoredAccount extends User {
  passwordHash: string;
  salt: string;
}

const ACCOUNTS_KEY = 'accounts';
const SESSION_KEY = 'session';
const SEEDED_KEY = 'seeded_v1';
const AVAILABILITY_KEY = 'vip_availability';
const BOOKINGS_KEY = 'vip_bookings';
const OUTBOX_KEY = 'email_outbox';
const CHANGE_EVENT = 'sugarfans:local-change';

const baseUser = (partial: Pick<User, 'id' | 'name' | 'email' | 'role' | 'avatar'> & Partial<User>): User => ({
  ageVerified: true,
  createdAt: new Date().toISOString(),
  settings: defaultSettings(),
  subscriptions: [],
  createdPosts: [],
  ...partial,
});

const demoUsers: User[] = [
  baseUser({ id: 'demo-admin', name: 'Admin SugarFans', email: 'admin@sugarfans.com', role: 'admin', avatar: avatarFor('admin') }),
  baseUser({
    id: 'demo-creator',
    name: 'Valentina Rose',
    email: 'creator@sugarfans.com',
    role: 'creator',
    avatar: avatarFor('valentina'),
    bio: 'Modelo y creadora de contenido exclusivo ✨',
    isVerified: true,
    subscriptionPrice: 9.99,
    creatorProfileId: '1',
    followers: 12500,
    following: 340,
    posts: 256,
  }),
  baseUser({ id: 'demo-fan', name: 'Carlos M.', email: 'fan@sugarfans.com', role: 'fan', avatar: avatarFor('carlos') }),
];

const notify = () => window.dispatchEvent(new Event(CHANGE_EVENT));

const loadAccounts = (): StoredAccount[] =>
  readJSON<StoredAccount[]>(ACCOUNTS_KEY, []).map((a) => ({
    ...a,
    settings: mergeSettings(a.settings),
    subscriptions: a.subscriptions ?? [],
    createdPosts: a.createdPosts ?? [],
    creatorProfileId: a.creatorProfileId ?? (a.role === 'creator' ? (a.id === 'demo-creator' ? '1' : a.id) : undefined),
    createdAt: a.createdAt ?? new Date().toISOString(),
  }));

const saveAccounts = (accounts: StoredAccount[]) => {
  writeJSON(ACCOUNTS_KEY, accounts);
  notify();
};

// Seed the demo accounts once per browser; deleting one keeps it deleted.
const seedPromise: Promise<void> = (async () => {
  if (readJSON<boolean>(SEEDED_KEY, false)) return;
  const accounts = loadAccounts();
  for (const demo of demoUsers) {
    if (accounts.some((a) => a.email === demo.email)) continue;
    const salt = newId();
    accounts.push({ ...demo, salt, passwordHash: await hashPassword(DEMO_PASSWORD, salt) });
  }
  writeJSON(ACCOUNTS_KEY, accounts);
  writeJSON(SEEDED_KEY, true);
})();

// The session lives in localStorage ("remember me") or sessionStorage (this tab only).
const readSession = (): string | null => {
  try {
    return JSON.parse(sessionStorage.getItem('sugarfans_' + SESSION_KEY) || 'null') ?? readJSON<string | null>(SESSION_KEY, null);
  } catch {
    return readJSON<string | null>(SESSION_KEY, null);
  }
};

const writeSession = (id: string | null, remember = true) => {
  try {
    sessionStorage.removeItem('sugarfans_' + SESSION_KEY);
    if (id && !remember) sessionStorage.setItem('sugarfans_' + SESSION_KEY, JSON.stringify(id));
  } catch {
    // ignore
  }
  if (id && remember) writeJSON(SESSION_KEY, id);
  else removeKey(SESSION_KEY);
  notify();
};

const toPublic = (account: StoredAccount): User => {
  const { passwordHash: _h, salt: _s, ...user } = account;
  return user;
};

const mutate = (id: string, fn: (a: StoredAccount) => StoredAccount) => {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  accounts[idx] = fn(accounts[idx]);
  saveAccounts(accounts);
  return true;
};

const checkPassword = async (id: string, password: string) => {
  const account = loadAccounts().find((a) => a.id === id);
  return !!account && (await hashPassword(password, account.salt)) === account.passwordHash;
};

const listBookings = (): VipBooking[] => readJSON<VipBooking[]>(BOOKINGS_KEY, []);
const saveBookings = (bookings: VipBooking[]) => {
  writeJSON(BOOKINGS_KEY, bookings);
  notify();
};
const loadAvailability = (id: string): Availability =>
  readJSON<Record<string, Availability>>(AVAILABILITY_KEY, {})[id] ?? DEFAULT_AVAILABILITY;
const takenFor = (id: string) =>
  listBookings()
    .filter((b) => b.creatorProfileId === id && ACTIVE_STATUSES.includes(b.status))
    .map((b) => ({ date: b.date, time: b.time }));

const platform = createLocalPlatform({
  listAccounts: () => loadAccounts().map(toPublic),
  setSubscription: (userId, creatorId, price) =>
    mutate(userId, (a) => ({
      ...a,
      subscriptions: [...a.subscriptions.filter((s) => s.creatorId !== creatorId), { creatorId, price, since: new Date().toISOString() }],
    })),
  setVerified: (userId) => mutate(userId, (a) => ({ ...a, isVerified: true })),
  notify,
});

const social = createLocalSocial({
  listAccounts: () => loadAccounts().map(toPublic),
  listBookings: () => listBookings(),
  notify,
});

const ok = { ok: true } as const;
const fail = (error: string) => ({ ok: false, error });

export const localBackend: Backend = {
  mode: 'local',
  platform,
  social,

  async getCurrentUser() {
    const id = readSession();
    if (!id) return null;
    const account = loadAccounts().find((a) => a.id === id);
    return account ? toPublic(account) : null;
  },

  onChange(cb) {
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.startsWith('sugarfans_')) cb();
    };
    window.addEventListener(CHANGE_EVENT, cb);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, cb);
      window.removeEventListener('storage', onStorage);
    };
  },

  async login(email, password, remember) {
    await seedPromise;
    const account = loadAccounts().find((a) => a.email === normalizeEmail(email));
    if (!account || (await hashPassword(password, account.salt)) !== account.passwordHash) return fail(WRONG_CREDENTIALS);
    writeSession(account.id, remember);
    return ok;
  },

  async register(name, email, password, role) {
    await seedPromise;
    const cleanEmail = normalizeEmail(email);
    const valid = validateRegistration(name, cleanEmail, password, role);
    if (!valid.ok) return valid;
    const accounts = loadAccounts();
    if (accounts.some((a) => a.email === cleanEmail)) return fail('Ya existe una cuenta con este email');
    const salt = newId();
    const id = newId();
    const account: StoredAccount = {
      ...baseUser({
        id,
        name: name.trim(),
        email: cleanEmail,
        role,
        avatar: avatarFor(name.trim()),
        // Registration requires confirming the user is 18+ (terms checkbox).
        ageVerified: true,
        ...(role === 'creator' ? { subscriptionPrice: 9.99, followers: 0, following: 0, posts: 0, bio: '', creatorProfileId: id } : {}),
      }),
      salt,
      passwordHash: await hashPassword(password, salt),
    };
    saveAccounts([...accounts, account]);
    writeSession(id, true);
    return ok;
  },

  async logout() {
    writeSession(null);
  },

  async updateProfile(user, patch) {
    const cleaned = cleanPatch(patch);
    if (!cleaned.patch) return fail(cleaned.error!);
    const next = cleaned.patch;
    if (next.email !== undefined && loadAccounts().some((a) => a.email === next.email && a.id !== user.id)) {
      return fail('Ese email ya está en uso por otra cuenta');
    }
    return mutate(user.id, (a) => ({ ...a, ...next })) ? ok : fail('Cuenta no encontrada');
  },

  async changePassword(user, current, next) {
    if (!(await checkPassword(user.id, current))) return fail('La contraseña actual no es correcta');
    if (next.length < 8) return fail('La nueva contraseña debe tener al menos 8 caracteres');
    const salt = newId();
    const passwordHash = await hashPassword(next, salt);
    mutate(user.id, (a) => ({ ...a, salt, passwordHash }));
    return ok;
  },

  async deleteAccount(user, password) {
    if (!(await checkPassword(user.id, password))) return fail('La contraseña no es correcta');
    saveAccounts(loadAccounts().filter((a) => a.id !== user.id));
    saveBookings(listBookings().filter((b) => b.fanId !== user.id));
    await platform.purgeUser(user.id);
    writeSession(null);
    return ok;
  },

  async setSubscription(user, creatorId, price, subscribed) {
    mutate(user.id, (a) => ({
      ...a,
      subscriptions: subscribed
        ? [...a.subscriptions.filter((s) => s.creatorId !== creatorId), { creatorId, price, since: new Date().toISOString() }]
        : a.subscriptions.filter((s) => s.creatorId !== creatorId),
    }));
    return ok;
  },

  async addPost(user, content, isLocked, media) {
    if (!content.trim() && !media) return fail('Escribe algo o añade una foto o video');
    const post = {
      id: newId(),
      content: content.trim(),
      isLocked,
      createdAt: new Date().toISOString(),
      ...(media ? { mediaPath: media.path, mediaType: media.type } : {}),
    };
    mutate(user.id, (a) => ({ ...a, posts: (a.posts ?? 0) + 1, createdPosts: [post, ...a.createdPosts] }));
    return ok;
  },

  async deletePost(user, postId) {
    const media = loadAccounts().find((a) => a.id === user.id)?.createdPosts.find((p) => p.id === postId)?.mediaPath;
    if (media) await social.removeMedia(user, media);
    mutate(user.id, (a) => ({
      ...a,
      posts: Math.max(0, (a.posts ?? 0) - 1),
      createdPosts: a.createdPosts.filter((p) => p.id !== postId),
    }));
    return ok;
  },

  async listAccounts() {
    return loadAccounts().map(toPublic);
  },

  async getAvailability(id) {
    return loadAvailability(id);
  },

  async setAvailability(id, availability) {
    if (availability.days.length === 0 || availability.hours.length === 0) return fail('Elige al menos un día y una hora');
    const all = readJSON<Record<string, Availability>>(AVAILABILITY_KEY, {});
    all[id] = normalizeAvailability(availability);
    writeJSON(AVAILABILITY_KEY, all);
    notify();
    return ok;
  },

  async takenSlots(id) {
    return takenFor(id);
  },

  async createBooking(user, input) {
    if (!input.date) return fail('Elige un día en el calendario');
    if (!input.time) return fail('Elige una hora disponible');
    if (user.creatorProfileId === input.creatorProfileId) return fail('No puedes reservar tu propia experiencia');
    const { min, max } = bookingWindow();
    if (input.date < min || input.date > max) return fail('La fecha debe estar dentro de los próximos 3 meses');
    if (!freeHoursOn(loadAvailability(input.creatorProfileId), takenFor(input.creatorProfileId), input.date).includes(input.time)) {
      return fail('Ese horario ya no está disponible. Elige otro.');
    }
    const now = new Date().toISOString();
    saveBookings([
      ...listBookings(),
      {
        ...input,
        message: input.message.trim(),
        id: newId(),
        fanId: user.id,
        fanName: user.name,
        fanEmail: user.email,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      },
    ]);
    return ok;
  },

  async updateBooking(user, bookingId, next: BookingStatus) {
    const bookings = listBookings();
    const b = bookings.find((x) => x.id === bookingId);
    if (!b) return fail('Reserva no encontrada');
    const isFan = b.fanId === user.id;
    const isCreator = !!user.creatorProfileId && b.creatorProfileId === user.creatorProfileId;
    const allowed =
      (isCreator && b.status === 'pending' && (next === 'accepted' || next === 'rejected')) ||
      (isFan && (b.status === 'pending' || b.status === 'accepted') && next === 'cancelled') ||
      (isFan && b.status === 'accepted' && next === 'confirmed');
    if (!allowed) return fail('Esta acción no está permitida');
    const now = new Date().toISOString();
    b.status = next;
    b.updatedAt = now;
    if (next === 'confirmed') {
      // Payment is simulated; the confirmation email only goes out after the
      // creator accepted AND the fan paid.
      b.paidAt = now;
      b.emailSentAt = now;
      writeJSON(OUTBOX_KEY, [
        ...readJSON<unknown[]>(OUTBOX_KEY, []),
        {
          id: newId(),
          to: b.fanEmail,
          subject: `Confirmación: ${b.title}`,
          body: `Hola ${b.fanName}, tu experiencia "${b.title}" con ${b.creatorName} está confirmada para el ${formatLongDate(b.date)} a las ${b.time}. Pago recibido: $${b.price} USD.`,
          sentAt: now,
        },
      ]);
    }
    saveBookings(bookings);
    return ok;
  },

  async fanBookings(fanId) {
    return listBookings()
      .filter((b) => b.fanId === fanId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async creatorBookings(id) {
    return listBookings()
      .filter((b) => b.creatorProfileId === id)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  },
};
