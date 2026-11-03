// Copy of the public landing page, in one place so marketing text can change
// without touching layout. Brand values come from the central config.
import { BRAND } from '../config/brand';

// The thesis behind the copy: social networks build the audience; Fans Reserve
// monetizes access to, and the relationship with, the part of it that wants more.
export const THESIS =
  'Fans Reserve no busca reemplazar las redes sociales donde los creadores construyen su audiencia. Fans Reserve existe para ayudarles a monetizar acceso, experiencias y relaciones estructuradas con esa audiencia.';

export const HERO = {
  titleLead: 'Tu acceso reservado a',
  titleAccent: 'tu creador de contenido favorito.',
  subtitle: 'Reserva videollamadas 1:1 y eventos con tus creadores favoritos. Suscríbete también a su contenido exclusivo.',
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

// Product examples in the hero; these do not represent bookable creator profiles.
export const HERO_EXPERIENCES = [
  {
    id: 'one-to-one',
    title: 'Platiquemos 1:1',
    description: 'Una conversación sobre lo que te interesa.',
    badge: 'Videollamada 1:1',
    icon: 'fa-video',
    image: '/hero-experiences/one-to-one.webp',
    alt: 'Una persona conversa por videollamada con una creadora desde su laptop.',
    action: 'Explorar Reserve',
    to: '/reserve',
  },
  {
    id: 'group-experience',
    title: 'Aprende y participa',
    description: 'Clases, talleres y eventos con tus creadores.',
    badge: 'Experiencias en grupo',
    icon: 'fa-people-group',
    image: '/hero-experiences/group-experience.webp',
    alt: 'Una creadora enseña a preparar pasta a dos participantes en una clase de cocina.',
    action: 'Ver experiencias',
    to: '/reserve',
  },
  {
    id: 'exclusive-content',
    title: 'Contenido exclusivo',
    description: 'Fotos y videos para su comunidad de suscriptores.',
    badge: 'Suscripción mensual',
    icon: 'fa-star',
    image: '/hero-experiences/exclusive-content.webp',
    alt: 'Una creadora con vestido lavanda y sombrero de playa junto al mar de agua cristalina.',
    action: 'Ver creadores',
    to: '/explore',
  },
  {
    id: 'your-proposal',
    title: 'Tu idea también cuenta',
    description: 'Propón una experiencia, una fecha y un presupuesto.',
    badge: 'A tu medida',
    icon: 'fa-pen-to-square',
    image: '/hero-experiences/your-proposal.webp',
    alt: 'Una persona prepara su idea en una libreta junto a su laptop y un calendario.',
    action: 'Elegir creador',
    to: '/explore',
  },
];

// Fans read an invitation to find creators; creators keep the "bring your
// community" message, which is about them.
export const CATEGORIES = {
  titleLead: 'Encuentra a los creadores que sigues,',
  titleAccent: 'y a los que vas a seguir',
  subtitle: 'Entra a una categoría y conecta con ellos: síguelos, suscríbete o reserva una experiencia.',
  creator: {
    titleLead: 'Cada creador trae a su comunidad,',
    titleAccent: 'sea cual sea su contenido',
    subtitle: 'Entrenamientos, recetas, música, gaming o un poco de todo. Las categorías solo te ayudan a encontrarlos.',
  },
};

export const HOW = {
  titleLead: 'Elige cómo',
  titleAccent: 'conectar',
};

export const LIVE_NOW = {
  title: 'Está pasando ahora',
  subtitle: 'Creators con comunidad propia: suscríbete para sus Lives exclusivos o reserva un evento o una videollamada 1:1.',
  // Only with ENABLE_OPEN_LIVE (src/config/features.ts).
  openLiveSubtitle: 'Lives gratis con su comunidad. Entra, comenta y envía un regalo sin salir de la página.',
};

export const VIP = {
  titleLead: 'Reserva experiencias,',
  titleAccent: 'no personas',
  subtitle:
    'Clases, conversaciones y actividades con tus creadores favoritos. Encuentra una experiencia que vaya contigo.',
  cta: 'Explorar Reserve',
};

export const CREATOR_CTA = {
  title: 'Trae a tu comunidad, sea cual sea tu contenido.',
  subtitle: `Sigue construyendo tu audiencia en TikTok, Instagram o YouTube. En ${BRAND.name} monetizas a la parte de esa audiencia que quiere más acceso a ti: membresías, eventos y videollamadas 1:1 con tus precios.`,
  cta: 'Empezar como creador',
  memberCta: 'Ir a mi panel',
  // Short muted loop of a person creating their account on the phone. Until the
  // real clip is in public/creator-cta/, the photo below is shown instead.
  video: '',
  poster: '/creators/photos/valentina.jpg',
  signupDone: 'Cuenta de creador lista',
  // Example notifications on the panel (illustration only).
  notifications: [
    { title: 'Nueva suscripción', text: 'Lucía se unió a tu comunidad' },
    { title: 'Reserva solicitada', text: 'Asesoría 1:1, sábado 16:00' },
    { title: 'Plaza reservada', text: 'Beauty Q&A del viernes, 15 de 20' },
  ],
};
