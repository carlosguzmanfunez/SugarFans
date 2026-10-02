// Gifts paid with the platform's virtual currency (internally "Terrones"; shown
// as VIRTUAL_CURRENCY in src/config/currency.ts). 1 unit = $0.01 of gift value.
// Fans buy packs at a net price and the platform absorbs the card fee; the
// creator gets 60% of every gift. The same catalogue is seeded in Supabase
// (migration 20260930000007_gifts_terrones.sql): keep both in sync. The names
// below are the stored ones; what users read comes from src/config/gifts.ts.
import type { CoinPack, CreatorGiftSettings, Gift, GiftCategory } from './backend/giftTypes';
import { COIN_PACK_DISPLAY, GIFT_DISPLAY } from '../config/gifts';

export const COIN_VALUE = 0.01;
export const GIFT_SHARE = 0.6;
export const coinsToUsd = (coins: number) => Math.round(coins) / 100;
export const formatCoins = (coins: number) => coins.toLocaleString('en-US');

// Stored catalogue (coin_packs).
const COIN_PACK_CATALOG: CoinPack[] = [
  { id: 'bolsita', name: 'Bolsita', price: 4.99, coins: 500 },
  { id: 'frasco', name: 'Frasco', price: 9.99, coins: 1_000 },
  { id: 'caja', name: 'Caja', price: 19.99, coins: 2_000 },
  { id: 'saco', name: 'Saco', price: 49.99, coins: 5_000 },
  { id: 'barril', name: 'Barril', price: 99.99, coins: 10_000 },
  { id: 'cofre', name: 'Cofre', price: 249.99, coins: 25_000 },
  { id: 'boveda', name: 'Bóveda', price: 499.99, coins: 50_000 },
  { id: 'tesoro', name: 'Tesoro', price: 999.0, coins: 100_000 },
];

const g = (id: string, name: string, category: GiftCategory, coins: number, icon: string): Gift => ({ id, name, category, coins, icon });

// Stored catalogue (gift_catalog).
const GIFT_CATALOG: Gift[] = [
  g('caramelo', 'Caramelo', 'Dulces', 20, '🍬'),
  g('chicle', 'Chicle rosa', 'Dulces', 20, '🫧'),
  g('piruleta', 'Piruleta', 'Dulces', 20, '🍭'),
  g('gomita', 'Gomita osito', 'Dulces', 50, '🧸'),
  g('algodon', 'Algodón de azúcar', 'Dulces', 50, '☁️'),
  g('bombon', 'Bombón', 'Dulces', 50, '🍫'),
  g('cupcake', 'Cupcake', 'Repostería', 100, '🧁'),
  g('donut', 'Donut glaseado', 'Repostería', 100, '🍩'),
  g('macaron', 'Macaron', 'Repostería', 100, '🍪'),
  g('helado', 'Helado de fresa', 'Repostería', 200, '🍦'),
  g('churros', 'Churros con chocolate', 'Repostería', 200, '🥨'),
  g('manzana', 'Manzana de caramelo', 'Repostería', 200, '🍎'),
  g('tarta', 'Tarta de fresas', 'Romance', 500, '🍰'),
  g('bombones', 'Caja de bombones', 'Romance', 500, '🎁'),
  g('rosas', 'Ramo de rosas', 'Romance', 1_000, '💐'),
  g('champan', 'Copa de champán', 'Romance', 1_000, '🥂'),
  g('perfume', 'Perfume', 'Lujo', 2_000, '🌸'),
  g('corazon', 'Corazón de cristal', 'Lujo', 2_000, '💖'),
  g('perlas', 'Collar de perlas', 'Lujo', 5_000, '📿'),
  g('tacones', 'Tacones de diamante', 'Lujo', 5_000, '👠'),
  g('corona', 'Corona de azúcar', 'Fantasía', 10_000, '👑'),
  g('limusina', 'Limusina rosa', 'Fantasía', 20_000, '🚘'),
  g('yate', 'Yate de caramelo', 'Fantasía', 50_000, '🛥️'),
  g('jet', 'Jet privado', 'Fantasía', 50_000, '✈️'),
  g('castillo', 'Castillo de azúcar', 'Fantasía', 100_000, '🏰'),
];

// What the app works with: same ids, prices and categories, display names.
export const COIN_PACKS: CoinPack[] = COIN_PACK_CATALOG.map((p) => ({ ...p, name: COIN_PACK_DISPLAY[p.id] ?? p.name }));
export const GIFTS: Gift[] = GIFT_CATALOG.map((x) => ({ ...x, name: GIFT_DISPLAY[x.id]?.name ?? x.name, icon: GIFT_DISPLAY[x.id]?.emoji ?? x.icon }));

export const GIFT_CATEGORIES: GiftCategory[] = ['Dulces', 'Repostería', 'Romance', 'Lujo', 'Fantasía'];
export const giftById = (id: string) => GIFTS.find((x) => x.id === id);
export const packById = (id: string) => COIN_PACKS.find((x) => x.id === id);

// Perks unlocked by a single gift (USD value), and the Círculo rules.
export const CIRCLE_DEFAULT_MIN = 100;
export const CIRCLE_LOWEST_MIN = 50;
export const CIRCLE_HIGHEST_MIN = 1_000;
export const VAULT_MIN = 200;
export const VIDEO_MIN = 500;
export const CALL_MIN = 1_000;
export const ACCESS_DAYS = 30;
export const VIDEO_DAYS = 7;
export const CALL_DAYS = 30;
export const CALL_MINUTES = 20;
// Fans who have not verified their identity can buy up to this much per day.
export const DAILY_UNVERIFIED_LIMIT = 300;

export const DEFAULT_GIFT_SETTINGS: CreatorGiftSettings = { circleMin: CIRCLE_DEFAULT_MIN, offersVideo: false, offersCall: false };

export const validateCircleMin = (min: number) =>
  Number.isFinite(min) && min >= CIRCLE_LOWEST_MIN && min <= CIRCLE_HIGHEST_MIN
    ? { ok: true }
    : { ok: false, error: `La entrada al Círculo debe estar entre $${CIRCLE_LOWEST_MIN} y $${CIRCLE_HIGHEST_MIN}` };

// Perks a gift of this value earns with this creator's settings. Gifts no longer
// earn a private video call: calls are experiences booked in Reserve, and a gift
// never buys a conversation or a meeting. Call perks earned before keep working.
export const GIFT_CALLS_RETIRED = true;
export const perksFor = (value: number, s: CreatorGiftSettings) => ({
  circle: value >= s.circleMin || value >= VAULT_MIN,
  vault: value >= VAULT_MIN,
  video: value >= VIDEO_MIN && s.offersVideo,
  call: !GIFT_CALLS_RETIRED && value >= CALL_MIN && s.offersCall,
});

const DAY = 86_400_000;
const addDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * DAY).toISOString();
const later = (a: string | undefined, b: string) => (a && a > b ? a : b);

// Círculo access: a gift of at least the creator's minimum, or gifts adding up to
// it within one calendar month (UTC), give 30 days; each new qualifying gift adds
// 30 more. The Bóveda works the same way with a single gift of $200 or more.
export const circleAccess = (
  gifts: { value: number; createdAt: string }[],
  circleMin: number
): { circleUntil?: string; vaultUntil?: string } => {
  let circleUntil: string | undefined;
  let vaultUntil: string | undefined;
  let month = '';
  let pile = 0;
  for (const gift of [...gifts].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const m = gift.createdAt.slice(0, 7);
    if (m !== month) {
      month = m;
      pile = 0;
    }
    pile += gift.value;
    const single = gift.value >= circleMin || gift.value >= VAULT_MIN;
    if (single || pile >= circleMin) {
      circleUntil = addDays(later(circleUntil, gift.createdAt), ACCESS_DAYS);
      pile = 0;
    }
    if (gift.value >= VAULT_MIN) vaultUntil = addDays(later(vaultUntil, gift.createdAt), ACCESS_DAYS);
  }
  return { circleUntil, vaultUntil };
};

export const isActive = (until?: string, at = new Date()) => !!until && until > at.toISOString();
