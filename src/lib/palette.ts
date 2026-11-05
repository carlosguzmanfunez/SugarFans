import { BRAND } from '../config/brand';
import type { Gender } from './backend';

// Colour palette of the app. Men ('male') get the blue gradient; women,
// "prefiero no decirlo", no answer and visitors keep the pink one. The CSS lives
// in src/index.css (:root[data-palette="blue"]).
export type Palette = 'pink' | 'blue';

const KEY = `${BRAND.storagePrefix}palette`;

export const paletteFor = (gender?: Gender | null): Palette => (gender === 'male' ? 'blue' : 'pink');

export const applyPalette = (palette: Palette) => {
  const root = document.documentElement;
  if (palette === 'blue') root.dataset.palette = 'blue';
  else delete root.dataset.palette;
  try {
    if (palette === 'blue') localStorage.setItem(KEY, palette);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the palette still applies for this visit.
  }
};

// The last palette, applied before the session is restored so a returning man
// doesn't see a pink flash first.
export const restorePalette = () => {
  try {
    if (localStorage.getItem(KEY) === 'blue') document.documentElement.dataset.palette = 'blue';
  } catch {
    // ignore
  }
};
