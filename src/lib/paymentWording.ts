import { BRAND } from '../config/brand';

// Older payment functions can still return this time label. Change its display,
// preserving the stored message, account country and operational time zone.
export const paymentWording = (text: string) => text.replace(
  /hora de Honduras(?: \(UTC[−-]6\))?/gi,
  match => `${match.startsWith('H') ? 'Hora' : 'hora'} de ${BRAND.name} (UTC−6)`,
);
