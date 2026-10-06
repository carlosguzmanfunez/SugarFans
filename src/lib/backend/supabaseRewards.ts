// Supabase implementation of creator rewards and the Meta de experiencia. Referrals
// are recorded by a trigger at sign-up and the cut of each payment by a trigger on
// transactions; see supabase/migrations/20261006000001_creator_incentives_v2.sql.
import type { SupabaseClient } from '@supabase/supabase-js';
import { EMPTY_MEDALS, type MedalState } from '../rewardRules';
import type { CreatorRewards, ExperienceTicket, FeaturedCreator, LevelId, RewardsBackend } from './rewardTypes';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const EMPTY: CreatorRewards = {
  level: 'bronce', activeFans: 0, sales: 0, clean: true, reliable: true, share: 0.8, attractedThisMonth: 0, attractedLastMonth: 0,
  medals: EMPTY_MEDALS, referrals: [], invitedCreators: [],
};

const medals = (m: Row | null | undefined): MedalState =>
  m
    ? {
        firstReserveAt: m.first_reserve_at ?? null,
        puntual: !!m.puntual,
        puntualCount: Number(m.puntual_count ?? 0),
        liveWeeks: Number(m.live_weeks ?? 0),
        constante: !!m.constante,
        imanTier: Number(m.iman_tier ?? 0),
        imanUntil: m.iman_until ?? null,
        qualifiedInvites: Number(m.qualified_invites ?? 0),
        embajador: !!m.embajador,
        boostUntil: m.boost_until ?? null,
        boostReason: m.boost_reason ?? null,
      }
    : EMPTY_MEDALS;

const ticket = (r: Row): ExperienceTicket => ({
  id: r.id,
  creatorProfileId: r.creator_profile_id,
  creatorName: r.creator_name ?? '',
  experienceId: r.experience_id,
  experienceTitle: r.experience_title,
  bonus: r.bonus,
  status: r.status,
  ...(r.booking_id ? { bookingId: r.booking_id } : {}),
  createdAt: r.created_at,
  expiresAt: r.expires_at,
});

const fail = (error: { message: string } | null) => ({ ok: false as const, error: error?.message || 'No se pudo completar la acción' });

export const createSupabaseRewards = (sb: SupabaseClient): RewardsBackend => ({
  async myRewards() {
    const { data, error } = await sb.rpc('my_creator_rewards');
    if (error || !data) return EMPTY;
    const r = data as Row;
    return {
      level: r.level,
      activeFans: r.active_fans,
      sales: Number(r.sales ?? 0),
      clean: r.clean !== false,
      reliable: r.reliable !== false,
      share: Number(r.share),
      attractedThisMonth: r.attracted_this_month,
      attractedLastMonth: r.attracted_last_month,
      medals: medals(r.medals),
      referrals: (r.referrals as Row[]).map((f) => ({ name: f.name, joinedAt: f.joined_at, paid: f.paid, referralUntil: f.referral_until })),
      invitedCreators: ((r.invited_creators ?? []) as Row[]).map((c) => ({
        name: c.name,
        joinedAt: c.joined_at,
        qualifiedAt: c.qualified_at ?? undefined,
        from: c.from ?? undefined,
        until: c.until ?? undefined,
        bonus: Number(c.bonus),
      })),
    };
  },

  async levels(ids) {
    if (!ids.length) return {};
    const { data } = await sb.rpc('creator_levels', { p_ids: ids });
    return Object.fromEntries(((data ?? []) as Row[]).map((r) => [r.creator_profile_id, r.level as LevelId]));
  },

  async badges(ids) {
    if (!ids.length) return {};
    const { data } = await sb.rpc('creator_badges', { p_ids: ids });
    return Object.fromEntries(
      ((data ?? []) as Row[]).map((r) => [r.creator_profile_id, { level: r.level as LevelId, puntual: !!r.puntual, constante: !!r.constante }])
    );
  },

  async featured() {
    const { data } = await sb.rpc('featured_creators');
    return ((data ?? []) as Row[]).map((r): FeaturedCreator => ({ creatorProfileId: r.creator_profile_id, level: r.level, reason: r.reason }));
  },

  async monthlyNewFans() {
    const { data } = await sb.rpc('monthly_new_fans');
    return Object.fromEntries(((data ?? []) as Row[]).map((r) => [r.creator_profile_id, Number(r.new_fans)]));
  },

  async payoutTerms() {
    const { data } = await sb.rpc('my_payout_terms');
    const r = (data ?? null) as Row | null;
    return { min: r ? Number(r.min) : 50 };
  },

  async goal(creatorProfileId) {
    const { data, error } = await sb.rpc('my_experience_goal', { p_creator: creatorProfileId });
    if (error || !data) return null;
    const r = data as Row;
    return {
      target: Number(r.target),
      progress: Number(r.progress),
      experiences: ((r.experiences ?? []) as Row[]).map((e) => ({ id: e.id, title: e.title, ...(e.duration_minutes ? { durationMinutes: e.duration_minutes } : {}) })),
    };
  },

  async myGoalSettings(user) {
    if (!user.creatorProfileId) return null;
    const { data } = await sb.from('experience_goals').select('enabled, target, experience_ids').eq('creator_profile_id', user.creatorProfileId).maybeSingle();
    return data ? { enabled: data.enabled, target: Number(data.target), experienceIds: data.experience_ids ?? [] } : null;
  },

  async saveGoal(_user, input) {
    const { error } = await sb.rpc('save_experience_goal', { p_enabled: input.enabled, p_target: input.target, p_experience_ids: input.experienceIds });
    return error ? fail(error) : { ok: true };
  },

  async claimTicket(_user, creatorProfileId, experienceId) {
    const { data, error } = await sb.rpc('claim_experience_ticket', { p_creator: creatorProfileId, p_experience_id: experienceId });
    if (error || !data) return fail(error);
    const r = data as Row;
    return {
      ok: true,
      ticket: ticket({ ...r, creator_profile_id: creatorProfileId, experience_id: experienceId, status: 'active', created_at: new Date().toISOString() }),
    };
  },

  async myTickets() {
    const { data } = await sb.rpc('my_experience_tickets');
    return ((data ?? []) as Row[]).map(ticket);
  },

  async bookWithTicket(_user, ticketId, date, time, message) {
    const { error } = await sb.rpc('book_with_ticket', { p_ticket_id: ticketId, p_date: date, p_time: time, p_message: message });
    return error ? fail(error) : { ok: true };
  },
});
