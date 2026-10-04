// Copy of the public landing page, in one place so marketing text can change
// without touching layout. Brand values come from the central config.
import { BRAND } from '../config/brand';

// The thesis behind the copy: social networks build the audience; Fans Reserve
// monetizes access to, and the relationship with, the part of it that wants more.
export const THESIS =
  'Fans Reserve no busca reemplazar las redes sociales donde los creators construyen su audiencia. Fans Reserve existe para ayudarles a monetizar acceso, experiencias y relaciones estructuradas con esa audiencia.';

export const HERO = {
  subtitle: 'Suscríbete a tus creators y reserva eventos y sesiones privadas con fecha, precio y reglas claras.',
  primaryCta: 'Crear cuenta gratis',
  secondaryCta: 'Explorar Reserve',
  secondaryTo: '/reserve',
  // Only with ENABLE_OPEN_LIVE (src/config/features.ts).
  openLiveCta: 'Ver quién está en Live',
  // Signed-in visitors already have an account: offer their next step instead.
  member: {
    fan: { primary: { label: 'Explorar creadores', to: '/explore', icon: 'fa-compass' }, secondary: { label: 'Ver Reserve', to: '/reserve', icon: 'fa-ticket' } },
    creator: { primary: { label: 'Ir a mi panel', to: '/creator/dashboard', icon: 'fa-chart-line' }, secondary: { label: 'Explorar creadores', to: '/explore', icon: 'fa-compass' } },
    admin: { primary: { label: 'Panel de administración', to: '/admin', icon: 'fa-shield-halved' }, secondary: { label: 'Explorar creadores', to: '/explore', icon: 'fa-compass' } },
  },
};

export const CATEGORIES = {
  titleLead: 'Encuentra tu comunidad de',
  titleAccent: 'influencers y creadores',
  subtitle: 'Desde entrenamientos y recetas hasta estrenos musicales y mentorías.',
};

export const HOW = {
  eyebrow: 'Cómo funciona',
  titleLead: 'Cuatro formas de acercarte,',
  titleAccent: 'de gratis a muy personal',
  subtitle: 'Abre cada una y pruébala aquí mismo.',
};

export const LIVE_NOW = {
  title: 'Está pasando ahora',
  subtitle: 'Creators con comunidad propia: suscríbete para sus Lives exclusivos o reserva un evento o una sesión privada.',
  // Only with ENABLE_OPEN_LIVE (src/config/features.ts).
  openLiveSubtitle: 'Lives gratis con su comunidad. Entra, comenta y envía un regalo sin salir de la página.',
};

export const VIP = {
  eyebrow: 'Reserve',
  titleLead: 'Reserva experiencias,',
  titleAccent: 'no personas',
  subtitle:
    'Cada creator define qué ofrece: modalidad, duración, precio, lugar y reglas. Tú eliges, el creator aprueba y la experiencia queda confirmada.',
  cta: 'Explorar Reserve',
  perks: [
    { title: 'Reserve Events', text: 'Q&A, masterclass, workshops y gaming en grupo, con plazas.' },
    { title: 'Reserve 1:1', text: 'Sesión privada solo con el creator, en la sala de Fans Reserve.' },
    { title: 'Clases y coaching', text: 'Cocina, fitness, música, arte y más.' },
    { title: 'A medida', text: 'Propón tu experiencia; el creator decide.' },
  ],
  steps: ['Eliges la experiencia', 'El creator la aprueba', 'Pagas y queda confirmada'],
};

export const CREATOR_CTA = {
  title: '¿Creas contenido o experiencias?',
  subtitle: `Sigue construyendo tu audiencia en TikTok, Instagram o YouTube. En ${BRAND.name} monetizas a la parte de esa audiencia que quiere más acceso a ti: membresías, eventos y sesiones privadas con tus precios.`,
  cta: 'Empezar como creador',
  memberCta: 'Ir a mi panel',
  // Example notifications on the panel (illustration only).
  notifications: [
    { title: 'Nueva suscripción', text: 'Lucía se unió a tu comunidad' },
    { title: 'Reserva solicitada', text: 'Asesoría 1:1, sábado 16:00' },
    { title: 'Plaza reservada', text: 'Beauty Q&A del viernes, 15 de 20' },
  ],
};
