// Browser-only implementation of the virtual currency (internally "Terrones"),
// gifts and the video / video-call perks earned before they were retired (dev
// and offline tests). Gifts are written into the platform's books through the ledger so earnings, payouts and
// admin reports see them like any other payment.
import { readJSON, writeJSONChecked, newId } from '../storage';
import { round2 } from '../platformRules';
import {
  CALL_DAYS,
  DAILY_UNVERIFIED_LIMIT,
  DEFAULT_GIFT_SETTINGS,
  GIFT_SHARE,
  VIDEO_DAYS,
  coinsToUsd,
  giftById,
  packById,
  perksFor,
  validateCircleMin,
} from '../giftRules';
import { fileUrl } from './localSocial';
import { currencyWord } from '../../config/currency';
import type { LocalLedger } from './localPlatform';
import type { AuthResult, User, VipBooking } from './types';
import type { CoinPurchase, CreatorGiftSettings, GiftsBackend, PerkRequest } from './giftTypes';

interface Store {
  purchases: CoinPurchase[];
  settings: Record<string, CreatorGiftSettings>;
  perks: PerkRequest[];
}

interface Deps {
  ledger: LocalLedger;
  listAccounts(): User[];
  // Adds a confirmed booking (the gifted video call); fails when the slot is taken.
  addBooking(b: VipBooking): AuthResult;
  notify(): void;
}

const KEY = 'gifts';
const DAY = 86_400_000;
const ok: AuthResult = { ok: true };
const fail = (error: string): AuthResult => ({ ok: false, error });
const now = () => new Date().toISOString();
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

export const createLocalGifts = (deps: Deps): GiftsBackend & { purgeUser(userId: string): Promise<void> } => {
  const load = (): Store => ({ purchases: [], settings: {}, perks: [], ...readJSON<Partial<Store>>(KEY, {}) });
  const commit = (fn: (s: Store) => Store): AuthResult => {
    if (!writeJSONChecked(KEY, fn(load()))) return fail('No se pudo guardar: el almacenamiento del navegador está lleno');
    deps.notify();
    return ok;
  };

  const settingsOf = (s: Store, creatorProfileId: string) => s.settings[creatorProfileId] ?? DEFAULT_GIFT_SETTINGS;
  const giftsFrom = (userId: string) =>
    deps.ledger.transactions().filter((t) => t.kind === 'gift' && t.payerId === userId && t.status === 'paid');
  const balance = (s: Store, userId: string) =>
    s.purchases.filter((p) => p.userId === userId).reduce((sum, p) => sum + p.coins, 0) -
    giftsFrom(userId).reduce((sum, t) => sum + Math.round(t.amount * 100), 0);
  // A perk not delivered in time refunds the whole gift (coins back, creator's cut removed).
  const settle = () => {
    const s = load();
    const overdue = s.perks.filter((p) => p.status === 'pending' && p.dueAt < now());
    if (!overdue.length) return;
    const refunded = new Set(overdue.map((p) => p.transactionId));
    // Mark the perks first: saving notifies listeners, which reload and settle again.
    commit((st) => ({
      ...st,
      perks: st.perks.map((p) => (refunded.has(p.transactionId) && p.status === 'pending' ? { ...p, status: 'refunded' } : p)),
    }));
    refunded.forEach((id) => deps.ledger.refund(id));
  };

  const withUrl = async <T extends { mediaPath?: string }>(x: T): Promise<T & { mediaUrl?: string }> =>
    x.mediaPath ? { ...x, mediaUrl: await fileUrl(x.mediaPath) } : x;

  return {
    async wallet(user) {
      settle();
      const s = load();
      const since = new Date(Date.now() - DAY).toISOString();
      const purchases = s.purchases.filter((p) => p.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        coins: balance(s, user.id),
        purchases,
        spentToday: round2(purchases.filter((p) => p.createdAt > since).reduce((sum, p) => sum + p.price, 0)),
      };
    },

    async buyCoins(user, packId, methodId) {
      const pack = packById(packId);
      if (!pack) return fail('Paquete no encontrado');
      const label = deps.ledger.methodLabel(user.id, methodId);
      if (!label) return fail('Elige un método de pago');
      const verified = !!deps.listAccounts().find((a) => a.id === user.id)?.isVerified;
      if (!verified) {
        const since = new Date(Date.now() - DAY).toISOString();
        const today = load().purchases.filter((p) => p.userId === user.id && p.createdAt > since).reduce((sum, p) => sum + p.price, 0);
        if (today + pack.price > DAILY_UNVERIFIED_LIMIT)
          return fail(`Sin verificar tu identidad puedes comprar hasta $${DAILY_UNVERIFIED_LIMIT} al día. Verifícate en Configuración para comprar más.`);
      }
      // INTEGRATION: the payment processor charges the pack here.
      return commit((s) => ({
        ...s,
        purchases: [
          ...s.purchases,
          { id: newId(), userId: user.id, packId: pack.id, coins: pack.coins, price: pack.price, methodLabel: label, createdAt: now() },
        ],
      }));
    },

    async sendGift(user, input) {
      const gift = giftById(input.giftId);
      if (!gift) return fail('Regalo no encontrado');
      if (user.creatorProfileId === input.creatorProfileId) return fail('No puedes enviarte un regalo a ti mismo');
      if (!deps.ledger.acceptsPayments(input.creatorProfileId)) return fail('Este perfil no existe');
      if (deps.ledger.cutOff(user.id, input.creatorProfileId)) return fail('No puedes enviar regalos a este perfil');
      settle();
      const s = load();
      if (balance(s, user.id) < gift.coins) return fail(`No tienes suficientes ${currencyWord}`);
      const value = coinsToUsd(gift.coins);
      const message = (input.message ?? '').trim().slice(0, 200);
      const at = now();
      const tx = deps.ledger.addTransaction({
        key: `gift:${user.id}:${newId()}`,
        payerId: user.id,
        payerName: user.name,
        creatorProfileId: input.creatorProfileId,
        creatorName: input.creatorName,
        kind: 'gift',
        amount: value,
        methodLabel: 'Terrones', // stored label, as the database writes it; shown via displayMethodLabel
        status: 'paid',
        createdAt: at,
        share: GIFT_SHARE,
        giftId: gift.id,
        note: message ? `${gift.name} · “${message}”` : gift.name,
      });
      if (!tx.ok || !tx.id) return tx;
      const perks = perksFor(value, settingsOf(s, input.creatorProfileId));
      const base = {
        transactionId: tx.id,
        fanId: user.id,
        fanName: user.name,
        creatorProfileId: input.creatorProfileId,
        creatorName: input.creatorName,
        status: 'pending' as const,
        createdAt: at,
      };
      const owed: PerkRequest[] = [
        ...(perks.video ? [{ ...base, id: newId(), kind: 'video' as const, request: (input.request ?? '').trim().slice(0, 500), dueAt: inDays(VIDEO_DAYS) }] : []),
        ...(perks.call ? [{ ...base, id: newId(), kind: 'call' as const, request: '', dueAt: inDays(CALL_DAYS) }] : []),
      ];
      return owed.length ? commit((st) => ({ ...st, perks: [...st.perks, ...owed] })) : ok;
    },

    async sentGifts(user) {
      return deps.ledger
        .transactions()
        .filter((t) => t.kind === 'gift' && t.payerId === user.id && t.status !== 'failed')
        .map((t) => ({
          id: t.id,
          creatorProfileId: t.creatorProfileId,
          creatorName: t.creatorName,
          giftId: t.giftId ?? '',
          coins: Math.round(t.amount * 100),
          status: t.status as 'paid' | 'refunded' | 'disputed',
          createdAt: t.createdAt,
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async giftSettings(creatorProfileId) {
      return settingsOf(load(), creatorProfileId);
    },

    async saveGiftSettings(user, settings) {
      if (!user.creatorProfileId) return fail('Solo los creadores configuran sus regalos');
      const check = validateCircleMin(settings.circleMin);
      if (!check.ok) return fail(check.error!);
      return commit((s) => ({ ...s, settings: { ...s.settings, [user.creatorProfileId!]: { ...settings, circleMin: round2(settings.circleMin) } } }));
    },

    async perkRequests(user) {
      settle();
      const mine = load().perks.filter((p) => p.fanId === user.id || (!!user.creatorProfileId && p.creatorProfileId === user.creatorProfileId));
      return Promise.all(mine.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(withUrl));
    },

    async deliverVideo(user, perkId, media) {
      settle();
      const p = load().perks.find((x) => x.id === perkId);
      if (!p || p.kind !== 'video' || p.creatorProfileId !== user.creatorProfileId) return fail('Esta acción no está permitida');
      if (p.status !== 'pending') return fail('Este pedido ya no está pendiente');
      if (media.type !== 'video') return fail('Sube un video');
      return commit((s) => ({
        ...s,
        perks: s.perks.map((x) => (x.id === perkId ? { ...x, status: 'delivered', deliveredAt: now(), mediaPath: media.path, mediaType: media.type } : x)),
      }));
    },

    async scheduleCall(user, perkId, date, time) {
      settle();
      const p = load().perks.find((x) => x.id === perkId);
      if (!p || p.kind !== 'call' || p.creatorProfileId !== user.creatorProfileId) return fail('Esta acción no está permitida');
      if (p.status !== 'pending') return fail('Esta videollamada ya no está pendiente');
      if (!date || !time) return fail('Elige día y hora');
      const at = new Date(`${date}T${time}:00`).toISOString();
      if (at <= now()) return fail('Elige un momento futuro');
      if (at > p.dueAt) return fail('La videollamada debe hacerse antes de que venza el plazo de 30 días');
      const fan = deps.listAccounts().find((a) => a.id === p.fanId);
      const bookingId = newId();
      const booked = deps.addBooking({
        id: bookingId,
        experienceId: 'gift-call',
        creatorProfileId: p.creatorProfileId,
        title: 'Videollamada privada (regalo)',
        creatorName: p.creatorName,
        price: 0,
        fanId: p.fanId,
        fanName: p.fanName,
        fanEmail: fan?.email ?? '',
        date,
        time,
        message: '',
        status: 'confirmed',
        createdAt: now(),
        updatedAt: now(),
        paidAt: now(),
      });
      if (!booked.ok) return booked;
      return commit((s) => ({
        ...s,
        perks: s.perks.map((x) => (x.id === perkId ? { ...x, status: 'scheduled', bookingId, deliveredAt: now() } : x)),
      }));
    },

    async purgeUser(userId) {
      commit((s) => ({
        ...s,
        purchases: s.purchases.filter((p) => p.userId !== userId),
        perks: s.perks.filter((p) => p.fanId !== userId),
      }));
    },
  };
};
