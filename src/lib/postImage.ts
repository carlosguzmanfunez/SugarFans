// Photos in posts are shrunk in the browser before they are uploaded, like the
// profile photo and the cover. A phone photo is 3-10 MB (4000 px); on screen, even
// full size and zoomed, 1920 px looks the same and weighs ~10 times less. Every fan
// who opens the post downloads it, so this is what keeps the storage traffic bill low.
// It also drops the photo's hidden data (EXIF), including the GPS location.
import { loadImage } from './profileImage';

export const POST_IMAGE_PX = 1920;
export const POST_IMAGE_QUALITY = 0.82;
// Already this light and this small: upload it as it is (re-saving would only lose quality).
const KEEP_BYTES = 500 * 1024;

const encode = (canvas: HTMLCanvasElement) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', POST_IMAGE_QUALITY));

const jpegName = (name: string) => `${name.replace(/\.[^.]*$/, '') || 'foto'}.jpg`;

/** Returns the photo to upload: smaller when it helps, the original otherwise. */
export const shrinkPostImage = async (file: File): Promise<File> => {
  // GIFs can be animated; a canvas would keep only the first frame.
  if (file.type === 'image/gif') return file;
  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return file;
  }
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return file;
  const longSide = Math.max(w, h);
  if (longSide <= POST_IMAGE_PX && file.size <= KEEP_BYTES) return file;

  const scale = Math.min(1, POST_IMAGE_PX / longSide);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  // JPEG has no transparency: transparent parts of a PNG become white, not black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await encode(canvas);
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: Date.now() });
};
