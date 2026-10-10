// Supabase implementation of the platform features. Tables and the functions
// that enforce the rules live in supabase/migrations/20260930000001_platform.sql.
import { PAID_WITH_PAYPAL } from './shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildManagedProfile, validateReport, validateTip, validateVerification } from '../platformRules';
import { creators as catalogue } from '../../data/mockData';
import type { AuthResult } from './types';
import type {
  AccountRestriction,
  AdminActionLog,
  Block,
  ManagedProfile,
  PaymentMethod,
  Payout,
  PlatformBackend,
  Report,
  Transaction,
  VerificationRequest,
} from './platformTypes';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ok: AuthResult = { ok: true };
const fail = (error: string): AuthResult => ({ ok: false, error });

// Our functions raise Spanish messages meant for the user; hide anything else.
const dbError = (error: { message?: string } | null, fallback: string) => {
  const msg = error?.message ?? '';
  return fail(/[áéíóúñ¿$]|Debes|Esta acción|Elige|Indica|Faltan|Deja|Solo|Tu |Tienes|Ya |No puedes|Añade|Verifica|La solicitud|Reporte|Este perfil|Ese nombre|Escribe|Las cuentas|Cuenta no/.test(msg) ? msg : fallback);
};
const done = (error: { message?: string } | null, fallback: string) => (error ? dbError(error, fallback) : ok);

const toManaged = (r: Row): ManagedProfile => ({
  id: r.id,
  name: r.name,
  username: r.username,
  bio: r.bio,
  avatar: r.avatar,
  cover: r.cover,
  category: r.category,
  subscriptionPrice: Number(r.subscription_price),
  isAi: r.is_ai,
  hidden: r.hidden,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toVerification = (r: Row): VerificationRequest => ({
  id: r.id,
  userId: r.user_id,
  userName: r.user_name,
  email: r.email,
  role: r.role,
  legalName: r.legal_name,
  birthDate: r.birth_date ?? '',
  country: r.country,
  docType: r.doc_type,
  docNumber: r.doc_number,
  docFront: r.doc_front,
  selfie: r.selfie,
  status: r.status,
  rejectionReason: r.rejection_reason ?? undefined,
  submittedAt: r.submitted_at,
  reviewedAt: r.reviewed_at ?? undefined,
  provider: r.provider === 'didit' ? 'didit' : 'manual',
});

const toMethod = (r: Row): PaymentMethod => ({
  id: r.id,
  userId: r.user_id,
  kind: r.kind,
  label: r.label,
  detail: r.detail,
  isDefault: r.is_default,
  createdAt: r.created_at,
});

const toTransaction = (r: Row): Transaction => ({
  id: r.id,
  payerId: r.payer_id,
  payerName: r.payer_name,
  creatorProfileId: r.creator_profile_id,
  creatorName: r.creator_name,
  kind: r.kind,
  amount: Number(r.amount),
  methodLabel: r.method_label,
  status: r.status,
  createdAt: r.created_at,
  note: r.note ?? undefined,
  share: r.creator_share == null ? undefined : Number(r.creator_share),
  ...(r.gateway_fee == null ? {} : { gatewayFee: Number(r.gateway_fee) }),
  giftId: r.gift_id ?? undefined,
  ...(r.platform_covers ? { platformCovers: true } : {}),
});

const toPayout = (r: Row): Payout => ({
  id: r.id,
  userId: r.user_id,
  creatorName: r.creator_name,
  amount: Number(r.amount),
  accountLabel: r.account_label,
  status: r.status,
  fee: Number(r.fee ?? 0),
  net: Number(r.net ?? r.amount),
  availableBefore: Number(r.available_before ?? 0),
  requestedAt: r.requested_at,
  paidAt: r.paid_at ?? null,
});

const toReport = (r: Row): Report => ({
  id: r.id,
  kind: r.kind,
  targetId: r.target_id ?? undefined,
  targetLabel: r.target_label,
  reason: r.reason,
  description: r.description,
  contactEmail: r.contact_email ?? undefined,
  reporterId: r.reporter_id ?? undefined,
  reporterName: r.reporter_name,
  status: r.status,
  resolution: r.resolution ?? undefined,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at ?? undefined,
});

const toBlock = (r: Row): Block => ({
  blockerId: r.blocker_id,
  blockerProfileId: r.blocker_profile_id ?? undefined,
  targetId: r.target_id,
  targetName: r.target_name,
  createdAt: r.created_at,
});

export const createSupabasePlatform = (sb: SupabaseClient): PlatformBackend => ({
  async myVerification(userId) {
    const { data } = await sb.from('identity_verifications').select('*').eq('user_id', userId).maybeSingle();
    return data ? toVerification(data) : null;
  },

  async submitVerification(_user, input) {
    const check = validateVerification(input);
    if (!check.ok) return check;
    const { error } = await sb.rpc('submit_verification', {
      p_legal_name: input.legalName,
      p_birth_date: input.birthDate,
      p_country: input.country,
      p_doc_type: input.docType,
      p_doc_number: input.docNumber,
      p_doc_front: input.docFront,
      p_selfie: input.selfie,
    });
    return done(error, 'No se pudo enviar la solicitud');
  },

  async listVerifications() {
    const { data } = await sb.from('identity_verifications').select('*').order('submitted_at', { ascending: false });
    return (data ?? []).map(toVerification);
  },

  async reviewVerification(id, approve, reason) {
    if (!approve && !reason.trim()) return fail('Indica el motivo del rechazo');
    const { error } = await sb.rpc('review_verification', { p_id: id, p_approve: approve, p_reason: reason });
    return done(error, 'No se pudo guardar la revisión');
  },

  async paymentMethods(userId) {
    const { data } = await sb.from('payment_methods').select('*').eq('user_id', userId).order('created_at');
    return (data ?? []).map(toMethod);
  },

  async addPaymentMethod(user, method) {
    const { count } = await sb.from('payment_methods').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
    const { data, error } = await sb
      .from('payment_methods')
      .insert({ user_id: user.id, kind: method.kind, label: method.label, detail: method.detail, is_default: !count })
      .select('id')
      .single();
    return error ? dbError(error, 'No se pudo guardar el método de pago') : { ok: true, id: data.id };
  },

  async removePaymentMethod(user, id) {
    const { error } = await sb.from('payment_methods').delete().eq('id', id).eq('user_id', user.id);
    if (error) return dbError(error, 'No se pudo eliminar el método de pago');
    const { data } = await sb.from('payment_methods').select('id, is_default').eq('user_id', user.id).order('created_at');
    if (data?.length && !data.some((m) => m.is_default)) {
      await sb.from('payment_methods').update({ is_default: true }).eq('id', data[0].id);
    }
    return ok;
  },

  async setDefaultPaymentMethod(user, id) {
    const { error } = await sb.from('payment_methods').update({ is_default: false }).eq('user_id', user.id).neq('id', id);
    if (error) return dbError(error, 'No se pudo cambiar el método principal');
    return done((await sb.from('payment_methods').update({ is_default: true }).eq('id', id).eq('user_id', user.id)).error, 'No se pudo cambiar el método principal');
  },

  async subscribeAndPay(_user, creatorProfileId, creatorName, price, methodId) {
    if (methodId === PAID_WITH_PAYPAL) return { ok: true }; // PayPal Subscriptions already activated it
    const { error } = await sb.rpc('subscribe_and_pay', {
      p_creator_profile_id: creatorProfileId,
      p_creator_name: creatorName,
      p_price: price,
      p_method_id: methodId,
    });
    return done(error, 'No se pudo completar el pago');
  },

  async sendTip(_user, creatorProfileId, creatorName, amount, methodId, postId, message) {
    if (methodId === PAID_WITH_PAYPAL) return { ok: true }; // the server already charged and sent it
    const check = validateTip(amount);
    if (!check.ok) return check;
    const { error } = await sb.rpc('send_tip', {
      p_creator_profile_id: creatorProfileId,
      p_creator_name: creatorName,
      p_amount: amount,
      p_method_id: methodId,
      p_post_id: postId ?? null,
      p_message: message ?? '',
    });
    return done(error, 'No se pudo enviar la propina');
  },

  async billDueRenewals(_user, creatorNames) {
    await sb.rpc('bill_due_renewals', { p_creator_names: creatorNames });
  },

  async myPayments(userId) {
    const { data } = await sb.from('transactions').select('*').eq('payer_id', userId).order('created_at', { ascending: false });
    return (data ?? []).map(toTransaction);
  },

  async creatorSales(creatorProfileId) {
    const { data } = await sb
      .from('transactions')
      .select('*')
      .eq('creator_profile_id', creatorProfileId)
      .order('created_at', { ascending: false });
    return (data ?? []).map(toTransaction);
  },

  async allPayments() {
    const { data } = await sb.from('transactions').select('*').order('created_at', { ascending: false });
    return (data ?? []).map(toTransaction);
  },

  async mySubscribers() {
    const { data } = await sb.rpc('my_subscribers');
    return ((data ?? []) as Row[]).map((r) => ({ id: r.id, name: r.name, avatar: r.avatar, since: r.since }));
  },

  async payoutAccount(userId) {
    const { data } = await sb.from('payout_accounts').select('*').eq('user_id', userId).maybeSingle();
    // An older bank account counts as none: withdrawals now go to PayPal.
    return data?.paypal_email ? { email: data.paypal_email } : null;
  },

  async setPayoutAccount(user, account) {
    const { error } = await sb.from('payout_accounts').upsert({
      user_id: user.id,
      paypal_email: account.email,
      holder: null,
      bank: null,
      account_last4: null,
      updated_at: new Date().toISOString(),
    });
    return done(error, 'No se pudo guardar la cuenta');
  },

  async myPayouts(userId) {
    const read = async () => {
      const { data } = await sb.from('payouts').select('*').eq('user_id', userId).order('requested_at', { ascending: false });
      return (data ?? []).map(toPayout);
    };
    const payouts = await read();
    if (!payouts.some((p) => p.status === 'sending')) return payouts;
    // A withdrawal on its way: ask PayPal again, in case its notification didn't arrive.
    const token = (await sb.auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/paypal', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token ?? ''}` },
      body: JSON.stringify({ action: 'payout-check' }),
    }).catch(() => null);
    const body = (await r?.json().catch(() => null)) as { items?: { id: string; paypalStatus: string }[] } | null;
    if (!r?.ok || !body?.items?.length) return payouts;
    const states = new Map(body.items.map((i) => [i.id, i.paypalStatus]));
    return (await read()).map((p) => (p.status === 'sending' && states.has(p.id) ? { ...p, paypalState: states.get(p.id) } : p));
  },

  async requestPayout() {
    // With PayPal set up the server sends it with PayPal Payouts; otherwise it's recorded as paid.
    const token = (await sb.auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/paypal', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token ?? ''}` },
      body: JSON.stringify({ action: 'payout' }),
    }).catch(() => null);
    const body = (await r?.json().catch(() => null)) as { status?: 'sending' | 'paid'; net?: number; error?: string } | null;
    if (r?.ok) return { ok: true, amount: Number(body?.net ?? 0), status: body?.status ?? 'paid' };
    if (r && r.status !== 503 && r.status !== 404 && body?.error) return fail(body.error);
    const { data, error } = await sb.rpc('request_payout');
    return error ? dbError(error, 'No se pudo hacer el retiro') : { ok: true, amount: Number(data), status: 'paid' as const };
  },

  async cancelPayout(_user, payoutId) {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/paypal', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token ?? ''}` },
      body: JSON.stringify({ action: 'payout-cancel', payoutId }),
    }).catch(() => null);
    const body = (await r?.json().catch(() => null)) as { error?: string } | null;
    return r?.ok ? { ok: true } : fail(body?.error ?? 'No se pudo conectar con PayPal. Intenta de nuevo.');
  },

  async listPayouts() {
    const { data } = await sb.from('payouts').select('*').order('requested_at', { ascending: false });
    return (data ?? []).map(toPayout);
  },

  async submitReport(reporter, input) {
    const check = validateReport(input, !!reporter);
    if (!check.ok) return check;
    const { error } = await sb.rpc('submit_report', {
      p_kind: input.kind,
      p_target_id: input.targetId ?? null,
      p_target_label: input.targetLabel,
      p_reason: input.reason,
      p_description: input.description,
      p_contact_email: input.contactEmail ?? null,
    });
    return done(error, 'No se pudo enviar el reporte');
  },

  async listReports() {
    const { data } = await sb.from('reports').select('*').order('created_at', { ascending: false });
    return (data ?? []).map(toReport);
  },

  async resolveReport(id, action) {
    return done((await sb.rpc('resolve_report', { p_id: id, p_action: action })).error, 'No se pudo actualizar el reporte');
  },

  async removedPosts() {
    const { data } = await sb.from('removed_posts').select('post_id');
    return (data ?? []).map((r) => r.post_id as string);
  },

  async restorePost(postId) {
    return done((await sb.from('removed_posts').delete().eq('post_id', postId)).error, 'No se pudo restaurar la publicación');
  },

  async coverRefund(transactionId, cover) {
    return done((await sb.rpc('admin_cover_refund', { p_transaction: transactionId, p_cover: cover })).error, 'No se pudo actualizar la venta');
  },

  async accountRestrictions() {
    const { data } = await sb.from('account_restrictions').select('*');
    return (data ?? []).map(
      (r): AccountRestriction => ({
        userId: r.user_id,
        suspendedUntil: r.suspended_until,
        suspensionReason: r.suspension_reason,
        payoutsFrozen: r.payouts_frozen,
        updatedAt: r.updated_at,
      })
    );
  },

  async adminActions() {
    const { data } = await sb.from('admin_actions').select('*').order('created_at', { ascending: false }).limit(500);
    return (data ?? []).map(
      (r): AdminActionLog => ({
        id: r.id,
        adminName: r.admin_name,
        userId: r.user_id,
        userName: r.user_name,
        action: r.action,
        reason: r.reason,
        until: r.until,
        createdAt: r.created_at,
      })
    );
  },

  async adminAccountAction(_admin, userId, action, reason, days) {
    const { error } = await sb.rpc('admin_account_action', { p_user: userId, p_action: action, p_reason: reason, p_days: days ?? null });
    return done(error, 'No se pudo aplicar la acción');
  },

  async blocks(user) {
    const { data } = await sb.from('blocks').select('*').or(`blocker_id.eq.${user.id},target_id.eq.${user.id}`);
    return (data ?? []).map(toBlock);
  },

  async block(user, targetId, targetName) {
    const { error } = await sb.from('blocks').upsert(
      { blocker_id: user.id, blocker_profile_id: user.creatorProfileId ?? null, target_id: targetId, target_name: targetName },
      { onConflict: 'blocker_id,target_id', ignoreDuplicates: true }
    );
    return done(error, 'No se pudo bloquear');
  },

  async unblock(user, targetId) {
    return done((await sb.from('blocks').delete().eq('blocker_id', user.id).eq('target_id', targetId)).error, 'No se pudo desbloquear');
  },

  async managedProfiles(includeHidden = false) {
    let query = sb.from('managed_profiles').select('*').order('created_at', { ascending: false });
    if (!includeHidden) query = query.eq('hidden', false);
    const { data } = await query;
    return (data ?? []).map(toManaged);
  },

  // RLS lets only admins write; the unique index guards usernames between profiles.
  async saveManagedProfile(_admin, input, id) {
    const { profile, error } = buildManagedProfile(input, catalogue.map((c) => c.username));
    if (!profile) return fail(error!);
    const row = {
      name: profile.name,
      username: profile.username,
      bio: profile.bio,
      avatar: profile.avatar,
      cover: profile.cover,
      category: profile.category,
      subscription_price: profile.subscriptionPrice,
      is_ai: profile.isAi,
    };
    const res = id
      ? await sb.from('managed_profiles').update(row).eq('id', id).select('id').single()
      : await sb.from('managed_profiles').insert(row).select('id').single();
    if (res.error) return fail(res.error.code === '23505' ? 'Ese nombre de usuario ya existe' : 'No se pudo guardar el perfil');
    return { ok: true, id: res.data.id as string };
  },

  async setManagedProfileHidden(_admin, id, hidden) {
    return done((await sb.from('managed_profiles').update({ hidden }).eq('id', id)).error, 'No se pudo actualizar el perfil');
  },

  async deleteManagedProfile(_admin, id) {
    return done((await sb.rpc('delete_managed_profile', { p_id: id })).error, 'No se pudo eliminar el perfil');
  },
});
