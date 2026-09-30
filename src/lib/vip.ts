// VIP experience scheduling helpers: booking window, availability math and labels.
// Data access lives in the backend (src/lib/backend).
import type { Availability, BookingStatus, TakenSlot } from './backend/types';

export type { Availability, BookingStatus, VipBooking, TakenSlot } from './backend/types';

export const MAX_BOOKING_MONTHS = 3;

export const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const ALL_HOURS = Array.from({ length: 15 }, (_, i) => `${String(i + 8).padStart(2, '0')}:00`); // 08:00–22:00

export const DEFAULT_AVAILABILITY: Availability = {
  days: [1, 2, 3, 4, 5],
  hours: ['10:00', '12:00', '16:00', '18:00'],
};

export const ACTIVE_STATUSES: BookingStatus[] = ['pending', 'accepted', 'confirmed'];

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

export const takenHoursOn = (taken: TakenSlot[], date: string): string[] =>
  taken.filter((s) => s.date === date).map((s) => s.time);

export const freeHoursOn = (availability: Availability, taken: TakenSlot[], date: string): string[] => {
  const { min, max } = bookingWindow();
  if (date < min || date > max || !availability.days.includes(fromISODate(date).getDay())) return [];
  const busy = takenHoursOn(taken, date);
  return availability.hours.filter((h) => !busy.includes(h));
};

export const normalizeAvailability = (a: Availability): Availability => ({
  days: [...new Set(a.days)].sort((x, y) => x - y),
  hours: [...new Set(a.hours)].sort(),
});

export const statusLabel: Record<BookingStatus, { text: string; className: string }> = {
  pending: { text: 'Esperando al creador', className: 'bg-yellow-100 text-yellow-700' },
  accepted: { text: 'Aceptada · pendiente de pago', className: 'bg-blue-100 text-blue-700' },
  confirmed: { text: 'Confirmada', className: 'bg-green-100 text-green-700' },
  rejected: { text: 'Rechazada por el creador', className: 'bg-red-100 text-red-700' },
  cancelled: { text: 'Cancelada', className: 'bg-gray-100 text-gray-500' },
};

// Live video sessions: experiences with a duration happen live in the app's
// room (/live/:bookingId). It opens 15 minutes before the booked time and
// closes 30 minutes after the booked duration.
export const LIVE_EARLY_MIN = 15;
export const LIVE_GRACE_MIN = 30;

export const durationMinutes = (duration?: string): number | null => {
  const m = duration?.match(/(\d+)\s*min/);
  return m ? Number(m[1]) : null;
};

export const liveWindow = (date: string, time: string, minutes: number) => {
  const start = fromISODate(date);
  const [h, mm] = time.split(':').map(Number);
  start.setHours(h, mm || 0, 0, 0);
  return {
    start,
    opens: new Date(start.getTime() - LIVE_EARLY_MIN * 60_000),
    closes: new Date(start.getTime() + (minutes + LIVE_GRACE_MIN) * 60_000),
  };
};

export type LiveState = 'early' | 'open' | 'over';
export const liveState = (date: string, time: string, minutes: number, now = new Date()): LiveState => {
  const w = liveWindow(date, time, minutes);
  return now < w.opens ? 'early' : now > w.closes ? 'over' : 'open';
};
