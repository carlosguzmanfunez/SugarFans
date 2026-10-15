// Profile photo and cover photo: the picture is shrunk in the browser before it is
// uploaded (a phone photo can be 10 MB; a cover needs ~1600 px, an avatar 1024 px).
export type ProfileImageKind = 'avatar' | 'cover';

const MAX_INPUT_MB = 20;
// Sharp when the photo is opened full size, not only in the small circle.
const AVATAR_PX = 1024;
export const checkProfileImage = (file: File): string | null => {
  if (!file.type.startsWith('image/') && !/\.hei[cf]$/i.test(file.name)) return 'Elige una foto (JPG, PNG o WebP)';
  if (file.size > MAX_INPUT_MB * 1024 * 1024) return `La foto es demasiado grande (máximo ${MAX_INPUT_MB} MB)`;
  return null;
};

const UNREADABLE = 'No pudimos leer esa foto. Prueba con otra (JPG o PNG).';

// iPhone and many Android phones save photos as HEIC/HEIF, which Chrome and other
// browsers can't open. Those are turned into JPEG first, in the browser.
const isHeic = (file: Blob & { name?: string }) =>
  /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name ?? '');

const decode = (blob: Blob, keepUrl: boolean) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      if (!keepUrl) URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(UNREADABLE));
    };
    img.src = url;
  });

const heicToJpeg = async (file: Blob): Promise<Blob> => {
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  return Array.isArray(out) ? out[0] : out;
};

// keepUrl: the adjust screen still shows the picture, it frees the link when it closes.
export const loadImage = async (file: File, keepUrl = false): Promise<HTMLImageElement> => {
  try {
    return await decode(file, keepUrl);
  } catch (err) {
    // Safari opens HEIC itself; elsewhere convert it and try again.
    if (!isHeic(file)) throw err;
    let jpeg: Blob;
    try {
      jpeg = await heicToJpeg(file);
    } catch {
      throw new Error(UNREADABLE);
    }
    return decode(jpeg, keepUrl);
  }
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
const COVER_PX = 1600;

// Cover chosen by hand in the adjust screen: the frame (in the photo's own pixels),
// saved at up to 1600 × 800.
export const cropCover = (img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number): Promise<Blob> => {
  const outW = Math.max(1, Math.round(Math.min(COVER_PX, sw)));
  const outH = Math.max(1, Math.round(outW / COVER_RATIO));
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('No pudimos preparar la foto'));
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No pudimos preparar la foto'))), 'image/jpeg', 0.86)
  );
};

export const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
