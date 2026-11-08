// Cupos en vivo: shared rules for the creator panel, the public page
// fansreserve.com/@usuario/ahora and the local demo store. The database
// (20261108010000_reserve_live_slots.sql) enforces the same values.
import type { LiveDrop } from './backend/types';

export const LIVE_SLOT_COUNTS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20];
export const LIVE_SLOT_MINUTES = [10, 15, 20, 30];
export const LIVE_OPENS_IN = [0, 5, 10, 15, 30, 60];
export const LIVE_GAPS = [10, 15, 30, 60];
export const LIVE_MIN_PRICE = 5;
export const LIVE_MAX_PRICE = 5000;
export const LIVE_HOLD_MINUTES = 15;

export const liveSlotsError = (i: { slots: number; minutes: number; price: number; opensIn: number; gap: number }): string | null => {
  if (!(Number.isInteger(i.slots) && i.slots >= 1 && i.slots <= 20)) return 'liveSlots.err.slots';
  if (!LIVE_SLOT_MINUTES.includes(i.minutes)) return 'liveSlots.err.minutes';
  if (!(i.price >= LIVE_MIN_PRICE && i.price <= LIVE_MAX_PRICE)) return 'liveSlots.err.price';
  if (!LIVE_OPENS_IN.includes(i.opensIn)) return 'liveSlots.err.opens';
  if (!LIVE_GAPS.includes(i.gap)) return 'liveSlots.err.gap';
  if (i.slots * i.minutes > 600) return 'liveSlots.err.long';
  return null;
};

// The short link a creator says out loud on the live.
export const liveSlotsPath = (username: string) => `/@${username}/ahora`;
export const liveSlotsLink = (username: string, origin = typeof location !== 'undefined' ? location.origin : 'https://fansreserve.com') =>
  `${origin}${liveSlotsPath(username)}`;

// First call on a round 5-minute mark, like the database.
export const firstCallAt = (opensAt: Date, gap: number): Date => {
  const t = new Date(opensAt.getTime() + gap * 60_000);
  t.setUTCSeconds(0, 0);
  const extra = (5 - (t.getUTCMinutes() % 5)) % 5;
  return new Date(t.getTime() + extra * 60_000);
};

export const slotStart = (drop: Pick<LiveDrop, 'firstStartAt' | 'minutes'>, n: number): Date =>
  new Date(new Date(drop.firstStartAt).getTime() + n * drop.minutes * 60_000);

// Wall-clock date and "HH:MM" of an instant in a zone.
export const wallClock = (instant: Date, zone: string): { date: string; time: string } => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
};

// "4:05" / "1:02:30" for the countdown.
export const countdown = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

// Hour of an instant for the viewer ("7:35 p. m.").
export const viewerTime = (iso: string, language = 'es') =>
  new Date(iso).toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' });

// Text with {name} placeholders.
export const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (all, k: string) => (k in values ? String(values[k]) : all));
