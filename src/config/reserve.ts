// RESERVE: structured, creator-controlled access to experiences.
//
//   "Fans Reserve permite reservar experiencias, no personas."
//
// Everything Reserve offers is declared here, as data:
//   creator category → allowed experience types → modalities → venue types.
// Adding or removing an experience, a venue type or a category is a change in
// this file, not in the UI. The server enforces the global lists (types,
// modalities, venue types; see supabase/migrations/20261002000001_reserve.sql);
// keep both in sync (e2e checks it).
//
// LEGAL: the category content lines, the prohibited lists and the cancellation
// policies below are product drafts. Requires legal review before production launch.

// --- Modalities ---------------------------------------------------------------

export type ReserveModality = 'virtual' | 'presencial' | 'evento' | 'profesional';

export const RESERVE_MODALITIES: Record<ReserveModality, { label: string; icon: string; description: string }> = {
  virtual: { label: 'Virtual', icon: 'fa-video', description: 'En la sala privada de Fans Reserve o como contenido entregado en la app.' },
  presencial: { label: 'Presencial', icon: 'fa-location-dot', description: 'En un venue, estudio o lugar público definido de antemano.' },
  evento: { label: 'Evento', icon: 'fa-calendar-check', description: 'Convenciones, apariciones, firmas y eventos con público.' },
  profesional: { label: 'Profesional', icon: 'fa-briefcase', description: 'Colaboraciones, producciones y servicios profesionales.' },
};
export const MODALITY_IDS = Object.keys(RESERVE_MODALITIES) as ReserveModality[];

// --- Venue types ----------------------------------------------------------------
// Only establishments, venues, studios and public places. Private homes, hotel
// rooms and private or "discreet" places are never offered (PROHIBITED_LOCATIONS).

export type LocationType =
  | 'online'
  | 'public-place'
  | 'restaurant'
  | 'event-venue'
  | 'convention'
  | 'studio'
  | 'gym'
  | 'salon'
  | 'culinary-space'
  | 'art-space'
  | 'gaming-venue'
  | 'commercial-space';

export const LOCATION_TYPES: Record<LocationType, { label: string; icon: string; hint: string }> = {
  online: { label: 'Sala online de Fans Reserve', icon: 'fa-video', hint: 'Videollamada privada dentro de la app' },
  'public-place': { label: 'Lugar público', icon: 'fa-tree-city', hint: 'Abierto y concurrido: plaza, centro comercial, espacio público' },
  restaurant: { label: 'Restaurante o cafetería', icon: 'fa-mug-saucer', hint: 'Establecimiento abierto al público' },
  'event-venue': { label: 'Venue de evento', icon: 'fa-building-flag', hint: 'Sala de eventos, auditorio o local' },
  convention: { label: 'Convención o feria', icon: 'fa-id-badge', hint: 'Con acreditación del evento' },
  studio: { label: 'Estudio profesional', icon: 'fa-camera', hint: 'Foto, música o producción' },
  gym: { label: 'Gimnasio o centro deportivo', icon: 'fa-dumbbell', hint: 'Instalación deportiva abierta' },
  salon: { label: 'Salón o estudio de belleza', icon: 'fa-spa', hint: 'Establecimiento profesional' },
  'culinary-space': { label: 'Cocina profesional o escuela culinaria', icon: 'fa-kitchen-set', hint: 'Espacio culinario profesional' },
  'art-space': { label: 'Taller, galería o espacio creativo', icon: 'fa-palette', hint: 'Espacio artístico abierto' },
  'gaming-venue': { label: 'Gaming center o torneo', icon: 'fa-gamepad', hint: 'Local o evento de gaming' },
  'commercial-space': { label: 'Espacio comercial o tienda', icon: 'fa-store', hint: 'Tienda, showroom o marca' },
};
export const LOCATION_IDS = Object.keys(LOCATION_TYPES) as LocationType[];
export const IN_PERSON_LOCATIONS = LOCATION_IDS.filter((l) => l !== 'online');

// Never offered as an option, rejected by validation and by the server.
// Some legitimate trades (e.g. catering) may need private addresses in a future
// phase: that would be a new, reviewed venue type for those experiences only.
export const PROHIBITED_LOCATIONS = [
  { id: 'private-residence', label: 'Residencia privada ("mi casa", "tu casa")' },
  { id: 'hotel-room', label: 'Hotel o habitación de hotel como experiencia' },
  { id: 'private-room', label: 'Habitación o "lugar privado/discreto"' },
  { id: 'vehicle', label: 'Vehículo particular' },
] as const;

// --- Experience types --------------------------------------------------------------

// delivery: live = video session in the app's private room (virtual) ·
// in-person = happens at the venue · delivered = content the creator sends.
export type ExperienceDelivery = 'live' | 'in-person' | 'delivered';

export interface ReserveExperienceType {
  id: string;
  name: string;
  icon: string;
  description: string;
  modalities: ReserveModality[];
  // Venue types for the non-virtual modalities (intersected with the category's).
  locations: LocationType[];
  // [min, max] minutes; null = delivered content without a session.
  minutes: [number, number] | null;
  defaultMinutes?: number;
  // Most people one booking can cover (the fan plus companions, or a group).
  maxParticipants: number;
  // The five ids of the original VIP experiences (kept valid for history).
  legacy?: true;
  // Always reviewed by the creator, whatever the experience's approval setting.
  alwaysManual?: true;
}

const t = (x: ReserveExperienceType) => x;

export const RESERVE_EXPERIENCE_TYPES: ReserveExperienceType[] = [
  // Virtual, shared by several categories
  t({ id: 'video-call', name: 'Videollamada 1:1', icon: 'fa-video', description: 'Sesión privada por video dentro de Fans Reserve.', modalities: ['virtual'], locations: [], minutes: [10, 60], defaultMinutes: 20, maxParticipants: 1 }),
  t({ id: 'live-1-1', name: 'Live 1:1', icon: 'fa-tower-broadcast', description: 'Un Live solo para ti, con chat y regalos.', modalities: ['virtual'], locations: [], minutes: [10, 60], defaultMinutes: 15, maxParticipants: 1 }),
  t({ id: 'qa-session', name: 'Q&A privado', icon: 'fa-comments', description: 'Pregunta lo que quieras sobre su trabajo.', modalities: ['virtual'], locations: [], minutes: [10, 60], defaultMinutes: 20, maxParticipants: 3, legacy: true }),
  t({ id: 'personal-greeting', name: 'Saludo personalizado', icon: 'fa-hand-sparkles', description: 'Un video con tu nombre, entregado en la app.', modalities: ['virtual'], locations: [], minutes: null, maxParticipants: 1 }),
  t({ id: 'custom-content', name: 'Contenido personalizado', icon: 'fa-wand-magic-sparkles', description: 'Contenido hecho para ti, dentro de las políticas.', modalities: ['virtual'], locations: [], minutes: null, maxParticipants: 1, legacy: true }),
  t({ id: 'early-access', name: 'Acceso anticipado', icon: 'fa-bolt', description: 'Estrenos y lanzamientos antes que nadie.', modalities: ['virtual'], locations: [], minutes: null, maxParticipants: 1, legacy: true }),
  t({ id: 'themed-talk', name: 'Conversación temática', icon: 'fa-comment-dots', description: 'Una charla sobre un tema concreto que el creator domina.', modalities: ['virtual'], locations: [], minutes: [15, 60], defaultMinutes: 30, maxParticipants: 2 }),
  t({ id: 'coaching', name: 'Coaching', icon: 'fa-bullseye', description: 'Sesión guiada con objetivos concretos.', modalities: ['virtual'], locations: [], minutes: [20, 90], defaultMinutes: 45, maxParticipants: 1 }),
  t({ id: 'mentoring', name: 'Mentoría', icon: 'fa-chalkboard-user', description: 'Orientación profesional sobre tu proyecto.', modalities: ['virtual'], locations: [], minutes: [20, 90], defaultMinutes: 45, maxParticipants: 2 }),
  t({ id: 'creative-session', name: 'Sesión creativa', icon: 'fa-lightbulb', description: 'Crear juntos: ideas, bocetos o maquetas.', modalities: ['virtual'], locations: [], minutes: [30, 120], defaultMinutes: 60, maxParticipants: 2 }),
  t({ id: 'feedback', name: 'Feedback', icon: 'fa-list-check', description: 'Revisión de tu trabajo con comentarios concretos.', modalities: ['virtual'], locations: [], minutes: [15, 60], defaultMinutes: 30, maxParticipants: 1 }),
  t({ id: 'fashion-beauty-talk', name: 'Fashion & beauty talk', icon: 'fa-shirt', description: 'Moda, estilo y belleza, con consejos para ti.', modalities: ['virtual'], locations: [], minutes: [15, 60], defaultMinutes: 20, maxParticipants: 2 }),
  t({ id: 'behind-the-scenes', name: 'Behind the scenes', icon: 'fa-clapperboard', description: 'Detrás de cámaras de una sesión o producción.', modalities: ['virtual'], locations: [], minutes: [15, 60], defaultMinutes: 20, maxParticipants: 5 }),

  // In person, events and professional work
  t({ id: 'meet-greet', name: 'Meet & Greet', icon: 'fa-handshake', description: 'Saludo, foto y firma en un lugar público o evento.', modalities: ['virtual', 'presencial', 'evento'], locations: ['public-place', 'event-venue', 'convention', 'commercial-space', 'restaurant', 'gaming-venue'], minutes: [10, 60], defaultMinutes: 30, maxParticipants: 4, legacy: true }),
  t({ id: 'workshop', name: 'Workshop', icon: 'fa-people-group', description: 'Taller práctico en grupo.', modalities: ['virtual', 'presencial', 'evento'], locations: ['event-venue', 'studio', 'gym', 'salon', 'culinary-space', 'art-space', 'commercial-space'], minutes: [45, 180], defaultMinutes: 90, maxParticipants: 30 }),
  t({ id: 'event', name: 'Evento', icon: 'fa-calendar-check', description: 'Evento programado con público.', modalities: ['evento'], locations: ['event-venue', 'convention', 'gym', 'restaurant', 'gaming-venue', 'commercial-space', 'art-space'], minutes: [30, 180], defaultMinutes: 120, maxParticipants: 50 }),
  t({ id: 'appearance', name: 'Aparición', icon: 'fa-star', description: 'Presencia del creator en tu evento o convención.', modalities: ['evento'], locations: ['event-venue', 'convention', 'commercial-space', 'gaming-venue'], minutes: [30, 180], defaultMinutes: 60, maxParticipants: 50, alwaysManual: true }),
  t({ id: 'fan-event', name: 'Firma / fan event', icon: 'fa-signature', description: 'Firma de autógrafos y fotos con fans.', modalities: ['evento'], locations: ['event-venue', 'convention', 'commercial-space', 'public-place'], minutes: [30, 180], defaultMinutes: 60, maxParticipants: 50 }),
  t({ id: 'collaboration', name: 'Colaboración profesional', icon: 'fa-people-arrows', description: 'Proyecto conjunto para tu marca o canal.', modalities: ['virtual', 'profesional'], locations: ['studio', 'commercial-space', 'event-venue'], minutes: [30, 180], defaultMinutes: 60, maxParticipants: 5, legacy: true, alwaysManual: true }),
  t({ id: 'production', name: 'Producción', icon: 'fa-film', description: 'Rodaje o producción con equipo profesional.', modalities: ['profesional'], locations: ['studio', 'commercial-space', 'event-venue'], minutes: [60, 180], defaultMinutes: 120, maxParticipants: 10, alwaysManual: true }),
  t({ id: 'photo-session', name: 'Sesión fotográfica profesional', icon: 'fa-camera', description: 'Sesión de fotos en estudio, con fines editoriales o de marca.', modalities: ['profesional'], locations: ['studio'], minutes: [30, 180], defaultMinutes: 60, maxParticipants: 3, alwaysManual: true }),

  // Cooking
  t({ id: 'cooking-class', name: 'Clase de cocina', icon: 'fa-utensils', description: 'Cocinan juntos una receta paso a paso.', modalities: ['virtual', 'presencial'], locations: ['culinary-space', 'restaurant'], minutes: [30, 180], defaultMinutes: 90, maxParticipants: 6 }),
  t({ id: 'culinary-consulting', name: 'Asesoría culinaria', icon: 'fa-clipboard-list', description: 'Menú, técnica o negocio gastronómico.', modalities: ['virtual'], locations: [], minutes: [20, 90], defaultMinutes: 45, maxParticipants: 2 }),
  t({ id: 'catering', name: 'Catering', icon: 'fa-bowl-food', description: 'Servicio de cocina para tu evento.', modalities: ['profesional'], locations: ['event-venue', 'commercial-space', 'restaurant'], minutes: [60, 180], defaultMinutes: 180, maxParticipants: 50, alwaysManual: true }),
  t({ id: 'tasting', name: 'Degustación', icon: 'fa-wine-glass', description: 'Degustación guiada de platos o productos.', modalities: ['presencial', 'evento'], locations: ['restaurant', 'culinary-space', 'event-venue'], minutes: [30, 180], defaultMinutes: 90, maxParticipants: 12 }),
  t({ id: 'gastronomic-experience', name: 'Experiencia gastronómica', icon: 'fa-kitchen-set', description: 'Menú o experiencia culinaria diseñada por el creator.', modalities: ['presencial'], locations: ['restaurant', 'culinary-space'], minutes: [60, 180], defaultMinutes: 120, maxParticipants: 12 }),

  // Fitness
  t({ id: 'training-1-1', name: 'Entrenamiento 1:1', icon: 'fa-dumbbell', description: 'Entrenamiento guiado, online o en gimnasio.', modalities: ['virtual', 'presencial'], locations: ['gym'], minutes: [30, 120], defaultMinutes: 60, maxParticipants: 2 }),
  t({ id: 'custom-routine', name: 'Rutina personalizada', icon: 'fa-clipboard-check', description: 'Plan de entrenamiento hecho para tus objetivos.', modalities: ['virtual'], locations: [], minutes: null, maxParticipants: 1 }),
  t({ id: 'assessment', name: 'Evaluación', icon: 'fa-heart-pulse', description: 'Evaluación de técnica, nivel y objetivos.', modalities: ['virtual'], locations: [], minutes: [20, 60], defaultMinutes: 30, maxParticipants: 1 }),
  t({ id: 'clinic', name: 'Clínica', icon: 'fa-medal', description: 'Clínica técnica en grupo.', modalities: ['presencial', 'evento'], locations: ['gym', 'event-venue'], minutes: [60, 180], defaultMinutes: 120, maxParticipants: 30 }),

  // Music
  t({ id: 'music-class', name: 'Clase privada de música', icon: 'fa-music', description: 'Técnica, instrumento o producción.', modalities: ['virtual'], locations: [], minutes: [30, 90], defaultMinutes: 60, maxParticipants: 1 }),
  t({ id: 'listening-session', name: 'Escucha privada', icon: 'fa-headphones', description: 'Escucha un estreno antes que nadie, con comentarios del artista.', modalities: ['virtual'], locations: [], minutes: [15, 60], defaultMinutes: 30, maxParticipants: 4 }),
  t({ id: 'studio-session', name: 'Sesión de estudio', icon: 'fa-sliders', description: 'Grabación o producción en estudio.', modalities: ['presencial', 'profesional'], locations: ['studio'], minutes: [60, 180], defaultMinutes: 120, maxParticipants: 4, alwaysManual: true }),

  // Gaming
  t({ id: 'private-match', name: 'Partida privada', icon: 'fa-gamepad', description: 'Juega una partida con el creator.', modalities: ['virtual'], locations: [], minutes: [20, 120], defaultMinutes: 45, maxParticipants: 4 }),
  t({ id: 'gaming-session', name: 'Gaming session', icon: 'fa-headset', description: 'Sesión de juego con estrategia y charla.', modalities: ['virtual'], locations: [], minutes: [30, 180], defaultMinutes: 60, maxParticipants: 4 }),
  t({ id: 'stream-1-1', name: 'Stream 1:1', icon: 'fa-display', description: 'Un stream privado solo para ti.', modalities: ['virtual'], locations: [], minutes: [15, 90], defaultMinutes: 30, maxParticipants: 1 }),
  t({ id: 'tournament', name: 'Torneo', icon: 'fa-trophy', description: 'Torneo presencial organizado por el creator.', modalities: ['evento'], locations: ['gaming-venue', 'convention', 'event-venue'], minutes: [60, 180], defaultMinutes: 180, maxParticipants: 50 }),

  // Art
  t({ id: 'art-class', name: 'Clase de arte', icon: 'fa-paintbrush', description: 'Técnica de dibujo, pintura o arte digital.', modalities: ['virtual', 'presencial'], locations: ['art-space', 'studio'], minutes: [30, 120], defaultMinutes: 60, maxParticipants: 4 }),
  t({ id: 'portfolio-review', name: 'Portfolio review', icon: 'fa-folder-open', description: 'Revisión de tu portafolio con mejoras concretas.', modalities: ['virtual'], locations: [], minutes: [20, 60], defaultMinutes: 45, maxParticipants: 1 }),
  t({ id: 'art-session', name: 'Sesión artística', icon: 'fa-palette', description: 'Sesión de creación en un taller o estudio.', modalities: ['presencial'], locations: ['art-space', 'studio'], minutes: [60, 180], defaultMinutes: 120, maxParticipants: 6 }),

  // Beauty
  t({ id: 'beauty-consulting', name: 'Asesoría de belleza', icon: 'fa-wand-magic', description: 'Rutina, productos y cuidado para ti.', modalities: ['virtual'], locations: [], minutes: [20, 60], defaultMinutes: 30, maxParticipants: 1 }),
  t({ id: 'styling', name: 'Styling', icon: 'fa-shirt', description: 'Asesoría de imagen y estilo.', modalities: ['virtual', 'presencial'], locations: ['salon', 'studio', 'commercial-space'], minutes: [30, 120], defaultMinutes: 60, maxParticipants: 2 }),
  t({ id: 'makeup-session', name: 'Sesión de maquillaje', icon: 'fa-brush', description: 'Maquillaje guiado o aplicado por el creator.', modalities: ['virtual', 'presencial'], locations: ['salon', 'studio'], minutes: [30, 120], defaultMinutes: 60, maxParticipants: 2 }),

  // Lifestyle
  t({ id: 'themed-experience', name: 'Experiencia temática', icon: 'fa-compass', description: 'Experiencia con un tema y un plan definidos, aprobada por el creator.', modalities: ['presencial', 'evento'], locations: ['event-venue', 'commercial-space', 'public-place', 'restaurant'], minutes: [30, 180], defaultMinutes: 90, maxParticipants: 8, alwaysManual: true }),
];

export const EXPERIENCE_TYPE_IDS = RESERVE_EXPERIENCE_TYPES.map((x) => x.id);
export const LEGACY_EXPERIENCE_TYPES = ['meet-greet', 'qa-session', 'custom-content', 'early-access', 'collaboration'] as const;
export const experienceTypeById = (id: string) => RESERVE_EXPERIENCE_TYPES.find((x) => x.id === id);

// Not offered by any category, in any form. Tests assert none of these appear.
// Professional services with a defined purpose (a cooking class, a coaching or
// training session, a studio photo shoot) are allowed, 1:1 included: what is
// prohibited is selling a person's company or intimacy (PROFESSIONAL_SERVICES_ALLOWED).
export const PROHIBITED_EXPERIENCES = [
  'Vender compañía o tiempo personal ("pasar tiempo conmigo") sin un servicio definido',
  'Cita romántica o "date" remunerada',
  'Compensated dating',
  'Hotel o residencia privada como lugar de la experiencia',
  'Servicios de escort o acompañamiento',
  'Cualquier actividad sexual, virtual o presencial',
  'Lives sexuales o sexting remunerado',
] as const;

// The other half of the rule, shown next to the prohibited list.
export const PROFESSIONAL_SERVICES_ALLOWED =
  'Los servicios profesionales con un propósito definido sí están permitidos, también en formato 1:1: una clase de cocina, una sesión de coaching o entrenamiento, una asesoría o una sesión de fotos en estudio. La experiencia debe decir qué se hace, dónde, cuánto dura y cuánto cuesta. Lo que no se permite es vender la compañía o la intimidad de una persona.';

// --- Custom experience purposes (step 2 of "Solicitar experiencia personalizada")

export type PurposeId =
  | 'meet-greet'
  | 'class'
  | 'session'
  | 'coaching'
  | 'consulting'
  | 'review'
  | 'collaboration'
  | 'photo-session'
  | 'appearance'
  | 'workshop'
  | 'event'
  | 'other';

export const PURPOSES: Record<PurposeId, { label: string; icon: string; modalities: ReserveModality[] }> = {
  'meet-greet': { label: 'Meet & Greet', icon: 'fa-handshake', modalities: ['virtual', 'presencial', 'evento'] },
  class: { label: 'Clase', icon: 'fa-chalkboard-user', modalities: ['virtual', 'presencial'] },
  session: { label: 'Sesión', icon: 'fa-video', modalities: ['virtual', 'presencial', 'profesional'] },
  coaching: { label: 'Coaching', icon: 'fa-bullseye', modalities: ['virtual', 'presencial'] },
  consulting: { label: 'Asesoría', icon: 'fa-clipboard-list', modalities: ['virtual', 'presencial'] },
  review: { label: 'Revisión / feedback', icon: 'fa-list-check', modalities: ['virtual'] },
  collaboration: { label: 'Colaboración', icon: 'fa-people-arrows', modalities: ['virtual', 'profesional'] },
  'photo-session': { label: 'Sesión fotográfica', icon: 'fa-camera', modalities: ['profesional'] },
  appearance: { label: 'Aparición', icon: 'fa-star', modalities: ['evento'] },
  workshop: { label: 'Workshop', icon: 'fa-people-group', modalities: ['virtual', 'presencial', 'evento'] },
  event: { label: 'Evento', icon: 'fa-calendar-check', modalities: ['evento'] },
  other: { label: 'Otro permitido', icon: 'fa-ellipsis', modalities: ['virtual', 'presencial', 'evento', 'profesional'] },
};

// --- Creator categories -----------------------------------------------------------

export type CreatorCategoryId =
  | 'modelaje-glamour'
  | 'fitness'
  | 'cocina'
  | 'musica'
  | 'gaming'
  | 'arte'
  | 'belleza'
  | 'lifestyle'
  | 'educacion';

export interface CreatorCategory {
  id: CreatorCategoryId;
  name: string;
  icon: string;
  blurb: string;
  tint: string;
  ink: string;
  // Older stored names that mean this category (profiles keep their value).
  aliases: string[];
  // Reserve experience types this category may offer.
  experiences: string[];
  modalities: ReserveModality[];
  // Venue types this category may use for in-person experiences.
  locations: LocationType[];
  // Purposes a fan can pick in a custom request.
  customPurposes: PurposeId[];
  // Shown to fans and creators; the line this category's content must respect.
  contentLine?: string;
  // Extra rules shown in the creator wizard and enforced by validation.
  restrictions?: string[];
}

export const CREATOR_CATEGORIES: CreatorCategory[] = [
  {
    id: 'modelaje-glamour',
    name: 'Modelos',
    icon: 'fa-camera-retro',
    blurb: 'Moda, editorial, cosplay y glamour',
    tint: '#fff1f6',
    ink: '#c81b63',
    aliases: ['Modelaje & Glamour', 'Modelaje', 'Modelaje y Glamour'],
    experiences: [
      'live-1-1', 'video-call', 'qa-session', 'personal-greeting', 'themed-talk', 'fashion-beauty-talk', 'behind-the-scenes', 'custom-content',
      'meet-greet', 'appearance', 'event', 'fan-event', 'photo-session', 'collaboration', 'production',
    ],
    modalities: ['virtual', 'presencial', 'evento', 'profesional'],
    // Public and professional places only: no restaurants, no private spaces.
    locations: ['public-place', 'event-venue', 'convention', 'studio', 'commercial-space'],
    customPurposes: ['meet-greet', 'session', 'collaboration', 'photo-session', 'appearance', 'event', 'other'],
    contentLine: 'Glamour permitido. Contenido sexual explícito no permitido.',
    restrictions: [
      'Presencial solo en lugares públicos, eventos, convenciones o estudios profesionales.',
      'No se ofrecen citas, compañía ni "pasar tiempo" sin un servicio profesional definido.',
      'Sesiones fotográficas solo en estudio y con fines editoriales o de marca.',
    ],
  },
  {
    id: 'fitness',
    name: 'Fitness',
    icon: 'fa-dumbbell',
    blurb: 'Rutinas, planes y coaching',
    tint: '#e8f8f1',
    ink: '#0f8a5f',
    aliases: [],
    experiences: ['coaching', 'custom-routine', 'assessment', 'training-1-1', 'qa-session', 'clinic', 'workshop', 'event', 'meet-greet'],
    modalities: ['virtual', 'presencial', 'evento'],
    locations: ['gym', 'event-venue', 'public-place'],
    customPurposes: ['coaching', 'class', 'session', 'workshop', 'event', 'other'],
  },
  {
    id: 'cocina',
    name: 'Cocina',
    icon: 'fa-utensils',
    blurb: 'Recetas, clases y gastronomía',
    tint: '#fff7ed',
    ink: '#c2410c',
    aliases: [],
    experiences: ['cooking-class', 'culinary-consulting', 'qa-session', 'live-1-1', 'catering', 'tasting', 'gastronomic-experience', 'event', 'workshop'],
    modalities: ['virtual', 'presencial', 'evento', 'profesional'],
    locations: ['culinary-space', 'restaurant', 'event-venue', 'commercial-space'],
    customPurposes: ['class', 'consulting', 'workshop', 'event', 'collaboration', 'other'],
  },
  {
    id: 'musica',
    name: 'Música',
    icon: 'fa-music',
    blurb: 'Estrenos, sesiones y clases',
    tint: '#f5f3ff',
    ink: '#6d3ce6',
    aliases: [],
    experiences: ['music-class', 'listening-session', 'feedback', 'creative-session', 'qa-session', 'early-access', 'studio-session', 'meet-greet', 'workshop', 'event', 'appearance'],
    modalities: ['virtual', 'presencial', 'evento', 'profesional'],
    locations: ['studio', 'event-venue', 'convention', 'commercial-space', 'public-place'],
    customPurposes: ['class', 'review', 'session', 'meet-greet', 'collaboration', 'appearance', 'event', 'other'],
  },
  {
    id: 'gaming',
    name: 'Gaming',
    icon: 'fa-gamepad',
    blurb: 'Partidas, coaching y torneos',
    tint: '#eef2ff',
    ink: '#4f46e5',
    aliases: [],
    experiences: ['private-match', 'coaching', 'gaming-session', 'stream-1-1', 'qa-session', 'tournament', 'event', 'meet-greet'],
    modalities: ['virtual', 'evento'],
    locations: ['gaming-venue', 'convention', 'event-venue'],
    customPurposes: ['session', 'coaching', 'meet-greet', 'event', 'collaboration', 'other'],
  },
  {
    id: 'arte',
    name: 'Arte & Creatividad',
    icon: 'fa-palette',
    blurb: 'Procesos, clases y obra',
    tint: '#fff4e5',
    ink: '#c2610c',
    aliases: ['Arte', 'Arte / Creatividad'],
    experiences: ['art-class', 'portfolio-review', 'mentoring', 'creative-session', 'workshop', 'art-session', 'event'],
    modalities: ['virtual', 'presencial', 'evento'],
    locations: ['art-space', 'studio', 'event-venue', 'commercial-space'],
    customPurposes: ['class', 'review', 'session', 'workshop', 'collaboration', 'event', 'other'],
  },
  {
    id: 'belleza',
    name: 'Belleza',
    icon: 'fa-spa',
    blurb: 'Maquillaje, styling y cuidado',
    tint: '#fdf2f8',
    ink: '#be185d',
    aliases: [],
    experiences: ['beauty-consulting', 'styling', 'makeup-session', 'qa-session', 'workshop', 'event'],
    modalities: ['virtual', 'presencial', 'evento'],
    locations: ['salon', 'studio', 'event-venue', 'commercial-space'],
    customPurposes: ['consulting', 'class', 'session', 'workshop', 'event', 'collaboration', 'other'],
  },
  {
    id: 'lifestyle',
    name: 'Lifestyle',
    icon: 'fa-wand-magic-sparkles',
    blurb: 'Día a día, viajes y estilo',
    tint: '#fdf2f8',
    ink: '#a5124f',
    // "Experiencias VIP" was listed as a category before Reserve existed.
    aliases: ['Experiencias VIP'],
    experiences: ['qa-session', 'live-1-1', 'coaching', 'themed-talk', 'behind-the-scenes', 'early-access', 'meet-greet', 'event', 'appearance', 'themed-experience'],
    modalities: ['virtual', 'presencial', 'evento'],
    locations: ['public-place', 'event-venue', 'convention', 'commercial-space', 'restaurant'],
    customPurposes: ['meet-greet', 'coaching', 'session', 'appearance', 'event', 'collaboration', 'other'],
  },
  {
    id: 'educacion',
    name: 'Educación',
    icon: 'fa-graduation-cap',
    blurb: 'Cursos, mentorías y Q&A',
    tint: '#ecfeff',
    ink: '#0e7490',
    aliases: [],
    experiences: ['mentoring', 'coaching', 'qa-session', 'feedback', 'workshop', 'event'],
    modalities: ['virtual', 'presencial', 'evento'],
    locations: ['event-venue', 'commercial-space', 'convention'],
    customPurposes: ['class', 'coaching', 'review', 'workshop', 'event', 'other'],
  },
];

// Creators without a category (or with an unknown one) get the most general set.
export const DEFAULT_CATEGORY: CreatorCategoryId = 'lifestyle';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Resolves a stored category (id, current name or an older name) to its config.
export const categoryFor = (value?: string | null): CreatorCategory => {
  const v = fold(value ?? '');
  return (
    CREATOR_CATEGORIES.find((c) => fold(c.id) === v || fold(c.name) === v || c.aliases.some((a) => fold(a) === v)) ??
    CREATOR_CATEGORIES.find((c) => c.id === DEFAULT_CATEGORY)!
  );
};
export const isKnownCategory = (value?: string | null) => {
  const v = fold(value ?? '');
  return CREATOR_CATEGORIES.some((c) => fold(c.id) === v || fold(c.name) === v || c.aliases.some((a) => fold(a) === v));
};

// Experience types a category offers, optionally for one modality.
export const experienceTypesFor = (category: CreatorCategory, modality?: ReserveModality) =>
  category.experiences
    .map(experienceTypeById)
    .filter((x): x is ReserveExperienceType => !!x)
    .filter((x) => !modality || x.modalities.includes(modality));

export const modalitiesFor = (category: CreatorCategory, type: ReserveExperienceType) =>
  type.modalities.filter((m) => category.modalities.includes(m));

// Venue types allowed for a type in a category (online for virtual).
export const locationsFor = (category: CreatorCategory, type: ReserveExperienceType | null, modality: ReserveModality): LocationType[] => {
  if (modality === 'virtual') return ['online'];
  const base = type ? type.locations : IN_PERSON_LOCATIONS;
  return base.filter((l) => category.locations.includes(l));
};

export const purposesFor = (category: CreatorCategory, modality: ReserveModality) =>
  category.customPurposes.filter((p) => PURPOSES[p].modalities.includes(modality));

// --- Creator controls ---------------------------------------------------------------

export type ApprovalMode = 'manual' | 'automatic';
export type CancellationPolicyId = 'flexible' | 'moderate' | 'strict';

// LEGAL: refund terms are drafts and no refund is executed yet (no live PSP).
export const CANCELLATION_POLICIES: Record<CancellationPolicyId, { label: string; summary: string }> = {
  flexible: { label: 'Flexible', summary: 'Cancelación sin coste hasta 24 h antes.' },
  moderate: { label: 'Moderada', summary: 'Cancelación sin coste hasta 72 h antes; después, se retiene el 50%.' },
  strict: { label: 'Estricta', summary: 'Sin reembolso una vez confirmada, salvo que el creator cancele.' },
};

export const MIN_NOTICE_OPTIONS = [24, 48, 72, 168];
export const SUBSCRIBER_DISCOUNTS = [0, 5, 10, 15, 20, 25];
export const MAX_PARTICIPANTS = 50;
export const MAX_LIST_ITEMS = 6;

export const noticeLabel = (hours: number) => (hours === 168 ? '1 semana' : `${hours} horas`);

// --- States ---------------------------------------------------------------------------
// Stored statuses (vip_bookings.status) and how Reserve names them. "realizada"
// is shown once a confirmed experience's time has passed. reschedule_requested
// and disputed are reserved for the next phase (data model ready, no UI yet).

export type ReserveStatus =
  | 'pending'
  | 'countered'
  | 'accepted'
  | 'confirmed'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'reschedule_requested'
  | 'disputed';

export const RESERVE_STATUSES: Record<ReserveStatus, { label: string; icon: string; className: string }> = {
  pending: { label: 'Solicitud pendiente', icon: 'fa-hourglass-half', className: 'bg-amber-50 text-amber-800 ring-amber-200' },
  countered: { label: 'Contraoferta del creator', icon: 'fa-right-left', className: 'bg-iris-50 text-iris-700 ring-iris-200' },
  accepted: { label: 'Aceptada · pendiente de pago', icon: 'fa-credit-card', className: 'bg-blue-50 text-blue-700 ring-blue-200' },
  confirmed: { label: 'Confirmada', icon: 'fa-circle-check', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  completed: { label: 'Realizada', icon: 'fa-flag-checkered', className: 'bg-gray-100 text-gray-700 ring-gray-200' },
  rejected: { label: 'Rechazada', icon: 'fa-circle-xmark', className: 'bg-red-50 text-red-700 ring-red-200' },
  cancelled: { label: 'Cancelada', icon: 'fa-ban', className: 'bg-gray-100 text-gray-500 ring-gray-200' },
  reschedule_requested: { label: 'Reprogramación solicitada', icon: 'fa-calendar-days', className: 'bg-amber-50 text-amber-800 ring-amber-200' },
  disputed: { label: 'En revisión', icon: 'fa-scale-balanced', className: 'bg-orange-50 text-orange-700 ring-orange-200' },
};

// Request → acceptance → payment → confirmation → experience → payout.
export const RESERVE_FLOW = ['Solicitud', 'Aceptación', 'Pago', 'Confirmación', 'Experiencia', 'Liquidación'] as const;

// --- Copy that keeps the systems apart ------------------------------------------------

export const RESERVE_COPY = {
  principle: 'Reservas experiencias, no personas.',
  gift: 'Los regalos son apoyo voluntario. No garantizan respuesta, conversación, acceso ni experiencias de Reserve.',
  subscription: 'La suscripción da acceso al contenido y a los beneficios que el creator define. No incluye videollamadas ni experiencias de Reserve.',
  reserve: 'Una Reserve es una experiencia concreta, con fecha, duración, precio y condiciones definidas por el creator, que el creator acepta o rechaza.',
  testPayments: 'Pagos en modo de prueba: no se realiza ningún cargo real.',
  legalDraft: 'Borrador. Requiere revisión legal antes del lanzamiento a producción.',
};
