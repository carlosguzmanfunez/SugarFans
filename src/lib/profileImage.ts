// Profile photo and cover photo: the picture is shrunk in the browser before it is
// uploaded (a phone photo can be 10 MB; a cover needs ~1600 px, an avatar 512 px).
export type ProfileImageKind = 'avatar' | 'cover';

const MAX_INPUT_MB = 20;
export const checkProfileImage = (file: File): string | null => {
  if (!file.type.startsWith('image/')) return 'Elige una foto (JPG, PNG o WebP)';
  if (file.size > MAX_INPUT_MB * 1024 * 1024) return `La foto es demasiado grande (máximo ${MAX_INPUT_MB} MB)`;
  return null;
};

const loadImage = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No pudimos leer esa foto. Prueba con otra (JPG o PNG).'));
    };
    img.src = url;
  });

// Avatar: centred square, 512 px. Cover: up to 1600 px wide, any proportion
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
    dw = dh = Math.min(512, side);
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

export const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
