// Copy of the public landing page, in one place so marketing text can change
// without touching layout. Brand values come from the central config.
import { BRAND } from '../config/brand';

export const HERO = {
  eyebrow: 'Membresías · Lives · Experiencias VIP',
  titleLead: 'Tu acceso reservado a quienes',
  titleAccent: 'te inspiran.',
  subtitle:
    'Contenido exclusivo, sesiones en vivo y experiencias VIP con creadores que conectan contigo más allá del feed.',
  primaryCta: 'Crear cuenta gratis',
  secondaryCta: 'Explorar creadores',
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
  title: `Empieza en ${BRAND.name} en tres pasos`,
  steps: [
    { icon: 'fa-user-plus', title: 'Crea tu cuenta', text: 'Regístrate gratis y confirma tu edad en un minuto.' },
    { icon: 'fa-compass', title: 'Descubre creadores', text: 'Explora perfiles por categoría y únete a la membresía de quienes te inspiran.' },
    { icon: 'fa-heart', title: 'Conecta y apoya', text: 'Accede a contenido exclusivo, escríbeles, envía regalos y reserva experiencias.' },
  ],
};

export const VIP = {
  eyebrow: 'Experiencias VIP',
  title: 'Momentos que no se publican en ningún feed',
  subtitle:
    'Reserva tiempo real con tus creadores: videollamadas privadas, sesiones de preguntas, contenido hecho para ti y acceso antes que nadie.',
  cta: 'Explorar experiencias',
  perks: [
    { icon: 'fa-handshake', title: 'Meet & Greet', text: 'Un encuentro 1:1 por videollamada.' },
    { icon: 'fa-comments', title: 'Sesiones Q&A', text: 'Pregunta lo que siempre quisiste saber.' },
    { icon: 'fa-wand-magic-sparkles', title: 'Contenido personalizado', text: 'Creado solo para ti.' },
    { icon: 'fa-bolt', title: 'Acceso anticipado', text: 'Estrenos y lanzamientos antes que nadie.' },
  ],
  steps: ['Eliges día y hora', 'El creador confirma', 'Pagas y recibes tu acceso'],
};

export const CREATOR_CTA = {
  eyebrow: 'Para creadores',
  title: '¿Creas contenido o experiencias?',
  subtitle: `Convierte a tu audiencia en una comunidad que te apoya. En ${BRAND.name} tú defines tus precios, tus membresías y tus experiencias.`,
  cta: 'Empezar como creador',
  features: [
    { icon: 'fa-id-badge', label: 'Membresías mensuales' },
    { icon: 'fa-lock', label: 'Contenido exclusivo' },
    { icon: 'fa-gift', label: 'Regalos de tus fans' },
    { icon: 'fa-video', label: 'Sesiones en vivo' },
    { icon: 'fa-ticket', label: 'Experiencias VIP' },
    { icon: 'fa-comment-dots', label: 'Mensajes directos' },
  ],
  stats: [
    { value: '80%', label: 'de cada pago es tuyo' },
    { value: '$50', label: 'retiro mínimo, cuando quieras' },
  ],
};
