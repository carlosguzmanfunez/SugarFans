// Copy of the public landing page, in one place so marketing text can change
// without touching layout. Brand values come from the central config.
import { BRAND } from '../config/brand';

export const HERO = {
  eyebrow: 'Sigue · Suscríbete · Live · Reserve',
  titleLead: 'Tu acceso reservado a quienes',
  titleAccent: 'te inspiran.',
  subtitle:
    'Sigue a tus creators favoritos, accede a contenido exclusivo y reserva experiencias directamente con ellos.',
  primaryCta: 'Crear cuenta gratis',
  secondaryCta: 'Explorar creadores',
  // Signed-in visitors already have an account: offer their next step instead.
  member: {
    fan: { primary: { label: 'Explorar creadores', to: '/explore', icon: 'fa-compass' }, secondary: { label: 'Ver Reserve', to: '/reserve', icon: 'fa-ticket' } },
    creator: { primary: { label: 'Ir a mi panel', to: '/creator/dashboard', icon: 'fa-chart-line' }, secondary: { label: 'Explorar creadores', to: '/explore', icon: 'fa-compass' } },
    admin: { primary: { label: 'Panel de administración', to: '/admin', icon: 'fa-shield-halved' }, secondary: { label: 'Explorar creadores', to: '/explore', icon: 'fa-compass' } },
  },
  socialProof: 'Creadores verificados en música, fitness, arte, gaming y más',
  trust: [
    { icon: 'fa-id-card', label: 'Identidad verificada' },
    { icon: 'fa-lock', label: 'Pagos protegidos' },
    { icon: 'fa-user-shield', label: 'Solo mayores de 18' },
  ],
};

export const FEATURED = {
  eyebrow: 'Creadores',
  title: 'Perfiles que su comunidad sigue de cerca',
  subtitle: 'Membresías mensuales, contenido exclusivo y acceso directo a quienes crean.',
  viewAll: 'Ver todos los creadores',
};

export const CATEGORIES = {
  eyebrow: 'Explora',
  title: 'Encuentra tu comunidad',
  subtitle: 'Desde entrenamientos y recetas hasta estrenos musicales y mentorías.',
};

export const HOW = {
  eyebrow: 'Cómo funciona',
  title: `Cuatro formas de acercarte en ${BRAND.name}`,
  steps: [
    { icon: 'fa-compass', label: 'Discover', title: 'Descubre', text: 'Explora creators por categoría y síguelos gratis.' },
    { icon: 'fa-star', label: 'Subscribe', title: 'Suscríbete', text: 'Contenido exclusivo y los beneficios que cada creator define.' },
    { icon: 'fa-video', label: 'Live', title: 'En vivo', text: 'Sesiones en directo en la sala privada de Fans Reserve.' },
    { icon: 'fa-ticket', label: 'Reserve', title: 'Reserva experiencias', text: 'Clases, sesiones, meet & greets y eventos con fecha, precio y reglas claras.' },
  ],
};

export const VIP = {
  eyebrow: 'Reserve',
  title: 'Reserva experiencias, no personas',
  subtitle:
    'Cada creator define qué ofrece: modalidad, duración, precio, lugar y reglas. Tú eliges, el creator aprueba y la experiencia queda confirmada.',
  cta: 'Explorar Reserve',
  perks: [
    { icon: 'fa-chalkboard-user', title: 'Clases y coaching', text: 'Cocina, fitness, música, arte y más.' },
    { icon: 'fa-video', title: 'Sesiones 1:1 online', text: 'En la sala privada de Fans Reserve.' },
    { icon: 'fa-calendar-check', title: 'Eventos y meet & greets', text: 'En venues, convenciones y lugares públicos.' },
    { icon: 'fa-wand-magic-sparkles', title: 'A medida', text: 'Propón tu experiencia; el creator decide.' },
  ],
  steps: ['Eliges la experiencia', 'El creator la aprueba', 'Pagas y queda confirmada'],
};

export const CREATOR_CTA = {
  eyebrow: 'Para creadores',
  title: '¿Creas contenido o experiencias?',
  subtitle: `Convierte a tu audiencia en una comunidad que te apoya. En ${BRAND.name} tú defines tus precios, tus membresías y tus experiencias.`,
  cta: 'Empezar como creador',
  memberCta: 'Ir a mi panel',
  features: [
    { icon: 'fa-id-badge', label: 'Membresías mensuales' },
    { icon: 'fa-lock', label: 'Contenido exclusivo' },
    { icon: 'fa-gift', label: 'Regalos de tus fans' },
    { icon: 'fa-video', label: 'Sesiones en vivo' },
    { icon: 'fa-ticket', label: 'Reserve: experiencias' },
    { icon: 'fa-comment-dots', label: 'Mensajes directos' },
  ],
};
