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

// Avatar: centred square, 1024 px. Cover: up to 1600 px wide, any proportion
// (the profile shows it cropped like Facebook does).
export const prepareProfileImage = async (file: File, kind: ProfileImageKind): Promise<Blob> => {
  const img = await loadImage(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  let sx = 0, sy = 0, sw = w, sh = h, dw: number, dh: number;
  if (kind === 'avatar') {
    const side = Math.min(w, h);
    sx = (w - side) / 2;
    sy = (h - side) / 2;
    sw = sh = side;
    dw = dh = Math.min(AVATAR_PX, side);
  } else {
    const scale = Math.min(1, 1600 / w);
    dw = Math.round(w * scale);
    dh = Math.round(h * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No pudimos preparar la foto');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No pudimos preparar la foto'))), 'image/jpeg', 0.86)
  );
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

export const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
