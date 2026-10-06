// Creator rewards (incentives v2): levels by active fans or sales, a referral link,
// creator invites, medals and featured spots. The creator's cut is taken from the
// NET of each payment (after the payment processor's fee) for subscriptions,
// renewals, tips and Reserve; gifts keep their fixed 60%. The same rules run in
// the database (migration 20261006000001_creator_incentives_v2.sql): keep both in sync.
import type { Transaction } from './backend/platformTypes';
import type { LevelId } from './backend/rewardTypes';
import { BRAND } from '../config/brand';

// The payment processor's fee when it didn't report one: PayPal's usual rate for
// international commercial payments.
export const PROCESSOR_FEE = { rate: 0.054, fixed: 0.3 };
export const processorFee = (amount: number) =>
  amount > 0 ? Math.min(amount, Math.round((amount * PROCESSOR_FEE.rate + PROCESSOR_FEE.fixed) * 100) / 100) : 0;

export interface Level {
  id: LevelId;
  name: string;
  icon: string;
  minFans: number; // active fans needed (fans from the creator's link count twice)...
  minSales: number; // ...or this much sold in the last 30 days (USD)
  reliable: boolean; // also answers 95% of Reserve requests
  share: number; // creator's cut of the net
  eventSeats: number; // most seats a new Reserve Event can have
  payoutMin: number; // smallest withdrawal (USD)
  perks: string[]; // what the level unlocks, as the creator reads it
}

export const LEVELS: Level[] = [
  {
    id: 'bronce', name: 'Bronce', icon: '🥉', minFans: 0, minSales: 0, reliable: false, share: 0.8, eventSeats: 10, payoutMin: 50,
    perks: ['Perfil, Suscribirse, Reserve 1:1 y regalos', 'Reserve Event de hasta 10 plazas'],
  },
  {
    id: 'plata', name: 'Plata', icon: '🥈', minFans: 10, minSales: 250, reliable: false, share: 0.8, eventSeats: 20, payoutMin: 50,
    perks: ['Sales en "En ascenso" en Explorar', 'Reserve Event de hasta 20 plazas', 'Insignia Plata en tu perfil'],
  },
  {
    id: 'oro', name: 'Oro', icon: '🥇', minFans: 50, minSales: 1000, reliable: true, share: 0.8, eventSeats: 50, payoutMin: 25,
    perks: ['Destacado en Explorar y en tu categoría', 'Retiras desde $25', 'Reserve Event de hasta 50 plazas'],
  },
  {
    id: 'diamante', name: 'Diamante', icon: '💎', minFans: 200, minSales: 5000, reliable: true, share: 0.83, eventSeats: 50, payoutMin: 25,
    perks: ['83% de lo que te pagan', 'Tu tarjeta va primero en la portada, en tu categoría', 'Todo lo de Oro'],
  },
];

// Fans who sign up with the creator's link pay the creator 85% of the net for 60 days.
export const REFERRAL_SHARE = 0.85;
export const REFERRAL_DAYS = 60;
// A creator earns 5% of the net of what each creator they invited sells
// (subscriptions, renewals and tips) for one month, paid from the platform's
// part, once 2 invited creators are verified and have sold $100. At most $100
// per invited creator.
export const CREATOR_INVITE_BONUS = 0.05;
export const CREATOR_INVITE_MONTHS = 1;
export const CREATOR_INVITE_MIN = 2;
export const CREATOR_INVITE_QUALIFY = 100;
export const CREATOR_INVITE_CAP = 100;

// Creator and inviter together never take more than this of a payment's net.
export const MAX_SHARE = 0.9;
// A fan counts as active with a payment to the creator in the last 30 days.
export const ACTIVE_DAYS = 30;
// Reliability: answer at least 95% of the Reserve requests of the last 90 days (from 5 on).
export const RELIABLE_DAYS = 90;
export const RELIABLE_MIN_REQUESTS = 5;
export const RELIABLE_RATE = 0.95;
// Reserve statuses that close a request: answered in time, or not (expired, disputed).
export const ANSWERED_STATUSES = ['accepted', 'confirmed', 'completed', 'rejected', 'expired', 'disputed'];
const UNANSWERED = ['expired', 'disputed'];

const DAY = 24 * 60 * 60 * 1000;
export const pct = (share: number) => `${Math.round(share * 100)}%`;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

// The creator's cut of one payment, as a fraction of what the fan paid.
export const netShare = (rate: number, amount: number, fee = processorFee(amount)) =>
  amount > 0 ? Math.max(0, round4((Math.min(rate, MAX_SHARE) * (amount - fee)) / amount)) : 0;

export interface LevelInput {
  fans: number;
  sales: number;
  clean: boolean; // no report against the creator confirmed in 90 days
  reliable: boolean;
}

export const levelFor = ({ fans, sales, clean, reliable }: LevelInput): Level => {
  const reached = (l: Level) => (fans >= l.minFans || sales >= l.minSales) && (l.id === 'bronce' || clean) && (!l.reliable || reliable);
  return [...LEVELS].reverse().find(reached)!;
};
export const levelById = (id: LevelId) => LEVELS.find((l) => l.id === id)!;
export const nextLevel = (level: Level): Level | undefined => LEVELS[LEVELS.findIndex((l) => l.id === level.id) + 1];

// Month boundaries in UTC, like the monthly credit.
export const monthStart = (at: Date, offset = 0) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + offset, 1)).toISOString();

export interface CreatorInvite {
  creatorProfileId: string; // the invited creator
  referrerProfileId: string;
  joinedAt: string;
}

export interface Referral {
  fanId: string;
  creatorProfileId: string;
  joinedAt: string;
}

const paidTo = (txs: Transaction[], creatorProfileId: string) =>
  txs.filter((t) => t.creatorProfileId === creatorProfileId && t.status === 'paid' && t.kind !== 'referral');

const inLast = (iso: string, at: Date, days: number) => iso > new Date(at.getTime() - days * DAY).toISOString() && iso <= at.toISOString();

// Active fans in the last 30 days; fans who came through the creator's link count twice.
export const activeFans = (txs: Transaction[], refs: Referral[], creatorProfileId: string, at = new Date()) => {
  const payers = new Set(paidTo(txs, creatorProfileId).filter((t) => t.payerId && inLast(t.createdAt, at, ACTIVE_DAYS)).map((t) => t.payerId!));
  const referred = refs.filter((r) => r.creatorProfileId === creatorProfileId && payers.has(r.fanId)).length;
  return payers.size + referred;
};

// What fans paid the creator in the last 30 days (gross).
export const salesOf = (txs: Transaction[], creatorProfileId: string, at = new Date()) =>
  Math.round(paidTo(txs, creatorProfileId).filter((t) => inLast(t.createdAt, at, ACTIVE_DAYS)).reduce((s, t) => s + t.amount, 0) * 100) / 100;

export interface BookingLike {
  creatorProfileId: string;
  status: string;
  createdAt: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
}

export const reliableFrom = (bookings: BookingLike[], creatorProfileId: string, at = new Date()) => {
  const closed = bookings.filter((b) => b.creatorProfileId === creatorProfileId && ANSWERED_STATUSES.includes(b.status) && inLast(b.createdAt, at, RELIABLE_DAYS));
  if (closed.length < RELIABLE_MIN_REQUESTS) return true;
  return closed.filter((b) => UNANSWERED.includes(b.status)).length <= closed.length * (1 - RELIABLE_RATE);
};

// Referred fans who joined between `from` and `to` and have paid the creator.
export const attractedFans = (refs: Referral[], txs: Transaction[], creatorProfileId: string, from: string, to: string) => {
  const payers = new Set(paidTo(txs, creatorProfileId).map((t) => t.payerId));
  return refs.filter((r) => r.creatorProfileId === creatorProfileId && r.joinedAt >= from && r.joinedAt < to && payers.has(r.fanId)).length;
};

export const referralActive = (ref: Referral | undefined, creatorProfileId: string, at = new Date()) =>
  !!ref && ref.creatorProfileId === creatorProfileId && at.getTime() - new Date(ref.joinedAt).getTime() < REFERRAL_DAYS * DAY;

// The creator's rate (of the net) for one fan's payment.
export const rateFor = (level: Level, refs: Referral[], fanId: string | null, creatorProfileId: string, at = new Date()) =>
  fanId && referralActive(refs.find((r) => r.fanId === fanId), creatorProfileId, at) ? Math.max(REFERRAL_SHARE, level.share) : level.share;

// When an invited creator qualified for the invite bonus: verified, and the sale that took them to $100.
export const qualifiedAt = (txs: Transaction[], creatorProfileId: string, verified: boolean): string | null => {
  if (!verified) return null;
  let total = 0;
  for (const t of paidTo(txs, creatorProfileId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    total += t.amount;
    if (total >= CREATOR_INVITE_QUALIFY) return t.createdAt;
  }
  return null;
};

// The bonus month of one invited creator: from when the inviter has 2 qualified
// invited creators (or this one qualifies, if later), for one month. Null until then.
export const inviteWindow = (invite: CreatorInvite, all: CreatorInvite[], qualified: (creatorProfileId: string) => string | null): { from: string; until: string } | null => {
  const mine = qualified(invite.creatorProfileId);
  if (!mine) return null;
  const times = all
    .filter((i) => i.referrerProfileId === invite.referrerProfileId)
    .map((i) => qualified(i.creatorProfileId))
    .filter((q): q is string => !!q)
    .sort();
  if (times.length < CREATOR_INVITE_MIN) return null;
  const from = mine > times[CREATOR_INVITE_MIN - 1] ? mine : times[CREATOR_INVITE_MIN - 1];
  const until = new Date(from);
  until.setUTCMonth(until.getUTCMonth() + CREATOR_INVITE_MONTHS);
  return { from, until: until.toISOString() };
};

// The inviter's bonus on one sale: 5% of the net, keeping creator + inviter within
// 90% of the net, and within what is left of the $100 cap.
export const inviteBonusFor = (sale: Pick<Transaction, 'amount' | 'share'> & { gatewayFee?: number }, paidSoFar = 0) => {
  const net = sale.amount - (sale.gatewayFee ?? processorFee(sale.amount));
  if (net <= 0) return 0;
  const rate = (sale.amount * (sale.share ?? 0.8)) / net;
  const bonus = Math.round(net * Math.max(0, Math.min(CREATOR_INVITE_BONUS, MAX_SHARE - rate)) * 100) / 100;
  return Math.max(0, Math.min(bonus, Math.round((CREATOR_INVITE_CAP - paidSoFar) * 100) / 100));
};

// ---------------------------------------------------------------------
// Medals: worked out from activity. Each one unlocks visibility, not money.
// ---------------------------------------------------------------------
export type MedalId = 'primer-reserve' | 'iman' | 'puntual' | 'constante' | 'embajador';

export interface MedalInfo {
  id: MedalId;
  name: string;
  icon: string;
  how: string; // how to earn it
  unlocks: string;
}

export const MEDALS: MedalInfo[] = [
  { id: 'primer-reserve', name: 'Primer Reserve', icon: 'fa-ticket', how: 'Completa tu primera experiencia de Reserve.', unlocks: '48 h destacado en Explorar.' },
  { id: 'iman', name: 'Imán de fans', icon: 'fa-magnet', how: 'Consigue 10, 25 o 50 fans nuevos con tu enlace en un mes (que te paguen algo).', unlocks: '2, 5 o 7 días destacado en tu categoría.' },
  { id: 'puntual', name: 'Puntual', icon: 'fa-clock', how: 'Responde a tiempo tus últimas 20 solicitudes de Reserve.', unlocks: 'Insignia "Puntual" visible para tus fans.' },
  { id: 'constante', name: 'Constante', icon: 'fa-fire', how: 'Haz al menos un Live para suscriptores cada semana durante 4 semanas.', unlocks: 'Destacado en Explorar mientras mantengas la racha, e insignia "Constante".' },
  { id: 'embajador', name: 'Embajador', icon: 'fa-handshake', how: 'Invita a 2 creadores que se verifiquen y vendan sus primeros $100.', unlocks: 'Activa tu bono de invitación (5%, hasta $100 por creador).' },
];
export const IMAN_TIERS = [
  { fans: 10, days: 2 },
  { fans: 25, days: 5 },
  { fans: 50, days: 7 },
];
export const PUNTUAL_REQUESTS = 20;
export const CONSTANTE_WEEKS = 4;
export const FIRST_RESERVE_BOOST_DAYS = 2;

export interface MedalState {
  firstReserveAt: string | null;
  puntual: boolean;
  puntualCount: number; // requests counted so far (up to 20)
  liveWeeks: number; // weeks in a row with a subscriber Live
  constante: boolean;
  imanTier: number; // 0-3
  imanUntil: string | null;
  qualifiedInvites: number;
  embajador: boolean;
  boostUntil: string | null; // featured until then
  boostReason: MedalId | null;
}

export const EMPTY_MEDALS: MedalState = {
  firstReserveAt: null, puntual: false, puntualCount: 0, liveWeeks: 0, constante: false,
  imanTier: 0, imanUntil: null, qualifiedInvites: 0, embajador: false, boostUntil: null, boostReason: null,
};

const slotTime = (b: Pick<BookingLike, 'date' | 'time'>) => new Date(`${b.date}T${b.time || '00:00'}:00Z`).toISOString();

export const medalsFor = (input: {
  creatorProfileId: string;
  bookings: BookingLike[];
  lives: { creatorProfileId: string; startedAt: string; mode?: string }[];
  refs: Referral[];
  txs: Transaction[];
  qualifiedInvites: number;
  at?: Date;
}): MedalState => {
  const { creatorProfileId: id, bookings, lives, refs, txs, qualifiedInvites } = input;
  const at = input.at ?? new Date();
  const now = at.toISOString();
  const mine = bookings.filter((b) => b.creatorProfileId === id);

  const done = mine.filter((b) => ['confirmed', 'completed'].includes(b.status) && slotTime(b) < now).map(slotTime).sort();
  const firstReserveAt = done[0] ?? null;

  const answered = mine.filter((b) => ANSWERED_STATUSES.includes(b.status) && b.createdAt <= now).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, PUNTUAL_REQUESTS);
  const puntual = answered.length >= PUNTUAL_REQUESTS && !answered.some((b) => UNANSWERED.includes(b.status));

  let liveWeeks = 0;
  for (let k = 0; k < CONSTANTE_WEEKS; k++) {
    const from = new Date(at.getTime() - 7 * (k + 1) * DAY).toISOString();
    const to = new Date(at.getTime() - 7 * k * DAY).toISOString();
    if (!lives.some((l) => l.creatorProfileId === id && l.mode === 'subscriber' && l.startedAt > from && l.startedAt <= to)) break;
    liveWeeks++;
  }

  let imanTier = 0;
  let imanUntil: string | null = null;
  for (const offset of [-1, 0]) {
    const from = monthStart(at, offset);
    const to = monthStart(at, offset + 1);
    const firstPaid = refs
      .filter((r) => r.creatorProfileId === id && r.joinedAt >= from && r.joinedAt < to)
      .map((r) => paidTo(txs, id).filter((t) => t.payerId === r.fanId).map((t) => t.createdAt).sort()[0])
      .filter((x): x is string => !!x && x <= now)
      .sort();
    for (const [i, tier] of IMAN_TIERS.entries()) {
      const reached = firstPaid[tier.fans - 1];
      if (!reached) break;
      imanTier = Math.max(imanTier, i + 1);
      const until = new Date(new Date(reached).getTime() + tier.days * DAY).toISOString();
      if (!imanUntil || until > imanUntil) imanUntil = until;
    }
  }

  let boostUntil: string | null = null;
  let boostReason: MedalId | null = null;
  if (firstReserveAt) {
    const until = new Date(new Date(firstReserveAt).getTime() + FIRST_RESERVE_BOOST_DAYS * DAY).toISOString();
    if (now < until) [boostUntil, boostReason] = [until, 'primer-reserve'];
  }
  if (imanUntil && now < imanUntil && (!boostUntil || imanUntil > boostUntil)) [boostUntil, boostReason] = [imanUntil, 'iman'];
  if (liveWeeks >= CONSTANTE_WEEKS && !boostUntil) [boostUntil, boostReason] = [new Date(at.getTime() + DAY).toISOString(), 'constante'];

  return {
    firstReserveAt,
    puntual,
    puntualCount: answered.length,
    liveWeeks,
    constante: liveWeeks >= CONSTANTE_WEEKS,
    imanTier,
    imanUntil,
    qualifiedInvites,
    embajador: qualifiedInvites >= CREATOR_INVITE_MIN,
    boostUntil,
    boostReason,
  };
};

// Which medals a creator holds right now (for the panel and the profile).
export const earnedMedals = (m: MedalState): MedalId[] => [
  ...(m.firstReserveAt ? (['primer-reserve'] as const) : []),
  ...(m.imanTier > 0 ? (['iman'] as const) : []),
  ...(m.puntual ? (['puntual'] as const) : []),
  ...(m.constante ? (['constante'] as const) : []),
  ...(m.embajador ? (['embajador'] as const) : []),
];

// Referral links look like /r/<creator profile id>; the code waits in the browser until sign-up.
export const REF_KEY = `${BRAND.storagePrefix}ref`;
export const REF_TTL_DAYS = 30;

export const saveRefCode = (creatorProfileId: string) => {
  try {
    localStorage.setItem(REF_KEY, JSON.stringify({ id: creatorProfileId, at: Date.now() }));
  } catch {
    // ignore
  }
};

export const readRefCode = (): string | undefined => {
  try {
    const v = JSON.parse(localStorage.getItem(REF_KEY) || 'null');
    if (v && typeof v.id === 'string' && Date.now() - v.at < REF_TTL_DAYS * DAY) return v.id;
  } catch {
    // ignore
  }
  return undefined;
};

export const clearRefCode = () => {
  try {
    localStorage.removeItem(REF_KEY);
  } catch {
    // ignore
  }
};
