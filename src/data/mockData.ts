export interface Creator {
  id: string;
  name: string;
  username: string;
  avatar: string;
  cover: string;
  bio: string;
  isVerified: boolean;
  subscriptionPrice: number;
  followers: number;
  likes: number;
  postsCount: number;
  category: string;
  tags: string[];
}

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

export interface Category {
  id: string;
  name: string;
  icon: string;
  count: number;
}

export const categories: Category[] = [
  { id: '1', name: 'Fitness', icon: '💪', count: 2340 },
  { id: '2', name: 'Modelaje', icon: '📸', count: 5670 },
  { id: '3', name: 'Arte', icon: '🎨', count: 1890 },
  { id: '4', name: 'Música', icon: '🎵', count: 3210 },
  { id: '5', name: 'Cocina', icon: '🍳', count: 980 },
  { id: '6', name: 'Lifestyle', icon: '✨', count: 4560 },
  { id: '7', name: 'Gaming', icon: '🎮', count: 2100 },
  { id: '8', name: 'Educación', icon: '📚', count: 1540 },
  { id: '9', name: 'Experiencias VIP', icon: '👑', count: 890 },
];

export const creators: Creator[] = [
  {
    id: '1',
    name: 'Valentina Rose',
    username: 'valentina_rose',
    avatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=valentina',
    cover: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=400&fit=crop',
    bio: 'Modelo profesional y creadora de contenido exclusivo. Fitness, moda y lifestyle. 💋✨',
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
    avatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=diego',
    cover: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&h=400&fit=crop',
    bio: 'Entrenador personal certificado. Rutinas exclusivas y planes nutricionales. 🔥',
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
    avatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=sofia',
    cover: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=800&h=400&fit=crop',
    bio: 'Artista digital y pintora. Tutoriales exclusivos y proceso creativo. 🎨',
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
    avatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=mariana',
    cover: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&h=400&fit=crop',
    bio: 'Bailarina y coreógrafa profesional. Contenido detrás de cámaras. 💃',
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
    avatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=andres',
    cover: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=800&h=400&fit=crop',
    bio: 'Productor musical y DJ. Beats exclusivos y sesiones en vivo. 🎵',
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
    avatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=camila',
    cover: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&h=400&fit=crop',
    bio: 'Chef profesional. Recetas exclusivas y técnicas de cocina avanzada. 👩‍🍳',
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
    creatorAvatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=valentina',
    content: '¡Nuevo set de fotos desde la playa! 🏖️ ¿Les gusta? Suscríbanse para ver el contenido completo 💕',
    media: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&h=600&fit=crop',
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
    creatorAvatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=valentina',
    content: 'Sesión exclusiva para suscriptores 🔥 Contenido premium disponible ahora',
    media: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=600&h=600&fit=crop',
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
    creatorAvatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=diego',
    content: 'Rutina de pecho y tríceps para hoy 💪 4 series de 12 reps. ¡No hay excusas!',
    media: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600&h=600&fit=crop',
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
    creatorAvatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=sofia',
    content: 'Proceso de mi nueva obra digital 🎨 Tutorial completo disponible para suscriptores',
    media: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=600&h=600&fit=crop',
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
    creatorAvatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=mariana',
    content: 'Behind the scenes de mi última presentación 💃 ¡Gracias por todo el apoyo!',
    media: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&h=600&fit=crop',
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
    creatorAvatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=camila',
    content: 'Receta exclusiva: Risotto de trufa negra 🍄 Paso a paso en video para suscriptores',
    media: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&h=600&fit=crop',
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
    creatorAvatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=valentina',
    title: 'Video Llamada VIP Personalizada',
    description: 'Sesión privada de 30 minutos donde podemos conversar, conocer tus intereses y crear contenido personalizado para ti.',
    type: 'meet-greet',
    price: 99.99,
    duration: '30 min',
    availableSlots: 3,
    totalSlots: 5,
    rating: 4.9,
    reviews: 47,
    image: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=600&h=400&fit=crop',
    tags: ['Exclusivo', 'Personalizado', 'Premium'],
  },
  {
    id: '2',
    creatorId: '2',
    creatorName: 'Diego Torres',
    creatorAvatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=diego',
    title: 'Plan de Entrenamiento 1:1',
    description: 'Sesión de coaching personalizado donde diseño un plan de entrenamiento específico para tus objetivos.',
    type: 'qa-session',
    price: 149.99,
    duration: '60 min',
    availableSlots: 2,
    totalSlots: 4,
    rating: 5.0,
    reviews: 23,
    image: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=600&h=400&fit=crop',
    tags: ['Coaching', 'Personalizado', 'Fitness'],
  },
  {
    id: '3',
    creatorId: '3',
    creatorName: 'Sofía Luna',
    creatorAvatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=sofia',
    title: 'Tutorial de Arte Personalizado',
    description: 'Clase privada donde te enseño técnicas específicas de arte digital según tu nivel y preferencias.',
    type: 'custom-content',
    price: 79.99,
    duration: '45 min',
    availableSlots: 5,
    totalSlots: 8,
    rating: 4.8,
    reviews: 31,
    image: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=600&h=400&fit=crop',
    tags: ['Tutorial', 'Privado', 'Arte'],
  },
  {
    id: '4',
    creatorId: '4',
    creatorName: 'Mariana Silva',
    creatorAvatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=mariana',
    title: 'Behind the Scenes Exclusivo',
    description: 'Acceso anticipado a mi próximo proyecto de baile + video exclusivo del proceso creativo.',
    type: 'early-access',
    price: 49.99,
    availableSlots: 10,
    totalSlots: 20,
    rating: 4.7,
    reviews: 56,
    image: 'https://images.unsplash.com/photo-1508700929628-666bc8bd84ea?w=600&h=400&fit=crop',
    tags: ['Acceso Anticipado', 'Exclusivo', 'BTS'],
  },
  {
    id: '5',
    creatorId: '6',
    creatorName: 'Camila Reyes',
    creatorAvatar: 'https://api.dicebear.com/7.0/adventurer/svg?seed=camila',
    title: 'Clase de Cocina Privada',
    description: 'Sesión en vivo donde cocinamos juntos una receta exclusiva. Incluye lista de ingredientes y tips profesionales.',
    type: 'collaboration',
    price: 119.99,
    duration: '90 min',
    availableSlots: 4,
    totalSlots: 6,
    rating: 4.9,
    reviews: 38,
    image: 'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=600&h=400&fit=crop',
    tags: ['Colaboración', 'En Vivo', 'Gastronomía'],
  },
];
