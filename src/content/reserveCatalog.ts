import type { Language } from '../context/LanguageContext';

// Editorial translations of the approved pilot offers. Never translate arbitrary
// creator text by type or id: both source fields must still match this edition.
type Copy = { title: string; description: string };
type Edition = { type: string; featured?: boolean; copy: Record<Language, Copy> };
export const RESERVE_CATALOG: Record<string, Edition> = {
  'video-call': { type: 'video-call', copy: {
    es: { title: 'Videollamada 1:1', description: 'Videollamada dentro de Fans Reserve para conversar sobre moda, estilo y el trabajo creativo. Tú propones el tema y el creador comparte consejos y respuestas.' },
    en: { title: '1:1 video call', description: 'A video call within Fans Reserve to discuss fashion, style and creative work. You suggest the topic, and the creator shares advice and answers.' },
    pt: { title: 'Videochamada 1:1', description: 'Uma videochamada no Fans Reserve para conversar sobre moda, estilo e trabalho criativo. Você sugere o tema, e o criador compartilha dicas e respostas.' },
    fr: { title: 'Appel vidéo 1:1', description: 'Un appel vidéo sur Fans Reserve pour parler de mode, de style et de création. Vous proposez le sujet et le créateur partage ses conseils et répond à vos questions.' },
    it: { title: 'Videochiamata 1:1', description: 'Una videochiamata su Fans Reserve per parlare di moda, stile e lavoro creativo. Tu proponi il tema e il creator condivide consigli e risposte.' },
  } },
  coaching: { type: 'coaching', copy: {
    es: { title: 'Asesoría y plan de entrenamiento', description: 'Asesoría por video para diseñar un plan de entrenamiento según tu nivel y tus objetivos.' },
    en: { title: 'Fitness advice and training plan', description: 'Video guidance to design a training plan suited to your level and goals.' },
    pt: { title: 'Orientação e plano de treino', description: 'Orientação por vídeo para montar um plano de treino de acordo com seu nível e seus objetivos.' },
    fr: { title: 'Conseils et programme d’entraînement', description: 'Des conseils en vidéo pour concevoir un programme d’entraînement adapté à votre niveau et à vos objectifs.' },
    it: { title: 'Consulenza e piano di allenamento', description: 'Una consulenza video per creare un piano di allenamento adatto al tuo livello e ai tuoi obiettivi.' },
  } },
  art: { type: 'art-class', copy: {
    es: { title: 'Clase de arte digital', description: 'Aprende técnicas de arte digital por video, con explicaciones y ejercicios adecuados a tu nivel y tus intereses.' },
    en: { title: 'Digital art class', description: 'Learn digital art techniques by video, with explanations and exercises suited to your level and interests.' },
    pt: { title: 'Aula de arte digital', description: 'Aprenda técnicas de arte digital por vídeo, com explicações e exercícios adequados ao seu nível e aos seus interesses.' },
    fr: { title: 'Cours d’art numérique', description: 'Apprenez des techniques d’art numérique en vidéo, avec des explications et des exercices adaptés à votre niveau et à vos centres d’intérêt.' },
    it: { title: 'Lezione di arte digitale', description: 'Impara tecniche di arte digitale in video, con spiegazioni ed esercizi adatti al tuo livello e ai tuoi interessi.' },
  } },
  cooking: { type: 'cooking-class', copy: {
    es: { title: 'Clase de cocina en vivo', description: 'Cocina una receta paso a paso con el creador por video. Incluye una lista de ingredientes y consejos de preparación.' },
    en: { title: 'Live cooking class', description: 'Cook a recipe step by step with the creator by video. Includes an ingredient list and preparation tips.' },
    pt: { title: 'Aula de culinária ao vivo', description: 'Prepare uma receita passo a passo com o criador por vídeo. Inclui uma lista de ingredientes e dicas de preparo.' },
    fr: { title: 'Cours de cuisine en direct', description: 'Réalisez une recette étape par étape avec le créateur en vidéo. Une liste d’ingrédients et des conseils de préparation sont inclus.' },
    it: { title: 'Lezione di cucina in diretta', description: 'Prepara una ricetta passo dopo passo con il creator in video. Include l’elenco degli ingredienti e consigli per la preparazione.' },
  } },
  greeting: { type: 'meet-greet', copy: {
    es: { title: 'Saludo y fotos contigo', description: 'Saluda a tu creador y tómate unas fotos durante una actividad programada en un lugar público de Miami.' },
    en: { title: 'Say hello and take photos', description: 'Say hello to your creator and take a few photos during a scheduled activity at a public location in Miami.' },
    pt: { title: 'Um olá e fotos com você', description: 'Cumprimente seu criador e tire algumas fotos durante uma atividade programada em um local público de Miami.' },
    fr: { title: 'Un bonjour et des photos avec vous', description: 'Saluez votre créateur et prenez quelques photos lors d’une activité programmée dans un lieu public à Miami.' },
    it: { title: 'Un saluto e qualche foto insieme', description: 'Saluta il tuo creator e scatta qualche foto durante un’attività programmata in un luogo pubblico di Miami.' },
  } },
  fashion: { type: 'fashion-beauty-talk', copy: {
    es: { title: 'Charla de moda y belleza', description: 'Conversemos sobre estilos, tendencias y consejos para encontrar lo que mejor va contigo.' },
    en: { title: 'Fashion and beauty conversation', description: 'Let’s discuss styles, trends and tips to help you find what suits you best.' },
    pt: { title: 'Conversa sobre moda e beleza', description: 'Vamos conversar sobre estilos, tendências e dicas para encontrar o que mais combina com você.' },
    fr: { title: 'Discussion sur la mode et la beauté', description: 'Parlons de styles, de tendances et de conseils pour trouver ce qui vous convient le mieux.' },
    it: { title: 'Chiacchierata su moda e bellezza', description: 'Parliamo di stili, tendenze e consigli per trovare ciò che fa per te.' },
  } },
  gym: { type: 'training-1-1', copy: {
    es: { title: 'Entrenamiento en gimnasio', description: 'Entrenamiento guiado en un gimnasio de Ciudad de México, con ejercicios, revisión de técnica y correcciones durante la actividad.' },
    en: { title: 'Gym training session', description: 'Guided training at a gym in Mexico City, with exercises, technique reviews and corrections during the activity.' },
    pt: { title: 'Treino na academia', description: 'Treino orientado em uma academia na Cidade do México, com exercícios, revisão de técnica e correções durante a atividade.' },
    fr: { title: 'Entraînement en salle de sport', description: 'Un entraînement guidé dans une salle de sport à Mexico, avec des exercices, une vérification de la technique et des corrections pendant l’activité.' },
    it: { title: 'Allenamento in palestra', description: 'Allenamento guidato in una palestra di Città del Messico, con esercizi, verifica della tecnica e correzioni durante l’attività.' },
  } },
  questions: { type: 'qa-session', copy: {
    es: { title: 'Preguntas y respuestas sobre belleza', description: 'Trae tus preguntas sobre maquillaje, cuidado personal y rutinas de belleza. Valentina responde en vivo a las preguntas del grupo por el chat.' },
    en: { title: 'Beauty questions and answers', description: 'Bring your questions about makeup, personal care and beauty routines. Valentina answers the group’s questions live through the chat.' },
    pt: { title: 'Perguntas e respostas sobre beleza', description: 'Traga suas perguntas sobre maquiagem, cuidados pessoais e rotinas de beleza. Valentina responde ao vivo às perguntas do grupo pelo chat.' },
    fr: { title: 'Questions et réponses sur la beauté', description: 'Posez vos questions sur le maquillage, les soins et les routines de beauté. Valentina répond en direct aux questions du groupe dans le chat.' },
    it: { title: 'Domande e risposte sulla bellezza', description: 'Porta le tue domande su trucco, cura personale e routine di bellezza. Valentina risponde in diretta alle domande del gruppo tramite la chat.' },
  } },
  conversation: { type: 'live-1-1', featured: true, copy: {
    es: { title: 'Platiquemos de lo que te interesa', description: 'Una conversación en vivo 1:1 con tu creador favorito sobre intereses compartidos, sus proyectos y las preguntas que siempre quisiste hacerle.' },
    en: { title: 'Let’s talk about what interests you', description: 'A live 1:1 conversation with your favorite creator about shared interests, their projects and the questions you’ve always wanted to ask.' },
    pt: { title: 'Vamos conversar sobre o que te interessa', description: 'Uma conversa ao vivo 1:1 com seu criador favorito sobre interesses em comum, os projetos dele e as perguntas que você sempre quis fazer.' },
    fr: { title: 'Parlons de ce qui vous intéresse', description: 'Une conversation en direct 1:1 avec votre créateur préféré sur vos centres d’intérêt communs, ses projets et les questions que vous avez toujours voulu lui poser.' },
    it: { title: 'Parliamo di ciò che ti interessa', description: 'Una conversazione in diretta 1:1 con il tuo creator preferito su interessi comuni, i suoi progetti e le domande che hai sempre voluto fargli.' },
  } },
};

type Source = { type: string; title: string; description: string };
export const catalogEdition = (exp: Source) => Object.values(RESERVE_CATALOG).find((entry) =>
  entry.type === exp.type && entry.copy.es.title === exp.title && entry.copy.es.description === exp.description);
export const experienceCopy = (exp: Source, language: Language): Copy & { language?: Language } => {
  const edition = catalogEdition(exp);
  return edition ? { ...edition.copy[language], language } : { title: exp.title, description: exp.description };
};
export const isFeaturedExperience = (exp: Source) => catalogEdition(exp)?.featured === true;
export const catalogOrder = (a: Source, b: Source) => Number(isFeaturedExperience(b)) - Number(isFeaturedExperience(a));

export const RESERVE_READING = {
  es: { language: 'Idioma de las descripciones', details: 'Ver detalles', request: 'Solicitar', book: 'Reservar', seat: 'Reservar plaza', full: 'Sin plazas', talk: 'Reserva tu plática', requestTalk: 'Solicita tu plática', featured: 'Plática en vivo 1:1' },
  en: { language: 'Description language', details: 'View details', request: 'Request', book: 'Book', seat: 'Book a seat', full: 'No seats available', talk: 'Book your conversation', requestTalk: 'Request your conversation', featured: 'Live 1:1 conversation' },
  pt: { language: 'Idioma das descrições', details: 'Ver detalhes', request: 'Solicitar', book: 'Reservar', seat: 'Reservar vaga', full: 'Sem vagas', talk: 'Reserve sua conversa', requestTalk: 'Solicite sua conversa', featured: 'Conversa ao vivo 1:1' },
  fr: { language: 'Langue des descriptions', details: 'Voir les détails', request: 'Demander', book: 'Réserver', seat: 'Réserver une place', full: 'Complet', talk: 'Réservez votre conversation', requestTalk: 'Demandez votre conversation', featured: 'Conversation en direct 1:1' },
  it: { language: 'Lingua delle descrizioni', details: 'Vedi i dettagli', request: 'Richiedi', book: 'Prenota', seat: 'Prenota un posto', full: 'Posti esauriti', talk: 'Prenota la tua conversazione', requestTalk: 'Richiedi la tua conversazione', featured: 'Conversazione in diretta 1:1' },
} satisfies Record<Language, Record<string, string>>;

// Type labels are separate from creator-authored titles. Operational ids stay stable.
const TYPE_NAMES: Record<string, Record<Language, string>> = {
  'video-call': { es: 'Videollamada 1:1', en: '1:1 video call', pt: 'Videochamada 1:1', fr: 'Appel vidéo 1:1', it: 'Videochiamata 1:1' },
  'live-1-1': { es: 'Plática en vivo 1:1', en: 'Live 1:1 conversation', pt: 'Conversa ao vivo 1:1', fr: 'Conversation en direct 1:1', it: 'Conversazione in diretta 1:1' },
  coaching: { es: 'Asesoría', en: 'Guidance', pt: 'Orientação', fr: 'Conseils', it: 'Consulenza' },
  'art-class': { es: 'Clase de arte', en: 'Art class', pt: 'Aula de arte', fr: 'Cours d’art', it: 'Lezione d’arte' },
  'cooking-class': { es: 'Clase de cocina', en: 'Cooking class', pt: 'Aula de culinária', fr: 'Cours de cuisine', it: 'Lezione di cucina' },
  'meet-greet': { es: 'Saludo y fotos', en: 'Say hello and take photos', pt: 'Cumprimentos e fotos', fr: 'Salutations et photos', it: 'Saluti e foto' },
  'fashion-beauty-talk': { es: 'Charla de moda y belleza', en: 'Fashion and beauty conversation', pt: 'Conversa sobre moda e beleza', fr: 'Discussion sur la mode et la beauté', it: 'Chiacchierata su moda e bellezza' },
  'training-1-1': { es: 'Entrenamiento 1:1', en: '1:1 training', pt: 'Treino 1:1', fr: 'Entraînement individuel', it: 'Allenamento 1:1' },
  'qa-session': { es: 'Preguntas y respuestas', en: 'Questions and answers', pt: 'Perguntas e respostas', fr: 'Questions et réponses', it: 'Domande e risposte' },
};
export const reserveTypeName = (type: string, language: Language, fallback: string) => TYPE_NAMES[type]?.[language] ?? fallback;
