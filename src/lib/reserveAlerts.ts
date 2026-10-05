// What each side is told when a Reserve booking is created or changes state. The
// database writes the same notices with the trigger public.reserve_alert()
// (supabase/migrations/20261005000001_reserve_alerts.sql); the browser-only
// backend uses this copy. Keep both in step.
import { RESERVE_RESPONSE_HOURS } from '../config/reserve';
import type { VipBooking } from './backend/types';

export interface BookingAlert {
  to: 'creator' | 'fan';
  title: string;
  body: string;
  link: string;
}

export const CREATOR_RESERVE_LINK = '/creator/dashboard?tab=vip';
export const FAN_RESERVE_LINK = '/profile#mis-reservas';

const first = (name: string | undefined, fallback: string) => (name?.trim() || fallback).split(' ')[0];

export const bookingAlert = (prev: VipBooking | undefined, b: VipBooking): BookingAlert | null => {
  const when = `${b.date.slice(8, 10)}/${b.date.slice(5, 7)} · ${b.time}`;
  const fan = first(b.fanName, 'Un fan');
  const creator = first(b.creatorName, 'El creador');
  const forCreator = (title: string, body: string): BookingAlert => ({ to: 'creator', title, body, link: CREATOR_RESERVE_LINK });
  const forFan = (title: string, body: string): BookingAlert => ({ to: 'fan', title, body, link: FAN_RESERVE_LINK });

  if (!prev) return forCreator(b.status === 'pending' ? 'Nueva solicitud de Reserve' : 'Nueva reserva', `${fan} · ${b.title} · ${when}`);
  if (prev.status === b.status) return null;
  switch (b.status) {
    case 'accepted':
      if (prev.status === 'pending') return forFan(`${creator} aceptó tu solicitud`, `${b.title} · ${when}. Paga para confirmarla.`);
      if (prev.status === 'countered') return forCreator(`${fan} aceptó tu contraoferta`, `${b.title} · ${when}. Falta su pago.`);
      return null;
    case 'countered':
      return forFan(`${creator} te envió una contraoferta`, `${b.title}. Tienes ${RESERVE_RESPONSE_HOURS} horas para responder.`);
    case 'rejected':
      return forFan(`${creator} no puede aceptar tu solicitud`, `${b.title}. No se te cobró nada.`);
    case 'expired':
      if (prev.status === 'pending') return forFan('Tu solicitud expiró sin respuesta', `${b.title} con ${creator}. No se te cobró nada.`);
      if (prev.status === 'countered') return forCreator('Tu contraoferta expiró', `${fan} no respondió a tiempo · ${b.title}`);
      return null;
    case 'cancelled':
      return ['pending', 'accepted', 'countered'].includes(prev.status) ? forCreator(`${fan} canceló su solicitud`, `${b.title} · ${when}`) : null;
    case 'confirmed':
      return forCreator('Reserva confirmada y pagada', `${fan} · ${b.title} · ${when}`);
    default:
      return null;
  }
};

// Deadline for a booking that starts waiting for an answer now: the response
// time, but never after the experience itself (and at least an hour).
export const respondByFrom = (b: Pick<VipBooking, 'date' | 'time'>, now = new Date()): string => {
  const limit = now.getTime() + RESERVE_RESPONSE_HOURS * 3600_000;
  const start = new Date(`${b.date}T${b.time || '00:00'}:00`).getTime();
  const capped = Number.isNaN(start) ? limit : Math.min(limit, Math.max(start, now.getTime() + 3600_000));
  return new Date(capped).toISOString();
};

// A pending request or counter-offer whose deadline passed (before the server job
// gets to it, the app already treats it as expired).
export const isOverdue = (b: Pick<VipBooking, 'status' | 'respondBy'>, now = new Date()) =>
  (b.status === 'pending' || b.status === 'countered') && !!b.respondBy && new Date(b.respondBy) < now;

// What the creator still has to answer: the red dot on "Reservas".
export const needsCreatorAnswer = (b: VipBooking, now = new Date()) =>
  (b.status === 'pending' || b.status === 'reschedule_requested') && !isOverdue(b, now);

// "quedan 31 h" / "quedan 25 min".
export const timeLeft = (iso: string, now = new Date()) => {
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - now.getTime()) / 60000));
  return mins >= 120 ? `quedan ${Math.floor(mins / 60)} h` : mins >= 60 ? `queda 1 h ${mins - 60} min` : `quedan ${mins} min`;
};

export const deadlineLabel = (iso: string) =>
  new Date(iso).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
