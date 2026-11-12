// fansreserve.com/sitemap.xml. Served by api/usage.ts (vercel.json rewrites
// /sitemap.xml to /api/usage?sitemap=1): the Hobby plan allows 12 functions per
// deployment and they are all in use, so this shares a bundle like reserve-session
// shares live-token.
// The public pages plus the profile of every verified creator, so Google and AI
// search can find each creator's page: fansreserve.com/@usuario (their name in the
// address) once they chose one, /creator/<id> until then. Reads the same public list
// Explorar shows (public.public_creators, open to anyone); unverified creators,
// suspended accounts and the demo profiles stay out. If Supabase doesn't answer,
// the sitemap still lists the public pages.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://odugxvqwuvewsvifwmwb.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_vuRosXd_owmQ4KeeExEAPQ_d32g6WEL';
const SITE = 'https://fansreserve.com';

export const STATIC_PAGES: { path: string; changefreq: string; priority: string }[] = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/explore', changefreq: 'daily', priority: '0.9' },
  { path: '/reserve', changefreq: 'daily', priority: '0.9' },
  { path: '/recorrido', changefreq: 'monthly', priority: '0.7' },
  { path: '/help', changefreq: 'monthly', priority: '0.5' },
  { path: '/legal', changefreq: 'monthly', priority: '0.3' },
];

type CreatorRow = { id?: unknown; is_verified?: unknown; created_at?: unknown };

const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string);

const USERNAME = /^[a-z0-9_]{3,30}$/;

export const sitemapXml = (creators: CreatorRow[], usernames: Record<string, string> = {}) => {
  const urls = STATIC_PAGES.map(
    (p) => `  <url>\n    <loc>${SITE}${p.path}</loc>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`,
  );
  const seen = new Set<string>();
  for (const c of creators) {
    const id = typeof c.id === 'string' ? c.id.trim() : '';
    if (!id || c.is_verified !== true || seen.has(id)) continue;
    seen.add(id);
    const updated = typeof c.created_at === 'string' && !Number.isNaN(Date.parse(c.created_at)) ? new Date(c.created_at).toISOString().slice(0, 10) : '';
    const handle = usernames[id];
    const path = handle && USERNAME.test(handle) ? `/@${handle}` : `/creator/${escapeXml(encodeURIComponent(id))}`;
    urls.push(
      `  <url>\n    <loc>${SITE}${path}</loc>\n${updated ? `    <lastmod>${updated}</lastmod>\n` : ''}    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
};

const rpc = async (name: string): Promise<unknown[]> => {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return [];
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
};

// creator profile id → @usuario (public.creator_usernames, open to anyone).
const creatorUsernames = async (): Promise<Record<string, string>> => {
  const map: Record<string, string> = {};
  for (const row of (await rpc('creator_usernames')) as { id?: unknown; username?: unknown }[]) {
    if (typeof row?.id === 'string' && typeof row.username === 'string') map[row.id.trim()] = row.username.trim().toLowerCase();
  }
  return map;
};

export async function sitemapResponse(): Promise<Response> {
  const [creators, usernames] = await Promise.all([rpc('public_creators') as Promise<CreatorRow[]>, creatorUsernames()]);
  return new Response(sitemapXml(creators, usernames), {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      // Shared caches keep it an hour; new creators show up within that time.
      'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
