// Post videos play from Bunny Stream when they have a copy there (api/_bunny.ts):
// cheaper per GB and converted to several qualities. The server only signs a Bunny
// link for videos Storage already lets this viewer see; links last an hour and are
// reused like the Supabase ones (signedMedia.ts). A video without a copy yet keeps
// its Supabase link, and the browser asks once for the copy to be made.
import type { SupabaseClient } from '@supabase/supabase-js';
import { REUSE_MARGIN } from './signedMedia';

const LINK_TTL = 60 * 60;
// When Bunny isn't set up, don't ask again for a while.
const OFF_FOR_MS = 10 * 60 * 1000;
const cache = new Map<string, { url: string; expires: number }>();
const asked = new Set<string>();
let offUntil = 0;

export const isBunnyEmbed = (url: string | undefined) => !!url && url.startsWith('https://player.mediadelivery.net/embed/');

export async function bunnyVideoLinks(sb: SupabaseClient, paths: string[], now = Date.now()): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(paths)];
  if (!unique.length || now < offUntil) return out;
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token ?? '';
  const who = data.session?.user.id ?? 'anon';
  const key = (path: string) => `${who}|${path}`;
  const missing: string[] = [];
  for (const path of unique) {
    const hit = cache.get(key(path));
    if (hit && hit.expires - now > REUSE_MARGIN * 1000) out.set(path, hit.url);
    else missing.push(path);
  }
  if (!missing.length) return out;
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  try {
    const r = await fetch('/api/moderate', { method: 'POST', headers, body: JSON.stringify({ action: 'video-access', paths: missing }) });
    const res = (await r.json().catch(() => ({}))) as { enabled?: boolean; urls?: Record<string, string>; pending?: string[] };
    if (!r.ok) return out;
    if (res.enabled === false) {
      offUntil = now + OFF_FOR_MS;
      return out;
    }
    for (const [path, url] of Object.entries(res.urls ?? {})) {
      if (!isBunnyEmbed(url)) continue;
      out.set(path, url);
      cache.set(key(path), { url, expires: now + LINK_TTL * 1000 });
    }
    // Not copied yet: ask once per page load (the copy runs on the server; nobody waits).
    if (token) {
      for (const path of res.pending ?? []) {
        if (asked.has(path)) continue;
        asked.add(path);
        void fetch('/api/moderate', { method: 'POST', headers, body: JSON.stringify({ action: 'video-ingest', path }), keepalive: true }).catch(() => undefined);
      }
    }
  } catch {
    // No connection to our server: Supabase links keep working.
  }
  return out;
}

/** The creator deleted a video: remove its Bunny copy too (nothing happens if there was none). */
export async function forgetBunnyVideo(sb: SupabaseClient, path: string) {
  const token = (await sb.auth.getSession()).data.session?.access_token;
  if (!token) return;
  for (const k of [...cache.keys()]) if (k.endsWith(`|${path}`)) cache.delete(k);
  await fetch('/api/moderate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'video-forget', path }),
  }).catch(() => undefined);
}
