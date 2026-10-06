import type { ReserveDetails } from '../lib/backend/types';
import { CREATOR_CATEGORIES } from '../config/reserve';

export interface Creator {
  id: string;
  name: string;
  username: string;
  avatar: string;
  cover: string; // empty: generated cover art (components/CoverArt) until a photo is uploaded
  bio: string;
  isVerified: boolean;
  subscriptionPrice: number;
  followers: number;
  likes: number;
  postsCount: number;
  category: string;
  tags: string[];
  // Set on platform-run profiles (see lib/catalog.ts); fans always see the label.
  managed?: 'ai' | 'official';
}

// Demo media are drawn as generated art (components/CoverArt) instead of
// loading third-party stock photos.
export const DEMO_ART = 'art:demo';

export interface Post {
  id: string;
  creatorId: string;
  creatorName: string;
  creatorAvatar: string;
  content: string;
  media?: string;
  mediaType?: 'image' | 'video';
  isLocked: boolean;
  likes: number;
  comments: number;
  tips: number;
  createdAt: string;
  price?: number;
}

// Creator categories (and what each may offer in Reserve) live in src/config/reserve.ts.
export interface Category {
  id: string;
  name: string;
}

export const categories: Category[] = CREATOR_CATEGORIES.map(({ id, name }) => ({ id, name }));

export const creators: Creator[] = [
  {
    id: '1',
    name: 'Valentina Rose',
    username: 'valentina_rose',
    avatar: '/creators/photos/valentina.jpg',
    cover: '',
    bio: 'Modelo y creadora de contenido. Moda, fitness y lifestyle, con sesiones y backstage exclusivos.',
    isVerified: true,
    subscriptionPrice: 9.99,
    followers: 12500,
    likes: 89000,
    postsCount: 256,
    category: 'Tu gente',
    tags: ['fitness', 'moda', 'lifestyle'],
  },
  {
    id: '2',
    name: 'Diego Torres',
    username: 'diego_fit',
    avatar: '/creators/photos/diego.jpg',
    cover: '',
    bio: 'Entrenador personal certificado. Rutinas exclusivas y planes de nutrición a tu medida.',
    isVerified: true,
    subscriptionPrice: 9.49,
    followers: 8900,
    likes: 45000,
    postsCount: 189,
    category: 'Fitness',
    tags: ['fitness', 'entrenamiento', 'nutrición'],
  },
  {
    id: '3',
    name: 'Sofía Luna',
    username: 'sofia_art',
    avatar: '/creators/photos/sofia.jpg',
    cover: '',
    bio: 'Artista digital y pintora. Tutoriales exclusivos y todo mi proceso creativo.',
    isVerified: true,
    subscriptionPrice: 7.99,
    followers: 6700,
    likes: 34000,
    postsCount: 145,
    category: 'Arte & Creatividad',
    tags: ['arte', 'digital', 'tutoriales'],
  },
  {
    id: '4',
    name: 'Mariana Silva',
    username: 'mariana_s',
    avatar: '/creators/photos/mariana.jpg',
    cover: '',
    bio: 'Bailarina y coreógrafa profesional. Ensayos, coreografías y detrás de cámaras.',
    isVerified: false,
    subscriptionPrice: 8.49,
    followers: 15200,
    likes: 120000,
    postsCount: 312,
    category: 'Lifestyle',
    tags: ['baile', 'música', 'entretenimiento'],
  },
  {
    id: '5',
    name: 'Andrés Vega',
    username: 'andres_music',
    avatar: '/creators/photos/andres.jpg',
    cover: '',
    bio: 'Productor musical y DJ. Beats exclusivos, estrenos y sesiones en vivo.',
    isVerified: true,
    subscriptionPrice: 6.99,
    followers: 4300,
    likes: 22000,
    postsCount: 98,
    category: 'Música',
    tags: ['música', 'producer', 'DJ'],
  },
  {
    id: '6',
    name: 'Camila Reyes',
    username: 'camila_r',
    avatar: '/creators/photos/camila.jpg',
    cover: '',
    bio: 'Chef profesional. Recetas exclusivas, técnicas avanzadas y clases privadas.',
    isVerified: true,
    subscriptionPrice: 8.99,
    followers: 9800,
    likes: 56000,
    postsCount: 201,
    category: 'Cocina',
    tags: ['cocina', 'recetas', 'gastronomía'],
  },
  {
    id: '7',
    name: 'Mateo Ríos',
    username: 'mateo_plays',
    avatar: '/creators/photos/mateo.jpg',
    cover: '',
    bio: 'Streamer y jugador competitivo. Partidas en vivo, estrategia y coaching para subir de nivel.',
    isVerified: true,
    subscriptionPrice: 6.99,
    followers: 11300,
    likes: 64000,
    postsCount: 178,
    category: 'Gaming',
    tags: ['gaming', 'streaming', 'esports'],
  },
  {
    id: '8',
    name: 'Isabela Cruz',
    username: 'isabela_beauty',
    avatar: '/creators/photos/isabela.jpg',
    cover: '',
    bio: 'Maquilladora profesional. Tutoriales, rutinas de cuidado y asesorías de belleza 1:1.',
    isVerified: true,
    subscriptionPrice: 7.49,
    followers: 13800,
    likes: 97000,
    postsCount: 289,
    category: 'Belleza',
    tags: ['belleza', 'maquillaje', 'skincare'],
  },
  {
    id: '9',
    name: 'Daniel Ortiz',
    username: 'profe_daniel',
    avatar: '/creators/photos/daniel.jpg',
    cover: '',
    bio: 'Profesor de ciencias. Explicaciones claras, clases particulares y mentorías para estudiantes.',
    isVerified: true,
    subscriptionPrice: 6.99,
    followers: 7200,
    likes: 38000,
    postsCount: 143,
    category: 'Educación',
    tags: ['educación', 'ciencia', 'clases'],
  },
];

export const posts: Post[] = [
  {
    id: '1',
    creatorId: '1',
    creatorName: 'Valentina Rose',
    creatorAvatar: '/creators/photos/valentina.jpg',
    content: '¡Nuevo set de fotos desde la playa! 🏖️ ¿Les gusta? Suscríbanse para ver el contenido completo 💕',
    media: DEMO_ART,
    mediaType: 'image',
    isLocked: false,
    likes: 342,
    comments: 56,
    tips: 12,
    createdAt: '2024-01-15T10:30:00Z',
  },
  {
    id: '2',
    creatorId: '1',
    creatorName: 'Valentina Rose',
    creatorAvatar: '/creators/photos/valentina.jpg',
    content: 'Sesión exclusiva para suscriptores 🔥 Contenido premium disponible ahora',
    media: DEMO_ART,
    mediaType: 'image',
    isLocked: true,
    likes: 890,
    comments: 123,
    tips: 45,
    createdAt: '2024-01-14T15:00:00Z',
    price: 4.99,
  },
  {
    id: '3',
    creatorId: '2',
    creatorName: 'Diego Torres',
    creatorAvatar: '/creators/photos/diego.jpg',
    content: 'Rutina de pecho y tríceps para hoy 💪 4 series de 12 reps. ¡No hay excusas!',
    media: DEMO_ART,
    mediaType: 'image',
    isLocked: false,
    likes: 567,
    comments: 89,
    tips: 23,
    createdAt: '2024-01-15T08:00:00Z',
  },
  {
    id: '4',
    creatorId: '3',
    creatorName: 'Sofía Luna',
    creatorAvatar: '/creators/photos/sofia.jpg',
    content: 'Proceso de mi nueva obra digital 🎨 Tutorial completo disponible para suscriptores',
    media: DEMO_ART,
    mediaType: 'image',
    isLocked: true,
    likes: 234,
    comments: 45,
    tips: 8,
    createdAt: '2024-01-14T20:00:00Z',
    price: 2.99,
  },
  {
    id: '5',
    creatorId: '4',
    creatorName: 'Mariana Silva',
    creatorAvatar: '/creators/photos/mariana.jpg',
    content: 'Behind the scenes de mi última presentación 💃 ¡Gracias por todo el apoyo!',
    media: DEMO_ART,
    mediaType: 'image',
    isLocked: false,
    likes: 1200,
    comments: 200,
    tips: 67,
    createdAt: '2024-01-13T18:00:00Z',
  },
  {
    id: '6',
    creatorId: '6',
    creatorName: 'Camila Reyes',
    creatorAvatar: '/creators/photos/camila.jpg',
    content: 'Receta exclusiva: Risotto de trufa negra 🍄 Paso a paso en video para suscriptores',
    media: DEMO_ART,
    mediaType: 'image',
    isLocked: true,
    likes: 456,
    comments: 78,
    tips: 34,
    createdAt: '2024-01-12T12:00:00Z',
    price: 3.99,
  },
];

export const notifications = [
  { id: '1', text: 'Valentina Rose publicó nuevo contenido', time: 'Hace 5 min', read: false },
  { id: '2', text: 'Tu suscripción a Diego Torres se renovó', time: 'Hace 1 hora', read: false },
  { id: '3', text: 'Sofía Luna respondió a tu comentario', time: 'Hace 3 horas', read: true },
  { id: '4', text: 'Mariana Silva publicó un video exclusivo', time: 'Hace 5 horas', read: true },
];

// Demo Reserve experiences (same ids as the Supabase seed). `details` follows
// ReserveDetails (src/lib/backend/types.ts); see src/config/reserve.ts.
export interface VIPExperience {
  id: string;
  creatorId: string;
  creatorName: string;
  creatorAvatar: string;
  title: string;
  description: string;
  type: string;
  details?: ReserveDetails;
  price: number;
  duration?: string;
  availableSlots: number;
  totalSlots: number;
  rating: number;
  reviews: number;
  image: string;
  tags: string[];
}

const online = { modality: 'virtual' as const, locationTypes: ['online' as const] };
// YYYY-MM-DD of the next Friday at least two days from now (local time).
const nextFriday = () => {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const noRecording = 'Grabación de la sesión';
const offPlatform = 'Contacto o pagos fuera de Fans Reserve';

export const vipExperiences: VIPExperience[] = [
  {
    id: '1',
    creatorId: '1',
    creatorName: 'Valentina Rose',
    creatorAvatar: '/creators/photos/valentina.jpg',
    title: 'Videollamada 1:1',
    description: 'Videollamada privada dentro de Fans Reserve para hablar de moda, estilo y backstage. Tú propones el tema y yo traigo consejos y respuestas.',
    type: 'video-call',
    details: {
      ...online,
      includes: ['Sala privada de Fans Reserve', 'Tema acordado de antemano', 'Consejos de estilo personalizados'],
      excludes: [noRecording, offPlatform],
      requirements: { verifiedFans: false, subscribersOnly: false },
      minNoticeHours: 24,
      maxParticipants: 1,
      approval: 'manual',
      cancellationPolicy: 'moderate',
      subscriberDiscount: 10,
    },
    price: 24.99,
    duration: '30 min',
    availableSlots: 3,
    totalSlots: 5,
    rating: 4.9,
    reviews: 47,
    image: '',
    tags: ['Moda', 'Estilo', 'Backstage'],
  },
  {
    id: '2',
    creatorId: '2',
    creatorName: 'Diego Torres',
    creatorAvatar: '/creators/photos/diego.jpg',
    title: 'Coaching y plan de entrenamiento',
    description: 'Sesión de coaching por video en la que diseño un plan de entrenamiento específico para tus objetivos.',
    type: 'coaching',
    details: {
      ...online,
      includes: ['Evaluación de tu nivel', 'Plan de 4 semanas en PDF'],
      excludes: [noRecording],
      requirements: { verifiedFans: false, subscribersOnly: false },
      minNoticeHours: 24,
      maxParticipants: 1,
      approval: 'manual',
      cancellationPolicy: 'flexible',
    },
    price: 29.99,
    duration: '60 min',
    availableSlots: 2,
    totalSlots: 4,
    rating: 5.0,
    reviews: 23,
    image: '',
    tags: ['Coaching', 'Personalizado', 'Fitness'],
  },
  {
    id: '3',
    creatorId: '3',
    creatorName: 'Sofía Luna',
    creatorAvatar: '/creators/photos/sofia.jpg',
    title: 'Clase de arte digital',
    description: 'Clase privada en la que te enseño técnicas de arte digital según tu nivel y preferencias.',
    type: 'art-class',
    details: {
      ...online,
      includes: ['Archivo de pinceles', 'Ejercicio guiado'],
      excludes: [noRecording],
      requirements: { verifiedFans: false, subscribersOnly: false },
      minNoticeHours: 48,
      maxParticipants: 2,
      approval: 'manual',
      cancellationPolicy: 'moderate',
    },
    price: 22.99,
    duration: '45 min',
    availableSlots: 5,
    totalSlots: 8,
    rating: 4.8,
    reviews: 31,
    image: '',
    tags: ['Tutorial', 'Arte digital'],
  },
  {
    id: '4',
    creatorId: '4',
    creatorName: 'Mariana Silva',
    creatorAvatar: '/creators/photos/mariana.jpg',
    title: 'Acceso anticipado a mi próximo proyecto',
    description: 'Acceso anticipado a mi próximo proyecto de baile y un video exclusivo del proceso creativo, entregado en la app.',
    type: 'early-access',
    details: {
      ...online,
      includes: ['Estreno 7 días antes', 'Video del proceso creativo'],
      excludes: ['Sesión en vivo'],
      requirements: { verifiedFans: false, subscribersOnly: false },
      minNoticeHours: 24,
      maxParticipants: 1,
      approval: 'automatic',
      cancellationPolicy: 'strict',
    },
    price: 15.99,
    availableSlots: 10,
    totalSlots: 20,
    rating: 4.7,
    reviews: 56,
    image: '',
    tags: ['Acceso anticipado', 'Baile'],
  },
  {
    id: '5',
    creatorId: '6',
    creatorName: 'Camila Reyes',
    creatorAvatar: '/creators/photos/camila.jpg',
    title: 'Clase de cocina en vivo',
    description: 'Clase por video en la que cocinamos juntos una receta exclusiva. Incluye lista de ingredientes y tips profesionales.',
    type: 'cooking-class',
    details: {
      ...online,
      includes: ['Lista de ingredientes previa', 'Receta en PDF'],
      excludes: ['Ingredientes', noRecording],
      requirements: { verifiedFans: false, subscribersOnly: false },
      minNoticeHours: 48,
      maxParticipants: 4,
      approval: 'manual',
      cancellationPolicy: 'moderate',
    },
    price: 27.99,
    duration: '90 min',
    availableSlots: 4,
    totalSlots: 6,
    rating: 4.9,
    reviews: 38,
    image: '',
    tags: ['En vivo', 'Gastronomía'],
  },
  {
    id: '6',
    creatorId: '1',
    creatorName: 'Valentina Rose',
    creatorAvatar: '/creators/photos/valentina.jpg',
    title: 'Meet & Greet en Miami',
    description: 'Saludo, foto y firma en un venue público de Miami, durante mi agenda de eventos. El lugar exacto se confirma con la reserva.',
    type: 'meet-greet',
    details: {
      modality: 'presencial',
      locationTypes: ['public-place', 'event-venue'],
      city: 'Miami',
      includes: ['Foto juntos', 'Firma personalizada'],
      excludes: ['Encuentros fuera del venue', 'Transporte'],
      requirements: { verifiedFans: true, subscribersOnly: false },
      minNoticeHours: 72,
      maxParticipants: 2,
      approval: 'manual',
      cancellationPolicy: 'moderate',
    },
    price: 29.99,
    duration: '30 min',
    availableSlots: 6,
    totalSlots: 6,
    rating: 5.0,
    reviews: 12,
    image: '',
    tags: ['Meet & Greet', 'Miami'],
  },
  {
    id: '7',
    creatorId: '1',
    creatorName: 'Valentina Rose',
    creatorAvatar: '/creators/photos/valentina.jpg',
    title: 'Fashion & beauty talk',
    description: 'Veinte minutos por video para revisar tu estilo, tu rutina de belleza y tus dudas de moda.',
    type: 'fashion-beauty-talk',
    details: {
      ...online,
      includes: ['Sala privada de Fans Reserve', 'Lista de recomendaciones después de la llamada'],
      excludes: [noRecording, offPlatform],
      requirements: { verifiedFans: true, subscribersOnly: false },
      minNoticeHours: 48,
      maxParticipants: 1,
      approval: 'manual',
      cancellationPolicy: 'moderate',
      days: [1, 3],
    },
    price: 19.99,
    duration: '20 min',
    availableSlots: 4,
    totalSlots: 4,
    rating: 4.9,
    reviews: 18,
    image: '',
    tags: ['Moda', 'Belleza'],
  },
  {
    id: '8',
    creatorId: '2',
    creatorName: 'Diego Torres',
    creatorAvatar: '/creators/photos/diego.jpg',
    title: 'Entrenamiento en gimnasio',
    description: 'Entrenamiento 1:1 en un gimnasio de Ciudad de México: técnica, rutina y correcciones en directo.',
    type: 'training-1-1',
    details: {
      modality: 'presencial',
      locationTypes: ['gym'],
      city: 'Ciudad de México',
      includes: ['Acceso de un día al gimnasio', 'Rutina por escrito'],
      excludes: ['Suplementos', 'Transporte'],
      requirements: { verifiedFans: false, subscribersOnly: false },
      minNoticeHours: 48,
      maxParticipants: 2,
      approval: 'automatic',
      cancellationPolicy: 'flexible',
    },
    price: 26.99,
    duration: '60 min',
    availableSlots: 6,
    totalSlots: 6,
    rating: 4.9,
    reviews: 9,
    image: '',
    tags: ['Gimnasio', 'Presencial'],
  },
  // Demo Reserve Event: a group Q&A on the next Friday at 20:00 (at least two days away).
  {
    id: 'ev-1',
    creatorId: '1',
    creatorName: 'Valentina Rose',
    creatorAvatar: '/creators/photos/valentina.jpg',
    title: 'Beauty Q&A con Valentina',
    description: 'Q&A grupal en vivo sobre maquillaje, cuidado de la piel y rutinas. Envías tus preguntas por el chat y Valentina responde en directo.',
    type: 'qa-session',
    details: {
      ...online,
      format: 'event',
      eventDate: nextFriday(),
      eventTime: '20:00',
      includes: ['Sala del evento en Fans Reserve', 'Preguntas por chat', 'Lista de productos mencionados'],
      excludes: [noRecording, 'Tiempo privado con la creadora', offPlatform],
      requirements: { verifiedFans: false, subscribersOnly: false },
      minNoticeHours: 24,
      maxParticipants: 20,
      approval: 'automatic',
      cancellationPolicy: 'moderate',
    },
    price: 15.99,
    duration: '60 min',
    availableSlots: 20,
    totalSlots: 20,
    rating: 5,
    reviews: 0,
    image: '',
    tags: ['Q&A', 'Belleza', 'Grupal'],
  },
];
