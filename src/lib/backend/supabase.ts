// Supabase backend: accounts via Supabase Auth, data in Postgres with Row Level
// Security. Rules that span users (booking lifecycle, account deletion) run in
// SECURITY DEFINER functions, see supabase/migrations.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { WRONG_CREDENTIALS, cleanPatch, mergeSettings, normalizeEmail, validateRegistration } from './shared';
import { DEFAULT_AVAILABILITY, normalizeAvailability } from '../vip';
import type { Backend, BookingStatus, User, UserRole, VipBooking } from './types';

const REMEMBER_KEY = 'sugarfans_remember';

// "Remember me" off keeps the session in sessionStorage (dies with the tab).
const sessionAwareStorage = {
  getItem: (key: string) => {
    try {
      return sessionStorage.getItem(key) ?? localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    try {
      const remember = localStorage.getItem(REMEMBER_KEY) !== 'false';
      (remember ? localStorage : sessionStorage).setItem(key, value);
      (remember ? sessionStorage : localStorage).removeItem(key);
    } catch {
      // ignore
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};

interface ProfileRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar: string;
  bio: string | null;
  is_verified: boolean;
  subscription_price: number | string | null;
  followers: number;
  following: number;
  posts: number;
  age_verified: boolean;
  settings: Partial<User['settings']> | null;
  creator_profile_id: string | null;
  created_at: string;
}

interface BookingRow {
  id: string;
  experience_id: string;
  creator_profile_id: string;
  title: string;
  creator_name: string;
  price: number | string;
  fan_id: string;
  fan_name: string;
  fan_email: string;
  date: string;
  time: string;
  message: string;
  status: BookingStatus;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  email_sent_at: string | null;
}

const toUser = (p: ProfileRow, extra?: Pick<User, 'subscriptions' | 'createdPosts'>): User => ({
  id: p.id,
  name: p.name,
  email: p.email,
  role: p.role,
  avatar: p.avatar,
  bio: p.bio ?? undefined,
  isVerified: p.is_verified,
  subscriptionPrice: p.subscription_price == null ? undefined : Number(p.subscription_price),
  followers: p.followers,
  following: p.following,
  posts: p.posts,
  ageVerified: p.age_verified,
  createdAt: p.created_at,
  settings: mergeSettings(p.settings),
  creatorProfileId: p.creator_profile_id ?? undefined,
  subscriptions: extra?.subscriptions ?? [],
  createdPosts: extra?.createdPosts ?? [],
});

const toBooking = (b: BookingRow): VipBooking => ({
  id: b.id,
  experienceId: b.experience_id,
  creatorProfileId: b.creator_profile_id,
  title: b.title,
  creatorName: b.creator_name,
  price: Number(b.price),
  fanId: b.fan_id,
  fanName: b.fan_name,
  fanEmail: b.fan_email,
  date: b.date,
  time: b.time,
  message: b.message,
  status: b.status,
  createdAt: b.created_at,
  updatedAt: b.updated_at,
  paidAt: b.paid_at ?? undefined,
  emailSentAt: b.email_sent_at ?? undefined,
});

const ok = { ok: true } as const;
const fail = (error: string) => ({ ok: false, error });

// Postgres raises our own Spanish messages; pass those through, hide the rest.
const dbError = (error: { message?: string } | null, fallback: string) => {
  const msg = error?.message ?? '';
  return fail(/[áéíóúñ¿]|Debes|Esta acción|Ese horario|La fecha|No puedes|Reserva/.test(msg) ? msg : fallback);
};

const translateAuthError = (message: string): string => {
  if (/invalid login credentials/i.test(message)) return WRONG_CREDENTIALS;
  if (/already registered|already exists/i.test(message)) return 'Ya existe una cuenta con este email';
  if (/email not confirmed/i.test(message)) return 'Confirma tu email antes de iniciar sesión (revisa tu bandeja de entrada)';
  if (/password/i.test(message) && /least|short|weak/i.test(message)) return 'La contraseña es demasiado débil';
  if (/fetch|network|load failed/i.test(message)) return 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
  if (/rate limit|too many/i.test(message)) return 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
  return 'No se pudo completar la operación. Inténtalo de nuevo.';
};

export const createSupabaseBackend = (url: string, anonKey: string): Backend => {
  const sb: SupabaseClient = createClient(url, anonKey, {
    auth: { storage: sessionAwareStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const reauthenticate = async (email: string, password: string) => {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    return !error;
  };

  return {
    mode: 'supabase',

    async getCurrentUser() {
      const { data: sessionData } = await sb.auth.getSession();
      const uid = sessionData.session?.user.id;
      if (!uid) return null;
      const [profile, subs, posts] = await Promise.all([
        sb.from('profiles').select('*').eq('id', uid).maybeSingle(),
        sb.from('subscriptions').select('creator_id, price, since').eq('fan_id', uid),
        sb.from('creator_posts').select('id, content, is_locked, created_at').eq('creator_id', uid).order('created_at', { ascending: false }),
      ]);
      if (!profile.data) return null;
      return toUser(profile.data as ProfileRow, {
        subscriptions: (subs.data ?? []).map((s) => ({ creatorId: s.creator_id, price: Number(s.price), since: s.since })),
        createdPosts: (posts.data ?? []).map((p) => ({ id: p.id, content: p.content, isLocked: p.is_locked, createdAt: p.created_at })),
      });
    },

    onChange(cb) {
      const { data } = sb.auth.onAuthStateChange((event) => {
        if (event !== 'TOKEN_REFRESHED') setTimeout(cb, 0);
      });
      return () => data.subscription.unsubscribe();
    },

    async login(email, password, remember) {
      try {
        localStorage.setItem(REMEMBER_KEY, String(remember));
      } catch {
        // ignore
      }
      const { error } = await sb.auth.signInWithPassword({ email: normalizeEmail(email), password });
      return error ? fail(translateAuthError(error.message)) : ok;
    },

    async register(name, email, password, role) {
      const cleanEmail = normalizeEmail(email);
      const valid = validateRegistration(name, cleanEmail, password, role);
      if (!valid.ok) return valid;
      try {
        localStorage.setItem(REMEMBER_KEY, 'true');
      } catch {
        // ignore
      }
      const { data, error } = await sb.auth.signUp({
        email: cleanEmail,
        password,
        // The terms checkbox at sign-up confirms the user is 18+.
        options: { data: { name: name.trim(), role, age_verified: true }, emailRedirectTo: `${window.location.origin}/login` },
      });
      if (error) return fail(translateAuthError(error.message));
      // With "Confirm email" enabled Supabase returns no session and, for an
      // address that already exists, a user with no identities.
      if (data.user && data.user.identities?.length === 0) return fail('Ya existe una cuenta con este email');
      if (!data.session) {
        return { ok: true, needsConfirmation: true, notice: `Te enviamos un correo a ${cleanEmail}. Confírmalo para iniciar sesión.` };
      }
      return ok;
    },

    async logout() {
      await sb.auth.signOut();
    },

    async updateProfile(user, patch) {
      const cleaned = cleanPatch(patch);
      if (!cleaned.patch) return fail(cleaned.error!);
      const { email, name, avatar, bio, subscriptionPrice, settings, ageVerified } = cleaned.patch;
      const row: Record<string, unknown> = {};
      if (name !== undefined) row.name = name;
      if (avatar !== undefined) row.avatar = avatar;
      if (bio !== undefined) row.bio = bio;
      if (subscriptionPrice !== undefined) row.subscription_price = subscriptionPrice;
      if (settings !== undefined) row.settings = settings;
      if (ageVerified !== undefined) row.age_verified = ageVerified;
      if (Object.keys(row).length) {
        const { error } = await sb.from('profiles').update(row).eq('id', user.id);
        if (error) return dbError(error, 'No se pudieron guardar los cambios');
      }
      if (email !== undefined && email !== user.email) {
        const { data, error } = await sb.auth.updateUser({ email }, { emailRedirectTo: `${window.location.origin}/settings` });
        if (error) return fail(/already|registered|exists/i.test(error.message) ? 'Ese email ya está en uso por otra cuenta' : translateAuthError(error.message));
        if (data.user?.email !== email) {
          return { ok: true, notice: `Te enviamos un correo a ${email} para confirmar el cambio de email.` };
        }
      }
      return ok;
    },

    async changePassword(user, current, next) {
      if (!(await reauthenticate(user.email, current))) return fail('La contraseña actual no es correcta');
      if (next.length < 8) return fail('La nueva contraseña debe tener al menos 8 caracteres');
      const { error } = await sb.auth.updateUser({ password: next });
      return error ? fail(translateAuthError(error.message)) : ok;
    },

    async deleteAccount(user, password) {
      if (!(await reauthenticate(user.email, password))) return fail('La contraseña no es correcta');
      const { error } = await sb.rpc('delete_my_account');
      if (error) return dbError(error, 'No se pudo eliminar la cuenta');
      await sb.auth.signOut({ scope: 'local' });
      return ok;
    },

    async setSubscription(user, creatorId, price, subscribed) {
      const { error } = subscribed
        ? await sb.from('subscriptions').upsert({ fan_id: user.id, creator_id: creatorId, price })
        : await sb.from('subscriptions').delete().eq('fan_id', user.id).eq('creator_id', creatorId);
      return error ? dbError(error, 'No se pudo actualizar la suscripción') : ok;
    },

    async addPost(user, content, isLocked) {
      if (!content.trim()) return fail('Escribe algo antes de publicar');
      const { error } = await sb.from('creator_posts').insert({ creator_id: user.id, content: content.trim(), is_locked: isLocked });
      return error ? dbError(error, 'No se pudo publicar') : ok;
    },

    async deletePost(user, postId) {
      const { error } = await sb.from('creator_posts').delete().eq('id', postId).eq('creator_id', user.id);
      return error ? dbError(error, 'No se pudo eliminar la publicación') : ok;
    },

    async listAccounts() {
      const { data } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
      return (data ?? []).map((p) => toUser(p as ProfileRow));
    },

    async getAvailability(id) {
      const { data } = await sb.from('vip_availability').select('days, hours').eq('creator_profile_id', id).maybeSingle();
      return data ? { days: data.days, hours: data.hours } : DEFAULT_AVAILABILITY;
    },

    async setAvailability(id, availability) {
      if (availability.days.length === 0 || availability.hours.length === 0) return fail('Elige al menos un día y una hora');
      const a = normalizeAvailability(availability);
      const { error } = await sb
        .from('vip_availability')
        .upsert({ creator_profile_id: id, days: a.days, hours: a.hours, updated_at: new Date().toISOString() });
      return error ? dbError(error, 'No se pudieron guardar los horarios') : ok;
    },

    async takenSlots(id) {
      const { data } = await sb.rpc('vip_taken_slots', { p_creator_profile_id: id });
      return (data ?? []) as { date: string; time: string }[];
    },

    async createBooking(_user, input) {
      if (!input.date) return fail('Elige un día en el calendario');
      if (!input.time) return fail('Elige una hora disponible');
      const { error } = await sb.rpc('vip_create_booking', {
        p_experience_id: input.experienceId,
        p_creator_profile_id: input.creatorProfileId,
        p_title: input.title,
        p_creator_name: input.creatorName,
        p_price: input.price,
        p_date: input.date,
        p_time: input.time,
        p_message: input.message,
      });
      return error ? dbError(error, 'No se pudo enviar la reserva') : ok;
    },

    async updateBooking(_user, bookingId, next) {
      const { error } = await sb.rpc('vip_update_booking', { p_booking_id: bookingId, p_next: next });
      return error ? dbError(error, 'No se pudo actualizar la reserva') : ok;
    },

    async fanBookings(fanId) {
      const { data } = await sb.from('vip_bookings').select('*').eq('fan_id', fanId).order('created_at', { ascending: false });
      return (data ?? []).map((b) => toBooking(b as BookingRow));
    },

    async creatorBookings(id) {
      const { data } = await sb
        .from('vip_bookings')
        .select('*')
        .eq('creator_profile_id', id)
        .order('date', { ascending: true })
        .order('time', { ascending: true });
      return (data ?? []).map((b) => toBooking(b as BookingRow));
    },
  };
};
