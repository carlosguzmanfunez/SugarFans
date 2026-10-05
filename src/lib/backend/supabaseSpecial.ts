// Supabase implementation of special accounts. The admin reads and writes the tables
// through row security; a creator claims a link with claim_special_invite, and the
// cut of each Reserve payment is set by a trigger. See
// supabase/migrations/20261005000001_special_accounts.sql.
import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_TAX_RATE, validateInvite } from '../specialRules';
import type { SpecialAccount, SpecialBackend } from './specialTypes';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const toAccount = (r: Row): SpecialAccount => ({
  creatorProfileId: r.creator_profile_id,
  userId: r.user_id,
  inviteCode: r.invite_code ?? undefined,
  label: r.label,
  reserveNet: r.reserve_net,
  taxRate: Number(r.tax_rate),
  featured: r.featured,
  since: r.since,
  revokedAt: r.revoked_at ?? undefined,
});

export const createSupabaseSpecial = (sb: SupabaseClient): SpecialBackend => ({
  async listInvites() {
    const [{ data: invites }, { data: uses }] = await Promise.all([
      sb.from('special_invites').select('*').order('created_at', { ascending: false }),
      sb.from('special_accounts').select('invite_code'),
    ]);
    const count = new Map<string, number>();
    for (const u of (uses ?? []) as Row[]) if (u.invite_code) count.set(u.invite_code, (count.get(u.invite_code) ?? 0) + 1);
    return ((invites ?? []) as Row[]).map((r) => ({
      code: r.code,
      label: r.label,
      reserveNet: r.reserve_net,
      taxRate: Number(r.tax_rate),
      featured: r.featured,
      maxUses: r.max_uses,
      expiresAt: r.expires_at ?? undefined,
      revokedAt: r.revoked_at ?? undefined,
      createdAt: r.created_at,
      uses: count.get(r.code) ?? 0,
    }));
  },

  async createInvite(input) {
    const valid = validateInvite(input);
    if (!valid.ok) return valid;
    const { data, error } = await sb
      .from('special_invites')
      .insert({
        label: input.label.trim(),
        reserve_net: input.reserveNet,
        tax_rate: input.taxRate,
        featured: input.featured,
        max_uses: input.maxUses,
        expires_at: input.expiresAt ?? null,
      })
      .select('code')
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? 'No se pudo crear el link' };
    return { ok: true, code: (data as Row).code };
  },

  async revokeInvite(code) {
    const { error } = await sb.from('special_invites').update({ revoked_at: new Date().toISOString() }).eq('code', code).is('revoked_at', null);
    return error ? { ok: false, error: error.message } : { ok: true };
  },

  async listAccounts() {
    const { data } = await sb.from('special_accounts').select('*').order('since', { ascending: false });
    return ((data ?? []) as Row[]).map(toAccount);
  },

  async updateAccount(creatorProfileId, patch) {
    if (patch.taxRate !== undefined && !(patch.taxRate >= 0 && patch.taxRate <= MAX_TAX_RATE)) return { ok: false, error: 'El impuesto debe estar entre 0% y 50%' };
    const row: Row = {};
    if (patch.reserveNet !== undefined) row.reserve_net = patch.reserveNet;
    if (patch.taxRate !== undefined) row.tax_rate = patch.taxRate;
    if (patch.featured !== undefined) row.featured = patch.featured;
    if (patch.active !== undefined) row.revoked_at = patch.active ? null : new Date().toISOString();
    const { error } = await sb.from('special_accounts').update(row).eq('creator_profile_id', creatorProfileId);
    return error ? { ok: false, error: error.message } : { ok: true };
  },

  async mine() {
    const { data: auth } = await sb.auth.getUser();
    if (!auth.user) return null;
    const { data } = await sb.from('special_accounts').select('*').eq('user_id', auth.user.id).maybeSingle();
    return data ? toAccount(data as Row) : null;
  },

  async claim(code) {
    const { data, error } = await sb.rpc('claim_special_invite', { p_code: code });
    if (error) return { ok: false, error: error.message };
    const r = data as Row;
    return { ok: true, label: r.label, already: !!r.already };
  },
});
