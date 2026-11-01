// Creator recruitment ("Captar creadores" in the admin dashboard): the countries and
// goals of the pilot, the funnel math, how a list exported from Heepsy, Modash or a
// spreadsheet is read, the score, and the invitation messages.
// Data: public.creator_prospects in supabase/migrations/20261101000001_creator_prospects.sql.
import { COUNTRIES, countryName } from '../config/countries';

export type ProspectNetwork = 'instagram' | 'tiktok' | 'facebook' | 'youtube';
export type ProspectStatus = 'nuevo' | 'contactado' | 'respondio' | 'registrado' | 'verificado' | 'activo' | 'descartado' | 'no_contactar';
export type ProspectSource = 'heepsy' | 'modash' | 'tiktok_one' | 'meta_marketplace' | 'manual' | 'referido' | 'otro';
export type ProspectChannel = 'dm' | 'email';

export interface Prospect {
  id: string;
  network: ProspectNetwork;
  handle: string;
  country?: string;
  city?: string;
  displayName?: string;
  category?: string;
  followers?: number;
  posts?: number;
  engagement?: number; // % of followers who like or comment a post, on average
  lastPostAt?: string;
  email?: string;
  bio?: string;
  website?: string;
  source: ProspectSource;
  status: ProspectStatus;
  channel?: ProspectChannel;
  contactedAt?: string;
  repliedAt?: string;
  followUps: number;
  lastFollowUpAt?: string;
  notes?: string;
  score: number;
  enrichedAt?: string;
  enrichNote?: string;
  matchedProfileId?: string;
  createdAt: string;
}

// One row of an imported list, before it is saved.
export interface ProspectInput {
  network: ProspectNetwork;
  handle: string;
  country?: string;
  city?: string;
  display_name?: string;
  category?: string;
  followers?: number;
  posts?: number;
  engagement?: number;
  last_post_at?: string;
  email?: string;
  bio?: string;
  website?: string;
  enriched?: boolean;
  enrich_note?: string;
}

// The pilot: 10 countries, 500 sign-ups and at least 50 active creators each.
export const PILOT_COUNTRIES = ['HN', 'MX', 'CO', 'GT', 'SV', 'CR', 'PA', 'DO', 'PE', 'CL'] as const;
export const GOALS = { contacts: 8300, registered: 500, active: 50 };
// Expected rates (cold invitation by DM and email); the pilot replaces them with real ones.
export const RATES = { reply: 0.15, register: 0.06, verify: 0.6, active: 0.35 };
export const FOLLOW_UP_DAYS = 5;
export const CAMPAIGN_DAYS = 30; // working days, about 6 weeks

export const countryLabel = (code?: string) => (code ? countryName(code, 'es', code) : 'Sin país');

export const NETWORKS: Record<ProspectNetwork, { label: string; icon: string; url: (h: string) => string }> = {
  instagram: { label: 'Instagram', icon: 'fab fa-instagram', url: (h) => `https://www.instagram.com/${h}/` },
  tiktok: { label: 'TikTok', icon: 'fab fa-tiktok', url: (h) => `https://www.tiktok.com/@${h}` },
  facebook: { label: 'Facebook', icon: 'fab fa-facebook', url: (h) => `https://www.facebook.com/${h}` },
  youtube: { label: 'YouTube', icon: 'fab fa-youtube', url: (h) => `https://www.youtube.com/@${h}` },
};

export const SOURCES: Record<ProspectSource, string> = {
  heepsy: 'Heepsy', modash: 'Modash', tiktok_one: 'TikTok One', meta_marketplace: 'Meta Creator Marketplace',
  manual: 'Lista hecha a mano', referido: 'Recomendado por un creador', otro: 'Otro',
};

// Order of the funnel; "descartado" and "no_contactar" sit outside it.
export const STATUSES: Record<ProspectStatus, { label: string; tone: string; hint: string }> = {
  nuevo: { label: 'Por contactar', tone: 'bg-gray-100 text-gray-700', hint: 'Todavía no le escribimos' },
  contactado: { label: 'Contactado', tone: 'bg-sky-50 text-sky-800', hint: 'Le escribimos y esperamos respuesta' },
  respondio: { label: 'Respondió', tone: 'bg-violet-50 text-violet-800', hint: 'Contestó y le interesa saber más' },
  registrado: { label: 'Registrado', tone: 'bg-amber-50 text-amber-900', hint: 'Tiene cuenta en Fans Reserve' },
  verificado: { label: 'Verificado', tone: 'bg-emerald-50 text-emerald-800', hint: 'Creador con identidad verificada' },
  activo: { label: 'Activo', tone: 'bg-emerald-600 text-white', hint: 'Creador verificado con ventas en los últimos 90 días' },
  descartado: { label: 'Descartado', tone: 'bg-gray-50 text-gray-500 line-through', hint: 'No encaja con Fans Reserve' },
  no_contactar: { label: 'No contactar', tone: 'bg-red-50 text-red-700', hint: 'Pidió que no le escribamos; sus datos de contacto se borraron' },
};
export const FUNNEL: ProspectStatus[] = ['nuevo', 'contactado', 'respondio', 'registrado', 'verificado', 'activo'];
const rank = (s: ProspectStatus) => FUNNEL.indexOf(s);
// Statuses the app detects by itself (prospects_sync) and the team can't set by hand.
export const AUTOMATIC: ProspectStatus[] = ['registrado', 'verificado', 'activo'];

export interface CountryProgress {
  country: string;
  total: number;
  contacted: number; // everyone who got a message, whatever happened after
  replied: number;
  registered: number;
  verified: number;
  active: number;
  optedOut: number;
}

// Each count includes the stages after it: a creator who is active was also contacted.
export const countryProgress = (rows: { country: string; status: ProspectStatus; count: number }[]): CountryProgress[] => {
  const map = new Map<string, CountryProgress>();
  for (const r of rows) {
    const p = map.get(r.country) ?? { country: r.country, total: 0, contacted: 0, replied: 0, registered: 0, verified: 0, active: 0, optedOut: 0 };
    p.total += r.count;
    const at = rank(r.status);
    if (r.status === 'no_contactar') p.optedOut += r.count;
    if (at >= 1 || r.status === 'no_contactar') p.contacted += r.count;
    if (at >= 2) p.replied += r.count;
    if (at >= 3) p.registered += r.count;
    if (at >= 4) p.verified += r.count;
    if (at >= 5) p.active += r.count;
    map.set(r.country, p);
  }
  return [...map.values()];
};

export const emptyProgress = (country: string): CountryProgress => ({ country, total: 0, contacted: 0, replied: 0, registered: 0, verified: 0, active: 0, optedOut: 0 });

export const sumProgress = (list: CountryProgress[], country = 'ALL'): CountryProgress =>
  list.reduce((a, p) => ({
    country, total: a.total + p.total, contacted: a.contacted + p.contacted, replied: a.replied + p.replied, registered: a.registered + p.registered,
    verified: a.verified + p.verified, active: a.active + p.active, optedOut: a.optedOut + p.optedOut,
  }), emptyProgress(country));

// Real rates once there is enough to measure (30+ contacted), the expected ones before.
export const measuredRates = (p: CountryProgress) => {
  const enough = p.contacted >= 30;
  return {
    measured: enough,
    register: enough ? p.registered / p.contacted : RATES.register,
    active: enough && p.registered >= 10 ? p.active / Math.max(1, p.registered) : RATES.verify * RATES.active,
  };
};

// How many people still need a first message to reach the sign-up goal at the current rate.
export const contactsNeeded = (p: CountryProgress, goals = GOALS) => {
  const { register } = measuredRates(p);
  const missing = Math.max(0, goals.registered - p.registered);
  return register > 0 ? Math.ceil(missing / register) : goals.contacts;
};

export const dailyPace = (p: CountryProgress, days = CAMPAIGN_DAYS) => Math.ceil(contactsNeeded(p) / Math.max(1, days));

// Same weights as public.prospect_score() in the migration.
export const prospectScore = (p: Pick<Prospect, 'followers' | 'engagement' | 'lastPostAt' | 'email' | 'enrichedAt'>) => {
  const f = p.followers;
  const followers = f == null ? 15 : f >= 10000 && f <= 150000 ? 40 : f >= 3000 && f < 10000 ? 25 : f > 150000 && f <= 500000 ? 20 : 5;
  const e = p.engagement;
  const engagement = e == null ? 10 : e >= 6 ? 30 : e >= 3 ? 22 : e >= 1.5 ? 14 : 5;
  const at = p.enrichedAt ? new Date(p.enrichedAt).getTime() : Date.now();
  const days = p.lastPostAt ? (at - new Date(p.lastPostAt).getTime()) / 86400000 : undefined;
  const recent = days === undefined ? 8 : days <= 14 ? 20 : days <= 45 ? 12 : 0;
  return followers + engagement + recent + (p.email ? 10 : 0);
};

export const scoreTone = (score: number) => (score >= 75 ? 'bg-emerald-600 text-white' : score >= 55 ? 'bg-emerald-100 text-emerald-900' : score >= 35 ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-600');

// Why the score is what it is, in a few words for the card.
export const scoreReasons = (p: Prospect) => {
  const out: string[] = [];
  const f = p.followers;
  if (f != null) out.push(f >= 10000 && f <= 150000 ? 'Tamaño ideal' : f < 3000 ? 'Muy pequeño' : f > 500000 ? 'Muy grande, responde poco' : f < 10000 ? 'Pequeño' : 'Grande');
  if (p.engagement != null) out.push(p.engagement >= 3 ? 'Su público participa' : p.engagement < 1.5 ? 'Poca interacción' : 'Interacción normal');
  if (p.lastPostAt) {
    const days = ((p.enrichedAt ? new Date(p.enrichedAt).getTime() : Date.now()) - new Date(p.lastPostAt).getTime()) / 86400000;
    out.push(days <= 14 ? 'Publica seguido' : days > 45 ? 'Lleva tiempo sin publicar' : 'Publica a veces');
  }
  if (p.email) out.push('Correo público');
  return out;
};

export const followUpDue = (p: Prospect, now = Date.now()) =>
  p.status === 'contactado' && p.followUps === 0 && !!p.contactedAt && now - new Date(p.contactedAt).getTime() >= FOLLOW_UP_DAYS * 86400000;

export const compact = (n?: number) =>
  n == null ? '—' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace('.0', '')} M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace('.0', '')} mil` : String(n);

/* ---------- Reading a list ---------- */

const HANDLE = /^[a-z0-9._-]{1,50}$/;

// "@Ana.Fit", "ana.fit" or the profile's address → { network?, handle }.
export const parseHandle = (input: string): { network?: ProspectNetwork; handle?: string } => {
  let value = input.trim();
  let network: ProspectNetwork | undefined;
  const url = value.match(/^(?:https?:\/\/)?(?:www\.|m\.)?(instagram|tiktok|facebook|youtube)\.com\/(.*)$/i);
  if (url) {
    network = url[1].toLowerCase() as ProspectNetwork;
    value = url[2].split(/[/?#]/)[0];
  }
  value = value.replace(/^@/, '').toLowerCase();
  return HANDLE.test(value) ? { network, handle: value } : { network };
};

// "25.3K", "1,2 M", "25,000", "4.5%" → number.
export const parseAmount = (input: string): number | undefined => {
  let v = input.trim().toLowerCase().replace(/\s|%/g, '');
  if (!v) return undefined;
  const mult = /m$/.test(v) ? 1_000_000 : /(k|mil)$/.test(v) ? 1000 : 1;
  v = v.replace(/(k|mil|m)$/, '');
  if (mult > 1) v = v.replace(',', '.');
  else if (/^[1-9]\d{0,2}([.,]\d{3})+$/.test(v)) v = v.replace(/[.,]/g, '');
  else v = v.replace(',', '.');
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * mult * 10000) / 10000 : undefined;
};

const plain = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// "Honduras", "México", "Mexico", "mx" → ISO code; undefined if unknown.
const countryIndex = (() => {
  let index: Map<string, string> | undefined;
  return () => {
    if (index) return index;
    index = new Map();
    for (const { code } of COUNTRIES) {
      index.set(code.toLowerCase(), code);
      for (const lang of ['es', 'en']) {
        const name = countryName(code, lang, '');
        if (name) index.set(plain(name), code);
      }
    }
    index.set('republica dominicana', 'DO').set('dominican republic', 'DO').set('usa', 'US').set('estados unidos', 'US');
    return index;
  };
})();
export const parseCountry = (input?: string) => (input ? countryIndex().get(plain(input)) : undefined);

export const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
export const emailIn = (text?: string) => text?.match(EMAIL)?.[0]?.toLowerCase();

// Splits CSV or tab-separated text (Excel, Google Sheets, Heepsy and Modash exports).
export const parseTable = (text: string): string[][] => {
  const clean = text.replace(/^﻿/, '');
  const first = clean.split(/\r?\n/, 1)[0] ?? '';
  const sep = (first.match(/\t/g)?.length ?? 0) > 0 ? '\t' : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
};

// Column names seen in Heepsy, Modash, TikTok One and our own template.
const COLUMNS: Record<keyof ProspectInput | 'url', string[]> = {
  network: ['red', 'network', 'platform', 'plataforma', 'social network', 'red social'],
  handle: ['usuario', 'username', 'handle', 'user', 'account', 'cuenta', 'instagram', 'tiktok', 'nombre de usuario', 'user name'],
  url: ['url', 'url_perfil', 'profile url', 'profile link', 'link', 'perfil', 'enlace', 'profile'],
  country: ['pais', 'country', 'location country', 'ubicacion', 'location'],
  city: ['ciudad', 'city'],
  display_name: ['nombre_publico', 'nombre', 'name', 'full name', 'fullname', 'display name', 'nombre completo'],
  category: ['categoria', 'category', 'categories', 'niche', 'nicho', 'topics'],
  followers: ['seguidores', 'followers', 'followers count', 'audience', 'fans'],
  posts: ['posts', 'publicaciones', 'media count'],
  engagement: ['engagement', 'engagement rate', 'er', 'tasa de interaccion', 'interaccion', 'engagement_rate'],
  last_post_at: ['ultimo post', 'last post', 'last post date'],
  email: ['email', 'correo', 'e-mail', 'contacto_publico_bio', 'contact email', 'mail', 'emails'],
  bio: ['bio', 'biography', 'biografia', 'description', 'descripcion'],
  website: ['web', 'website', 'sitio web'],
  enriched: [], enrich_note: [],
};

export interface ParsedList {
  rows: ProspectInput[];
  invalid: number; // lines without a usable handle or network
  duplicates: number; // repeated inside the same file
  columns: string[]; // which of our fields were recognised
}

export const parseProspectList = (text: string, defaults: { network: ProspectNetwork; country?: string }): ParsedList => {
  const table = parseTable(text);
  if (!table.length) return { rows: [], invalid: 0, duplicates: 0, columns: [] };
  const header = table[0].map(plain);
  const find = (key: keyof typeof COLUMNS) => header.findIndex((h) => COLUMNS[key].includes(h));
  let idx = Object.fromEntries((Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).map((k) => [k, find(k)])) as Record<keyof typeof COLUMNS, number>;
  let body = table.slice(1);
  // A pasted column of handles without a header.
  if (idx.handle < 0 && idx.url < 0) {
    if (table.every((r) => r.length === 1)) { idx = { ...idx, handle: 0 }; body = table; }
    else return { rows: [], invalid: table.length - 1, duplicates: 0, columns: [] };
  }
  const seen = new Set<string>();
  const rows: ProspectInput[] = [];
  let invalid = 0;
  let duplicates = 0;
  const get = (r: string[], k: keyof typeof COLUMNS) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '');
  for (const r of body) {
    const fromUrl = parseHandle(get(r, 'url'));
    const fromHandle = parseHandle(get(r, 'handle'));
    const handle = fromHandle.handle ?? fromUrl.handle;
    const named = plain(get(r, 'network'));
    const network = (Object.keys(NETWORKS) as ProspectNetwork[]).find((n) => named.includes(n)) ?? fromHandle.network ?? fromUrl.network ?? defaults.network;
    if (!handle) { invalid++; continue; }
    const key = `${network}:${handle}`;
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    const bio = get(r, 'bio') || undefined;
    const followers = parseAmount(get(r, 'followers'));
    let engagement = parseAmount(get(r, 'engagement'));
    // Some exports write 0.045 for 4.5 %.
    if (engagement !== undefined && engagement > 0 && engagement < 0.3 && !get(r, 'engagement').includes('%')) engagement = Math.round(engagement * 10000) / 100;
    if (engagement !== undefined) engagement = Math.round(engagement * 100) / 100;
    const lastPost = get(r, 'last_post_at');
    rows.push({
      network, handle,
      country: parseCountry(get(r, 'country')) ?? defaults.country,
      city: get(r, 'city') || undefined,
      display_name: get(r, 'display_name') || undefined,
      category: get(r, 'category') || undefined,
      followers: followers === undefined ? undefined : Math.round(followers),
      posts: parseAmount(get(r, 'posts')),
      engagement,
      last_post_at: /^\d{4}-\d{2}-\d{2}/.test(lastPost) ? lastPost : undefined,
      email: emailIn(get(r, 'email')) ?? emailIn(bio),
      bio, website: get(r, 'website') || undefined,
    });
  }
  const columns = (Object.keys(idx) as (keyof typeof COLUMNS)[]).filter((k) => idx[k] >= 0);
  return { rows, invalid, duplicates, columns };
};

export const TEMPLATE_HEADER = 'pais,ciudad,nombre_publico,red,usuario,url_perfil,seguidores,categoria,email,engagement,notas';

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const prospectsCsv = (list: Prospect[]) =>
  ['pais,red,usuario,url_perfil,nombre_publico,categoria,seguidores,engagement,puntaje,email,estado,canal,contactado,seguimientos,notas',
    ...list.map((p) => [p.country, p.network, p.handle, NETWORKS[p.network].url(p.handle), p.displayName, p.category, p.followers, p.engagement,
      p.score, p.email, STATUSES[p.status].label, p.channel, p.contactedAt?.slice(0, 10), p.followUps, p.notes].map(csvCell).join(','))].join('\n');

/* ---------- Messages ---------- */

export interface Templates { dm: string; emailSubject: string; email: string; followUp: string }

export const DEFAULT_TEMPLATES: Templates = {
  dm: 'Hola {nombre} 👋 Me encanta tu contenido de {categoria}. Soy Carlos, de Fans Reserve: una plataforma nueva donde tus seguidores reservan videollamadas 1:1, Meet & Greet y eventos contigo, pagan seguro y tú cobras por PayPal.\n\nVamos a lanzar en {pais} y te queremos invitar a participar en el lanzamiento. Los creadores que alcancen ciertas metas en sus primeros 90 días se convierten en Creadores Fundadores, con mejores ganancias y beneficios.\n\n¿Te cuento más? Si no te interesa, dímelo y no te escribo de nuevo.',
  emailSubject: '{nombre}, te invitamos al lanzamiento de Fans Reserve en {pais}',
  email: 'Hola {nombre}:\n\nVi tu cuenta @{usuario} y me gustó mucho tu contenido de {categoria}. Soy Carlos, de Fans Reserve, una plataforma nueva donde los seguidores reservan experiencias con sus creadores favoritos: videollamadas 1:1, Meet & Greet y eventos. El pago es seguro y el creador cobra por PayPal.\n\nEstamos preparando el lanzamiento en {pais} y queremos invitarte a participar. Quienes alcancen ciertas metas en sus primeros 90 días se convierten en Creadores Fundadores, con mejores ganancias, una insignia en su perfil y prioridad en Explorar.\n\nSi te interesa, responde este correo y te cuento los detalles.\n\nUn saludo,\nCarlos · Fans Reserve\n\nSi prefieres que no te escribamos más, responde "no" y te sacamos de la lista.',
  followUp: 'Hola {nombre}, te escribo de nuevo por si se perdió mi mensaje 🙂 Seguimos armando el grupo de creadores para el lanzamiento de Fans Reserve en {pais}. ¿Te interesa que te cuente cómo funciona? Si no, todo bien y no te escribo más.',
};

export const fillTemplate = (template: string, p: Prospect) => {
  const first = (p.displayName ?? '').trim().split(/\s+/)[0];
  const name = first && first.length > 1 && !/^[@\d]/.test(first) ? first : `@${p.handle}`;
  const category = p.category?.trim().toLowerCase();
  // Without a category, "tu contenido de {categoria}" reads "tu contenido".
  return (category ? template : template.replace(/ (de|sobre|con) \{categoria\}/g, ''))
    .replace(/{nombre}/g, name)
    .replace(/{usuario}/g, p.handle)
    .replace(/{pais}/g, p.country ? countryLabel(p.country) : 'tu país')
    .replace(/{categoria}/g, category || 'tu contenido');
};

// An email batch for a sending tool (Instantly, Smartlead): one row per creator with
// the subject and message already written for them. In the tool's sequence the
// subject is {{subject}} and the message is {{body}}.
export const emailBatchCsv = (list: Prospect[], t: Templates, followUp = false) =>
  ['email,first_name,username,network,country,category,subject,body',
    ...list.filter((p) => p.email).map((p) => {
      const first = fillTemplate('{nombre}', p).replace(/^@.*/, '');
      const subject = followUp ? `Re: ${fillTemplate(t.emailSubject, p)}` : fillTemplate(t.emailSubject, p);
      return [p.email, first, p.handle, p.network, p.country ? countryLabel(p.country) : '', p.category ?? '', subject, fillTemplate(followUp ? t.followUp : t.email, p)]
        .map(csvCell).join(',');
    })].join('\n');
