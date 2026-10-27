// Runtime-independent rules: Vercel loads this module as native Node ESM.
// Keep frontend/configuration imports out of this leaf module.
import type { ReportInput } from './backend/platformTypes';

type Check = { ok: true } | { ok: false; error: string };
const bad = (error: string): Check => ({ ok: false, error });

export const validateReport = (input: ReportInput, signedIn: boolean): Check => {
  if (!input.reason?.trim() || input.reason.trim().length > 200) return bad('Elige un motivo válido (máximo 200 caracteres)');
  const descriptionLength = input.description.trim().length;
  if (descriptionLength < 10 || descriptionLength > 4000) return bad('Describe el problema entre 10 y 4000 caracteres');
  if (input.targetLabel?.trim().length > 200 || (input.targetId?.length ?? 0) > 180) {
    return bad('La referencia del reporte es demasiado larga');
  }
  const email = input.contactEmail?.trim();
  if (!signedIn && !(email && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return bad('Deja un email de contacto válido');
  }
  return { ok: true };
};
