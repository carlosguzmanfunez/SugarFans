// Who may enter each kind of live video room. Pure functions with no imports,
// shared by the server (api/live-token.ts decides with them before signing a
// LiveKit token) and the app (which uses them to show the right screen). The
// server is the one that enforces them: hiding a button is never access control.
//
//   open          Public Live, anyone signed in watches.        Disabled by ENABLE_OPEN_LIVE.
//   subscriber    Subscriber Live: group Live included in an active subscription.
//   reserve_event Reserve Event: group experience, one paid seat (booking) per fan.
//   reserve_1to1  Reserve 1:1: private call, only the booking's fan and creator.
//
// Gifts never appear here: no gift grants a seat, a subscription or a call.
// A subscription never grants a Reserve Event or a Reserve 1:1 either.

export type LiveMode = 'open' | 'subscriber' | 'reserve_event' | 'reserve_1to1';

export const LIVE_MODES: Record<LiveMode, { label: string; badge: string; who: string; cta: string }> = {
  open: { label: 'Open Live', badge: 'En vivo', who: 'Cualquier persona con sesión (desactivado)', cta: 'Entrar al Live' },
  subscriber: { label: 'Subscriber Live', badge: 'Exclusivo para suscriptores', who: 'Solo suscriptores con suscripción activa', cta: 'Entrar al Live' },
  reserve_event: { label: 'Reserve Event', badge: 'Reserve Event', who: 'Solo participantes con plaza confirmada', cta: 'Reservar plaza' },
  reserve_1to1: { label: 'Reserve 1:1', badge: 'Sesión privada', who: 'Solo el fan y el creador de la reserva', cta: 'Reservar sesión privada' },
};

// Lives stored in live_broadcasts: rows without a mode (made before modes existed) are open.
export const broadcastModeOf = (mode: string | null | undefined): 'open' | 'subscriber' => (mode === 'subscriber' ? 'subscriber' : 'open');

export const isActiveSubscription = (sub: { cancel_at?: string | null; cancelAt?: string | null } | null | undefined, now = Date.now()) => {
  if (!sub) return false;
  const end = sub.cancel_at ?? sub.cancelAt ?? null;
  return !end || Date.parse(end) > now;
};

export type Decision =
  | { ok: true; mode: LiveMode; room: string; canPublish: boolean; host: boolean }
  | { ok: false; status: number; error: string };

const deny = (status: number, error: string): Decision => ({ ok: false, status, error });

// A creator's Live (open or Subscriber Live), from live_broadcasts.
export const decideBroadcast = (input: {
  live: { id: string; mode?: string | null } | null;
  isOwner: boolean;
  subscription: { cancel_at?: string | null } | null;
  openLiveEnabled: boolean;
  now?: number;
}): Decision => {
  const { live, isOwner } = input;
  if (!live) return deny(404, 'Este creador no está en Live ahora.');
  const mode = broadcastModeOf(live.mode);
  const room = `live-${live.id}`;
  if (mode === 'open') {
    if (!input.openLiveEnabled) return deny(403, 'El Live abierto no está disponible en Fans Reserve.');
    return { ok: true, mode, room, canPublish: isOwner, host: isOwner };
  }
  if (isOwner) return { ok: true, mode, room, canPublish: true, host: true };
  if (!isActiveSubscription(input.subscription, input.now)) return deny(403, 'Este Live es exclusivo para suscriptores. Suscríbete para entrar.');
  return { ok: true, mode, room, canPublish: false, host: false };
};

export interface BookingRow {
  id: string;
  experience_id?: string | null;
  status: string;
  date: string;
  time: string;
  duration_minutes: number | null;
  fan_id: string;
  creator_profile_id: string;
  details: { modality?: string; kind?: string } | null;
}

// Booked times are local to the people in the call; ±14 h covers every time zone.
export const CALL_DAY_SLACK_HOURS = 14 + 4;

export const isEventBooking = (b: Pick<BookingRow, 'details'>) => b.details?.kind === 'event';

// Everyone with a seat in the same Reserve Event (same experience, day and time) meets in one room.
export const eventRoom = (b: Pick<BookingRow, 'experience_id' | 'date' | 'time'>) =>
  `event-${b.experience_id}-${b.date}-${(b.time || '').replace(':', '')}`;

// A Reserve booking: a seat in a Reserve Event or a private Reserve 1:1 call.
// `booking` is what row security shows the user (only bookings they are the fan or
// the creator of), so somebody else's booking arrives here as null.
export const decideBooking = (input: {
  booking: BookingRow | null;
  userId: string;
  myCreatorProfileId: string | null | undefined;
  now?: number;
}): Decision => {
  const b = input.booking;
  const isFan = !!b && b.fan_id === input.userId;
  const isCreator = !!b && !!input.myCreatorProfileId && b.creator_profile_id === input.myCreatorProfileId;
  if (!b || (!isFan && !isCreator)) return deny(404, 'No encontramos esta reserva en tu cuenta.');
  if (b.status !== 'confirmed') return deny(403, 'La sala se abre cuando la reserva está aceptada y pagada.');
  if (!b.duration_minutes || (b.details?.modality ?? 'virtual') !== 'virtual') return deny(403, 'Esta experiencia no es una sesión en vivo.');
  // The app opens the room at the exact local time; the server, which doesn't know the
  // time zone, only refuses calls far from the booked day.
  const day = Date.parse(`${b.date}T${b.time || '00:00'}:00Z`);
  if (Number.isNaN(day) || Math.abs((input.now ?? Date.now()) - day) > CALL_DAY_SLACK_HOURS * 3600_000) {
    return deny(403, 'La sala solo abre el día de la reserva.');
  }
  if (isEventBooking(b)) {
    // Group room: the creator presents, participants watch and use the chat.
    return { ok: true, mode: 'reserve_event', room: eventRoom(b), canPublish: isCreator, host: isCreator };
  }
  // Private room: nobody but this booking's fan and creator gets a token.
  return { ok: true, mode: 'reserve_1to1', room: `booking-${b.id}`, canPublish: true, host: isCreator };
};
