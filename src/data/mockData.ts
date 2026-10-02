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

// Presentation (icon, tint, blurb) lives in src/config/theme.ts.
export interface Category {
  id: string;
  name: string;
}

export const categories: Category[] = [
  { id: '1', name: 'Fitness' },
  { id: '2', name: 'Modelaje' },
  { id: '3', name: 'Arte' },
  { id: '4', name: 'Música' },
  { id: '5', name: 'Cocina' },
  { id: '6', name: 'Lifestyle' },
  { id: '7', name: 'Gaming' },
  { id: '8', name: 'Educación' },
  { id: '9', name: 'Experiencias VIP' },
];

export const creators: Creator[] = [
  {
    id: '1',
    name: 'Valentina Rose',
    username: 'valentina_rose',
    avatar: '/creators/valentina.svg',
    cover: '',
    bio: 'Modelo y creadora de contenido. Moda, fitness y lifestyle, con sesiones y backstage exclusivos.',
    isVerified: true,
    subscriptionPrice: 9.99,
    followers: 12500,
    likes: 89000,
    postsCount: 256,
    category: 'Modelaje',
    tags: ['fitness', 'moda', 'lifestyle'],
  },
  {
    id: '2',
    name: 'Diego Torres',
    username: 'diego_fit',
    avatar: '/creators/diego.svg',
    cover: '',
    bio: 'Entrenador personal certificado. Rutinas exclusivas y planes de nutrición a tu medida.',
    isVerified: true,
    subscriptionPrice: 14.99,
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
    avatar: '/creators/sofia.svg',
    cover: '',
    bio: 'Artista digital y pintora. Tutoriales exclusivos y todo mi proceso creativo.',
    isVerified: true,
    subscriptionPrice: 7.99,
    followers: 6700,
    likes: 34000,
    postsCount: 145,
    category: 'Arte',
    tags: ['arte', 'digital', 'tutoriales'],
  },
  {
    id: '4',
    name: 'Mariana Silva',
    username: 'mariana_s',
    avatar: '/creators/mariana.svg',
    cover: '',
    bio: 'Bailarina y coreógrafa profesional. Ensayos, coreografías y detrás de cámaras.',
    isVerified: false,
    subscriptionPrice: 12.99,
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
    avatar: '/creators/andres.svg',
    cover: '',
    bio: 'Productor musical y DJ. Beats exclusivos, estrenos y sesiones en vivo.',
    isVerified: true,
    subscriptionPrice: 5.99,
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
    avatar: '/creators/camila.svg',
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
];

export const posts: Post[] = [
  {
    id: '1',
    creatorId: '1',
    creatorName: 'Valentina Rose',
    creatorAvatar: '/creators/valentina.svg',
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
    creatorAvatar: '/creators/valentina.svg',
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
    creatorAvatar: '/creators/diego.svg',
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
    creatorAvatar: '/creators/sofia.svg',
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
    creatorAvatar: '/creators/mariana.svg',
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
    creatorAvatar: '/creators/camila.svg',
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

export interface VIPExperience {
  id: string;
  creatorId: string;
  creatorName: string;
  creatorAvatar: string;
  title: string;
  description: string;
  type: 'meet-greet' | 'qa-session' | 'custom-content' | 'early-access' | 'collaboration';
  price: number;
  duration?: string;
  availableSlots: number;
  totalSlots: number;
  rating: number;
  reviews: number;
  image: string;
  tags: string[];
}

export const vipExperiences: VIPExperience[] = [
  {
    id: '1',
    creatorId: '1',
    creatorName: 'Valentina Rose',
    creatorAvatar: '/creators/valentina.svg',
    title: 'Video Llamada VIP Personalizada',
    description: 'Sesión privada de 30 minutos donde podemos conversar, conocer tus intereses y crear contenido personalizado para ti.',
    type: 'meet-greet',
    price: 99.99,
    duration: '30 min',
    availableSlots: 3,
    totalSlots: 5,
    rating: 4.9,
    reviews: 47,
    image: '',
    tags: ['Exclusivo', 'Personalizado', 'Premium'],
  },
  {
    id: '2',
    creatorId: '2',
    creatorName: 'Diego Torres',
    creatorAvatar: '/creators/diego.svg',
    title: 'Plan de Entrenamiento 1:1',
    description: 'Sesión de coaching personalizado donde diseño un plan de entrenamiento específico para tus objetivos.',
    type: 'qa-session',
    price: 149.99,
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
    creatorAvatar: '/creators/sofia.svg',
    title: 'Tutorial de Arte Personalizado',
    description: 'Clase privada donde te enseño técnicas específicas de arte digital según tu nivel y preferencias.',
    type: 'custom-content',
    price: 79.99,
    duration: '45 min',
    availableSlots: 5,
    totalSlots: 8,
    rating: 4.8,
    reviews: 31,
    image: '',
    tags: ['Tutorial', 'Privado', 'Arte'],
  },
  {
    id: '4',
    creatorId: '4',
    creatorName: 'Mariana Silva',
    creatorAvatar: '/creators/mariana.svg',
    title: 'Behind the Scenes Exclusivo',
    description: 'Acceso anticipado a mi próximo proyecto de baile + video exclusivo del proceso creativo.',
    type: 'early-access',
    price: 49.99,
    availableSlots: 10,
    totalSlots: 20,
    rating: 4.7,
    reviews: 56,
    image: '',
    tags: ['Acceso Anticipado', 'Exclusivo', 'BTS'],
  },
  {
    id: '5',
    creatorId: '6',
    creatorName: 'Camila Reyes',
    creatorAvatar: '/creators/camila.svg',
    title: 'Clase de Cocina Privada',
    description: 'Sesión en vivo donde cocinamos juntos una receta exclusiva. Incluye lista de ingredientes y tips profesionales.',
    type: 'collaboration',
    price: 119.99,
    duration: '90 min',
    availableSlots: 4,
    totalSlots: 6,
    rating: 4.9,
    reviews: 38,
    image: '',
    tags: ['Colaboración', 'En Vivo', 'Gastronomía'],
  },
];
