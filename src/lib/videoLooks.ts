// Camera looks (filters) applied to the creator's or fan's own camera before it is
// published to LiveKit, so the other side receives the picture already filtered.
// The pixel work lives in lookProcessor.ts; this file holds the catalogue, the
// per-look settings and the remembered choice.

export type LookId = 'natural' | 'soft' | 'retouch' | 'pure' | 'vivid' | 'warm' | 'studio' | 'blur';

export interface LookInfo {
  id: LookId;
  name: string;
  hint: string;
  icon: string;
}

export const LOOKS: LookInfo[] = [
  { id: 'natural', name: 'Natural', hint: 'Sin filtro', icon: 'fa-circle' },
  { id: 'soft', name: 'Soft', hint: 'Suavizado ligero', icon: 'fa-feather' },
  { id: 'retouch', name: 'Retouch', hint: 'Piel lisa y luminosa', icon: 'fa-star' },
  { id: 'pure', name: 'Pure', hint: 'Piel pulida y definida', icon: 'fa-gem' },
  { id: 'vivid', name: 'Vivid', hint: 'Colores intensos', icon: 'fa-bolt' },
  { id: 'warm', name: 'Warm', hint: 'Tono cálido', icon: 'fa-sun' },
  { id: 'studio', name: 'Studio', hint: 'Luz de estudio', icon: 'fa-lightbulb' },
  { id: 'blur', name: 'Background Blur', hint: 'Fondo desenfocado', icon: 'fa-user' },
];

/** Shader settings. 1 = unchanged for multipliers, 0 = unchanged for offsets. */
export interface LookParams {
  smooth: number; // skin smoothing strength 0..1
  exposure: number; // brightness multiplier
  contrast: number; // around mid grey
  saturation: number;
  warmth: number; // + warmer, - cooler
  lift: number; // brightens shadows
  blur: boolean; // background blur (needs person segmentation)
  reach: number; // smoothing radius multiplier
  glow: number; // soft glow from the smoothed picture 0..1
  blush: number; // rosy tint on skin 0..1
  rose: number; // pink tint over the whole picture 0..1
}

const NEUTRAL: LookParams = { smooth: 0, exposure: 1, contrast: 1, saturation: 1, warmth: 0, lift: 0, blur: false, reach: 1, glow: 0, blush: 0, rose: 0 };

const BASE: Record<LookId, LookParams> = {
  natural: NEUTRAL,
  soft: { ...NEUTRAL, smooth: 0.55, exposure: 1.02, contrast: 0.96, lift: 0.02, warmth: 0.01 },
  // Beauty-lens style: strong, wide smoothing on skin, a soft glow and a rosy touch.
  retouch: { ...NEUTRAL, smooth: 0.95, reach: 1.7, glow: 0.18, blush: 0.5, exposure: 1.04, contrast: 0.95, saturation: 1.02, warmth: 0.015, lift: 0.04 },
  // Polished glam: smooth skin but crisper contrast and a warm, neutral tone.
  pure: { ...NEUTRAL, smooth: 0.8, reach: 1.4, glow: 0.08, blush: 0.25, exposure: 1.03, contrast: 1.08, saturation: 0.98, warmth: 0.02, lift: 0.02 },
  // Punchy colour: more saturation and contrast, a light touch of smoothing.
  vivid: { ...NEUTRAL, smooth: 0.2, exposure: 1.02, contrast: 1.14, saturation: 1.35, warmth: 0.02 },
  warm: { ...NEUTRAL, exposure: 1.01, contrast: 0.95, saturation: 1.06, warmth: 0.07, lift: 0.015 },
  studio: { ...NEUTRAL, smooth: 0.15, exposure: 1.07, contrast: 1.06, saturation: 1.05, warmth: 0.015, lift: 0.05 },
  blur: { ...NEUTRAL, blur: true },
};

/** "Mejorar apariencia" adds light smoothing and a little light on top of any look. */
export function lookParams(look: LookId, enhance: boolean): LookParams {
  const p = BASE[look] ?? NEUTRAL;
  if (!enhance) return p;
  return {
    ...p,
    smooth: Math.max(p.smooth, Math.min(0.8, Math.max(p.smooth, 0.25) + 0.25)),
    exposure: p.exposure * 1.03,
    lift: p.lift + 0.03,
    saturation: p.saturation * 1.03,
    warmth: p.warmth + 0.01,
  };
}

/** Natural without "Mejorar apariencia" needs no processing at all. */
export const needsProcessing = (look: LookId, enhance: boolean) => look !== 'natural' || enhance;

const KEY = 'fr.cameraLook';

export function savedLook(): { look: LookId; enhance: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}') as { look?: string; enhance?: boolean };
    const look = LOOKS.some((l) => l.id === v.look) ? (v.look as LookId) : 'natural';
    return { look, enhance: v.enhance === true };
  } catch {
    return { look: 'natural', enhance: false };
  }
}

export function saveLook(look: LookId, enhance: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ look, enhance }));
  } catch {
    // private mode or blocked storage: the choice just isn't remembered
  }
}

let webgl: boolean | null = null;

/** Filters need WebGL and canvas capture; without them the camera stays Natural. */
export function looksSupported(): boolean {
  if (webgl !== null) return webgl;
  try {
    const c = document.createElement('canvas');
    webgl = !!c.getContext('webgl') && typeof c.captureStream === 'function';
  } catch {
    webgl = false;
  }
  return webgl;
}

/** Phones and small laptops get a 720p filtered picture to save battery. */
export function isLightDevice(): boolean {
  const cores = navigator.hardwareConcurrency || 4;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse || cores <= 4;
}
