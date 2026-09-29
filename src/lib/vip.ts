// VIP experience scheduling: creator availability and the booking lifecycle.
// Bookings are shared between the fan who books and the creator who accepts,
// so they live in one store instead of on either account.
import { useEffect, useState } from 'react';
import { readJSON, writeJSON, newId } from './storage';

export const MAX_BOOKING_MONTHS = 3;

export const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const ALL_HOURS = Array.from({ length: 15 }, (_, i) => `${String(i + 8).padStart(2, '0')}:00`); // 08:00–22:00

export interface Availability {
  days: number[]; // 0 = Sunday … 6 = Saturday
  hours: string[]; // "HH:00"
}

export const DEFAULT_AVAILABILITY: Availability = {
  days: [1, 2, 3, 4, 5],
  hours: ['10:00', '12:00', '16:00', '18:00'],
};

// pending: waiting for the creator · accepted: waiting for the fan's payment
// confirmed: paid, confirmation email sent · rejected / cancelled: closed
export type BookingStatus = 'pending' | 'accepted' | 'confirmed' | 'rejected' | 'cancelled';

export interface VipBooking {
  id: string;
  experienceId: string;
  creatorProfileId: string;
  title: string;
  creatorName: string;
  price: number;
  fanId: string;
  fanName: string;
  fanEmail: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:00
  message: string;
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
  emailSentAt?: string;
}

export interface OutgoingEmail {
  id: string;
  to: string;
  subject: string;
  body: string;
  sentAt: string;
}

const AVAILABILITY_KEY = 'vip_availability';
const BOOKINGS_KEY = 'vip_bookings';
const OUTBOX_KEY = 'email_outbox';
const CHANGE_EVENT = 'sugarfans:vip';

const notify = () => window.dispatchEvent(new Event(CHANGE_EVENT));

// Re-render subscribers when VIP data changes in this tab or another one.
export const useVipStore = (): number => {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.startsWith('sugarfans_vip') || e.key.startsWith('sugarfans_email')) bump();
    };
    window.addEventListener(CHANGE_EVENT, bump);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, bump);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return version;
};

// ---- Dates -------------------------------------------------------------

export const toISODate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const fromISODate = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// Bookable window: from tomorrow up to MAX_BOOKING_MONTHS ahead.
export const bookingWindow = (now = new Date()) => {
  const min = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const max = new Date(now.getFullYear(), now.getMonth() + MAX_BOOKING_MONTHS, now.getDate());
  return { min: toISODate(min), max: toISODate(max) };
};

export const formatLongDate = (iso: string): string =>
  fromISODate(iso).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

// ---- Availability ------------------------------------------------------

export const getAvailability = (creatorProfileId: string): Availability =>
  readJSON<Record<string, Availability>>(AVAILABILITY_KEY, {})[creatorProfileId] ?? DEFAULT_AVAILABILITY;

export const setAvailability = (creatorProfileId: string, availability: Availability): void => {
  const all = readJSON<Record<string, Availability>>(AVAILABILITY_KEY, {});
  all[creatorProfileId] = {
    days: [...new Set(availability.days)].sort(),
    hours: [...new Set(availability.hours)].sort(),
  };
  writeJSON(AVAILABILITY_KEY, all);
  notify();
};

// ---- Bookings ----------------------------------------------------------

const ACTIVE: BookingStatus[] = ['pending', 'accepted', 'confirmed'];

export const listBookings = (): VipBooking[] => readJSON<VipBooking[]>(BOOKINGS_KEY, []);
const saveBookings = (bookings: VipBooking[]) => {
  writeJSON(BOOKINGS_KEY, bookings);
  notify();
};

export const bookingsForFan = (fanId: string) =>
  listBookings().filter((b) => b.fanId === fanId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const bookingsForCreator = (creatorProfileId: string) =>
  listBookings()
    .filter((b) => b.creatorProfileId === creatorProfileId)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

// Hours on a date that another active booking already holds for this creator.
export const takenHours = (creatorProfileId: string, date: string): string[] =>
  listBookings()
    .filter((b) => b.creatorProfileId === creatorProfileId && b.date === date && ACTIVE.includes(b.status))
    .map((b) => b.time);

export const availableHours = (creatorProfileId: string, date: string): string[] => {
  const { min, max } = bookingWindow();
  const availability = getAvailability(creatorProfileId);
  if (date < min || date > max || !availability.days.includes(fromISODate(date).getDay())) return [];
  const taken = takenHours(creatorProfileId, date);
  return availability.hours.filter((h) => !taken.includes(h));
};

export type BookingInput = Omit<VipBooking, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'paidAt' | 'emailSentAt'>;

export const createBooking = (input: BookingInput): { ok: boolean; error?: string } => {
  if (!input.date) return { ok: false, error: 'Elige un día en el calendario' };
  if (!input.time) return { ok: false, error: 'Elige una hora disponible' };
  if (!availableHours(input.creatorProfileId, input.date).includes(input.time)) {
    return { ok: false, error: 'Ese horario ya no está disponible. Elige otro.' };
  }
  const now = new Date().toISOString();
  saveBookings([...listBookings(), { ...input, id: newId(), status: 'pending', createdAt: now, updatedAt: now }]);
  return { ok: true };
};

const transitions: Record<string, BookingStatus[]> = {
  // who → from-status → allowed next statuses
  'creator:pending': ['accepted', 'rejected'],
  'fan:pending': ['cancelled'],
  'fan:accepted': ['confirmed', 'cancelled'],
};

export const updateBooking = (
  id: string,
  actor: { role: 'fan'; fanId: string } | { role: 'creator'; creatorProfileId: string },
  next: BookingStatus,
): { ok: boolean; error?: string } => {
  const bookings = listBookings();
  const booking = bookings.find((b) => b.id === id);
  if (!booking) return { ok: false, error: 'Reserva no encontrada' };
  const owns = actor.role === 'fan' ? booking.fanId === actor.fanId : booking.creatorProfileId === actor.creatorProfileId;
  if (!owns || !(transitions[`${actor.role}:${booking.status}`] ?? []).includes(next)) {
    return { ok: false, error: 'Esta acción no está permitida' };
  }
  const now = new Date().toISOString();
  booking.status = next;
  booking.updatedAt = now;
  if (next === 'confirmed') {
    // Payment is simulated; the confirmation email is only sent once the
    // creator has accepted AND the fan has paid.
    booking.paidAt = now;
    booking.emailSentAt = now;
    sendEmail(
      booking.fanEmail,
      `Confirmación: ${booking.title}`,
      `Hola ${booking.fanName}, tu experiencia "${booking.title}" con ${booking.creatorName} está confirmada para el ${formatLongDate(booking.date)} a las ${booking.time}. Pago recibido: $${booking.price} USD.`,
    );
  }
  saveBookings(bookings);
  return { ok: true };
};

// When a fan deletes their account, free the slots they were holding.
export const cancelBookingsForFan = (fanId: string): void => {
  const now = new Date().toISOString();
  saveBookings(
    listBookings().map((b) =>
      b.fanId === fanId && (b.status === 'pending' || b.status === 'accepted') ? { ...b, status: 'cancelled', updatedAt: now } : b,
    ),
  );
};

// ---- Email (simulated outbox until a mail provider is connected) --------

const sendEmail = (to: string, subject: string, body: string) => {
  const outbox = readJSON<OutgoingEmail[]>(OUTBOX_KEY, []);
  writeJSON(OUTBOX_KEY, [...outbox, { id: newId(), to, subject, body, sentAt: new Date().toISOString() }]);
};

export const statusLabel: Record<BookingStatus, { text: string; className: string }> = {
  pending: { text: 'Esperando al creador', className: 'bg-yellow-100 text-yellow-700' },
  accepted: { text: 'Aceptada · pendiente de pago', className: 'bg-blue-100 text-blue-700' },
  confirmed: { text: 'Confirmada', className: 'bg-green-100 text-green-700' },
  rejected: { text: 'Rechazada por el creador', className: 'bg-red-100 text-red-700' },
  cancelled: { text: 'Cancelada', className: 'bg-gray-100 text-gray-500' },
};
