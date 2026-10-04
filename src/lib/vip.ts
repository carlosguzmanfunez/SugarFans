// VIP experience scheduling helpers: booking window, availability math and labels.
// Data access lives in the backend (src/lib/backend).
import type {
  Availability,
  BookingStatus,
  CustomRequestInput,
  CounterInput,
  ExperienceType,
  ReserveDetails,
  TakenSlot,
  VipBooking,
  VipExperience,
  VipExperienceInput,
} from './backend/types';
import { vipExperiences } from '../data/mockData';
import { CALL_MINUTES } from './giftRules';
import {
  CANCELLATION_POLICIES,
  LOCATION_TYPES,
  MAX_LIST_ITEMS,
  MAX_PARTICIPANTS,
  MIN_EVENT_SEATS,
  EVENT_TYPES,
  MIN_NOTICE_OPTIONS,
  PURPOSES,
  RESERVE_EXPERIENCE_TYPES,
  RESERVE_MODALITIES,
  RESERVE_STATUSES,
  SUBSCRIBER_DISCOUNTS,
  categoryFor,
  experienceTypeById,
  isHomeService,
  offersHomeServices,
  locationsFor,
  modalitiesFor,
  purposesFor,
  type ReserveStatus,
} from '../config/reserve';
import { moderate } from './moderation';

export type {
  Availability,
  BookingStatus,
  VipBooking,
  TakenSlot,
  VipExperience,
  VipExperienceInput,
  ExperienceType,
  ReserveDetails,
  BookingDetails,
  CustomRequestInput,
  CounterInput,
} from './backend/types';

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

export const freeHoursOn = (availability: Availability, taken: TakenSlot[], date: string, minNoticeHours = 0): string[] => {
  const { min, max } = bookingWindow();
  if (date < min || date > max || !availability.days.includes(fromISODate(date).getDay())) return [];
  const busy = takenHoursOn(taken, date);
  return availability.hours.filter((h) => !busy.includes(h) && (!minNoticeHours || meetsNotice(date, h, minNoticeHours)));
};

export const normalizeAvailability = (a: Availability): Availability => ({
  days: [...new Set(a.days)].sort((x, y) => x - y),
  hours: [...new Set(a.hours)].sort(),
});

// Status as Reserve names it: a confirmed experience whose time has passed reads "Realizada".
export const reserveStatusOf = (b: Pick<VipBooking, 'status' | 'date' | 'time' | 'durationMinutes'>, now = new Date()): ReserveStatus => {
  if (b.status === 'confirmed') {
    const end = liveWindow(b.date, b.time, b.durationMinutes ?? 60).closes;
    if (now > end) return 'completed';
  }
  return b.status;
};

export const statusLabel: Record<BookingStatus, { text: string; className: string; icon: string }> = Object.fromEntries(
  (Object.keys(RESERVE_STATUSES) as BookingStatus[]).map((k) => [k, { text: RESERVE_STATUSES[k].label, className: RESERVE_STATUSES[k].className, icon: RESERVE_STATUSES[k].icon }])
) as Record<BookingStatus, { text: string; className: string; icon: string }>;

// Live video sessions: experiences with a duration happen live in the app's
// room (/live/:bookingId). It opens 15 minutes before the booked time and
// closes 30 minutes after the booked duration.
export const LIVE_EARLY_MIN = 15;
export const LIVE_GRACE_MIN = 30;

export const durationMinutes = (duration?: string): number | null => {
  const m = duration?.match(/(\d+)\s*min/);
  return m ? Number(m[1]) : null;
};

// Minutes of a booking's live session: the experience's duration, or the
// private video call a $1,000 gift includes (booked as experience "gift-call").
export const GIFT_CALL_EXPERIENCE = 'gift-call';
export const sessionMinutes = (booking?: Pick<VipBooking, 'experienceId' | 'durationMinutes'> | null): number | null => {
  if (!booking) return null;
  if (booking.durationMinutes) return booking.durationMinutes;
  if (booking.experienceId === GIFT_CALL_EXPERIENCE) return CALL_MINUTES;
  // Bookings made before the duration was stored with them.
  return durationMinutes(vipExperiences.find((e) => e.id === booking.experienceId)?.duration);
};

// --- Experiences ------------------------------------------------------------
// The Reserve catalogue (src/config/reserve.ts); the five original ids stay valid.
export const EXPERIENCE_TYPES: { id: ExperienceType; name: string; icon: string }[] = RESERVE_EXPERIENCE_TYPES.map(({ id, name, icon }) => ({ id, name, icon }));
export const MIN_EXPERIENCE_PRICE = 5;
export const MAX_EXPERIENCE_PRICE = 5000;
export const MIN_SESSION_MINUTES = 10;
export const MAX_SESSION_MINUTES = 180;
// No image: the experience shows generated art (components/CoverArt).
export const DEFAULT_EXPERIENCE_IMAGE = '';
// Pseudo experience of a custom request (vip_bookings.experience_id).
export const CUSTOM_EXPERIENCE = 'custom';

export const typeOf = (id: string) => {
  const x = experienceTypeById(id);
  return x ?? { id, name: 'Experiencia', icon: 'fa-star', description: '', modalities: ['virtual'] as const, locations: [], minutes: null, maxParticipants: 1 };
};

// What an experience made before Reserve means: virtual, online, one person, manual approval.
export const defaultDetails = (): ReserveDetails => {
  return {
    modality: 'virtual',
    locationTypes: ['online'],
    includes: [],
    excludes: [],
    requirements: { verifiedFans: false, subscribersOnly: false },
    minNoticeHours: 24,
    maxParticipants: 1,
    approval: 'manual',
    cancellationPolicy: 'moderate',
  };
};
export const detailsOf = (exp: Pick<VipExperience, 'type' | 'details'>): ReserveDetails => ({ ...defaultDetails(), ...(exp.details ?? {}) });

// Manual approval = "Solicitar"; automatic = "Reservar" (some types are always reviewed).
export const needsApproval = (exp: Pick<VipExperience, 'type' | 'details'>) =>
  detailsOf(exp).approval !== 'automatic' || !!experienceTypeById(exp.type)?.alwaysManual;

// --- Reserve Event / Reserve 1:1 ---------------------------------------------------
export const isEventExperience = (exp: Pick<VipExperience, 'details'>) => exp.details?.format === 'event';
export const isEventBooking = (b: Pick<VipBooking, 'details'>) => b.details?.kind === 'event';
export const canBeEvent = (typeId: string) => EVENT_TYPES.includes(typeId);

// Where an experience sits in Reserve: a group event, a private live session (1:1), or another experience.
export type ReserveProduct = 'event' | 'one-to-one' | 'other';
export const reserveProductOf = (exp: Pick<VipExperience, 'details' | 'durationMinutes'>): ReserveProduct =>
  isEventExperience(exp) ? 'event' : isLiveExperience(exp) ? 'one-to-one' : 'other';

// The event's start in the viewer's clock (the creator sets it in local time).
export const eventStart = (exp: Pick<VipExperience, 'details'>) => {
  const d = exp.details;
  if (!d?.eventDate || !d.eventTime) return null;
  const start = fromISODate(d.eventDate);
  const [h, m] = d.eventTime.split(':').map(Number);
  start.setHours(h, m || 0, 0, 0);
  return start;
};
export const isUpcomingEvent = (exp: Pick<VipExperience, 'details'>, now = new Date()) => {
  const start = eventStart(exp);
  return !!start && start.getTime() > now.getTime();
};
export const seatsLeft = (exp: Pick<VipExperience, 'details'>, taken: number) => Math.max(0, (exp.details?.maxParticipants ?? 0) - taken);

// Virtual experiences with a session happen in the app's private room.
export const isLiveExperience = (exp: Pick<VipExperience, 'durationMinutes' | 'details'>) =>
  !!exp.durationMinutes && (exp.details?.modality ?? 'virtual') === 'virtual';
export const isLiveBooking = (b: Pick<VipBooking, 'details' | 'experienceId' | 'durationMinutes'>) =>
  (b.details?.modality ?? 'virtual') === 'virtual';

// Price a fan pays: the experience's, minus the explicit subscriber discount.
export const priceFor = (exp: Pick<VipExperience, 'price' | 'details'>, isSubscriber: boolean) => {
  const pct = isSubscriber ? exp.details?.subscriberDiscount ?? 0 : 0;
  return Math.round(exp.price * (100 - pct)) / 100;
};

export const locationSummary = (d: Pick<ReserveDetails, 'modality' | 'locationTypes' | 'city' | 'venue'>) => {
  if (d.modality === 'virtual') return 'Online · sala privada de Fans Reserve';
  const kinds = d.locationTypes.map((l) => LOCATION_TYPES[l]?.label).filter(Boolean).join(' o ');
  return [d.venue, kinds, d.city].filter(Boolean).join(' · ');
};

const cleanList = (items: string[] | undefined) => (items ?? []).map((x) => x.trim()).filter(Boolean).slice(0, MAX_LIST_ITEMS);

// Validates an experience against the creator's category and the Reserve rules.
export const validateExperience = (input: VipExperienceInput, categoryName?: string): { ok: boolean; error?: string } => {
  const title = input.title.trim();
  if (title.length < 3 || title.length > 80) return { ok: false, error: 'El título debe tener entre 3 y 80 caracteres' };
  if (input.description.trim().length > 600) return { ok: false, error: 'La descripción admite hasta 600 caracteres' };
  const type = experienceTypeById(input.type);
  if (!type) return { ok: false, error: 'Elige el tipo de experiencia' };
  if (!Number.isFinite(input.price) || input.price < MIN_EXPERIENCE_PRICE || input.price > MAX_EXPERIENCE_PRICE)
    return { ok: false, error: `El precio debe estar entre $${MIN_EXPERIENCE_PRICE} y $${MAX_EXPERIENCE_PRICE}` };
  if (input.durationMinutes !== undefined && (!Number.isInteger(input.durationMinutes) || input.durationMinutes < MIN_SESSION_MINUTES || input.durationMinutes > MAX_SESSION_MINUTES))
    return { ok: false, error: `La duración debe estar entre ${MIN_SESSION_MINUTES} y ${MAX_SESSION_MINUTES} minutos` };
  const d = input.details;
  if (d) {
    // New Reserve experiences: the category decides what can be offered.
    if (categoryName !== undefined) {
      const category = categoryFor(categoryName);
      if (!category.experiences.includes(type.id)) return { ok: false, error: `${category.name} no ofrece "${type.name}"` };
      if (!modalitiesFor(category, type).includes(d.modality)) return { ok: false, error: 'Esa modalidad no está disponible para esta experiencia' };
      const allowed = locationsFor(category, type, d.modality);
      if (!d.locationTypes.length || d.locationTypes.some((l) => !allowed.includes(l))) return { ok: false, error: 'Elige una ubicación permitida para esta experiencia' };
    }
    if (!RESERVE_MODALITIES[d.modality]) return { ok: false, error: 'Elige la modalidad' };
    if (d.modality === 'virtual' ? d.locationTypes.some((l) => l !== 'online') : !d.locationTypes.length || d.locationTypes.includes('online'))
      return { ok: false, error: 'Elige una ubicación permitida para esta experiencia' };
    if (d.locationTypes.some((l) => !LOCATION_TYPES[l])) return { ok: false, error: 'Ubicación no permitida' };
    if (isHomeService(d.locationTypes)) {
      if (categoryName !== undefined && !offersHomeServices(categoryFor(categoryName))) return { ok: false, error: 'Esta experiencia no se puede ofrecer a domicilio' };
      if (d.approval !== 'manual') return { ok: false, error: 'Las experiencias a domicilio requieren tu aprobación manual' };
    }
    if (d.format === 'event') {
      // Reserve Event: fixed day and time, a duration and seats for a group.
      if (!canBeEvent(type.id)) return { ok: false, error: `${type.name} no se ofrece como Reserve Event` };
      if (!type.minutes || input.durationMinutes === undefined) return { ok: false, error: 'Indica la duración del evento' };
      if (!d.eventDate || !d.eventTime || !/^\d{4}-\d{2}-\d{2}$/.test(d.eventDate) || !/^\d{2}:\d{2}$/.test(d.eventTime))
        return { ok: false, error: 'Indica la fecha y la hora del evento' };
      const { max } = bookingWindow();
      if (!isUpcomingEvent({ details: d }) || d.eventDate > max) return { ok: false, error: 'La fecha del evento debe estar dentro de los próximos 3 meses' };
      if (!Number.isInteger(d.maxParticipants) || d.maxParticipants < MIN_EVENT_SEATS || d.maxParticipants > MAX_PARTICIPANTS)
        return { ok: false, error: `Un Reserve Event tiene entre ${MIN_EVENT_SEATS} y ${MAX_PARTICIPANTS} plazas` };
    } else if (!Number.isInteger(d.maxParticipants) || d.maxParticipants < 1 || d.maxParticipants > Math.min(MAX_PARTICIPANTS, type.maxParticipants))
      return { ok: false, error: `Máximo ${Math.min(MAX_PARTICIPANTS, type.maxParticipants)} participantes para esta experiencia` };
    if (!MIN_NOTICE_OPTIONS.includes(d.minNoticeHours)) return { ok: false, error: 'Elige la anticipación mínima' };
    if (!CANCELLATION_POLICIES[d.cancellationPolicy]) return { ok: false, error: 'Elige la política de cancelación' };
    if (d.approval !== 'manual' && d.approval !== 'automatic') return { ok: false, error: 'Elige cómo apruebas las reservas' };
    if (d.subscriberDiscount !== undefined && !SUBSCRIBER_DISCOUNTS.includes(d.subscriberDiscount)) return { ok: false, error: 'Descuento no válido' };
    if (type.minutes && input.durationMinutes === undefined) return { ok: false, error: 'Indica la duración' };
    if (d.days && d.days.some((x) => x < 0 || x > 6)) return { ok: false, error: 'Días no válidos' };
    if ((d.city ?? '').length > 60 || (d.venue ?? '').length > 80) return { ok: false, error: 'La ciudad o el venue son demasiado largos' };
    if ((d.conditions ?? '').length > 400 || (d.requirements.notes ?? '').length > 300) return { ok: false, error: 'Las condiciones son demasiado largas' };
    if ([...d.includes, ...d.excludes].some((x) => x.length > 80)) return { ok: false, error: 'Cada punto de "incluye" admite hasta 80 caracteres' };
    // What is offered (excludes and conditions state what is NOT offered; they are shown as such).
    const check = moderate([title, input.description, d.venue, d.city, d.requirements.notes, ...d.includes], 'experience');
    if (!check.ok) return { ok: false, error: check.error };
  } else {
    const check = moderate([title, input.description], 'experience');
    if (!check.ok) return { ok: false, error: check.error };
  }
  return { ok: true };
};

// Trims an experience's details before saving.
export const cleanDetails = (d: ReserveDetails): ReserveDetails => ({
  modality: d.modality,
  locationTypes: [...new Set(d.locationTypes)],
  ...(d.city?.trim() ? { city: d.city.trim() } : {}),
  ...(d.venue?.trim() ? { venue: d.venue.trim() } : {}),
  includes: cleanList(d.includes),
  excludes: cleanList(d.excludes),
  requirements: {
    verifiedFans: !!d.requirements.verifiedFans,
    subscribersOnly: !!d.requirements.subscribersOnly,
    ...(d.requirements.notes?.trim() ? { notes: d.requirements.notes.trim() } : {}),
  },
  minNoticeHours: d.minNoticeHours,
  maxParticipants: d.maxParticipants,
  approval: d.approval,
  cancellationPolicy: d.cancellationPolicy,
  ...(d.conditions?.trim() ? { conditions: d.conditions.trim() } : {}),
  ...(d.subscriberDiscount ? { subscriberDiscount: d.subscriberDiscount } : {}),
  ...(d.format === 'event'
    ? { format: 'event' as const, eventDate: d.eventDate, eventTime: d.eventTime }
    : {
        ...(d.days?.length ? { days: [...new Set(d.days)].sort() } : {}),
        ...(d.hours?.length ? { hours: [...new Set(d.hours)].sort() } : {}),
      }),
});

// The experience's own days/hours narrow the creator's availability.
export const experienceAvailability = (availability: Availability, exp?: Pick<VipExperience, 'details'> | null): Availability => {
  const d = exp?.details;
  return {
    days: d?.days?.length ? availability.days.filter((x) => d.days!.includes(x)) : availability.days,
    hours: d?.hours?.length ? availability.hours.filter((x) => d.hours!.includes(x)) : availability.hours,
  };
};

// Earliest start allowed by the minimum notice.
export const meetsNotice = (date: string, time: string, hours: number, now = new Date()) => {
  const start = fromISODate(date);
  const [h, m] = time.split(':').map(Number);
  start.setHours(h, m || 0, 0, 0);
  return start.getTime() - now.getTime() >= hours * 3_600_000;
};

// Checks a custom request before it is sent (the server repeats the essentials).
export const validateCustomRequest = (input: CustomRequestInput, categoryName?: string): { ok: boolean; error?: string; flags?: string[] } => {
  const category = categoryFor(categoryName);
  if (!RESERVE_MODALITIES[input.modality] || !category.modalities.includes(input.modality)) return { ok: false, error: 'Elige una modalidad disponible' };
  if (!PURPOSES[input.purpose] || !purposesFor(category, input.modality).includes(input.purpose)) return { ok: false, error: 'Elige el propósito de la experiencia' };
  if (input.purpose === 'other' && input.purposeNote.trim().length < 5) return { ok: false, error: 'Describe brevemente el propósito' };
  if (!input.date) return { ok: false, error: 'Elige un día en el calendario' };
  if (!input.time) return { ok: false, error: 'Elige una hora disponible' };
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < MIN_SESSION_MINUTES || input.durationMinutes > MAX_SESSION_MINUTES)
    return { ok: false, error: `La duración debe estar entre ${MIN_SESSION_MINUTES} y ${MAX_SESSION_MINUTES} minutos` };
  if (!Number.isInteger(input.participants) || input.participants < 1 || input.participants > MAX_PARTICIPANTS)
    return { ok: false, error: `Entre 1 y ${MAX_PARTICIPANTS} participantes` };
  const allowed = locationsFor(category, null, input.modality);
  if (!allowed.includes(input.locationType)) return { ok: false, error: 'Elige un tipo de lugar permitido' };
  if (input.modality !== 'virtual' && input.city.trim().length < 2) return { ok: false, error: 'Indica la ciudad' };
  if (!Number.isFinite(input.budget) || input.budget < MIN_EXPERIENCE_PRICE || input.budget > MAX_EXPERIENCE_PRICE)
    return { ok: false, error: `El presupuesto debe estar entre $${MIN_EXPERIENCE_PRICE} y $${MAX_EXPERIENCE_PRICE}` };
  if (input.message.trim().length < 10) return { ok: false, error: 'Cuéntale al creator los detalles (mínimo 10 caracteres)' };
  if (input.message.length > 500 || input.purposeNote.length > 80 || input.venue.length > 80 || input.city.length > 60)
    return { ok: false, error: 'El texto es demasiado largo' };
  const check = moderate([input.purposeNote, input.city, input.venue, input.message], 'request', { homeAllowed: allowed.some((l) => isHomeService([l])) });
  if (!check.ok) return { ok: false, error: check.error };
  return { ok: true, flags: check.flags.filter((f) => f.severity === 'review').map((f) => f.rule) };
};

export const customTitle = (purpose: CustomRequestInput['purpose'], note: string) =>
  `Experiencia personalizada · ${purpose === 'other' ? note.trim().slice(0, 40) : PURPOSES[purpose].label}`;

export const validateCounter = (input: CounterInput): { ok: boolean; error?: string } => {
  if (!Number.isFinite(input.price) || input.price < MIN_EXPERIENCE_PRICE || input.price > MAX_EXPERIENCE_PRICE)
    return { ok: false, error: `El precio debe estar entre $${MIN_EXPERIENCE_PRICE} y $${MAX_EXPERIENCE_PRICE}` };
  if (!input.date || !input.time) return { ok: false, error: 'Elige la fecha y la hora' };
  const { min, max } = bookingWindow();
  if (input.date < min || input.date > max) return { ok: false, error: 'La fecha debe estar dentro de los próximos 3 meses' };
  if (input.durationMinutes !== undefined && (input.durationMinutes < MIN_SESSION_MINUTES || input.durationMinutes > MAX_SESSION_MINUTES))
    return { ok: false, error: `La duración debe estar entre ${MIN_SESSION_MINUTES} y ${MAX_SESSION_MINUTES} minutos` };
  if (input.note.length > 300) return { ok: false, error: 'El mensaje admite hasta 300 caracteres' };
  const check = moderate(input.note, 'request');
  if (!check.ok) return { ok: false, error: check.error };
  return { ok: true };
};

// The demo catalogue as stored experiences (same ids as the Supabase seed).
export const demoExperiences = (): VipExperience[] =>
  vipExperiences.map((e) => ({
    id: e.id,
    creatorProfileId: e.creatorId,
    creatorName: e.creatorName,
    title: e.title,
    description: e.description,
    type: e.type as ExperienceType,
    price: e.price,
    durationMinutes: durationMinutes(e.duration) ?? undefined,
    image: e.image,
    active: true,
    ...(e.details ? { details: e.details } : {}),
    createdAt: '2024-01-01T00:00:00.000Z',
  }));

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
