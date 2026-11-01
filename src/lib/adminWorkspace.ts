export const adminAreas = [
  { id: 'home', label: 'Inicio', tabs: ['overview'] },
  { id: 'people', label: 'Personas', tabs: ['users', 'verifications', 'managed', 'special'] },
  { id: 'content', label: 'Contenido', tabs: ['reports', 'moderation'] },
  { id: 'money', label: 'Dinero', tabs: ['finance', 'payouts', 'ledger'] },
  { id: 'growth', label: 'Crecimiento', tabs: ['prospects'] },
  { id: 'service', label: 'Estado del servicio', tabs: ['errors', 'infra'] },
] as const;

export const adminSections = {
  overview: 'Inicio', users: 'Buscar personas', verifications: 'Verificar identidades',
  managed: 'Perfiles de la plataforma', special: 'Cuentas especiales',
  reports: 'Denuncias y solicitudes', moderation: 'Revisar fotos y videos',
  finance: 'Pagos a creadores', payouts: 'Retiros y devoluciones', ledger: 'Todos los movimientos',
  prospects: 'Captar creadores',
  errors: 'Problemas de la página', infra: 'Costos y límites de servicios',
} as const;
export type AdminSection = keyof typeof adminSections;
export function adminSection(value: string | null): AdminSection {
  return value && Object.prototype.hasOwnProperty.call(adminSections, value) ? value as AdminSection : 'overview';
}
export const adminArea = (section: AdminSection) => adminAreas.find(area => (area.tabs as readonly string[]).includes(section))!;
export const adminDate = (iso: string) => new Intl.DateTimeFormat('es-HN', {
  timeZone: 'America/Tegucigalpa', dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(iso));
