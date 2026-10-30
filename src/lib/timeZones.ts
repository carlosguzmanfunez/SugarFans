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

const isZone = (zone?: string | null): zone is string => {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

// The instant of a wall-clock date ("2026-11-02") and time ("18:00") in a zone.
export const zonedDate = (date: string, time: string, zone?: string | null): Date => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mm] = (time || '00:00').split(':').map(Number);
  if (!isZone(zone)) return new Date(y, m - 1, d, h || 0, mm || 0, 0, 0);
  const guess = Date.UTC(y, m - 1, d, h || 0, mm || 0);
  const first = guess - offsetMinutes(new Date(guess), zone) * 60_000;
  // Around a daylight-saving change the offset at the result can differ.
  return new Date(guess - offsetMinutes(new Date(first), zone) * 60_000);
};

// Whether the viewer's clock reads differently from the zone at that instant.
export const differsFromViewer = (instant: Date, zone?: string | null): boolean => {
  const mine = viewerTimeZone();
  return isZone(zone) && !!mine && offsetMinutes(instant, zone) !== offsetMinutes(instant, mine);
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
  return localDay === date ? hourOf(at) : `${hourOf(at)} · ${at.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/[.,]/g, '')}`;
};
