// Supabase implementation of the platform features. Tables and the functions
// that enforce the rules live in supabase/migrations/20260930000001_platform.sql.
import type { SupabaseClient } from '@supabase/supabase-js';
import { validateReport, validateTip, validateVerification } from '../platformRules';
import type { AuthResult } from './types';
import type {
  Block,
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
  return fail(/[áéíóúñ¿$]|Debes|Esta acción|Elige|Indica|Faltan|Deja|Solo|Tu |Ya |No puedes|Añade|Verifica|La solicitud|Reporte/.test(msg) ? msg : fallback);
};
const done = (error: { message?: string } | null, fallback: string) => (error ? dbError(error, fallback) : ok);

const toVerification = (r: Row): VerificationRequest => ({
  id: r.id,
  userId: r.user_id,
  userName: r.user_name,
  email: r.email,
  role: r.role,
  legalName: r.legal_name,
  birthDate: r.birth_date,
  country: r.country,
  docType: r.doc_type,
  docNumber: r.doc_number,
  docFront: r.doc_front,
  docBack: r.doc_back ?? undefined,
  selfie: r.selfie,
  status: r.status,
  rejectionReason: r.rejection_reason ?? undefined,
  submittedAt: r.submitted_at,
  reviewedAt: r.reviewed_at ?? undefined,
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
});

const toPayout = (r: Row): Payout => ({
  id: r.id,
  userId: r.user_id,
  creatorName: r.creator_name,
  amount: Number(r.amount),
  accountLabel: r.account_label,
  status: r.status,
  requestedAt: r.requested_at,
  scheduledFor: r.scheduled_for,
  processedAt: r.processed_at ?? undefined,
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
      p_doc_back: input.docBack ?? null,
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
    const { error } = await sb.rpc('subscribe_and_pay', {
      p_creator_profile_id: creatorProfileId,
      p_creator_name: creatorName,
      p_price: price,
      p_method_id: methodId,
    });
    return done(error, 'No se pudo completar el pago');
  },

  async sendTip(_user, creatorProfileId, creatorName, amount, methodId, postId, message) {
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

  async openingBalance(creatorProfileId) {
    const { data } = await sb.from('creator_opening_balances').select('amount').eq('creator_profile_id', creatorProfileId).maybeSingle();
    return data ? Number(data.amount) : 0;
  },

  async payoutAccount(userId) {
    const { data } = await sb.from('payout_accounts').select('*').eq('user_id', userId).maybeSingle();
    return data ? { holder: data.holder, bank: data.bank, accountLast4: data.account_last4 } : null;
  },

  async setPayoutAccount(user, account) {
    const { error } = await sb.from('payout_accounts').upsert({
      user_id: user.id,
      holder: account.holder,
      bank: account.bank,
      account_last4: account.accountLast4,
      updated_at: new Date().toISOString(),
    });
    return done(error, 'No se pudo guardar la cuenta');
  },

  async myPayouts(userId) {
    const { data } = await sb.from('payouts').select('*').eq('user_id', userId).order('requested_at', { ascending: false });
    return (data ?? []).map(toPayout);
  },

  async requestPayout(_user, amount) {
    return done((await sb.rpc('request_payout', { p_amount: amount })).error, 'No se pudo solicitar el retiro');
  },

  async listPayouts() {
    const { data } = await sb.from('payouts').select('*').order('requested_at', { ascending: false });
    return (data ?? []).map(toPayout);
  },

  async processPayout(id, paid) {
    return done((await sb.rpc('process_payout', { p_id: id, p_paid: paid })).error, 'No se pudo actualizar el retiro');
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
});
