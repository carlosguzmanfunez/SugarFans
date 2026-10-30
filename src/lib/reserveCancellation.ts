// Reserve cancellation: one rule for every experience (Carlos, 2026-10-29).
//
//   Fan cancels 24 h or more before the start ... 100% back in Créditos.
//   Fan cancels less than 24 h before ........... 50% back in Créditos.
//   Fan does not show up ........................ nothing back.
//   Creator cancels a paid booking .............. 100% back in Créditos, and it
//                                                 counts against the creator.
//   One free date change per 1:1 booking, asked 24 h or more before the start.
//
// The server decides (supabase/migrations/20261030000001_reserve_cancellation.sql:
// reserve_cancel_hours(), reserve_late_refund_percent()); this file only
// previews it for the confirmation screen. Change both.
import { zonedDate } from './timeZones';
import type { VipBooking } from './backend/types';

export const CANCEL_FULL_REFUND_HOURS = 24;
export const LATE_REFUND_PERCENT = 50;
// Bookings saved before time zones existed were in Honduras time.
export const DEFAULT_RESERVE_TIME_ZONE = 'America/Tegucigalpa';

type BookingClock = Pick<VipBooking, 'date' | 'time' | 'timeZone'>;

export const bookingStart = (b: BookingClock): Date => zonedDate(b.date, b.time, b.timeZone || DEFAULT_RESERVE_TIME_ZONE);

export const hoursUntil = (b: BookingClock, now = new Date()) => (bookingStart(b).getTime() - now.getTime()) / 3_600_000;

export interface CancellationOutcome {
  // false: not paid yet, nothing moves.
  paid: boolean;
  refundPercent: number;
  refundCoins: number;
  // Paid with a Meta de experiencia ticket: whether it comes back.
  ticket: boolean;
  ticketBack: boolean;
  late: boolean;
}

// What cancelling now would do, or null when it can no longer be cancelled.
export const cancellationOutcome = (
  b: Pick<VipBooking, 'status' | 'price' | 'date' | 'time' | 'timeZone' | 'details'>,
  by: 'fan' | 'creator',
  now = new Date()
): CancellationOutcome | null => {
  const ticket = !!b.details?.ticketId;
  if (by === 'fan' && (b.status === 'pending' || b.status === 'accepted' || b.status === 'countered'))
    return { paid: false, refundPercent: 0, refundCoins: 0, ticket, ticketBack: ticket, late: false };
  if (b.status !== 'confirmed') return null;
  const hours = hoursUntil(b, now);
  if (hours <= 0) return null;
  const late = hours < CANCEL_FULL_REFUND_HOURS;
  const refundPercent = by === 'creator' || !late ? 100 : LATE_REFUND_PERCENT;
  return {
    paid: true,
    refundPercent,
    refundCoins: ticket ? 0 : Math.round(b.price * refundPercent),
    ticket,
    ticketBack: ticket && refundPercent === 100,
    late,
  };
};

// The fan's one free date change: 1:1 only, confirmed, not used yet, asked in time.
export const canRequestReschedule = (b: Pick<VipBooking, 'status' | 'date' | 'time' | 'timeZone' | 'details'>, now = new Date()) =>
  b.status === 'confirmed' &&
  b.details?.kind !== 'event' &&
  !b.details?.rescheduled &&
  !b.details?.reschedule &&
  hoursUntil(b, now) >= CANCEL_FULL_REFUND_HOURS;

// The earliest new date for a date change (24 h from now), as YYYY-MM-DD.
export const rescheduleMinDate = (now = new Date()) => {
  const d = new Date(now.getTime() + CANCEL_FULL_REFUND_HOURS * 3_600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
