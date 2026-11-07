// Supabase backend: accounts via Supabase Auth, data in Postgres with Row Level
// Security. Rules that span users (booking lifecycle, account deletion) run in
// SECURITY DEFINER functions, see supabase/migrations.
import { TERMS_VERSION } from '../../config/legal';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PAID_WITH_PAYPAL, WRONG_CREDENTIALS, ACCOUNT_SUSPENDED, avatarOrEmpty, cleanPatch, mergeSettings, normalizeEmail, validateRegistration, validateSignupExtras } from './shared';
import { REJECTED_MESSAGE, inReviewNotice, moderateUpload, moderationOf } from './supabaseModeration';
import { DEFAULT_AVAILABILITY, cleanDetails, customTitle, normalizeAvailability, validateCounter, validateCustomRequest, validateExperience } from '../vip';
import type { Backend, BookingDetails, BookingStatus, ExperienceType, ReserveDetails, SocialProvider, User, UserRole, VipBooking, VipExperience } from './types';
import { isGender } from './types';
import { isTimeZone, viewerTimeZone } from '../timeZones';
import { creators as demoCreators } from '../../data/mockData';
import { createSupabasePlatform } from './supabasePlatform';
import { createSupabaseSocial } from './supabaseSocial';
import { createSupabaseLive } from './supabaseLive';
import { createSupabaseGifts } from './supabaseGifts';
import { createSupabaseRewards } from './supabaseRewards';
import { createSupabaseSpecial } from './supabaseSpecial';
import { createSupabaseProspects } from './supabaseProspects';
import { BRAND } from '../../config/brand';
import { fromRpc } from '../infraUsage';
import type { MonitorKey, MonitorNewKey, MonitorSnapshot } from '../adminMonitor';
import { createSupabaseFinance } from './supabaseFinance';
import { isDemoEmail } from '../../config/demoAccounts';

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
  cover?: string | null;
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
  // Missing until migration 20261006000003_country_phone is applied.
  country?: string | null;
  phone?: string | null;
  // Missing until migration 20261016000001_creator_country_from_id is applied.
  id_country?: string | null;
  // Missing until migration 20261105000001_profile_gender is applied.
  gender?: string | null;
  // Missing until migration 20261010000004_creator_username_socials is applied.
  username?: string | null;
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
  // Missing until migration 20261005000002_reserve_alerts is applied.
  seen_at?: string | null;
  respond_by?: string | null;
  // Missing until migration 20261026210000_reserve_time_zones is applied.
  time_zone?: string | null;
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
  time_zone?: string | null;
}


// Writes that add the creator's time zone retry without it while the column
// doesn't exist yet (migration 20261026210000 not applied).
const missingTimeZone = (error: { message?: string } | null) => !!error && /time_zone/.test(error.message ?? '');

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
  ...(e.time_zone ? { timeZone: e.time_zone } : {}),
});

const toUser = (p: ProfileRow, extra?: Pick<User, 'subscriptions' | 'createdPosts' | 'authProvider' | 'isOwner' | 'role'>): User => ({
  id: p.id,
  name: p.name,
  email: p.email,
  role: extra?.isOwner ? extra.role ?? p.role : p.role,
  isOwner: extra?.isOwner === true,
  accountRole: p.role,
  avatar: avatarOrEmpty(p.avatar),
  cover: p.cover || undefined,
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
  country: p.country ?? undefined,
  phone: p.phone ?? undefined,
  idCountry: p.id_country ?? undefined,
  gender: isGender(p.gender) ? p.gender : undefined,
  username: p.username ?? undefined,
});

const toBooking = (b: BookingRow): VipBooking => ({
  incomePolicyVersion: (b as BookingRow & { income_policy_version?: string }).income_policy_version,
  paymentDueAt: (b as BookingRow & { payment_due_at?: string }).payment_due_at,
  paymentChecking: (b as BookingRow & { payment_checking?: boolean }).payment_checking,
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
  ...(b.time_zone ? { timeZone: b.time_zone } : {}),
});

const ok = { ok: true } as const;
const fail = (error: string) => ({ ok: false, error });

// Postgres raises our own Spanish messages; pass those through, hide the rest.
const dbError = (error: { message?: string } | null, fallback: string) => {
  const msg = error?.message ?? '';
  return fail(/[áéíóúñ¿]|Debes|Esta acción|Ese horario|La fecha|No puedes|No tienes|Reserva|Solo|Elige|Experiencia|Este perfil|Esta experiencia|Fans Reserve|Las experiencias|Mantén|El presupuesto|La duración|Entre|No quedan|Ya tienes|Evento|Este evento|Un Reserve Event|Indica|Tu cuenta|Esta cuenta|Termina|Las cuentas demo|Esta reserva|Ya usaste|Ya pediste|Este pago|El cambio|La nueva/.test(msg) ? msg : fallback);
};

const translateAuthError = (message: string): string => {
  if (/invalid login credentials/i.test(message)) return WRONG_CREDENTIALS;
  if (/banned/i.test(message)) return ACCOUNT_SUSPENDED;
  if (/already registered|already exists/i.test(message)) return 'Ya existe una cuenta con este email';
  if (/email address .* is invalid|invalid email|email_address_invalid/i.test(message)) return 'Introduce un email válido';
  if (/email not confirmed/i.test(message)) return 'Confirma tu email antes de iniciar sesión (revisa tu bandeja de entrada)';
  if (/different from the old password|same_password/i.test(message)) return 'La contraseña nueva debe ser distinta de la que ya tenías';
  if (/password/i.test(message) && /least|short|weak/i.test(message)) return 'La contraseña es demasiado débil';
  if (/fetch|network|load failed/i.test(message)) return 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
  if (/rate limit|too many/i.test(message)) return 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
  return 'No se pudo completar la operación. Inténtalo de nuevo.';
};

// Key of a device trusted for two-step verification (only its hash is stored server-side).
const DEVICE_KEY = `${BRAND.storagePrefix}mfa_device`;
const readDeviceKey = (): string | null => {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
};
const writeDeviceKey = (value: string | null) => {
  try {
    if (value) localStorage.setItem(DEVICE_KEY, value);
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    // Private mode: the code is asked again next time.
  }
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
    finance: createSupabaseFinance(sb),
    social: createSupabaseSocial(sb),
    gifts: createSupabaseGifts(sb),
    rewards: createSupabaseRewards(sb),
    special: createSupabaseSpecial(sb),
    prospects: createSupabaseProspects(sb),
    live: createSupabaseLive(sb, url, anonKey),

    // Two-step verification with an authenticator app (Settings > Seguridad).
    mfa: {
      async status() {
        const [{ data: factors }, { data: level }] = await Promise.all([
          sb.auth.mfa.listFactors(),
          sb.auth.mfa.getAuthenticatorAssuranceLevel(),
        ]);
        const factor = factors?.totp?.find((f) => f.status === 'verified') ?? null;
        let needsCode = !!factor && level?.currentLevel !== 'aal2';
        // A device trusted earlier marks this new session as verified.
        const device = readDeviceKey();
        if (needsCode && device) {
          const { data } = await sb.rpc('mfa_device_login', { p_token: device });
          if (data === true) needsCode = false;
          else writeDeviceKey(null);
        }
        return { enabled: !!factor, factorId: factor?.id ?? null, needsCode };
      },
      async enroll() {
        // A half-finished setup would block a new one with the same name.
        const { data: factors } = await sb.auth.mfa.listFactors();
        for (const f of factors?.all ?? []) if (f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
        const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: BRAND.name });
        if (error || !data) return { ok: false, error: 'No se pudo activar la verificación en dos pasos. Inténtalo de nuevo.' };
        return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
      },
      async verify(factorId, code, trustDevice) {
        const clean = code.replace(/\s+/g, '');
        if (!/^\d{6}$/.test(clean)) return { ok: false, error: 'Escribe los 6 números que muestra tu app.' };
        const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: clean });
        if (error) return { ok: false, error: /rate|too many/i.test(error.message) ? 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.' : 'El código no es correcto o ya cambió. Usa el código que muestra ahora tu app.' };
        if (trustDevice) {
          const label = (typeof navigator !== 'undefined' ? navigator.userAgent : '').slice(0, 120);
          const { data } = await sb.rpc('mfa_trust_device', { p_label: label });
          if (typeof data === 'string' && data) writeDeviceKey(data);
        }
        return { ok: true };
      },
      async forgetDevices() {
        const { error } = await sb.rpc('mfa_forget_devices');
        if (error) return { ok: false, error: 'Para hacerlo, entra con tu código de la app y vuelve a intentarlo.' };
        writeDeviceKey(null);
        return { ok: true };
      },
      async disable(factorId) {
        const { error } = await sb.auth.mfa.unenroll({ factorId });
        if (error) return { ok: false, error: 'Para desactivarla, entra con tu código de la app y vuelve a intentarlo.' };
        await sb.rpc('mfa_forget_devices');
        writeDeviceKey(null);
        await sb.auth.refreshSession();
        return { ok: true };
      },
    },

    async getCurrentUser() {
      const { data: sessionData } = await sb.auth.getSession();
      const uid = sessionData.session?.user.id;
      if (!uid) return null;
      if (isDemoEmail(sessionData.session?.user.email)) return null;
      const authProvider = (sessionData.session?.user.app_metadata?.provider as string | undefined) ?? 'email';
      const [profile, subs, posts, owner] = await Promise.all([
        sb.from('profiles').select('*').eq('id', uid).maybeSingle(),
        sb.from('subscriptions').select('creator_id, price, since, cancel_at').eq('fan_id', uid),
        sb.from('creator_posts').select('id, content, is_locked, created_at, media_path, media_type, is_draft').eq('creator_id', uid).order('created_at', { ascending: false }),
        sb.rpc('owner_access'),
      ]);
      if (!profile.data) return null;
      const moderation = await moderationOf(sb, 'post-media', (posts.data ?? []).map((p) => p.media_path).filter(Boolean) as string[]);
      return toUser(profile.data as ProfileRow, {
        isOwner: !owner.error && owner.data?.owner === true && ['fan','creator','admin'].includes(owner.data?.view),
        role: owner.data?.view,
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
          isDraft: !!p.is_draft,
          ...(p.media_path && moderation.get(p.media_path) && moderation.get(p.media_path) !== 'approved'
            ? { moderation: moderation.get(p.media_path) }
            : {}),
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
      if (isDemoEmail(email)) return fail('Las cuentas de demostración solo están disponibles en las pruebas locales.');
      try {
        localStorage.setItem(REMEMBER_KEY, String(remember));
      } catch {
        // ignore
      }
      const { error } = await sb.auth.signInWithPassword({ email: normalizeEmail(email), password });
      return error ? fail(translateAuthError(error.message)) : ok;
    },

    async ownerSwitchView(view) {
      const { error } = await sb.rpc('owner_switch_view', { p_view: view });
      return error ? dbError(error, 'No se pudo cambiar de vista') : ok;
    },

    async register(name, email, password, role, ref, extras) {
      const cleanEmail = normalizeEmail(email);
      const valid = validateRegistration(name, cleanEmail, password, role);
      if (!valid.ok) return valid;
      const validExtras = validateSignupExtras(extras);
      if (!validExtras.ok) return validExtras;
      try {
        localStorage.setItem(REMEMBER_KEY, 'true');
      } catch {
        // ignore
      }
      const { data, error } = await sb.auth.signUp({
        email: cleanEmail,
        password,
        // The terms checkbox at sign-up confirms the user is 18+.
        options: {
          data: {
            name: name.trim(),
            role,
            age_verified: true,
            country: extras?.country,
            ...(extras?.phone ? { phone: extras.phone } : {}),
            ...(extras?.gender ? { gender: extras.gender } : {}),
            // The required terms checkbox: the server stamps the date (profiles.terms_accepted_at).
            terms_version: TERMS_VERSION,
            ...(ref ? { ref } : {}),
          },
          emailRedirectTo: `${window.location.origin}/login`,
        },
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

    async completeSocialSignup(role, ref, extras) {
      if (role !== 'fan' && role !== 'creator') return fail('Elige un tipo de cuenta');
      const validExtras = validateSignupExtras(extras);
      if (!validExtras.ok) return validExtras;
      let { error } = await sb.rpc('complete_social_signup', {
        p_role: role,
        p_ref: ref ?? null,
        p_country: extras?.country ?? null,
        p_phone: extras?.phone || null,
      });
      // Until migration 20261006000003_country_phone is applied the function has no
      // country/phone arguments: finish the sign-up without them.
      if (error?.code === 'PGRST202') ({ error } = await sb.rpc('complete_social_signup', { p_role: role, p_ref: ref ?? null }));
      if (error) return dbError(error, 'No se pudo completar el registro');
      // Record the accepted Terms version; the server sets the date. Never blocks
      // the sign-up (until migration 20261105000002 the function doesn't exist).
      await sb.rpc('accept_terms', { p_version: TERMS_VERSION }).then(() => undefined, () => undefined);
      // Optional; a failure here never blocks the sign-up (it can be set in Ajustes).
      if (extras?.gender) {
        const { data } = await sb.auth.getUser();
        if (data.user) await sb.from('profiles').update({ gender: extras.gender }).eq('id', data.user.id);
      }
      return ok;
    },

    async becomeCreator(user) {
      if (user.role !== 'fan') return fail('Esta cuenta no se puede convertir en creador');
      const { error } = await sb.rpc('become_creator');
      // Until migration 20261015000001_become_creator is applied.
      if (error?.code === 'PGRST202') return fail('Esta opción se activa en unos minutos. Inténtalo más tarde.');
      return error ? dbError(error, 'No se pudo convertir tu cuenta en creador') : ok;
    },

    async logout() {
      await sb.auth.signOut();
    },

    async setProfileImage(user, kind, image) {
      const bucket = sb.storage.from('profile-images');
      const path = `${user.id}/${kind}-${Date.now()}.jpg`;
      const { error } = await bucket.upload(path, image, { contentType: 'image/jpeg', upsert: false });
      if (error) return fail(/size|large|payload/i.test(error.message) ? 'La foto es demasiado grande' : 'No se pudo subir la foto. Inténtalo de nuevo.');
      const url = bucket.getPublicUrl(path).data.publicUrl;
      // Scanned before it goes on the profile; until then the current photo stays.
      const moderation = await moderateUpload(sb, 'profile-images', path, kind, 'image', url);
      if (moderation === 'rejected') return fail(REJECTED_MESSAGE);
      if (moderation !== 'approved') return { ok: true, notice: inReviewNotice(kind === 'avatar' ? 'Tu nueva foto de perfil' : 'Tu nueva portada') };
      const { error: saveError } = await sb.from('profiles').update({ [kind]: url }).eq('id', user.id);
      if (saveError) {
        await bucket.remove([path]);
        return dbError(saveError, 'No se pudo guardar la foto');
      }
      // The previous photo of the same kind is no longer used.
      const { data: files } = await bucket.list(user.id);
      const old = (files ?? []).map((f) => `${user.id}/${f.name}`).filter((p) => p !== path && p.startsWith(`${user.id}/${kind}-`));
      if (old.length) await bucket.remove(old);
      return ok;
    },

    async moderationQueue() {
      const { data, error } = await sb
        .from('media_moderation')
        .select('bucket, path, owner_id, kind, media_type, status, reason, provider, created_at, public_url, owner:profiles!media_moderation_owner_id_fkey(name)')
        .in('status', ['pending', 'review', 'rejected'])
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw Error('No pudimos consultar los archivos por revisar.');
      if (!data) return [];
      const privatePaths = data.filter((r) => r.bucket === 'post-media').map((r) => r.path as string);
      const signed = new Map<string, string>();
      if (privatePaths.length) {
        const { data: urls } = await sb.storage.from('post-media').createSignedUrls(privatePaths, 60 * 60);
        for (const u of urls ?? []) if (u.path && u.signedUrl && !u.error) signed.set(u.path, u.signedUrl);
      }
      return data.map((r) => {
        const owner = (Array.isArray(r.owner) ? r.owner[0] : r.owner) as { name?: string } | null;
        return {
          bucket: r.bucket,
          path: r.path,
          ownerId: r.owner_id,
          ownerName: owner?.name ?? '',
          kind: r.kind,
          mediaType: r.media_type,
          status: r.status,
          reason: r.reason ?? '',
          provider: r.provider ?? '',
          createdAt: r.created_at,
          previewUrl: r.bucket === 'post-media' ? signed.get(r.path) : r.public_url || undefined,
        };
      });
    },

    async appErrors() {
      const { data, error } = await sb
        .from('app_errors')
        .select('id, source, message, detail, url, user_agent, count, first_seen, last_seen, user:profiles!app_errors_user_id_fkey(name)')
        .order('last_seen', { ascending: false })
        .limit(200);
      if (error) throw Error('No pudimos consultar los problemas de la página.');
      if (!data) return [];
      return data.map((r) => {
        const user = (Array.isArray(r.user) ? r.user[0] : r.user) as { name?: string } | null;
        return {
          id: r.id,
          source: r.source,
          message: r.message,
          detail: r.detail ?? '',
          url: r.url ?? '',
          userAgent: r.user_agent ?? '',
          userName: user?.name ?? '',
          count: r.count,
          firstSeen: r.first_seen,
          lastSeen: r.last_seen,
        };
      });
    },

    async monitor() {
      const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const [h, d, r] = await Promise.all([
        sb.from('monitor_snapshots').select('taken_at, kind, data').gte('taken_at', since).order('taken_at', { ascending: false }).limit(48),
        sb.from('monitor_daily').select('day, closed, updated_at, data').order('day', { ascending: false }).limit(31),
        sb.from('monitor_reports').select('id, kind, day, title, body, created_at, window_from, window_to, emailed_at, email_error, data').order('created_at', { ascending: false }).limit(20),
      ]);
      if (h.error || d.error || r.error) throw Error('No pudimos consultar el monitoreo.');
      return {
        hours: (h.data ?? []).map((x) => ({ takenAt: x.taken_at, kind: x.kind, data: x.data })),
        days: (d.data ?? []).map((x) => ({ day: x.day, closed: x.closed, updatedAt: x.updated_at, data: x.data })),
        reports: (r.data ?? []).map((x) => ({
          id: x.id, kind: x.kind, day: x.day, title: x.title, body: x.body, createdAt: x.created_at,
          windowFrom: x.window_from, windowTo: x.window_to, emailedAt: x.emailed_at, emailError: x.email_error, data: x.data,
        })),
      };
    },

    async monitorRefresh() {
      const { data, error } = await sb.rpc('monitor_refresh');
      if (error) throw Error('No pudimos actualizar el monitoreo.');
      return (data as MonitorSnapshot | null) ?? null;
    },

    async monitorKeys() {
      const { data, error } = await sb.rpc('monitor_key_list');
      if (error) throw Error('No pudimos consultar las llaves del celular.');
      return ((data ?? []) as { id: string; label: string; created_at: string; last_used_at: string | null; uses: number }[])
        .map((k): MonitorKey => ({ id: k.id, label: k.label, createdAt: k.created_at, lastUsedAt: k.last_used_at, uses: k.uses }));
    },

    async monitorKeyCreate(label: string) {
      const { data, error } = await sb.rpc('monitor_key_create', { p_label: label });
      if (error) throw Error(/3 llaves/.test(error.message) ? 'Ya hay 3 llaves activas: revoca una antes de crear otra.' : 'No pudimos crear la llave.');
      return data as MonitorNewKey;
    },

    async monitorKeyRevoke(id: string) {
      const { data, error } = await sb.rpc('monitor_key_revoke', { p_id: id });
      if (error) throw Error('No pudimos revocar la llave.');
      return Boolean(data);
    },

    async infraUsage() {
      const { data, error } = await sb.rpc('infra_usage');
      if (error) throw Error('No pudimos consultar los costos y límites.');
      return !data ? null : fromRpc(data as Record<string, unknown>);
    },

    async setInfraSettings(plans, fundPct) {
      const { error } = await sb.rpc('set_infra_settings', { p_plans: plans, p_fund_pct: fundPct });
      return error ? dbError(error, 'No se pudo guardar') : ok;
    },

    async reviewMedia(bucket, path, approve, reason) {
      const { error } = await sb.rpc('moderation_review', { p_bucket: bucket, p_path: path, p_approve: approve, p_reason: reason ?? '' });
      return error ? dbError(error, 'No se pudo guardar la decisión') : ok;
    },

    async updateProfile(user, patch) {
      const cleaned = cleanPatch(patch);
      if (!cleaned.patch) return fail(cleaned.error!);
      const { email, name, avatar, bio, subscriptionPrice, settings, ageVerified, country, phone, username, gender } = cleaned.patch;
      const row: Record<string, unknown> = {};
      if (name !== undefined) row.name = name;
      if (avatar !== undefined) row.avatar = avatar;
      if (bio !== undefined) row.bio = bio;
      if (subscriptionPrice !== undefined) row.subscription_price = subscriptionPrice;
      if (settings !== undefined) row.settings = settings;
      if (ageVerified !== undefined) row.age_verified = ageVerified;
      if (country !== undefined) row.country = country || null;
      if (phone !== undefined) row.phone = phone || null;
      if (gender !== undefined) row.gender = gender;
      if (username !== undefined && username !== user.username) row.username = username;
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
      const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
      if (error) throw Error('No pudimos consultar las personas.');
      return (data ?? []).map((p) => toUser(p as ProfileRow));
    },

    async getAvailability(id) {
      let { data, error } = await sb.from('vip_availability').select('days, hours, time_zone').eq('creator_profile_id', id).maybeSingle();
      if (missingTimeZone(error)) ({ data, error } = await sb.from('vip_availability').select('days, hours').eq('creator_profile_id', id).maybeSingle());
      if (error) throw Error('No pudimos consultar los horarios. Vuelve a intentarlo.');
      const row = data as { days: number[]; hours: string[]; time_zone?: string | null } | null;
      return row ? { days: row.days, hours: row.hours, ...(row.time_zone ? { timeZone: row.time_zone } : {}) } : DEFAULT_AVAILABILITY;
    },

    async setAvailability(id, availability) {
      if (availability.days.length === 0 || availability.hours.length === 0) return fail('Elige al menos un día y una hora');
      const a = normalizeAvailability(availability);
      const current = await this.getAvailability(id);
      const zone = a.timeZone ?? current.timeZone ?? viewerTimeZone();
      if (!isTimeZone(zone)) return fail('Elige una ciudad o zona horaria válida');
      const row = { creator_profile_id: id, days: a.days, hours: a.hours, updated_at: new Date().toISOString() };
      const { error } = await sb.from('vip_availability').upsert({ ...row, time_zone: zone });
      if (missingTimeZone(error)) return fail('Falta actualizar las zonas horarias de Reserve. No se guardaron los cambios.');
      return error ? dbError(error, 'No se pudieron guardar los horarios') : ok;
    },

    async takenSlots(id) {
      const { data, error } = await sb.rpc('reserve_taken_slots', { p_creator_profile_id: id });
      if (error) throw Error('No pudimos comprobar los horarios ocupados. Vuelve a intentarlo.');
      return (data ?? []).map((slot: { date: string; time: string; time_zone: string | null; duration_minutes: number | null }) => ({ date: slot.date, time: slot.time, timeZone: slot.time_zone ?? undefined, durationMinutes: slot.duration_minutes ?? undefined }));
    },

    async selectAttendanceLocation(_user, location) {
      const { error } = await sb.rpc('reserve_select_attendance_city', { p_country: location.country, p_region: location.region, p_city: location.city });
      return error ? dbError(error, 'No se pudo guardar la ciudad de asistencia') : ok;
    },

    async confirmBookingAttendance(_user, bookingId) {
      const { error } = await sb.rpc('reserve_confirm_booking_attendance', { p_booking_id: bookingId });
      return error ? dbError(error, 'Confirma la ciudad de asistencia antes de pagar') : ok;
    },

    async createBooking(_user, input) {
      if (!input.date) return fail('Elige un día en el calendario');
      if (!input.time) return fail('Elige una hora disponible');
      // Creator, title, price, discount and approval come from the experience (server side).
      const { error } = await sb.rpc('reserve_create_booking_in_zone', {
        p_time_zone: input.timeZone ?? null,
        p_experience_id: input.experienceId,
        p_date: input.date,
        p_time: input.time,
        p_message: input.message,
        p_participants: input.participants ?? 1,
      });
      return error ? dbError(error, 'No se pudo enviar la reserva') : ok;
    },

    async bookEventSeat(_user, experienceId, message, timeZone) {
      // Day, time, price and seats come from the event (server side).
      const { error } = await sb.rpc('reserve_book_event_in_zone', { p_experience_id: experienceId, p_message: message, p_time_zone: timeZone ?? null });
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
      const { error } = await sb.rpc('reserve_request_custom_in_zone', {
        p_time_zone: input.timeZone ?? null,
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

    async payBookingWithCredits(_user, bookingId) {
      const { error } = await sb.rpc('reserve_pay_with_credits', { p_booking_id: bookingId });
      return error ? dbError(error, 'No se pudo pagar con créditos') : ok;
    },

    async cancelBooking(_user, bookingId, choice = 'original', reason = 'voluntary') {
      const { data, error } = await sb.rpc('reserve_cancel_v2', { p_booking_id: bookingId, p_choice: choice, p_reason: reason });
      if (error) return dbError(error, 'No se pudo cancelar la reserva');
      return { ok: true, refundCoins: Number(data?.refundCoins ?? 0), refundPercent: Number(data?.refundPercent ?? 0), refundState: data?.refundState,
        ...(data?.refundAmount != null ? { refundAmount: Number(data.refundAmount), refundFee: Number(data.refundFee ?? 0) } : {}) };
    },
    async reserveAccess() {
      const { data, error } = await sb.rpc('reserve_access');
      if (error) throw Error('No pudimos comprobar tu acceso a Reserve. Vuelve a intentarlo.');
      return data;
    },
    async reserveRefunds() {
      const { data, error } = await sb.rpc('reserve_refund_list');
      if (error) throw Error('No pudimos consultar las devoluciones de Reserve.');
      return data ?? [];
    },
    async decideReserveRefund(_user, id, decision, note) {
      const { error } = await sb.rpc('reserve_refund_decide', { p_id: id, p_decision: decision, p_note: note });
      return error ? dbError(error, 'No se pudo registrar la decisión') : ok;
    },

    async requestReschedule(_user, bookingId, input) {
      const { error } = await sb.rpc('reserve_request_reschedule', { p_booking_id: bookingId, p_date: input.date, p_time: input.time, p_note: input.note });
      return error ? dbError(error, 'No se pudo pedir el cambio de fecha') : ok;
    },

    async respondReschedule(_user, bookingId, accept) {
      const { error } = await sb.rpc('reserve_respond_reschedule', { p_booking_id: bookingId, p_accept: accept });
      return error ? dbError(error, 'No se pudo responder al cambio de fecha') : ok;
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
      const existing = id ? await sb.from('vip_experiences').select('time_zone').eq('id', id).maybeSingle() : null;
      if (existing?.error) return dbError(existing.error, 'No se pudo comprobar la zona horaria de la experiencia');
      const availability = await this.getAvailability(user.creatorProfileId!);
      const zone = input.timeZone ?? existing?.data?.time_zone ?? availability.timeZone ?? viewerTimeZone();
      if (!isTimeZone(zone)) return fail('Elige una ciudad o zona horaria válida');
      const save = (r: object) => (id ? sb.from('vip_experiences').update(r).eq('id', id) : sb.from('vip_experiences').insert(r));
      const { error } = await save({ ...row, time_zone: zone });
      if (missingTimeZone(error)) return fail('Falta actualizar las zonas horarias de Reserve. No se guardaron los cambios.');
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
      const { error } = await sb.rpc('delete_push_subscription', { p_endpoint: endpoint });
      return error ? fail('No se pudieron desactivar los avisos. Inténtalo de nuevo.') : ok;
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
