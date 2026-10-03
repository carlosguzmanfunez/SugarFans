// Reserve moderation, first layer: rules that catch requests and experiences
// that are plainly incompatible with the policies (sexual services, escort or
// compensated dating, private locations, taking the deal off the platform).
//
// Not single-word censorship: rules match phrases and context ("habitación de
// hotel", "pasar la noche"), and ambiguous mentions ("hotel", "sexo" alone)
// are only flagged for review, never blocked. Every result carries rule ids so
// the same flags can later feed manual review, reports or an AI classifier.
// The server repeats the blocking phrases (reserve_text_blocked in
// supabase/migrations/20261002000001_reserve.sql).
//
// LEGAL: the rule set is a product draft. Requires legal review before production launch.

export type ModerationSeverity = 'block' | 'review';

export type ModerationContext = 'experience' | 'request';

export interface ModerationRule {
  id: string;
  severity: ModerationSeverity;
  // Where the rule applies (both when omitted). "En tu casa" is a red flag in a
  // fan's request, but a normal phrase in a virtual cooking class description.
  contexts?: ModerationContext[];
  // Shown to the person who wrote the text.
  message: string;
  test: (text: string) => boolean;
}

export interface ModerationFlag {
  rule: string;
  severity: ModerationSeverity;
  message: string;
}

export interface ModerationResult {
  ok: boolean; // nothing blocking
  flags: ModerationFlag[];
  // First blocking message, ready to show.
  error?: string;
}

// Negated mentions ("sin contenido sexual", "nada de encuentros privados") state a
// rule, not a request: the negation and the next words are left out of the check.
export const stripNegations = (text: string) =>
  text.replace(/\b(sin|no|nunca|cero|nada de|prohibid[oa]s?|no se permiten?)\s+(?:\S+\s+){0,2}\S+/g, ' ');

// Lowercase, no accents, common obfuscations undone ("s.e.x.o", "s e x o", "3sc0rt").
export const normalizeText = (raw: string): string => {
  let s = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Letters spelled out with separators: "s.e.x.o" / "e s c o r t" → "sexo" / "escort".
  s = s.replace(/\b(?:[a-z0-9][\s.\-_*]){2,}[a-z0-9]\b/g, (m) => m.replace(/[\s.\-_*]/g, ''));
  const leet: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };
  s = s.replace(/[a-z][013457@$]+[a-z]?/g, (m) => m.replace(/[013457@$]/g, (c) => leet[c]));
  return s.replace(/[^a-z0-9ñ+]+/g, ' ').replace(/\s+/g, ' ').trim();
};

const any = (...patterns: RegExp[]) => (text: string) => patterns.some((p) => p.test(text));

export const MODERATION_RULES: ModerationRule[] = [
  {
    id: 'sexual-services',
    severity: 'block',
    message: 'Fans Reserve no permite servicios ni actividad sexual, virtual o presencial.',
    test: any(
      /\bservicios? (sexual|sexuales|intimos?|eroticos?)\b/,
      /\b(actos?|actividad|relaciones|encuentros?) (sexual|sexuales|intimos?)\b/,
      /\bsexo (virtual|en vivo|por (video|camara|dinero|regalos|creditos))\b/,
      /\b(sexting|cibersexo|camsex|happy ending|final feliz|masaje erotico|erotic massage)\b/,
      /\b(desnud[oa]s?|sin ropa|nudes?|porno\w*|xxx)\b/,
      /\bshow (sexual|erotico|privado para adultos)\b/,
    ),
  },
  {
    id: 'escort-dating',
    severity: 'block',
    message: 'Reserve no es para citas, acompañamiento ni escort. Elige una experiencia con un propósito concreto.',
    test: any(
      /\b(escort|escorts|scort|prostitu\w*|putas?|acompanante (de pago|vip|intim\w*|para (la noche|cenar|salir)))\b/,
      /\b(sugar (daddy|baby|dating)|compensated dating|girlfriend experience|boyfriend experience|gfe|novi[oa] de alquiler)\b/,
      /\b(cita (romantica|pagada|a ciegas|intima)|citas pagadas|pagar (por|para) (una )?cita|tener una cita|una cita contigo|salir (conmigo|contigo) a cenar|dating|romantic date|date with)\b/,
      /\b(encuentro (privado|intimo|a solas|discreto)|encuentros privados|pagar para conocer(te|la|lo)?|pasar (la|una) noche|toda la noche (juntos|conmigo|contigo)|dormir (juntos|conmigo|contigo))\b/,
      /\bpasar tiempo (conmigo|contigo|juntos)\b/,
      /\b(seas|ser|sea) mi (novi[oa]|pareja|acompanante|amante)\b/,
      /\bnovi[oa] por (un|una) (dia|noche|hora|cita|fin de semana)\b/,
    ),
  },
  {
    id: 'hotel-room',
    severity: 'block',
    message: 'Las experiencias presenciales se hacen en venues, estudios o lugares públicos, nunca en hoteles o habitaciones.',
    test: any(
      /\b(habitacion|cuarto|suite) (de|del|en el|en un|de un) (hotel|motel|airbnb)\b/,
      /\b(motel|puerta cerrada)\b/,
      /\b(lugar|sitio|espacio) (privado|discreto|intimo)\b/,
      /\bhotel\b.*\b(noche|habitacion|cuarto|a solas|privado)\b/,
    ),
  },
  {
    id: 'private-location',
    severity: 'block',
    contexts: ['request'],
    message: 'Las experiencias presenciales se hacen en venues, estudios o lugares públicos, nunca en casas ni domicilios.',
    test: any(/\b(mi|tu|su) (casa|depa|departamento|apartamento|piso|cuarto|habitacion|recamara|cama)\b/, /\ba domicilio\b/),
  },
  {
    id: 'off-platform',
    severity: 'block',
    message: 'Mantén la conversación y los pagos dentro de Fans Reserve: no compartas teléfonos, correos ni pagos por fuera.',
    test: (text) =>
      /\b(whatsapp|whats app|wsp|telegram|signal|snapchat|kik|onlyfans|zelle|cashapp|cash app|venmo|bizum)\b/.test(text) ||
      /\b(pago|pagar|pagame|pagarte|te pago) (por fuera|en efectivo|en cash|directo|aparte)\b/.test(text) ||
      /\bfuera de (la app|la plataforma|fans reserve)\b/.test(text),
  },
  {
    id: 'contact-details',
    severity: 'block',
    message: 'No compartas teléfonos ni correos: la comunicación se queda en Fans Reserve.',
    // Checked on the raw text (normalization removes the @).
    test: () => false,
  },
  {
    id: 'minors',
    severity: 'review',
    message: 'Fans Reserve es solo para mayores de 18. El creator revisará esta mención.',
    test: any(/\b(menor(es)? de edad|underage|ninos?|ninas?|adolescentes?|\b1[0-7] anos)\b/),
  },
  {
    id: 'ambiguous-sexual',
    severity: 'review',
    message: 'Revisa el texto: menciona algo que podría no estar permitido.',
    test: any(/\b(sexo|sexual|sensual|erotic\w*|lenceria|intimidad|a solas)\b/),
  },
  {
    id: 'ambiguous-place',
    severity: 'review',
    message: 'Indica un venue concreto: los hoteles solo valen como sede de un evento.',
    test: any(/\bhotel\b/),
  },
];

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
// Phone numbers: 9+ digits in one run of digits, spaces, dots, dashes or brackets
// (dates and prices have fewer).
const hasPhone = (raw: string) => (raw.match(/\+?\d[\d\s().-]{7,}\d/g) ?? []).some((m) => m.replace(/\D/g, '').length >= 9);

// Checks one or more texts. `context` lets later layers weigh the same flag
// differently (an experience description vs. a fan's request).
// homeAllowed: the creator offers home services (every category but Modelos). Free text
// like "en mi casa" stays blocked everywhere (the server repeats it); the
// address type is chosen as "Lugar que propone el fan", so the message says that.
const HOME_HINT = 'Para un servicio a domicilio elige "Lugar que propone el fan" como lugar y escribe la dirección o la zona sin frases como "mi casa"; solo la ve el creator de esta reserva.';

export const moderate = (
  texts: string | Array<string | undefined | null>,
  context: ModerationContext = 'request',
  opts: { homeAllowed?: boolean } = {},
): ModerationResult => {
  const list = (Array.isArray(texts) ? texts : [texts]).filter((x): x is string => !!x && !!x.trim());
  const raw = list.join(' \n ');
  const text = stripNegations(normalizeText(raw));
  const flags: ModerationFlag[] = [];
  for (const rule of MODERATION_RULES) {
    if (rule.contexts && !rule.contexts.includes(context)) continue;
    const hit = rule.id === 'contact-details' ? EMAIL.test(raw) || hasPhone(raw) : rule.test(text);
    if (hit) flags.push({ rule: rule.id, severity: rule.severity, message: rule.id === 'private-location' && opts.homeAllowed ? HOME_HINT : rule.message });
  }
  // A blocking rule already explains the problem; drop the softer duplicates.
  const blocked = flags.filter((f) => f.severity === 'block');
  const final = blocked.length ? flags.filter((f) => f.severity === 'block' || f.rule === 'minors') : flags;
  return { ok: blocked.length === 0, flags: final, error: blocked[0]?.message };
};

export const reviewFlags = (r: ModerationResult) => r.flags.filter((f) => f.severity === 'review').map((f) => f.rule);
