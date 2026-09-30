// Browser-only implementation of Terrones, gifts, the Círculo privado, the
// Bóveda and the video / video-call perks (dev and offline tests). Gifts are
// written into the platform's books through the ledger so earnings, payouts and
// admin reports see them like any other payment.
import { readJSON, writeJSONChecked, newId } from '../storage';
import { round2 } from '../platformRules';
import {
  CALL_DAYS,
  DAILY_UNVERIFIED_LIMIT,
  DEFAULT_GIFT_SETTINGS,
  GIFT_SHARE,
  VIDEO_DAYS,
  circleAccess,
  coinsToUsd,
  giftById,
  isActive,
  packById,
  perksFor,
  validateCircleMin,
} from '../giftRules';
import { fileUrl } from './localSocial';
import type { LocalLedger } from './localPlatform';
import type { AuthResult, User, VipBooking } from './types';
import type { CircleMessage, CoinPurchase, CreatorGiftSettings, GiftsBackend, PerkRequest, VaultItem } from './giftTypes';

interface Store {
  purchases: CoinPurchase[];
  settings: Record<string, CreatorGiftSettings>;
  perks: PerkRequest[];
  circle: CircleMessage[];
  vault: VaultItem[];
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
  const load = (): Store => ({ purchases: [], settings: {}, perks: [], circle: [], vault: [], ...readJSON<Partial<Store>>(KEY, {}) });
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
  const owns = (user: User, creatorProfileId: string) => user.role === 'admin' || user.creatorProfileId === creatorProfileId;
  const access = (s: Store, user: User, creatorProfileId: string) => {
    if (owns(user, creatorProfileId)) return { circle: true, vault: true };
    const gifts = giftsFrom(user.id)
      .filter((t) => t.creatorProfileId === creatorProfileId)
      .map((t) => ({ value: t.amount, createdAt: t.createdAt }));
    const a = circleAccess(gifts, settingsOf(s, creatorProfileId).circleMin);
    return { circle: isActive(a.circleUntil), vault: isActive(a.vaultUntil) };
  };

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
      if (balance(s, user.id) < gift.coins) return fail('No tienes suficientes terrones');
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
        methodLabel: 'Terrones',
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
          status: t.status as 'paid' | 'refunded',
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

    async topFans(creatorProfileId) {
      const month = now().slice(0, 7);
      const totals = new Map<string, { name: string; value: number }>();
      for (const t of deps.ledger.transactions()) {
        if (t.kind !== 'gift' || t.status !== 'paid' || t.creatorProfileId !== creatorProfileId || !t.createdAt.startsWith(month)) continue;
        const key = t.payerId ?? t.payerName;
        const cur = totals.get(key) ?? { name: t.payerName, value: 0 };
        totals.set(key, { ...cur, value: round2(cur.value + t.amount) });
      }
      return [...totals.values()].sort((a, b) => b.value - a.value).slice(0, 5);
    },

    async circleStatus(user, creatorProfileId) {
      if (!user) return { owner: false };
      if (owns(user, creatorProfileId)) return { owner: true };
      const gifts = giftsFrom(user.id)
        .filter((t) => t.creatorProfileId === creatorProfileId)
        .map((t) => ({ value: t.amount, createdAt: t.createdAt }));
      return { owner: false, ...circleAccess(gifts, settingsOf(load(), creatorProfileId).circleMin) };
    },

    async circleMessages(user, creatorProfileId) {
      const s = load();
      if (!access(s, user, creatorProfileId).circle) return [];
      return s.circle.filter((m) => m.creatorProfileId === creatorProfileId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async postCircleMessage(user, creatorProfileId, body) {
      const text = body.trim();
      if (!text) return fail('Escribe un mensaje');
      if (text.length > 1000) return fail('El mensaje no puede superar 1000 caracteres');
      const s = load();
      if (!access(s, user, creatorProfileId).circle) return fail('Entra al Círculo con un regalo para participar');
      return commit((st) => ({
        ...st,
        circle: [
          ...st.circle,
          {
            id: newId(),
            creatorProfileId,
            userId: user.id,
            userName: user.name,
            userAvatar: user.avatar,
            body: text,
            fromCreator: user.creatorProfileId === creatorProfileId,
            createdAt: now(),
          },
        ],
      }));
    },

    async vaultItems(user, creatorProfileId) {
      const s = load();
      if (!access(s, user, creatorProfileId).vault) return [];
      return Promise.all(
        s.vault.filter((v) => v.creatorProfileId === creatorProfileId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(withUrl)
      );
    },

    async addVaultItem(user, title, media) {
      if (!user.creatorProfileId || user.role !== 'creator') return fail('Solo los creadores publican en su Bóveda');
      const name = title.trim();
      if (!name) return fail('Ponle un título');
      if (name.length > 120) return fail('El título no puede superar 120 caracteres');
      return commit((s) => ({
        ...s,
        vault: [
          ...s.vault,
          { id: newId(), creatorProfileId: user.creatorProfileId!, title: name, mediaPath: media.path, mediaType: media.type, createdAt: now() },
        ],
      }));
    },

    async deleteVaultItem(user, id) {
      const item = load().vault.find((v) => v.id === id);
      if (!item || !owns(user, item.creatorProfileId)) return fail('Esta acción no está permitida');
      return commit((s) => ({ ...s, vault: s.vault.filter((v) => v.id !== id) }));
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
        circle: s.circle.filter((m) => m.userId !== userId),
        perks: s.perks.filter((p) => p.fanId !== userId),
      }));
    },
  };
};
