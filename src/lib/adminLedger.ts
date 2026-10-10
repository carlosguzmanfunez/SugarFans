// The admin's money view: what came in from fans, what PayPal kept, what belongs to
// creators, what Fans Reserve keeps, and every movement in one ledger. Pure functions
// over the rows the admin can read (transactions, Créditos purchases, withdrawals).
import type { Payout, Transaction } from './backend/platformTypes';
import type { CoinPurchase } from './backend/giftTypes';
import { creditCutoff } from './platformRules';
import { GIFT_SHARE } from './giftRules';

export type Period = 'today' | '7d' | 'month' | 'lastMonth' | 'all';
export const periodLabel: Record<Period, string> = {
  today: 'Hoy',
  '7d': '7 días',
  month: 'Este mes',
  lastMonth: 'Mes pasado',
  all: 'Todo',
};

// [from, to) in ISO; null = no bound.
export const periodRange = (period: Period, at = new Date()): [string | null, string | null] => {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  const monthStart = new Date(at.getFullYear(), at.getMonth(), 1);
  switch (period) {
    case 'today':
      return [day.toISOString(), null];
    case '7d':
      return [new Date(day.getTime() - 6 * 86_400_000).toISOString(), null];
    case 'month':
      return [monthStart.toISOString(), null];
    case 'lastMonth':
      return [new Date(at.getFullYear(), at.getMonth() - 1, 1).toISOString(), monthStart.toISOString()];
    default:
      return [null, null];
  }
};

const inRange = (iso: string, [from, to]: [string | null, string | null]) => (!from || iso >= from) && (!to || iso < to);
const round2 = (n: number) => Math.round(n * 100) / 100;
// PayPal's usual rate (same estimate the database uses when PayPal didn't report the fee).
export const feeEstimate = (amount: number) => round2(amount * 0.054 + 0.3);

// Sales a fan paid with PayPal (Créditos are paid when bought; gifts spend them).
const CASH_KINDS: Transaction['kind'][] = ['subscription', 'renewal', 'tip', 'vip'];
const shareOf = (t: Transaction) => t.share ?? (t.kind === 'gift' ? GIFT_SHARE : t.kind === 'referral' ? 1 : 0.8);
// What the creator gets from a sale; a refund Fans Reserve covers still counts for them.
const counts = (t: Transaction) => t.status === 'paid' || (!!t.platformCovers && (t.status === 'refunded' || t.status === 'disputed'));
const creatorPart = (t: Transaction) => (counts(t) ? round2(t.amount * shareOf(t)) : 0);
const purchaseOk = (c: CoinPurchase) => (c.status ?? 'paid') === 'paid';

export interface Summary {
  cashIn: number; // what fans paid through PayPal
  paypalFees: number;
  creators: number; // creators' part of sales, gifts and invite bonuses
  platform: number; // what Fans Reserve keeps
  refunded: number;
  disputed: number;
  sales: number; // number of payments
  payingFans: number;
  byKind: { key: string; label: string; count: number; amount: number }[];
  topCreators: { id: string; name: string; amount: number; creators: number }[];
}

export const summarize = (txs: Transaction[], coins: CoinPurchase[], period: Period, at = new Date()): Summary => {
  const range = periodRange(period, at);
  const tx = txs.filter((t) => inRange(t.createdAt, range));
  const cash = tx.filter((t) => CASH_KINDS.includes(t.kind) && t.status === 'paid');
  const bought = coins.filter((c) => inRange(c.createdAt, range) && purchaseOk(c));
  const gifts = tx.filter((t) => t.kind === 'gift' && t.status === 'paid');

  const cashIn = round2(cash.reduce((s, t) => s + t.amount, 0) + bought.reduce((s, c) => s + c.price, 0));
  const paypalFees = round2(
    cash.reduce((s, t) => s + (t.gatewayFee ?? feeEstimate(t.amount)), 0) + bought.reduce((s, c) => s + feeEstimate(c.price), 0)
  );
  const creators = round2(tx.reduce((s, t) => s + creatorPart(t), 0));
  const lost = tx.filter((t) => t.kind !== 'referral' && (t.status === 'refunded' || t.status === 'disputed'));
  const kind = (key: string, label: string, list: { amount: number }[]) => ({ key, label, count: list.length, amount: round2(list.reduce((s, x) => s + x.amount, 0)) });

  const byCreator = new Map<string, { id: string; name: string; amount: number; creators: number }>();
  for (const t of [...cash, ...gifts]) {
    const row = byCreator.get(t.creatorProfileId) ?? { id: t.creatorProfileId, name: t.creatorName, amount: 0, creators: 0 };
    row.amount = round2(row.amount + t.amount);
    row.creators = round2(row.creators + creatorPart(t));
    byCreator.set(t.creatorProfileId, row);
  }

  return {
    cashIn,
    paypalFees,
    creators,
    platform: round2(cashIn - paypalFees - creators),
    refunded: round2(lost.filter((t) => t.status === 'refunded').reduce((s, t) => s + t.amount, 0)),
    disputed: round2(lost.filter((t) => t.status === 'disputed').reduce((s, t) => s + t.amount, 0)),
    sales: cash.length + bought.length,
    payingFans: new Set([...cash.map((t) => t.payerId), ...bought.map((c) => c.userId)].filter(Boolean)).size,
    byKind: [
      kind('subscription', 'Suscripciones y renovaciones', cash.filter((t) => t.kind === 'subscription' || t.kind === 'renewal')),
      kind('vip', 'Reserve', cash.filter((t) => t.kind === 'vip')),
      kind('tip', 'Propinas', cash.filter((t) => t.kind === 'tip')),
      kind('coins', 'Créditos vendidos', bought.map((c) => ({ amount: c.price }))),
      kind('gift', 'Regalos enviados (pagados con Créditos)', gifts),
    ],
    topCreators: [...byCreator.values()].sort((a, b) => b.amount - a.amount).slice(0, 5),
  };
};

// What Fans Reserve owes creators right now (all time, not by period).
export const owedToCreators = (txs: Transaction[], payouts: Payout[], at = new Date()) => {
  const cutoff = creditCutoff(at);
  const earned = txs.filter(counts);
  const credited = round2(earned.filter((t) => t.createdAt < cutoff).reduce((s, t) => s + creatorPart(t), 0));
  const pending = round2(earned.filter((t) => t.createdAt >= cutoff).reduce((s, t) => s + creatorPart(t), 0));
  const sent = payouts.filter((p) => p.status !== 'failed');
  const withdrawn = round2(sent.reduce((s, p) => s + p.amount, 0));
  return {
    available: round2(Math.max(0, credited - withdrawn)), // can be withdrawn today
    pending, // credited on the 1st of next month
    sending: round2(payouts.filter((p) => p.status === 'sending').reduce((s, p) => s + p.amount, 0)),
    withdrawn,
  };
};

// Créditos bought and not spent yet (money fans still hold inside Fans Reserve).
export const unspentCredits = (txs: Transaction[], coins: CoinPurchase[]) =>
  round2(Math.max(0, coins.filter(purchaseOk).reduce((s, c) => s + c.price, 0) - txs.filter((t) => t.kind === 'gift' && t.status === 'paid').reduce((s, t) => s + t.amount, 0)));

export interface LedgerRow {
  id: string;
  at: string;
  type: string;
  who: string;
  amount: number; // + money in, − money out
  fee: number;
  creator: number;
  platform: number;
  status: string;
}

const statusLabel: Record<string, string> = { paid: 'Pagado', failed: 'Fallido', refunded: 'Reembolsado', disputed: 'En disputa', sending: 'En camino' };
const txType: Record<Transaction['kind'], string> = {
  subscription: 'Suscripción',
  renewal: 'Renovación',
  tip: 'Propina',
  gift: 'Regalo (Créditos)',
  referral: 'Bono por invitar',
  vip: 'Reserve',
};

// Every movement of the period, newest first. Gifts and invite bonuses move no
// PayPal money (amount 0): they only move value from Fans Reserve to the creator.
export const ledger = (txs: Transaction[], coins: CoinPurchase[], payouts: Payout[], period: Period, at = new Date()): LedgerRow[] => {
  const range = periodRange(period, at);
  const rows: LedgerRow[] = [];
  for (const t of txs) {
    if (!inRange(t.createdAt, range)) continue;
    const isCash = CASH_KINDS.includes(t.kind);
    const fee = isCash && t.status === 'paid' ? round2(t.gatewayFee ?? feeEstimate(t.amount)) : 0;
    const creator = creatorPart(t);
    const amount = isCash && t.status === 'paid' ? t.amount : 0;
    rows.push({
      id: t.id,
      at: t.createdAt,
      type: txType[t.kind],
      who: t.kind === 'referral' ? `Fans Reserve → ${t.creatorName}` : `${t.payerName} → ${t.creatorName}`,
      amount,
      fee,
      creator,
      platform: round2(amount - fee - creator),
      status:
        (statusLabel[t.status] ?? t.status) +
        (isCash && (t.status === 'refunded' || t.status === 'disputed') ? ` $${t.amount.toFixed(2)}` : '') +
        (t.platformCovers && t.status !== 'paid' ? ' (lo cubre Fans Reserve)' : ''),
    });
  }
  for (const c of coins) {
    if (!inRange(c.createdAt, range)) continue;
    const ok = purchaseOk(c);
    const fee = ok ? feeEstimate(c.price) : 0;
    rows.push({
      id: c.id,
      at: c.createdAt,
      type: 'Compra de Créditos',
      who: c.userName ?? 'Fan',
      amount: ok ? c.price : 0,
      fee,
      creator: 0,
      platform: ok ? round2(c.price - fee) : 0,
      status: statusLabel[c.status ?? 'paid'] ?? String(c.status),
    });
  }
  for (const p of payouts) {
    if (!inRange(p.requestedAt, range)) continue;
    const out = p.status === 'failed' ? 0 : p.amount;
    rows.push({
      id: p.id,
      at: p.requestedAt,
      type: 'Retiro a creador',
      who: `Fans Reserve → ${p.creatorName}`,
      amount: -out,
      fee: 0,
      creator: -out,
      platform: 0,
      status: p.status === 'failed' ? 'No se pudo enviar' : statusLabel[p.status] ?? p.status,
    });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at));
};

// The ledger as a CSV file for the accountant.
export const ledgerCsv = (rows: LedgerRow[]) => {
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const head = ['Fecha', 'Tipo', 'Quién', 'Monto USD', 'Comisión PayPal', 'Parte creador', 'Fans Reserve', 'Estado'];
  return [head, ...rows.map((r) => [r.at, r.type, r.who, r.amount.toFixed(2), r.fee.toFixed(2), r.creator.toFixed(2), r.platform.toFixed(2), r.status])]
    .map((line) => line.map(q).join(','))
    .join('\n');
};
