// Supabase backend: accounts via Supabase Auth, data in Postgres with Row Level
// Security. Rules that span users (booking lifecycle, account deletion) run in
// SECURITY DEFINER functions, see supabase/migrations.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PAID_WITH_PAYPAL, WRONG_CREDENTIALS, cleanPatch, mergeSettings, normalizeEmail, validateRegistration } from './shared';
import { DEFAULT_AVAILABILITY, cleanDetails, customTitle, normalizeAvailability, validateCounter, validateCustomRequest, validateExperience } from '../vip';
import type { Backend, BookingDetails, BookingStatus, ExperienceType, ReserveDetails, SocialProvider, User, UserRole, VipBooking, VipExperience } from './types';
import { creators as demoCreators } from '../../data/mockData';
import { createSupabasePlatform } from './supabasePlatform';
import { createSupabaseSocial } from './supabaseSocial';
import { createSupabaseLive } from './supabaseLive';
import { createSupabaseGifts } from './supabaseGifts';
import { createSupabaseRewards } from './supabaseRewards';
import { BRAND } from '../../config/brand';

const REMEMBER_KEY = `${BRAND.storagePrefix}remember`;

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
  // Missing until the social-login migration is applied.
  signup_completed?: boolean;
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
  duration_minutes: number | null;
  // Missing until migration 20261002000001_reserve is applied.
  details?: BookingDetails | null;
  // Missing until migration 20261005000001_reserve_alerts is applied.
  seen_at?: string | null;
  respond_by?: string | null;
}

interface ExperienceRow {
  id: string;
  creator_profile_id: string;
  creator_name: string;
  title: string;
  description: string;
  type: ExperienceType;
  price: number | string;
  duration_minutes: number | null;
  image: string;
  active: boolean;
  created_at: string;
  details?: Partial<ReserveDetails> | null;
}

const hasDetails = (d: object | null | undefined): d is object => !!d && Object.keys(d).length > 0;

const toExperience = (e: ExperienceRow): VipExperience => ({
  id: e.id,
  creatorProfileId: e.creator_profile_id,
  creatorName: e.creator_name,
  title: e.title,
  description: e.description,
  type: e.type,
  price: Number(e.price),
  durationMinutes: e.duration_minutes ?? undefined,
  image: e.image,
  active: e.active,
  createdAt: e.created_at,
  ...(hasDetails(e.details) ? { details: e.details as ReserveDetails } : {}),
});

const toUser = (p: ProfileRow, extra?: Pick<User, 'subscriptions' | 'createdPosts' | 'authProvider'>): User => ({
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
  authProvider: extra?.authProvider,
  signupCompleted: p.signup_completed !== false,
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
  durationMinutes: b.duration_minutes ?? undefined,
  ...(hasDetails(b.details) ? { details: b.details as BookingDetails } : {}),
  ...(b.seen_at ? { seenAt: b.seen_at } : {}),
  ...(b.respond_by ? { respondBy: b.respond_by } : {}),
});

const ok = { ok: true } as const;
const fail = (error: string) => ({ ok: false, error });

// Postgres raises our own Spanish messages; pass those through, hide the rest.
const dbError = (error: { message?: string } | null, fallback: string) => {
  const msg = error?.message ?? '';
  return fail(/[áéíóúñ¿]|Debes|Esta acción|Ese horario|La fecha|No puedes|No tienes|Reserva|Solo|Elige|Experiencia|Este perfil|Esta experiencia|Fans Reserve|Las experiencias|Mantén|El presupuesto|La duración|Entre|No quedan|Ya tienes|Evento|Este evento|Un Reserve Event|Indica/.test(msg) ? msg : fallback);
};

const translateAuthError = (message: string): string => {
  if (/invalid login credentials/i.test(message)) return WRONG_CREDENTIALS;
  if (/already registered|already exists/i.test(message)) return 'Ya existe una cuenta con este email';
  if (/email address .* is invalid|invalid email|email_address_invalid/i.test(message)) return 'Introduce un email válido';
  if (/email not confirmed/i.test(message)) return 'Confirma tu email antes de iniciar sesión (revisa tu bandeja de entrada)';
  if (/password/i.test(message) && /least|short|weak/i.test(message)) return 'La contraseña es demasiado débil';
  if (/fetch|network|load failed/i.test(message)) return 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
  if (/rate limit|too many/i.test(message)) return 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
  return 'No se pudo completar la operación. Inténtalo de nuevo.';
};

const PROVIDER_NAMES: Record<SocialProvider, string> = { google: 'Google', azure: 'Microsoft' };

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
    async accessToken() {
      const { data } = await sb.auth.getSession();
      return data.session?.access_token ?? null;
    },
    platform: createSupabasePlatform(sb),
    social: createSupabaseSocial(sb),
    gifts: createSupabaseGifts(sb),
    rewards: createSupabaseRewards(sb),
    live: createSupabaseLive(sb, url, anonKey),

    async getCurrentUser() {
      const { data: sessionData } = await sb.auth.getSession();
      const uid = sessionData.session?.user.id;
      if (!uid) return null;
      const authProvider = (sessionData.session?.user.app_metadata?.provider as string | undefined) ?? 'email';
      const [profile, subs, posts] = await Promise.all([
        sb.from('profiles').select('*').eq('id', uid).maybeSingle(),
        sb.from('subscriptions').select('creator_id, price, since, cancel_at').eq('fan_id', uid),
        sb.from('creator_posts').select('id, content, is_locked, created_at, media_path, media_type').eq('creator_id', uid).order('created_at', { ascending: false }),
      ]);
      if (!profile.data) return null;
      return toUser(profile.data as ProfileRow, {
        authProvider,
        // A cancelled subscription counts until its end date.
        subscriptions: (subs.data ?? [])
          .filter((s) => !s.cancel_at || new Date(s.cancel_at) > new Date())
          .map((s) => ({ creatorId: s.creator_id, price: Number(s.price), since: s.since, ...(s.cancel_at ? { cancelAt: s.cancel_at } : {}) })),
        createdPosts: (posts.data ?? []).map((p) => ({
          id: p.id,
          content: p.content,
          isLocked: p.is_locked,
          createdAt: p.created_at,
          mediaPath: p.media_path ?? undefined,
          mediaType: p.media_type ?? undefined,
        })),
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

    async register(name, email, password, role, ref) {
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
        options: { data: { name: name.trim(), role, age_verified: true, ...(ref ? { ref } : {}) }, emailRedirectTo: `${window.location.origin}/login` },
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

    async signInWithProvider(provider, redirectTo) {
      const name = PROVIDER_NAMES[provider];
      // A provider that isn't switched on in Supabase would land on a raw JSON error.
      try {
        const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } });
        const settings = (await res.json()) as { external?: Record<string, boolean> };
        if (!settings.external?.[provider]) return fail(`El acceso con ${name} todavía no está activado. Usa tu email y contraseña.`);
      } catch {
        return fail(translateAuthError('fetch failed'));
      }
      try {
        localStorage.setItem(REMEMBER_KEY, 'true');
      } catch {
        // ignore
      }
      const { error } = await sb.auth.signInWithOAuth({
        provider,
        // Microsoft only shares the email address when asked for it.
        options: { redirectTo, ...(provider === 'azure' ? { scopes: 'email' } : {}) },
      });
      return error ? fail(translateAuthError(error.message)) : ok;
    },

    async completeSocialSignup(role, ref) {
      if (role !== 'fan' && role !== 'creator') return fail('Elige un tipo de cuenta');
      const { error } = await sb.rpc('complete_social_signup', { p_role: role, p_ref: ref ?? null });
      return error ? dbError(error, 'No se pudo completar el registro') : ok;
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
      // Google/Microsoft accounts have no password; the typed confirmation is the check.
      if ((user.authProvider ?? 'email') === 'email' && !(await reauthenticate(user.email, password))) return fail('La contraseña no es correcta');
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

    async cancelSubscription(_user, creatorId) {
      const { data, error } = await sb.rpc('cancel_subscription', { p_creator_profile_id: creatorId });
      if (!error) return { ok: true, until: data as string };
      if (!/se paga con PayPal/.test(error.message)) return dbError(error, 'No se pudo cancelar la suscripción');
      // Paid with PayPal: the server cancels it at PayPal first, then here.
      const token = (await sb.auth.getSession()).data.session?.access_token;
      const r = await fetch('/api/paypal', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token ?? ''}` },
        body: JSON.stringify({ action: 'cancel-subscription', creatorProfileId: creatorId }),
      }).catch(() => null);
      const body = (await r?.json().catch(() => null)) as { until?: string; error?: string } | null;
      return r?.ok ? { ok: true, until: body?.until } : fail(body?.error || 'No se pudo cancelar la suscripción en PayPal. Intenta de nuevo.');
    },

    async requestPasswordReset(email) {
      const clean = normalizeEmail(email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return fail('Introduce un email válido');
      const { error } = await sb.auth.resetPasswordForEmail(clean, { redirectTo: `${window.location.origin}/reset-password` });
      // Rate limits are worth telling; "no such user" is not (it would reveal who has an account).
      if (error && /rate limit|too many|seconds/i.test(error.message)) return fail(translateAuthError(error.message));
      return { ok: true, notice: 'Si existe una cuenta con ese email, te enviamos un enlace para crear una nueva contraseña.' };
    },

    // The emailed link signs the user in (recovery session); then the password can change.
    async resetPassword(password) {
      if (password.length < 8) return fail('La contraseña debe tener al menos 8 caracteres');
      const { data } = await sb.auth.getSession();
      if (!data.session) return fail('El enlace no es válido o ya caducó. Pide uno nuevo.');
      const { error } = await sb.auth.updateUser({ password });
      return error ? fail(translateAuthError(error.message)) : ok;
    },

    async addPost(user, content, isLocked, media, asProfileId) {
      if (!content.trim() && !media) return fail('Escribe algo o añade una foto o video');
      const { error } = await sb.from('creator_posts').insert({
        creator_id: user.id,
        content: content.trim(),
        is_locked: isLocked,
        media_path: media?.path ?? null,
        media_type: media?.type ?? null,
        // The server keeps it only for admins posting as a managed profile.
        creator_profile_id: asProfileId ?? null,
      });
      return error ? dbError(error, 'No se pudo publicar') : ok;
    },

    async deletePost(_user, postId) {
      // RLS: the author, or any admin for a managed profile's post. The file goes
      // first because the admin storage rule looks the post up.
      const { data: post } = await sb.from('creator_posts').select('media_path').eq('id', postId).maybeSingle();
      if (post?.media_path) await sb.storage.from('post-media').remove([post.media_path]);
      const { data, error } = await sb.from('creator_posts').delete().eq('id', postId).select('id');
      if (error || !data?.length) return dbError(error, 'No se pudo eliminar la publicación');
      return ok;
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
      // Creator, title, price, discount and approval come from the experience (server side).
      const { error } = await sb.rpc('reserve_create_booking', {
        p_experience_id: input.experienceId,
        p_date: input.date,
        p_time: input.time,
        p_message: input.message,
        p_participants: input.participants ?? 1,
      });
      return error ? dbError(error, 'No se pudo enviar la reserva') : ok;
    },

    async bookEventSeat(_user, experienceId, message) {
      // Day, time, price and seats come from the event (server side).
      const { error } = await sb.rpc('reserve_book_event_seat', { p_experience_id: experienceId, p_message: message });
      if (error && /reserve_book_event_seat/.test(error.message)) return fail('Los Reserve Events aún no están activados en la base de datos.');
      return error ? dbError(error, 'No se pudo reservar tu plaza') : ok;
    },

    async eventSeats(experienceIds) {
      if (!experienceIds.length) return {};
      const { data } = await sb.rpc('reserve_event_seats', { p_experience_ids: experienceIds });
      return Object.fromEntries(((data ?? []) as { experience_id: string; taken: number }[]).map((r) => [r.experience_id, Number(r.taken)]));
    },

    async requestCustomExperience(_user, input) {
      const demo = demoCreators.find((c) => c.id === input.creatorProfileId);
      const category = demo?.category ?? (await sb.rpc('creator_category', { p_creator_profile_id: input.creatorProfileId })).data;
      const check = validateCustomRequest(input, typeof category === 'string' ? category : undefined);
      if (!check.ok) return fail(check.error!);
      const { error } = await sb.rpc('reserve_request_custom', {
        p_creator_profile_id: input.creatorProfileId,
        p_date: input.date,
        p_time: input.time,
        p_duration: input.durationMinutes,
        p_budget: input.budget,
        p_participants: input.participants,
        p_message: input.message,
        p_title: customTitle(input.purpose, input.purposeNote),
        p_details: {
          modality: input.modality,
          purpose: input.purpose,
          locationType: input.locationType,
          ...(input.modality !== 'virtual' ? { city: input.city.trim(), venue: input.venue.trim() } : {}),
          ...(check.flags?.length ? { flags: check.flags } : {}),
        },
      });
      return error ? dbError(error, 'No se pudo enviar la solicitud') : ok;
    },

    async counterOffer(_user, bookingId, input) {
      const check = validateCounter(input);
      if (!check.ok) return fail(check.error!);
      const { error } = await sb.rpc('reserve_counter_offer', {
        p_booking_id: bookingId,
        p_price: input.price,
        p_date: input.date,
        p_time: input.time,
        p_duration: input.durationMinutes ?? null,
        p_note: input.note,
      });
      return error ? dbError(error, 'No se pudo enviar la contraoferta') : ok;
    },

    async respondCounter(_user, bookingId, accept) {
      const { error } = await sb.rpc('reserve_respond_counter', { p_booking_id: bookingId, p_accept: accept });
      return error ? dbError(error, 'No se pudo responder a la contraoferta') : ok;
    },

    async updateBooking(_user, bookingId, next) {
      const { error } = await sb.rpc('vip_update_booking', { p_booking_id: bookingId, p_next: next });
      return error ? dbError(error, 'No se pudo actualizar la reserva') : ok;
    },

    async payBooking(_user, bookingId, methodId) {
      if (methodId === PAID_WITH_PAYPAL) return ok; // the server already charged and confirmed it
      const { error } = await sb.rpc('vip_pay_booking', { p_booking_id: bookingId, p_method_id: methodId });
      return error ? dbError(error, 'No se pudo completar el pago') : ok;
    },

    async listExperiences() {
      const { data } = await sb.from('vip_experiences').select('*').order('created_at', { ascending: true });
      return ((data ?? []) as ExperienceRow[]).map(toExperience);
    },

    async saveExperience(user, input, id) {
      const demoCategory = demoCreators.find((c) => c.id === user.creatorProfileId)?.category;
      const check = validateExperience(input, input.details ? user.settings.category || demoCategory || '' : undefined);
      if (!check.ok) return fail(check.error!);
      // The server fills in the creator's profile id and name.
      const row = {
        title: input.title.trim(),
        description: input.description.trim(),
        type: input.type,
        price: Math.round(input.price * 100) / 100,
        duration_minutes: input.durationMinutes ?? null,
        image: input.image,
        active: input.active,
        ...(input.details ? { details: cleanDetails(input.details) } : {}),
        creator_profile_id: user.creatorProfileId,
        creator_name: user.name,
      };
      const { error } = id
        ? await sb.from('vip_experiences').update(row).eq('id', id)
        : await sb.from('vip_experiences').insert(row);
      return error ? dbError(error, 'No se pudo guardar la experiencia') : ok;
    },

    async deleteExperience(_user, id) {
      const { data, error } = await sb.from('vip_experiences').delete().eq('id', id).select('id');
      if (error || !data?.length) return dbError(error, 'No se pudo eliminar la experiencia');
      return ok;
    },

    async fanBookings(fanId) {
      const { data } = await sb.from('vip_bookings').select('*').eq('fan_id', fanId).order('created_at', { ascending: false });
      return (data ?? []).map((b) => toBooking(b as BookingRow));
    },

    async markBookingsSeen() {
      // Quietly does nothing until the migration is applied.
      await sb.rpc('reserve_mark_seen');
    },

    async savePushSubscription(sub) {
      const { error } = await sb.rpc('save_push_subscription', { p_endpoint: sub.endpoint, p_p256dh: sub.p256dh, p_auth: sub.auth });
      return error ? fail('No se pudieron activar los avisos. Inténtalo de nuevo.') : ok;
    },

    async deletePushSubscription(endpoint) {
      await sb.rpc('delete_push_subscription', { p_endpoint: endpoint });
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
