// Presentation of the gift catalogue and the currency packs.
//
// INTERNAL vs DISPLAY. Gift ids, pack ids, prices and categories are the keys the
// database stores (gift_catalog, coin_packs, transactions.gift_id) and are never
// renamed. The names seeded in the database come from the previous brand
// (Algodón de azúcar, Corona de azúcar, Castillo de azúcar...). The UI never shows
// those: it reads the names and artwork below, keyed by id. Gift transactions
// written before this layer carry the old name in their note; displayGiftNote()
// relabels it.

export interface GiftDisplay {
  name: string;
  art: string; // file in public/gifts (without .png)
  emoji: string; // fallback when the artwork can't load
  legacyName: string; // name stored in the database (gift_catalog.name)
  formerNames?: string[]; // earlier display names, still present in old notes
}

// Fans Reserve collection (Identity V1): reactions first, then celebration,
// specials, prestige and "legend" gifts. Artwork: Microsoft Fluent Emoji 3D (MIT).
export const GIFT_DISPLAY: Record<string, GiftDisplay> = {
  caramelo: { name: 'Chispa', art: 'chispa', emoji: '✨', legacyName: 'Caramelo' },
  chicle: { name: 'Aplauso', art: 'aplauso', emoji: '👏', legacyName: 'Chicle rosa' },
  piruleta: { name: 'Café', art: 'cafe', emoji: '☕', legacyName: 'Piruleta' },
  gomita: { name: 'Abrazo', art: 'gomita', emoji: '🧸', legacyName: 'Gomita osito', formerNames: ['Osito'] },
  algodon: { name: 'Estrella', art: 'estrella', emoji: '🌟', legacyName: 'Algodón de azúcar' },
  bombon: { name: 'Fuego', art: 'fuego', emoji: '🔥', legacyName: 'Bombón' },
  cupcake: { name: 'Micrófono', art: 'microfono', emoji: '🎤', legacyName: 'Cupcake' },
  donut: { name: 'Estreno', art: 'palomitas', emoji: '🍿', legacyName: 'Donut glaseado', formerNames: ['Palomitas'] },
  macaron: { name: 'Rayo', art: 'rayo', emoji: '⚡', legacyName: 'Macaron' },
  helado: { name: 'Trofeo', art: 'trofeo', emoji: '🏆', legacyName: 'Helado de fresa' },
  churros: { name: 'Cohete', art: 'cohete', emoji: '🚀', legacyName: 'Churros con chocolate' },
  manzana: { name: 'Confeti', art: 'confeti', emoji: '🎉', legacyName: 'Manzana de caramelo' },
  tarta: { name: 'Pase VIP', art: 'entrada', emoji: '🎟️', legacyName: 'Tarta de fresas' },
  bombones: { name: 'Sorpresa', art: 'bombones', emoji: '🎁', legacyName: 'Caja de bombones', formerNames: ['Regalo sorpresa'] },
  rosas: { name: 'Rosas', art: 'rosas', emoji: '💐', legacyName: 'Ramo de rosas' },
  champan: { name: 'Brindis', art: 'champan', emoji: '🥂', legacyName: 'Copa de champán' },
  perfume: { name: 'Flor de Cerezo', art: 'perfume', emoji: '🌸', legacyName: 'Perfume', formerNames: ['Flor de cerezo'] },
  corazon: { name: 'Corazón de Cristal', art: 'corazon', emoji: '💖', legacyName: 'Corazón de cristal' },
  perlas: { name: 'Medalla de Oro', art: 'medalla', emoji: '🥇', legacyName: 'Collar de perlas', formerNames: ['Medalla de oro'] },
  tacones: { name: 'Diamante', art: 'diamante', emoji: '💎', legacyName: 'Tacones de diamante' },
  corona: { name: 'Corona', art: 'corona', emoji: '👑', legacyName: 'Corona de azúcar' },
  limusina: { name: 'Limusina', art: 'limusina', emoji: '🚘', legacyName: 'Limusina rosa' },
  yate: { name: 'Yate', art: 'yate', emoji: '🛥️', legacyName: 'Yate de caramelo' },
  jet: { name: 'Jet Privado', art: 'jet', emoji: '✈️', legacyName: 'Jet privado' },
  castillo: { name: 'Castillo', art: 'castillo', emoji: '🏰', legacyName: 'Castillo de azúcar' },
};

// Internal category keys (gift_catalog.category) and how they read.
export const GIFT_CATEGORY_DISPLAY: Record<string, string> = {
  Dulces: 'Reacciones',
  Repostería: 'Celebración',
  Romance: 'Especiales',
  Lujo: 'Prestige',
  Fantasía: 'Leyenda',
};

// Currency packs: internal ids/names (coin_packs) -> display names.
export const COIN_PACK_DISPLAY: Record<string, string> = {
  bolsita: 'Inicial',
  frasco: 'Básico',
  caja: 'Plus',
  saco: 'Pro',
  barril: 'Élite',
  cofre: 'Premium',
  boveda: 'Reserva',
  tesoro: 'Leyenda',
};

export const giftDisplayName = (id: string, fallback = 'Regalo') => GIFT_DISPLAY[id]?.name ?? fallback;
export const giftArt = (id: string) => GIFT_DISPLAY[id]?.art ?? id;
export const giftCategoryLabel = (category: string) => GIFT_CATEGORY_DISPLAY[category] ?? category;
export const coinPackName = (id: string, fallback = 'Paquete') => COIN_PACK_DISPLAY[id] ?? fallback;

// Notes on gift transactions start with the gift name ("Corona de azúcar · “msg”").
// Show the current name whatever name was stored.
export const displayGiftNote = (note: string | undefined, giftId?: string) => {
  if (!note) return '';
  // Without an id, recognise the note by any name a gift ever had.
  const candidates = giftId && GIFT_DISPLAY[giftId] ? [GIFT_DISPLAY[giftId]] : Object.values(GIFT_DISPLAY);
  for (const d of candidates) {
    // Longest first so "Corazón de cristal" wins over a shorter prefix.
    const olds = [d.legacyName, ...(d.formerNames ?? []), d.name].sort((a, b) => b.length - a.length);
    for (const old of olds) {
      if (note === old) return d.name;
      if (note.startsWith(`${old} · `)) return d.name + note.slice(old.length);
    }
  }
  return note;
};
