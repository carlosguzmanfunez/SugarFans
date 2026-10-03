// Supabase implementation of the virtual currency (internally "Terrones"),
// gifts and the gift perks. Tables and the
// functions that enforce the rules live in
// supabase/migrations/20260930000007_gifts_terrones.sql.
import { PAID_WITH_PAYPAL } from './shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_GIFT_SETTINGS, validateCircleMin } from '../giftRules';
import type { AuthResult } from './types';
import { currencyWord } from '../../config/currency';
import type { GiftsBackend, PerkRequest } from './giftTypes';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const BUCKET = 'post-media';
const URL_TTL = 60 * 60;
const ok: AuthResult = { ok: true };
const fail = (error: string): AuthResult => ({ ok: false, error });
// Rule violations raised by the database are written for people; show them as-is
// (with the currency's current display name).
const done = (error: { message?: string } | null, fallback: string): AuthResult => {
  if (!error) return ok;
  const msg = (error.message ?? '').replace(/\bterrones\b/gi, currencyWord);
  return fail(/[áéíóúñ¿$]|Debes|Esta acción|Elige|Escribe|Entra|Ponle|Sube|Solo|No |Ya |Este|Esta|La /.test(msg) ? msg : fallback);
};

const toPerk = (r: Row): PerkRequest => ({
  id: r.id,
  transactionId: r.transaction_id,
  fanId: r.fan_id,
  fanName: r.fan_name,
  creatorProfileId: r.creator_profile_id,
  creatorName: r.creator_name,
  kind: r.kind,
  request: r.request,
  status: r.status,
  dueAt: r.due_at,
  createdAt: r.created_at,
  deliveredAt: r.delivered_at ?? undefined,
  mediaPath: r.media_path ?? undefined,
  mediaType: r.media_type ?? undefined,
  bookingId: r.booking_id ?? undefined,
});

export const createSupabaseGifts = (sb: SupabaseClient): GiftsBackend => {
  // Storage signs only the files this viewer may open (the fan a video was made for, and its creator).
  const sign = async <T extends { mediaPath?: string }>(items: T[]): Promise<(T & { mediaUrl?: string })[]> => {
    const paths = items.map((i) => i.mediaPath).filter(Boolean) as string[];
    if (!paths.length) return items;
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(paths, URL_TTL);
    const urls = new Map((data ?? []).filter((u) => u.path && u.signedUrl && !u.error).map((u) => [u.path!, u.signedUrl]));
    return items.map((i) => (i.mediaPath ? { ...i, mediaUrl: urls.get(i.mediaPath) } : i));
  };
  const settle = () => sb.rpc('settle_overdue_perks');

  return {
    async wallet(user) {
      await settle();
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const [{ data: coins }, { data: rows }] = await Promise.all([
        sb.rpc('my_coin_balance'),
        sb.from('coin_purchases').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      ]);
      const purchases = (rows ?? []).map((r) => ({
        id: r.id,
        userId: r.user_id,
        packId: r.pack_id,
        coins: r.coins,
        price: Number(r.price),
        methodLabel: r.method_label,
        createdAt: r.created_at,
      }));
      return {
        coins: Number(coins ?? 0),
        purchases,
        spentToday: Math.round(purchases.filter((p) => p.createdAt > since).reduce((s, p) => s + p.price, 0) * 100) / 100,
      };
    },

    async buyCoins(_user, packId, methodId) {
      if (methodId === PAID_WITH_PAYPAL) return { ok: true }; // the server already charged and credited it
      const { error } = await sb.rpc('buy_coins', { p_pack_id: packId, p_method_id: methodId });
      return done(error, 'No se pudo completar la compra');
    },

    async sendGift(_user, input) {
      const { error } = await sb.rpc('send_gift', {
        p_creator_profile_id: input.creatorProfileId,
        p_creator_name: input.creatorName,
        p_gift_id: input.giftId,
        p_post_id: input.postId ?? null,
        p_message: input.message ?? '',
        p_request: input.request ?? '',
      });
      return done(error, 'No se pudo enviar el regalo');
    },

    async sentGifts(user) {
      const { data } = await sb
        .from('transactions')
        .select('id, creator_profile_id, creator_name, gift_id, amount, status, created_at')
        .eq('payer_id', user.id)
        .eq('kind', 'gift')
        .order('created_at', { ascending: false });
      return (data ?? []).map((r) => ({
        id: r.id,
        creatorProfileId: r.creator_profile_id,
        creatorName: r.creator_name,
        giftId: r.gift_id ?? '',
        coins: Math.round(Number(r.amount) * 100),
        status: r.status,
        createdAt: r.created_at,
      }));
    },

    async giftSettings(creatorProfileId) {
      const { data } = await sb.from('creator_gift_settings').select('*').eq('creator_profile_id', creatorProfileId).maybeSingle();
      return data
        ? { circleMin: Number(data.circle_min), offersVideo: data.offers_video, offersCall: data.offers_call }
        : DEFAULT_GIFT_SETTINGS;
    },

    async saveGiftSettings(user, settings) {
      if (!user.creatorProfileId) return fail('Solo los creadores configuran sus regalos');
      const check = validateCircleMin(settings.circleMin);
      if (!check.ok) return fail(check.error!);
      const { error } = await sb.from('creator_gift_settings').upsert({
        creator_profile_id: user.creatorProfileId,
        circle_min: settings.circleMin,
        offers_video: settings.offersVideo,
        offers_call: settings.offersCall,
      });
      return done(error, 'No se pudo guardar la configuración');
    },

    async perkRequests() {
      await settle();
      const { data } = await sb.from('perk_requests').select('*').order('created_at', { ascending: false });
      return sign((data ?? []).map(toPerk));
    },

    async deliverVideo(_user, perkId, media) {
      if (media.type !== 'video') return fail('Sube un video');
      const { error } = await sb.rpc('deliver_perk_video', { p_id: perkId, p_media_path: media.path });
      return done(error, 'No se pudo entregar el video');
    },

    async scheduleCall(_user, perkId, date, time) {
      if (!date || !time) return fail('Elige día y hora');
      const at = new Date(`${date}T${time}:00`);
      const { error } = await sb.rpc('schedule_perk_call', { p_id: perkId, p_date: date, p_time: time, p_at: at.toISOString() });
      return done(error, 'No se pudo agendar la videollamada');
    },
  };
};
