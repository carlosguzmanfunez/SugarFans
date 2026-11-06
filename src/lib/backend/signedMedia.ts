// Short-lived links for post photos and videos (Carlos, 2026-11-06: subscriber
// content must not be shareable). Storage only signs files this viewer may see
// (locked posts need a subscription, see 20261103000002_content_security.sql);
// a copied link stops working within minutes. Photos last 20 minutes; videos an
// hour so a long video doesn't stop mid-play. Links still far from expiring are
// reused, so refreshing the feed doesn't reload images or restart a video.
import type { SupabaseClient } from '@supabase/supabase-js';

export const PHOTO_URL_TTL = 20 * 60;
export const VIDEO_URL_TTL = 60 * 60;
// A link with less than this left is signed again on the next refresh.
export const REUSE_MARGIN = 12 * 60;
// How often a page that shows posts asks for fresh links (shorter than the margin).
export const MEDIA_REFRESH_MS = 10 * 60 * 1000;

const cache = new Map<string, { url: string; expires: number }>();

export async function signPostMedia(
  sb: SupabaseClient,
  bucket: string,
  items: { path: string; video?: boolean }[],
  now = Date.now()
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!items.length) return out;
  // Per signed-in person: a link signed for one account is never handed to another.
  const { data } = await sb.auth.getSession();
  const who = data.session?.user.id ?? 'anon';
  const key = (path: string) => `${who}|${bucket}|${path}`;
  const missing: Record<number, string[]> = { [PHOTO_URL_TTL]: [], [VIDEO_URL_TTL]: [] };
  for (const { path, video } of items) {
    const hit = cache.get(key(path));
    if (hit && hit.expires - now > REUSE_MARGIN * 1000) out.set(path, hit.url);
    else if (!out.has(path)) missing[video ? VIDEO_URL_TTL : PHOTO_URL_TTL].push(path);
  }
  await Promise.all(
    Object.entries(missing).map(async ([ttl, paths]) => {
      const unique = [...new Set(paths)];
      if (!unique.length) return;
      const { data: urls } = await sb.storage.from(bucket).createSignedUrls(unique, Number(ttl));
      for (const u of urls ?? []) {
        if (!u.path || !u.signedUrl || u.error) continue;
        out.set(u.path, u.signedUrl);
        cache.set(key(u.path), { url: u.signedUrl, expires: now + Number(ttl) * 1000 });
      }
    })
  );
  return out;
}
