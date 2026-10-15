// Automatic moderation of uploads (migration 20261013000001_media_moderation.sql
// and api/moderate.ts). After uploading, the file is queued with submit_media()
// and scanned; the database keeps it hidden from everyone else until approved.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModerationStatus } from './socialTypes';

export type { ModerationStatus };
export type ModerationKind = 'post' | 'perk_video' | 'avatar' | 'cover';

export const REJECTED_MESSAGE =
  'Este archivo no cumple las normas de contenido de Fans Reserve (desnudez o contenido sexual), así que no se publicó.';
export const inReviewNotice = (what: string) => `${what} está en revisión: los demás lo verán en cuanto se apruebe.`;

export const moderateUpload = async (
  sb: SupabaseClient,
  bucket: 'post-media' | 'profile-images',
  path: string,
  kind: ModerationKind,
  mediaType: 'image' | 'video',
  publicUrl = ''
): Promise<ModerationStatus> => {
  const { data, error } = await sb.rpc('submit_media', {
    p_bucket: bucket,
    p_path: path,
    p_kind: kind,
    p_media_type: mediaType,
    p_public_url: publicUrl,
  });
  // Until the migration is applied there is no queue: uploads work as before.
  if (error?.code === 'PGRST202') return 'approved';
  if (error) return 'pending';
  if (data && data !== 'pending') return data as ModerationStatus;
  try {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/moderate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token ?? ''}` },
      body: JSON.stringify({ bucket, path }),
    });
    const out = (await r.json().catch(() => ({}))) as { status?: ModerationStatus };
    return r.ok && out.status ? out.status : 'pending';
  } catch {
    // No scan (local dev, network): an admin reviews it.
    return 'pending';
  }
};

// Status of the viewer's own files (row security returns only theirs, or all for admins).
export const moderationOf = async (sb: SupabaseClient, bucket: string, paths: string[]): Promise<Map<string, ModerationStatus>> => {
  const out = new Map<string, ModerationStatus>();
  if (!paths.length) return out;
  const { data } = await sb.from('media_moderation').select('path, status').eq('bucket', bucket).in('path', paths);
  for (const r of data ?? []) out.set(r.path as string, r.status as ModerationStatus);
  return out;
};
