// Time zones for Reserve. A creator offers "18:00" in their own clock (an IANA zone
// such as America/Tegucigalpa, saved with their schedule and each booking); a fan in
// another country sees that hour converted to theirs. Without a zone (rows saved
// before zones existed) an hour is read in the viewer's clock, as it always was.

export const viewerTimeZone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

// Minutes the zone is ahead of UTC at that instant.
const offsetMinutes = (instant: Date, zone: string): number => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(instant).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - instant.getTime()) / 60_000);
};

export const isTimeZone = (zone?: string | null): zone is string => {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

// Keep every supported region available: a country can have several clocks.
export const timeZoneOptions = (): string[] => {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  const zones = intl.supportedValuesOf?.('timeZone') ?? [
    'America/Tegucigalpa', 'America/Mexico_City', 'America/Bogota', 'America/Lima',
    'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/Sao_Paulo',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Europe/Madrid', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland',
  ];
  return [...new Set([...zones, viewerTimeZone(), 'UTC'].filter(isTimeZone))]
    .sort((a, b) => zoneCity(a).localeCompare(zoneCity(b), 'es'));
};

export const dateInZone = (instant: Date, zone?: string | null): string => {
  if (!isTimeZone(zone)) return `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')}`;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const instants = new Map<string, number>();
// The instant of a wall-clock date ("2026-11-02") and time ("18:00") in a zone.
export const zonedDate = (date: string, time: string, zone?: string | null): Date => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mm] = (time || '00:00').split(':').map(Number);
  if (!isTimeZone(zone)) return new Date(y, m - 1, d, h || 0, mm || 0, 0, 0);
  const key = `${date}|${time}|${zone}`;
  if (instants.has(key)) return new Date(instants.get(key)!);
  const guess = Date.UTC(y, m - 1, d, h || 0, mm || 0);
  // Compare both sides of a clock change. Nonexistent wall times cannot be
  // booked. For repeated hours choose the later occurrence, as PostgreSQL does.
  const offsets = new Set([-36, 0, 36].map(hours => offsetMinutes(new Date(guess + hours * 3_600_000), zone)));
  const matches = [...offsets].map(offset => guess - offset * 60_000).filter(at => at + offsetMinutes(new Date(at), zone) * 60_000 === guess);
  const at = matches.length ? Math.max(...matches) : NaN;
  if (instants.size >= 10000) instants.clear();
  instants.set(key, at);
  return new Date(at);
};

// Whether the viewer's clock reads differently from the zone at that instant.
export const differsFromViewer = (instant: Date, zone?: string | null): boolean => {
  const mine = viewerTimeZone();
  return Number.isFinite(instant.getTime()) && isTimeZone(zone) && !!mine && offsetMinutes(instant, zone) !== offsetMinutes(instant, mine);
};

// "Tegucigalpa" for America/Tegucigalpa, "Ciudad de México" for America/Mexico_City.
const CITY_NAMES: Record<string, string> = {
  Mexico_City: 'Ciudad de México', New_York: 'Nueva York', Los_Angeles: 'Los Ángeles', Sao_Paulo: 'São Paulo',
  Bogota: 'Bogotá', Panama: 'Panamá', Asuncion: 'Asunción', Havana: 'La Habana', London: 'Londres', Paris: 'París',
  Rome: 'Roma', Lisbon: 'Lisboa', Costa_Rica: 'Costa Rica', El_Salvador: 'El Salvador', Santo_Domingo: 'Santo Domingo',
};
export const zoneCity = (zone?: string | null): string => {
  if (!zone) return '';
  const city = zone.split('/').pop() ?? zone;
  return CITY_NAMES[city] ?? city.replace(/_/g, ' ');
};

const hourOf = (instant: Date) => instant.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false });

// The viewer's reading of a slot offered in another zone: "19:00" or, when the
// day changes, "19:00 · mar 3 nov". Null when both clocks read the same.
export const viewerSlotLabel = (date: string, time: string, zone?: string | null): string | null => {
  const at = zonedDate(date, time, zone);
  if (!differsFromViewer(at, zone)) return null;
  const localDay = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  return localDay === date ? hourOf(at) : `${hourOf(at)} · ${at.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short', ...(at.getFullYear() !== Number(date.slice(0, 4)) ? { year: 'numeric' } : {}) }).replace(/[.,]/g, '')}`;
};
