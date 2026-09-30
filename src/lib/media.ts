// Rules for the photos and videos creators attach to posts.
import type { MediaType } from './backend/socialTypes';

export const MAX_IMAGE_MB = 10;
export const MAX_VIDEO_MB = 50; // Supabase free plan: 50 MB per file
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

export const mediaTypeOf = (file: File): MediaType | null =>
  IMAGE_TYPES.includes(file.type) ? 'image' : VIDEO_TYPES.includes(file.type) ? 'video' : null;

export const validateMedia = (file: File): { type?: MediaType; error?: string } => {
  const type = mediaTypeOf(file);
  if (!type) return { error: 'Formato no permitido. Usa JPG, PNG, WEBP, GIF, MP4, WEBM o MOV.' };
  const maxMb = type === 'image' ? MAX_IMAGE_MB : MAX_VIDEO_MB;
  if (file.size > maxMb * 1024 * 1024) {
    return { error: `${type === 'image' ? 'La foto' : 'El video'} supera el máximo de ${maxMb} MB` };
  }
  return { type };
};

export const extensionOf = (file: File) => EXT[file.type] ?? 'bin';
