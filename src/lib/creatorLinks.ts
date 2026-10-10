// A creator's own @usuario (their link fansreserve.com/@usuario) and the social
// networks they link from their profile. Only handles are stored, never free URLs:
// the profile builds each link itself, so nobody can point fans somewhere else.

export type SocialKey = 'instagram' | 'tiktok' | 'youtube' | 'x' | 'facebook' | 'twitch';
export type SocialLinks = Partial<Record<SocialKey, string>>;

export const SOCIALS: { key: SocialKey; label: string; icon: string; host: RegExp; url: (handle: string) => string }[] = [
  { key: 'instagram', label: 'Instagram', icon: 'fab fa-instagram', host: /(^|\.)instagram\.com$/, url: (h) => `https://www.instagram.com/${h}` },
  { key: 'tiktok', label: 'TikTok', icon: 'fab fa-tiktok', host: /(^|\.)tiktok\.com$/, url: (h) => `https://www.tiktok.com/@${h}` },
  { key: 'youtube', label: 'YouTube', icon: 'fab fa-youtube', host: /(^|\.)youtube\.com$/, url: (h) => `https://www.youtube.com/@${h}` },
  { key: 'x', label: 'X (Twitter)', icon: 'fab fa-twitter', host: /(^|\.)(x|twitter)\.com$/, url: (h) => `https://x.com/${h}` },
  { key: 'facebook', label: 'Facebook', icon: 'fab fa-facebook', host: /(^|\.)facebook\.com$/, url: (h) => `https://www.facebook.com/${h}` },
  { key: 'twitch', label: 'Twitch', icon: 'fab fa-twitch', host: /(^|\.)twitch\.tv$/, url: (h) => `https://www.twitch.tv/${h}` },
];

const HANDLE = /^[A-Za-z0-9._-]{1,50}$/;

// "@ana", "ana" or the profile's address on that network → "ana". '' clears it.
export const parseSocial = (key: SocialKey, input: string): { handle?: string; error?: string } => {
  const social = SOCIALS.find((s) => s.key === key)!;
  let value = input.trim();
  if (!value) return { handle: '' };
  if (/^(https?:\/\/|www\.)/i.test(value) || /\.(com|tv)\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
      return { error: `Revisa tu enlace de ${social.label}` };
    }
    if (!social.host.test(url.hostname.toLowerCase())) return { error: `Ese enlace no es de ${social.label}` };
    value = url.pathname.split('/').filter(Boolean)[0] ?? '';
  }
  value = value.replace(/^@/, '');
  if (!HANDLE.test(value)) return { error: `Revisa tu usuario de ${social.label}` };
  return { handle: value };
};

// Only known networks with valid handles survive (also used on data read back).
export const cleanSocials = (links: unknown): SocialLinks => {
  const out: SocialLinks = {};
  if (!links || typeof links !== 'object') return out;
  for (const s of SOCIALS) {
    const v = (links as Record<string, unknown>)[s.key];
    if (typeof v === 'string' && HANDLE.test(v)) out[s.key] = v;
  }
  return out;
};

export const socialLinkList = (links?: SocialLinks) =>
  SOCIALS.filter((s) => links?.[s.key]).map((s) => ({ ...s, handle: links![s.key]!, href: s.url(encodeURIComponent(links![s.key]!)) }));

// @usuario: 3-30 lowercase letters, numbers or "_", unique across Fans Reserve.
export const USERNAME = /^[a-z0-9_]{3,30}$/;
const RESERVED = new Set([
  'admin', 'administrador', 'soporte', 'support', 'ayuda', 'help', 'fansreserve', 'fans_reserve', 'reserve', 'oficial', 'official',
  'legal', 'explore', 'explorar', 'login', 'register', 'settings', 'creator', 'creador', 'creadores', 'staff', 'moderador', 'root',
]);

export const normalizeUsername = (input: string) => input.trim().replace(/^@/, '').toLowerCase();

export const usernameError = (username: string): string | null => {
  if (!USERNAME.test(username)) return 'Tu @usuario debe tener de 3 a 30 letras, números o "_" (sin espacios ni acentos)';
  if (RESERVED.has(username)) return 'Ese @usuario está reservado. Prueba con otro';
  return null;
};

// "Ana López" → "ana_lopez" (a starting point; the creator can change it).
export const usernameFrom = (name: string) => {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return base.length >= 3 ? base : `${base || 'creador'}_fr`.slice(0, 24);
};

// The creator's own link: opens their profile and counts the visitor as theirs.
export const profileLink = (username: string) => `${window.location.origin}/@${username}`;
