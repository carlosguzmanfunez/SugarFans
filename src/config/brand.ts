// Single source of truth for the platform identity. UI copy, metadata
// (index.html is filled from here at build time, see vite.config.js), emails
// and storage keys read these values instead of repeating the name.

const domain = 'fansreserve.com';

export const BRAND = {
  name: 'Fans Reserve',
  compactName: 'FansReserve',
  domain,
  url: `https://${domain}`,
  // Public title: "Fans Reserve — <tagline>".
  tagline: 'Conecta con tus creadores más allá del feed',
  description:
    'Fans Reserve es el espacio donde creadores y sus verdaderos fans se conectan más allá del feed: membresías, contenido exclusivo, experiencias VIP y sesiones en vivo.',
  themeColor: '#160d1f',
  backgroundColor: '#faf7f5',
  // Social preview (1200x630) and app icons, rendered from design/brand/ by
  // scripts/brand-assets.mjs.
  ogImage: '/og-fans-reserve.jpg',
  ogImageAlt: 'Fans Reserve: tu acceso reservado a quienes te inspiran',
  emails: {
    support: `support@${domain}`,
    privacy: `privacy@${domain}`,
    legal: `legal@${domain}`,
    dmca: `dmca@${domain}`,
    safety: `safety@${domain}`,
    minors: `minors@${domain}`,
  },
  // Prefix for every key the app keeps in localStorage / sessionStorage.
  storagePrefix: 'fansreserve_',
} as const;

// Name the previous identity used. Only needed to carry browser data over
// (see legacyStorage.ts) and to relabel rows the database already wrote.
export const LEGACY_NAME = 'SugarFans';
export const LEGACY_STORAGE_PREFIX = 'sugarfans_';

// Platform-paid rows (creator-invite bonuses) carry the payer name the database
// trigger wrote; show them under the current brand.
export const displayPayer = (name: string) => (name === LEGACY_NAME ? BRAND.name : name);
