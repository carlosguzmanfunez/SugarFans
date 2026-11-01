import { COUNTRIES, countryName } from '../config/countries';
import type { BookingDetails, User, VipExperience } from './backend/types';

// Attendance is a declared destination, never GPS or the ID document's country.
export interface ReserveLocation { country: string; region: string; city: string }
export interface AttendanceLocation extends ReserveLocation { confirmedAt: string }
export const locationText = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
export const validReserveLocation = (d: Partial<ReserveLocation> | null | undefined): d is ReserveLocation =>
  !!d && COUNTRIES.some((c) => c.code === d.country) && [d.region, d.city].every((s) => typeof s === 'string' && s.trim().length >= 2 && s.length <= 60);
export const sameReserveLocation = (a: Partial<ReserveLocation> | null | undefined, b: Partial<ReserveLocation> | null | undefined) =>
  validReserveLocation(a) && validReserveLocation(b) && a.country === b.country && locationText(a.region) === locationText(b.region) && locationText(a.city) === locationText(b.city);
export const attendanceLocation = (user: User | null) => {
  const d = user?.settings.reserveAttendance;
  return validReserveLocation(d) && !!d.confirmedAt ? d : null;
};
export const inPerson = (d?: { modality?: string } | null) => !!d?.modality && d.modality !== 'virtual';
export const visibleAtLocation = (exp: Pick<VipExperience, 'details'>, where: Partial<ReserveLocation> | null) =>
  !inPerson(exp.details) || sameReserveLocation(exp.details, where);
export const locationLabel = (d: Partial<ReserveLocation>) =>
  [d.city, d.region, d.country ? countryName(d.country, 'es', '') : ''].filter(Boolean).join(', ');
export const attendanceError = 'Selecciona y confirma la ciudad donde asistirás. Debe coincidir con la de la experiencia.';
export const bookingHasAttendance = (d?: BookingDetails) => !inPerson(d) ||
  (!!d?.attendance?.confirmedAt && sameReserveLocation(d, d.attendance));
