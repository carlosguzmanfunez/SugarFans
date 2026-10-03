import { categoryFor } from './reserve';
// JS-side design tokens. Colours used from CSS live in src/index.css (@theme);
// this file holds the values components compute with: creator cover styles and
// category accents.

export type CoverStyle = 'aurora' | 'prism' | 'orbit' | 'dune' | 'grid' | 'noir';

export interface CoverPalette {
  base: string; // darkest tone, the backdrop
  a: string; // main light
  b: string; // secondary light
  c: string; // highlight
}

// Six cover families x palettes give every creator a distinct, on-brand header
// until they upload a photo. The layout is the same with a real photo on top.
export const COVER_STYLES: CoverStyle[] = ['aurora', 'prism', 'orbit', 'dune', 'grid', 'noir'];

export const COVER_PALETTES: CoverPalette[] = [
  { base: '#2a0f2b', a: '#e5337a', b: '#8259f3', c: '#ffc6dc' }, // magenta / iris
  { base: '#14102e', a: '#6d3ce6', b: '#22b8cf', c: '#c0b0ff' }, // iris / teal
  { base: '#2b1408', a: '#e3a93a', b: '#e5337a', c: '#f9eccb' }, // gold / magenta
  { base: '#0b1f1c', a: '#14b8a6', b: '#a3e635', c: '#ccfbf1' }, // teal / lime
  { base: '#1d0b1a', a: '#f7639b', b: '#f59e0b', c: '#ffe3ee' }, // coral / amber
  { base: '#0d1424', a: '#3b82f6', b: '#8259f3', c: '#dbeafe' }, // blue / iris
  { base: '#160d1f', a: '#9f84fb', b: '#e3a93a', c: '#ece8ff' }, // night / gold
];

// Stable small hash so the same creator always gets the same cover.
export const hashSeed = (seed: string) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export interface CategoryVisual {
  icon: string; // Font Awesome solid icon
  blurb: string;
  tint: string; // soft background
  ink: string; // icon colour
}

// Presentation of the creator categories comes from the category config; older
// stored names ("Modelaje", "Arte") resolve to their current category.
export const categoryVisual = (name: string): CategoryVisual => {
  const { icon, blurb, tint, ink } = categoryFor(name);
  return { icon, blurb, tint, ink };
};
