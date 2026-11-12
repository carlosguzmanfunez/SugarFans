// Profile photo and cover photo: the picture is shrunk in the browser before it is
// uploaded (a phone photo can be 10 MB; a cover needs ~1600 px, an avatar 1024 px).
export type ProfileImageKind = 'avatar' | 'cover';

const MAX_INPUT_MB = 20;
// Sharp when the photo is opened full size, not only in the small circle.
const AVATAR_PX = 1024;

// Errors are translation keys (LanguageContext); screens show them with t().
export const PHOTO_UNREADABLE = 'photo.unreadable';
export const PHOTO_CANT_OPEN = 'photo.cantOpen';

// Phones don't always say what a file is: an edited photo can arrive with no type,
// as "application/octet-stream" or with the wrong one. The bytes decide (sniffImage).
const IMAGE_NAME = /\.(jpe?g|jfif|png|webp|gif|hei[cf]|avif|bmp)$/i;
export const looksLikePhoto = (file: File) =>
  file.type.startsWith('image/') ||
  IMAGE_NAME.test(file.name) ||
  ((file.type === '' || file.type === 'application/octet-stream') && !/\.[a-z0-9]{2,5}$/i.test(file.name));

// What the photo pickers accept. On Android, Chrome opens the system Photo Picker
// when only images are allowed, and that picker hands over photos edited in the
// gallery (Samsung "Remasterizar") with stale file details: Chrome then refuses to
// read them ("Tu teléfono no nos dejó abrir esa foto"). Adding one non-image type
// makes Chrome open the regular chooser (Galería, Archivos...), which hands over the
// real file. The bytes still decide what it is (sniffImage), so other files are refused.
export const PHOTO_ACCEPT =
  typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
    ? 'image/*,application/octet-stream'
    : 'image/*';

export const checkProfileImage = (file: File): string | null => {
  if (!looksLikePhoto(file)) return 'Elige una foto (JPG, PNG o WebP)';
  if (file.size > MAX_INPUT_MB * 1024 * 1024) return `La foto es demasiado grande (máximo ${MAX_INPUT_MB} MB)`;
  return null;
};

// What the file really is, from its first bytes (not from its name or the type the
// phone reported).
export const sniffImage = (head: Uint8Array): string | null => {
  const at = (i: number, ...b: number[]) => b.every((v, k) => head[i + k] === v);
  const ascii = (i: number, n: number) => String.fromCharCode(...head.subarray(i, i + n));
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (ascii(0, 3) === 'GIF') return 'image/gif';
  if (ascii(0, 2) === 'BM') return 'image/bmp';
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (/^avi[fs]$/.test(brand)) return 'image/avif';
    if (/^(hei[cmsx]|hev[cmsx]|mif1|msf1)$/.test(brand)) return 'image/heic';
  }
  return null;
};

// A photo straight from the phone's gallery: the bytes, labelled with what they
// really are. Reading can fail once right after the gallery saved an edited photo;
// a second try usually works.
const readPhoto = async (file: File): Promise<Blob> => {
  let bytes: ArrayBuffer | null = null;
  for (let attempt = 0; attempt < 3 && !bytes; attempt++) {
    try {
      bytes = await file.arrayBuffer();
    } catch {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  if (!bytes || !bytes.byteLength) throw new Error(PHOTO_CANT_OPEN);
  const type = sniffImage(new Uint8Array(bytes, 0, Math.min(32, bytes.byteLength))) ?? (file.type || 'image/jpeg');
  return new Blob([bytes], { type });
};

const decode = (blob: Blob, keepUrl: boolean) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      if (!keepUrl) URL.revokeObjectURL(url);
      if (img.naturalWidth && img.naturalHeight) resolve(img);
      else reject(new Error(PHOTO_UNREADABLE));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(PHOTO_UNREADABLE));
    };
    img.src = url;
  });

// iPhone and many Android phones save photos as HEIC/HEIF, which Chrome and other
// browsers can't open. Those are turned into JPEG first, in the browser.
const heicToJpeg = async (file: Blob): Promise<Blob> => {
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  return Array.isArray(out) ? out[0] : out;
};

// JPEGs edited on the phone (Samsung "Remasterizar", filters, other editors) carry the
// maker's own blocks and extra data after the picture. Some browsers give up on those.
// Keeps the picture, its orientation (EXIF) and its colours (ICC); drops the rest.
export const cleanJpeg = (bytes: Uint8Array): Uint8Array<ArrayBuffer> | null => {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xda) {
      // Picture data runs to the end marker (FF D9); anything after it is extra.
      let end = bytes.length - 2;
      while (end > i && !(bytes[end] === 0xff && bytes[end + 1] === 0xd9)) end--;
      if (end <= i) return null;
      parts.push(bytes.subarray(i, end + 2));
      break;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) return null;
    const app = marker >= 0xe0 && marker <= 0xef;
    const keep = !app || marker === 0xe0 || marker === 0xe1 || marker === 0xe2;
    if (keep) parts.push(bytes.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// Last way in: the browser's other decoder, at most 4096 px (a phone with little free
// memory can't open a 50-megapixel photo full size; a cover needs 1600 px).
const BITMAP_MAX_PX = 4096;
const viaBitmap = async (blob: Blob, keepUrl: boolean): Promise<HTMLImageElement> => {
  if (typeof createImageBitmap !== 'function') throw new Error(PHOTO_UNREADABLE);
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(PHOTO_UNREADABLE);
  }
  const scale = Math.min(1, BITMAP_MAX_PX / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(PHOTO_UNREADABLE);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const jpeg = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
  if (!jpeg) throw new Error(PHOTO_UNREADABLE);
  return decode(jpeg, keepUrl);
};

// keepUrl: the adjust screen still shows the picture, it frees the link when it closes.
// Tries, in order: the photo as it is, HEIC converted to JPEG, the JPEG without the
// editor's extra blocks, and the browser's other decoder. One working is enough.
export const loadImage = async (file: File, keepUrl = false): Promise<HTMLImageElement> => {
  const blob = await readPhoto(file);
  const tries: Array<() => Promise<HTMLImageElement>> = [() => decode(blob, keepUrl)];
  if (blob.type === 'image/heic' || /\.hei[cf]$/i.test(file.name)) {
    tries.push(async () => decode(await heicToJpeg(blob), keepUrl));
  }
  if (blob.type === 'image/jpeg') {
    tries.push(async () => {
      const clean = cleanJpeg(new Uint8Array(await blob.arrayBuffer()));
      if (!clean) throw new Error(PHOTO_UNREADABLE);
      return decode(new Blob([clean], { type: 'image/jpeg' }), keepUrl);
    });
  }
  tries.push(() => viaBitmap(blob, keepUrl));
  for (const attempt of tries) {
    try {
      return await attempt();
    } catch (err) {
      console.warn('[foto] no se pudo abrir de esta forma', err);
    }
  }
  throw new Error(PHOTO_UNREADABLE);
};

// Avatar chosen by hand in the adjust screen: the square (in the photo's own pixels)
// the person framed, saved at up to 1024 px.
export const cropAvatar = (img: HTMLImageElement, sx: number, sy: number, side: number): Promise<Blob> => {
  const out = Math.max(1, Math.round(Math.min(AVATAR_PX, side)));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = out;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('No pudimos preparar la foto'));
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out, out);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No pudimos preparar la foto'))), 'image/jpeg', 0.86)
  );
};

// Cover: saved 2:1, the shape phones show; computers show its middle band at
// COVER_DESKTOP_RATIO (like Facebook, one photo fits both).
export const COVER_RATIO = 2;
export const COVER_DESKTOP_RATIO = 2.7;

// Cover like Facebook's: the WHOLE photo is saved, plus the band the person chose.
// The profile and the cards show only that band; opening the cover shows the whole
// photo. The band travels in the file name ("cover-<time>-f<x>-<y>-<w>-<h>-<W>-<H>.jpg",
// pixels of the saved photo), so it needs no database column and survives moderation.
export interface CoverFrame { x: number; y: number; w: number; h: number; W: number; H: number }
const COVER_FULL_PX = 1920;
const FRAME_RE = /[-#]f(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)(?:\.jpe?g)?(?:[?#].*)?$/i;

export const coverFrameTag = (f: CoverFrame) => `f${f.x}-${f.y}-${f.w}-${f.h}-${f.W}-${f.H}`;

export const parseCoverFrame = (src?: string | null): CoverFrame | null => {
  const m = src ? FRAME_RE.exec(src.length > 300 ? src.slice(-120) : src) : null;
  if (!m) return null;
  const [x, y, w, h, W, H] = m.slice(1).map(Number);
  if (!w || !h || !W || !H || x + w > W + 1 || y + h > H + 1) return null;
  return { x, y, w, h, W, H };
};

export const prepareCover = async (
  img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number
): Promise<{ blob: Blob; frame: CoverFrame }> => {
  const scale = Math.min(1, COVER_FULL_PX / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * scale));
  const H = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No pudimos preparar la foto');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, W, H);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('No pudimos preparar la foto');
  const x = Math.max(0, Math.min(W - 1, Math.round(sx * scale)));
  const y = Math.max(0, Math.min(H - 1, Math.round(sy * scale)));
  const w = Math.max(1, Math.min(W - x, Math.round(sw * scale)));
  const h = Math.max(1, Math.min(H - y, Math.round(sh * scale)));
  return { blob, frame: { x, y, w, h, W, H } };
};

export const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
