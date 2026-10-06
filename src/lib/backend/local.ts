// Browser-only backend (localStorage). Used when Supabase is not configured,
// e.g. local development and the offline E2E suite. Data is per browser.
import { readJSON, writeJSON, removeKey, hashPassword, newId } from '../storage';
import {
  ACTIVE_STATUSES,
  CUSTOM_EXPERIENCE,
  DEFAULT_AVAILABILITY,
  bookingWindow,
  cleanDetails,
  customTitle,
  demoExperiences,
  detailsOf,
  experienceAvailability,
  freeHoursOn,
  formatLongDate,
  isEventExperience,
  isUpcomingEvent,
  meetsNotice,
  needsApproval,
  normalizeAvailability,
  priceFor,
  validateCounter,
  validateCustomRequest,
  validateExperience,
} from '../vip';
import { nextRenewal, round2 } from '../platformRules';
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
import type { AuthResult, Availability, Backend, BookingInput, BookingStatus, User, VipBooking, VipExperience } from './types';
import { createLocalPlatform } from './localPlatform';
import { createLocalSocial } from './localSocial';
import { createLocalGifts } from './localGifts';
import { createLocalRewards } from './localRewards';
import { createLocalSpecial } from './localSpecial';
import { createLocalLive, addLocalNotification } from './localLive';
import { bookingAlert, isOverdue, respondByFrom } from '../reserveAlerts';
import { creators as demoCreators } from '../../data/mockData';
import { moderate } from '../moderation';
import { demoAccount } from '../../config/demoAccounts';
import { BRAND } from '../../config/brand';

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
const EXPERIENCES_KEY = 'vip_experiences_v1';
const RESETS_KEY = 'password_resets';
const CHANGE_EVENT = `${BRAND.compactName.toLowerCase()}:local-change`;

const baseUser = (partial: Pick<User, 'id' | 'name' | 'email' | 'role' | 'avatar'> & Partial<User>): User => ({
  ageVerified: true,
  createdAt: new Date().toISOString(),
  settings: defaultSettings(),
  subscriptions: [],
  createdPosts: [],
  ...partial,
});

const demoUsers: User[] = [
  baseUser({ id: 'demo-admin', name: `Admin ${BRAND.compactName}`, email: demoAccount('admin').email, role: 'admin', avatar: avatarFor('admin') }),
  baseUser({
    id: 'demo-creator',
    name: 'Valentina Rose',
    email: demoAccount('creator').email,
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
  baseUser({ id: 'demo-fan', name: 'Carlos M.', email: demoAccount('fan').email, role: 'fan', avatar: avatarFor('carlos') }),
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
    return JSON.parse(sessionStorage.getItem(BRAND.storagePrefix + SESSION_KEY) || 'null') ?? readJSON<string | null>(SESSION_KEY, null);
  } catch {
    return readJSON<string | null>(SESSION_KEY, null);
  }
};

const writeSession = (id: string | null, remember = true) => {
  try {
    sessionStorage.removeItem(BRAND.storagePrefix + SESSION_KEY);
    if (id && !remember) sessionStorage.setItem(BRAND.storagePrefix + SESSION_KEY, JSON.stringify(id));
  } catch {
    // ignore
  }
  if (id && remember) writeJSON(SESSION_KEY, id);
  else removeKey(SESSION_KEY);
  notify();
};

// A cancelled subscription counts until its end date, then it is gone.
const isActiveSub = (s: User['subscriptions'][number], at = new Date().toISOString()) => !s.cancelAt || s.cancelAt > at;

const toPublic = (account: StoredAccount): User => {
  const { passwordHash: _h, salt: _s, ...user } = account;
  return { ...user, subscriptions: user.subscriptions.filter((s) => isActiveSub(s)) };
};

const listExperiences = (): VipExperience[] => {
  const stored = readJSON<VipExperience[] | null>(EXPERIENCES_KEY, null);
  const demo = demoExperiences();
  if (stored) {
    // Browsers seeded before Reserve: complete the demo catalogue, keep everything else.
    const upgraded = stored.map((e) => {
      const seed = !e.details ? demo.find((d) => d.id === e.id && d.creatorProfileId === e.creatorProfileId) : undefined;
      return seed ? { ...seed, active: e.active } : e;
    });
    const missing = demo.filter((d) => !stored.some((e) => e.id === d.id));
    if (missing.length || upgraded.some((e, i) => e !== stored[i])) writeJSON(EXPERIENCES_KEY, [...upgraded, ...missing]);
    return [...upgraded, ...missing];
  }
  writeJSON(EXPERIENCES_KEY, demo);
  return demo;
};
const saveExperiences = (list: VipExperience[]) => {
  writeJSON(EXPERIENCES_KEY, list);
  notify();
};
// Someone runs this creator profile: a creator account, or a visible managed profile.
const creatorAccount = (creatorProfileId: string) =>
  loadAccounts().find((a) => a.role === 'creator' && a.creatorProfileId === creatorProfileId);

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

// Like the database triggers: a booking that starts waiting for an answer gets its
// deadline, and each new booking or change of state alerts the other side.
const saveBookings = (bookings: VipBooking[]) => {
  const before = new Map(readJSON<VipBooking[]>(BOOKINGS_KEY, []).map((b) => [b.id, b]));
  for (const b of bookings) {
    const prev = before.get(b.id);
    // A Meta de experiencia ticket pays for the booking: accepting it confirms it.
    if (b.details?.ticketId && b.status === 'accepted' && prev?.status !== 'accepted') {
      b.status = 'confirmed';
      b.paidAt = new Date().toISOString();
    }
    if ((b.status === 'pending' || b.status === 'countered') && prev?.status !== b.status) b.respondBy = respondByFrom(b);
  }
  writeJSON(BOOKINGS_KEY, bookings);
  for (const b of bookings)
    if (b.details?.ticketId && before.get(b.id)?.status !== b.status) rewards.syncTicket(b.id, b.details.ticketId, b.status);
  for (const b of bookings) {
    const alert = bookingAlert(before.get(b.id), b);
    if (!alert) continue;
    const kind = alert.to === 'creator' ? 'reserve_request' : 'reserve_update';
    const to = alert.to === 'fan' ? [b.fanId] : loadAccounts().filter((a) => a.role === 'creator' && a.creatorProfileId === b.creatorProfileId).map((a) => a.id);
    for (const userId of to) addLocalNotification(userId, { kind, creatorProfileId: b.creatorProfileId, title: alert.title, body: alert.body, link: alert.link });
  }
  notify();
};
// Requests nobody answered in time expire when read (the server runs a job).
const listBookings = (): VipBooking[] => {
  const all = readJSON<VipBooking[]>(BOOKINGS_KEY, []);
  if (!all.some((b) => isOverdue(b))) return all;
  const now = new Date().toISOString();
  const next = all.map((b): VipBooking => (isOverdue(b) ? { ...b, status: 'expired', updatedAt: now } : b));
  saveBookings(next);
  return next;
};
const loadAvailability = (id: string): Availability =>
  readJSON<Record<string, Availability>>(AVAILABILITY_KEY, {})[id] ?? DEFAULT_AVAILABILITY;
const takenFor = (id: string) =>
  listBookings()
    .filter((b) => b.creatorProfileId === id && ACTIVE_STATUSES.includes(b.status))
    .map((b) => ({ date: b.date, time: b.time }));

// A Reserve 1:1 request (also used to book with a Meta de experiencia ticket).
const createBooking = async (user: User, input: BookingInput): Promise<AuthResult & { bookingId?: string }> => {
  if (!input.date) return fail('Elige un día en el calendario');
  if (!input.time) return fail('Elige una hora disponible');
  const exp = listExperiences().find((e) => e.id === input.experienceId && e.active);
  if (!exp) return fail('Experiencia no encontrada');
  if (isEventExperience(exp)) return fail('Reserva tu plaza desde el evento');
  if (user.creatorProfileId === exp.creatorProfileId) return fail('No puedes reservar tu propia experiencia');
  const note = moderate(input.message ?? '', 'request');
  if (!note.ok) return fail(note.error!);
  if (platform.ledger.cutOff(user.id, exp.creatorProfileId)) return fail('No puedes reservar con este perfil');
  const d = detailsOf(exp);
  const subscribed = user.subscriptions.some((s) => s.creatorId === exp.creatorProfileId);
  if (d.requirements.verifiedFans && !user.isVerified) return fail('Esta experiencia es solo para fans con identidad verificada');
  if (d.requirements.subscribersOnly && !subscribed) return fail('Esta experiencia es solo para suscriptores');
  const participants = input.participants ?? 1;
  if (!Number.isInteger(participants) || participants < 1 || participants > d.maxParticipants)
    return fail(`Esta experiencia admite hasta ${d.maxParticipants} participante${d.maxParticipants === 1 ? '' : 's'}`);
  const { min, max } = bookingWindow();
  if (input.date < min || input.date > max) return fail('La fecha debe estar dentro de los próximos 3 meses');
  if (!meetsNotice(input.date, input.time, d.minNoticeHours)) return fail(`Reserva con al menos ${d.minNoticeHours} horas de anticipación`);
  const availability = experienceAvailability(loadAvailability(exp.creatorProfileId), exp);
  if (!freeHoursOn(availability, takenFor(exp.creatorProfileId), input.date).includes(input.time)) {
    return fail('Ese horario ya no está disponible. Elige otro.');
  }
  const price = priceFor(exp, subscribed);
  const now = new Date().toISOString();
  const id = newId();
  saveBookings([
    ...listBookings(),
    {
      experienceId: exp.id,
      creatorProfileId: exp.creatorProfileId,
      title: exp.title,
      creatorName: exp.creatorName,
      price,
      ...(exp.durationMinutes ? { durationMinutes: exp.durationMinutes } : {}),
      date: input.date,
      time: input.time,
      message: input.message.trim().slice(0, 500),
      id,
      fanId: user.id,
      fanName: user.name,
      fanEmail: user.email,
      // Automatic approval skips straight to payment.
      status: needsApproval(exp) ? 'pending' : 'accepted',
      createdAt: now,
      updatedAt: now,
      details: {
        kind: 'experience',
        typeId: exp.type,
        modality: d.modality,
        participants,
        ...(d.modality !== 'virtual' ? { locationType: d.locationTypes[0], city: d.city, venue: d.venue } : {}),
        ...(price !== exp.price ? { listPrice: exp.price, discountPercent: d.subscriberDiscount } : {}),
      },
    },
  ]);
  return { ok: true, bookingId: id };
};

const platform = createLocalPlatform({
  listAccounts: () => loadAccounts().map(toPublic),
  setSubscription: (userId, creatorId, price) =>
    mutate(userId, (a) => ({
      ...a,
      subscriptions: [...a.subscriptions.filter((s) => s.creatorId !== creatorId), { creatorId, price, since: new Date().toISOString() }],
    })),
  setCancelAt: (userId, creatorId, at) =>
    mutate(userId, (a) => ({
      ...a,
      subscriptions: a.subscriptions.map((s) => (s.creatorId === creatorId ? { ...s, cancelAt: at } : s)),
    })),
  creatorPrice: (creatorProfileId) => creatorAccount(creatorProfileId)?.subscriptionPrice ?? null,
  setVerified: (userId) => mutate(userId, (a) => ({ ...a, isVerified: true })),
  shareFor: (fanId, creatorProfileId, at, amount) => rewards.shareFor(fanId, creatorProfileId, at, amount),
  payoutTerms: (user) => rewards.payoutTermsFor(user),
  withInviteBonuses: (transactions) => rewards.withInviteBonuses(transactions),
  notify,
});

// Declared after the platform but only called later, once both exist.
const rewards = createLocalRewards({
  ledger: () => platform.ledger,
  listAccounts: () => loadAccounts().map(toPublic),
  creatorProfileIds: () => [
    ...new Set([
      ...demoCreators.map((c) => c.id),
      ...loadAccounts().flatMap((a) => (a.role === 'creator' && a.creatorProfileId ? [a.creatorProfileId] : [])),
    ]),
  ],
  specialFeatured: () => special.featuredIds(),
  bookings: () => listBookings(),
  lives: () => readJSON<{ broadcasts?: { creatorProfileId: string; startedAt: string; mode?: string }[] }>('live', {}).broadcasts ?? [],
  experiences: () => listExperiences(),
  bookTicket: async (user, experienceId, date, time, message) => createBooking(user, { experienceId, date, time, message }),
  markTicketBooking: (bookingId, ticketId, bonus) => {
    const bookings = listBookings();
    const b = bookings.find((x) => x.id === bookingId);
    if (!b) return;
    b.price = 0;
    b.details = { ...b.details, ticketId, ticketBonus: bonus };
    // Automatic approval: the ticket pays for it, so it is confirmed at once.
    if (b.status === 'accepted') {
      const prev = readJSON<VipBooking[]>(BOOKINGS_KEY, []);
      writeJSON(BOOKINGS_KEY, prev.map((x) => (x.id === b.id ? { ...x, status: 'pending' as const } : x)));
    }
    b.updatedAt = new Date().toISOString();
    saveBookings(bookings);
  },
});

const special = createLocalSpecial({
  currentUser: () => {
    const id = readSession();
    const account = id ? loadAccounts().find((a) => a.id === id) : undefined;
    return account ? toPublic(account) : null;
  },
  notify,
});

const social = createLocalSocial({
  listAccounts: () => loadAccounts().map(toPublic),
  notify,
});

const gifts = createLocalGifts({
  ledger: platform.ledger,
  listAccounts: () => loadAccounts().map(toPublic),
  addBooking: (b) => {
    if (takenFor(b.creatorProfileId).some((t) => t.date === b.date && t.time === b.time))
      return { ok: false, error: 'Ya tienes otra sesión a esa hora. Elige otro horario.' };
    saveBookings([...listBookings(), b]);
    return { ok: true };
  },
  notify,
});

const live = createLocalLive({
  followers: (creatorProfileId) => readJSON<{ follows?: Record<string, string[]> }>('social', {}).follows?.[creatorProfileId] ?? [],
  subscribers: (creatorProfileId) =>
    loadAccounts()
      .filter((a) => a.subscriptions.some((s) => s.creatorId === creatorProfileId && isActiveSub(s)))
      .map((a) => a.id),
  currentUserId: () => readSession(),
  onChange: (cb) => localBackend.onChange(cb),
  notify,
});

const ok = { ok: true } as const;
const fail = (error: string) => ({ ok: false, error });

export const localBackend: Backend = {
  mode: 'local',
  async accessToken() {
    return null;
  },
  platform,
  social,
  gifts,
  rewards,
  special,
  live,

  async getCurrentUser() {
    const id = readSession();
    if (!id) return null;
    const account = loadAccounts().find((a) => a.id === id);
    return account ? toPublic(account) : null;
  },

  onChange(cb) {
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.startsWith(BRAND.storagePrefix)) cb();
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

  async register(name, email, password, role, ref) {
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
    // Someone who arrived through a creator's link: a referred fan or an invited creator.
    if (ref && accounts.some((a) => a.role !== 'fan' && a.creatorProfileId === ref)) {
      rewards.recordReferral(id, role === 'creator' ? 'creator' : 'fan', ref);
    }
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

  // Google/Microsoft sign-in needs the real server (Supabase).
  async signInWithProvider(provider) {
    return fail(`El acceso con ${provider === 'google' ? 'Google' : 'Microsoft'} no está disponible en el modo sin conexión.`);
  },

  async completeSocialSignup() {
    return fail('No hay ningún registro pendiente');
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
    await gifts.purgeUser(user.id);
    await rewards.purgeUser(user.id);
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

  async cancelSubscription(user, creatorId) {
    const account = loadAccounts().find((a) => a.id === user.id);
    const sub = account?.subscriptions.find((s) => s.creatorId === creatorId && isActiveSub(s));
    if (!sub) return fail('No tienes una suscripción activa a este perfil');
    const until = sub.cancelAt ?? nextRenewal(sub.since).toISOString();
    mutate(user.id, (a) => ({ ...a, subscriptions: a.subscriptions.map((s) => (s.creatorId === creatorId ? { ...s, cancelAt: until } : s)) }));
    return { ok: true, until };
  },

  // The local store "sends" the email to the outbox; the link carries a one-time token.
  async requestPasswordReset(email) {
    await seedPromise;
    const clean = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return fail('Introduce un email válido');
    const notice = 'Si existe una cuenta con ese email, te enviamos un enlace para crear una nueva contraseña.';
    if (!loadAccounts().some((a) => a.email === clean)) return { ok: true, notice };
    const token = newId();
    const expires = new Date(Date.now() + 60 * 60_000).toISOString();
    writeJSON(RESETS_KEY, [...readJSON<{ token: string; email: string; expires: string }[]>(RESETS_KEY, []).filter((r) => r.email !== clean), { token, email: clean, expires }]);
    writeJSON(OUTBOX_KEY, [
      ...readJSON<unknown[]>(OUTBOX_KEY, []),
      {
        id: newId(),
        to: clean,
        subject: 'Crea una nueva contraseña',
        body: `Abre este enlace para elegir una nueva contraseña (caduca en 1 hora): ${window.location.origin}/reset-password?token=${token}`,
        sentAt: new Date().toISOString(),
      },
    ]);
    return { ok: true, notice };
  },

  async resetPassword(password, token) {
    if (password.length < 8) return fail('La contraseña debe tener al menos 8 caracteres');
    const resets = readJSON<{ token: string; email: string; expires: string }[]>(RESETS_KEY, []);
    const reset = resets.find((r) => r.token === token && r.expires > new Date().toISOString());
    const account = reset && loadAccounts().find((a) => a.email === reset.email);
    if (!account) return fail('El enlace no es válido o ya caducó. Pide uno nuevo.');
    const salt = newId();
    const passwordHash = await hashPassword(password, salt);
    mutate(account.id, (a) => ({ ...a, salt, passwordHash }));
    writeJSON(RESETS_KEY, resets.filter((r) => r.token !== token));
    return ok;
  },

  async addPost(user, content, isLocked, media, asProfileId) {
    if (!content.trim() && !media) return fail('Escribe algo o añade una foto o video');
    if (asProfileId && (user.role !== 'admin' || !asProfileId.startsWith('m-'))) return fail('Esta acción no está permitida');
    const post = {
      id: newId(),
      content: content.trim(),
      isLocked,
      createdAt: new Date().toISOString(),
      ...(media ? { mediaPath: media.path, mediaType: media.type } : {}),
      ...(asProfileId ? { creatorProfileId: asProfileId } : {}),
    };
    mutate(user.id, (a) => ({ ...a, posts: (a.posts ?? 0) + 1, createdPosts: [post, ...a.createdPosts] }));
    return ok;
  },

  async deletePost(user, postId) {
    const author = loadAccounts().find((a) => a.createdPosts.some((p) => p.id === postId));
    const post = author?.createdPosts.find((p) => p.id === postId);
    if (!author || !post) return fail('Publicación no encontrada');
    // The author, or any admin for a managed profile's post.
    const managedByAdmin = user.role === 'admin' && !!post.creatorProfileId?.startsWith('m-');
    if (author.id !== user.id && !managedByAdmin) return fail('Esta acción no está permitida');
    if (post.mediaPath) await social.removeMedia(user, post.mediaPath);
    mutate(author.id, (a) => ({
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

  createBooking: (user, input) => createBooking(user, input),

  async bookEventSeat(user, experienceId, message) {
    const exp = listExperiences().find((e) => e.id === experienceId && e.active);
    if (!exp) return fail('Evento no encontrado');
    if (!isEventExperience(exp)) return fail('Esta experiencia no es un Reserve Event');
    if (user.creatorProfileId === exp.creatorProfileId) return fail('No puedes reservar tu propio evento');
    if (platform.ledger.cutOff(user.id, exp.creatorProfileId)) return fail('No puedes reservar con este perfil');
    const note = moderate(message ?? '', 'request');
    if (!note.ok) return fail(note.error!);
    const d = detailsOf(exp);
    const subscribed = user.subscriptions.some((s) => s.creatorId === exp.creatorProfileId);
    if (d.requirements.verifiedFans && !user.isVerified) return fail('Este evento es solo para fans con identidad verificada');
    if (d.requirements.subscribersOnly && !subscribed) return fail('Este evento es solo para suscriptores');
    if (!isUpcomingEvent(exp)) return fail('Este evento ya pasó');
    const seats = listBookings().filter((b) => b.experienceId === exp.id && b.details?.kind === 'event' && ACTIVE_STATUSES.includes(b.status));
    if (seats.some((b) => b.fanId === user.id)) return fail('Ya tienes una plaza en este evento');
    if (seats.length >= d.maxParticipants) return fail('No quedan plazas para este evento');
    const price = priceFor(exp, subscribed);
    const now = new Date().toISOString();
    saveBookings([
      ...listBookings(),
      {
        id: newId(),
        experienceId: exp.id,
        creatorProfileId: exp.creatorProfileId,
        title: exp.title,
        creatorName: exp.creatorName,
        price,
        ...(exp.durationMinutes ? { durationMinutes: exp.durationMinutes } : {}),
        date: d.eventDate!,
        time: d.eventTime!,
        message: (message ?? '').trim().slice(0, 500),
        fanId: user.id,
        fanName: user.name,
        fanEmail: user.email,
        status: d.approval === 'automatic' ? 'accepted' : 'pending',
        createdAt: now,
        updatedAt: now,
        details: {
          kind: 'event',
          typeId: exp.type,
          modality: d.modality,
          participants: 1,
          ...(d.modality !== 'virtual' ? { locationType: d.locationTypes[0], city: d.city, venue: d.venue } : {}),
          ...(price !== exp.price ? { listPrice: exp.price, discountPercent: d.subscriberDiscount } : {}),
        },
      },
    ]);
    return ok;
  },

  async eventSeats(experienceIds) {
    const taken: Record<string, number> = {};
    for (const b of listBookings())
      if (b.details?.kind === 'event' && experienceIds.includes(b.experienceId) && ACTIVE_STATUSES.includes(b.status))
        taken[b.experienceId] = (taken[b.experienceId] ?? 0) + 1;
    return taken;
  },

  async requestCustomExperience(user, input) {
    if (user.creatorProfileId === input.creatorProfileId) return fail('No puedes enviarte una solicitud a ti mismo');
    if (platform.ledger.cutOff(user.id, input.creatorProfileId)) return fail('No puedes reservar con este perfil');
    const owner = creatorAccount(input.creatorProfileId);
    const demo = demoCreators.find((c) => c.id === input.creatorProfileId);
    const check = validateCustomRequest(input, owner?.settings.category || demo?.category);
    if (!check.ok) return fail(check.error!);
    const { min, max } = bookingWindow();
    if (input.date < min || input.date > max) return fail('La fecha debe estar dentro de los próximos 3 meses');
    if (!freeHoursOn(loadAvailability(input.creatorProfileId), takenFor(input.creatorProfileId), input.date).includes(input.time))
      return fail('Ese horario ya no está disponible. Elige otro.');
    const now = new Date().toISOString();
    saveBookings([
      ...listBookings(),
      {
        id: newId(),
        experienceId: CUSTOM_EXPERIENCE,
        creatorProfileId: input.creatorProfileId,
        title: customTitle(input.purpose, input.purposeNote),
        creatorName: owner?.name ?? demo?.name ?? 'Creator',
        price: round2(input.budget),
        durationMinutes: input.durationMinutes,
        date: input.date,
        time: input.time,
        message: input.message.trim().slice(0, 500),
        fanId: user.id,
        fanName: user.name,
        fanEmail: user.email,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        details: {
          kind: 'custom',
          modality: input.modality,
          purpose: input.purpose,
          participants: input.participants,
          locationType: input.locationType,
          ...(input.modality !== 'virtual' ? { city: input.city.trim(), venue: input.venue.trim() } : {}),
          ...(check.flags?.length ? { flags: check.flags } : {}),
        },
      },
    ]);
    return ok;
  },

  async counterOffer(user, bookingId, input) {
    const bookings = listBookings();
    const b = bookings.find((x) => x.id === bookingId);
    if (!b || !user.creatorProfileId || b.creatorProfileId !== user.creatorProfileId) return fail('Reserva no encontrada');
    if (b.status !== 'pending') return fail('Solo puedes responder a solicitudes pendientes');
    if (b.details?.ticketId) return fail('Esta reserva usa un ticket de Meta de experiencia: acéptala o recházala');
    const check = validateCounter(input);
    if (!check.ok) return fail(check.error!);
    b.status = 'countered';
    b.updatedAt = new Date().toISOString();
    b.details = {
      ...b.details,
      counter: {
        price: round2(input.price),
        date: input.date,
        time: input.time,
        ...(input.durationMinutes ? { durationMinutes: input.durationMinutes } : {}),
        note: input.note.trim(),
        at: b.updatedAt,
      },
    };
    saveBookings(bookings);
    return ok;
  },

  async respondCounter(user, bookingId, accept) {
    const bookings = listBookings();
    const b = bookings.find((x) => x.id === bookingId);
    if (!b || b.fanId !== user.id) return fail('Reserva no encontrada');
    const c = b.details?.counter;
    if (b.status !== 'countered' || !c) return fail('Esta reserva no tiene una contraoferta pendiente');
    if (accept) {
      const clash = takenFor(b.creatorProfileId).some((t) => t.date === c.date && t.time === c.time);
      if (clash) return fail('Ese horario ya no está disponible. Pide al creador otra fecha.');
      b.price = c.price;
      b.date = c.date;
      b.time = c.time;
      if (c.durationMinutes) b.durationMinutes = c.durationMinutes;
    }
    b.status = accept ? 'accepted' : 'cancelled';
    b.updatedAt = new Date().toISOString();
    saveBookings(bookings);
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
      (isFan && (b.status === 'pending' || b.status === 'accepted' || b.status === 'countered') && next === 'cancelled');
    if (!allowed) return fail('Esta acción no está permitida');
    b.status = next;
    b.updatedAt = new Date().toISOString();
    saveBookings(bookings);
    return ok;
  },

  // Payment is simulated; the confirmation email only goes out after the
  // creator accepted AND the fan paid. The creator is credited like any sale.
  async payBooking(user, bookingId, methodId) {
    const bookings = listBookings();
    const b = bookings.find((x) => x.id === bookingId);
    if (!b || b.fanId !== user.id) return fail('Reserva no encontrada');
    if (b.status !== 'accepted') return fail('Solo puedes pagar una reserva aceptada por el creador');
    const methodLabel = platform.ledger.methodLabel(user.id, methodId);
    if (!methodLabel) return fail('Elige un método de pago');
    const now = new Date().toISOString();
    const charged = platform.ledger.addTransaction({
      key: `vip:${b.id}`,
      payerId: user.id,
      payerName: b.fanName,
      creatorProfileId: b.creatorProfileId,
      creatorName: b.creatorName,
      kind: 'vip',
      amount: round2(b.price),
      // Special accounts keep Reserve al neto; everyone else gets their rate of the net.
      ...(() => {
        const normal = rewards.shareFor(user.id, b.creatorProfileId, new Date(), round2(b.price));
        const special_ = special.reserveShare(b.creatorProfileId, round2(b.price));
        return special_ === undefined ? normal : { share: special_, gatewayFee: normal.gatewayFee };
      })(),
      note: b.title,
      methodLabel,
      status: 'paid',
      createdAt: now,
    });
    if (!charged.ok) return charged;
    b.status = 'confirmed';
    b.updatedAt = now;
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
    saveBookings(bookings);
    return ok;
  },

  async listExperiences() {
    return listExperiences();
  },

  async saveExperience(user, input, id) {
    if (user.role !== 'creator' || !user.creatorProfileId) return fail('Solo los creadores publican experiencias');
    const demo = demoCreators.find((c) => c.id === user.creatorProfileId);
    const check = validateExperience(input, input.details ? user.settings.category || demo?.category || '' : undefined);
    if (!check.ok) return fail(check.error!);
    const list = listExperiences();
    const existing = id ? list.find((e) => e.id === id) : undefined;
    if (id && (!existing || existing.creatorProfileId !== user.creatorProfileId)) return fail('Experiencia no encontrada');
    // Reserve Event seats depend on the creator's level (an event saved earlier keeps its seats).
    const seats = input.details?.format === 'event' ? input.details.maxParticipants : 0;
    const cap = rewards.eventSeatCap(user.creatorProfileId);
    if (seats > cap && (!existing || existing.details?.maxParticipants !== seats))
      return fail(`Con tu nivel actual un Reserve Event tiene hasta ${cap} plazas`);
    const clean = {
      title: input.title.trim(),
      description: input.description.trim(),
      type: input.type,
      price: round2(input.price),
      durationMinutes: input.durationMinutes,
      image: input.image,
      active: input.active,
      ...(input.details ? { details: cleanDetails(input.details) } : {}),
      creatorProfileId: user.creatorProfileId,
      creatorName: user.name,
    };
    saveExperiences(
      existing
        ? list.map((e) => (e.id === id ? { ...e, ...clean } : e))
        : [...list, { ...clean, id: newId(), createdAt: new Date().toISOString() }]
    );
    return ok;
  },

  async deleteExperience(user, id) {
    const list = listExperiences();
    const exp = list.find((e) => e.id === id);
    if (!exp || exp.creatorProfileId !== user.creatorProfileId) return fail('Experiencia no encontrada');
    saveExperiences(list.filter((e) => e.id !== id));
    return ok;
  },

  async fanBookings(fanId) {
    return listBookings()
      .filter((b) => b.fanId === fanId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async markBookingsSeen(user) {
    const bookings = listBookings();
    const now = new Date().toISOString();
    let changed = false;
    for (const b of bookings)
      if (user.creatorProfileId && b.creatorProfileId === user.creatorProfileId && !b.seenAt && (b.status === 'pending' || b.status === 'reschedule_requested')) {
        b.seenAt = now;
        changed = true;
      }
    if (changed) saveBookings(bookings);
  },

  // Phone alerts need the published site (api/push.ts and the database).
  async savePushSubscription() {
    return fail('Los avisos al celular solo funcionan en la web publicada.');
  },

  async deletePushSubscription() {},

  async creatorBookings(id) {
    return listBookings()
      .filter((b) => b.creatorProfileId === id)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  },
};
