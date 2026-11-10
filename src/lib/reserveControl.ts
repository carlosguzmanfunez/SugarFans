import type { VipBooking } from './backend/types';
import { bookingStart } from './reserveCancellation';

export const RESERVE_HOLD_MINUTES = 15;
export const PROPOSAL_PAYMENT_MINUTES = 120;
// Cupos en vivo: less time to pay, so unpaid slots go back on the board sooner.
export const LIVE_SLOT_PAYMENT_MINUTES = 5;
export const RESERVE_BLOCK_HOURS = 72;
export const RESERVE_INCIDENT_DAYS = 30;
export const RESERVE_INCIDENT_LIMIT = 3;
export type ReserveIncident = { bookingId: string; fanId: string; kind: 'unpaid' | 'cancelled'; at: string };
export interface ReserveAccess {
  blockedUntil?: string;
  reason?: 'unpaid' | 'cancelled';
  unpaid: number;
  cancelled: number;
  reservations: number;
  proposals: number;
}
export const EMPTY_RESERVE_ACCESS: ReserveAccess = { unpaid: 0, cancelled: 0, reservations: 0, proposals: 0 };
export const reserveBucket = (b: VipBooking, now = new Date()): 'reservation' | 'proposal' | null => {
  if (paymentOverdue(b, now)) return null;
  if (b.status === 'pending' || b.status === 'countered') return 'proposal';
  if ((b.status === 'accepted' || b.status === 'confirmed') && bookingStart(b).getTime() + (b.durationMinutes ?? 60) * 60_000 > now.getTime()) return 'reservation';
  return null;
};
export const reserveAccessOf = (fanId: string, bookings: VipBooking[], incidents: ReserveIncident[], now = new Date()): ReserveAccess => {
  const history = incidents.filter(i => i.fanId === fanId && new Date(i.at).getTime() <= now.getTime()).sort((a,b) => a.at.localeCompare(b.at));
  const recent = history.filter(i => new Date(i.at).getTime() >= now.getTime() - RESERVE_INCIDENT_DAYS * 86400_000);
  let blockedUntil = 0; let reason: ReserveAccess['reason'];
  const counts = { unpaid: 0, cancelled: 0 };
  for (const i of history) {
    const at = new Date(i.at).getTime();
    const strikes = history.filter(other => other.kind === i.kind && new Date(other.at).getTime() <= at && new Date(other.at).getTime() >= at - RESERVE_INCIDENT_DAYS * 86400_000).length;
    if (strikes >= RESERVE_INCIDENT_LIMIT) { const until = at + RESERVE_BLOCK_HOURS * 3600_000; if (until > blockedUntil) { blockedUntil = until; reason = i.kind; } }
  }
  for (const i of recent) counts[i.kind]++;
  const mine = bookings.filter(b => b.fanId === fanId);
  return { ...counts, ...(blockedUntil > now.getTime() ? { blockedUntil: new Date(blockedUntil).toISOString(), reason } : {}), reservations: mine.filter(b => reserveBucket(b,now) === 'reservation').length, proposals: mine.filter(b => reserveBucket(b,now) === 'proposal').length };
};
export const reservationDue = (b: VipBooking, now = new Date()): string => new Date(Math.min(bookingStart(b).getTime(), now.getTime() + (b.details?.kind === 'custom' ? PROPOSAL_PAYMENT_MINUTES : b.details?.approvalRequired ? PROPOSAL_PAYMENT_MINUTES : b.details?.liveDropId ? LIVE_SLOT_PAYMENT_MINUTES : RESERVE_HOLD_MINUTES) * 60_000)).toISOString();
export const paymentOverdue = (b: VipBooking, now = new Date()) => b.status === 'accepted' && !!b.paymentDueAt && new Date(b.paymentDueAt) <= now && !b.paymentChecking;
export type RefundChoice = 'original' | 'credits';
export type CancellationReason = 'voluntary' | 'withdrawal' | 'creator_failure';
export interface ReserveRefundRequest { id: string; bookingId: string; fanId: string; title: string; fanName: string; amount: number; reason: string; state: 'pending' | 'approved' | 'completed' | 'declined'; createdAt: string; paymentRef?: string; note?: string; recoveredFee?: number; feePending?: boolean; funding?: 'credits' | 'original' }
