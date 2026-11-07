// Vercel function: fansreserve.com/sitemap.xml (vercel.json rewrites it here).
// The public pages plus the profile of every verified creator, so Google and AI
// search can find each creator's page (/creator/<id>). Reads the same public list
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

export const sitemapXml = (creators: CreatorRow[]) => {
  const urls = STATIC_PAGES.map(
    (p) => `  <url>\n    <loc>${SITE}${p.path}</loc>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`,
  );
  const seen = new Set<string>();
  for (const c of creators) {
    const id = typeof c.id === 'string' ? c.id.trim() : '';
    if (!id || c.is_verified !== true || seen.has(id)) continue;
    seen.add(id);
    const updated = typeof c.created_at === 'string' && !Number.isNaN(Date.parse(c.created_at)) ? new Date(c.created_at).toISOString().slice(0, 10) : '';
    urls.push(
      `  <url>\n    <loc>${SITE}/creator/${escapeXml(encodeURIComponent(id))}</loc>\n${updated ? `    <lastmod>${updated}</lastmod>\n` : ''}    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
};

const publicCreators = async (): Promise<CreatorRow[]> => {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/public_creators`, {
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

export async function GET(): Promise<Response> {
  return new Response(sitemapXml(await publicCreators()), {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      // Shared caches keep it an hour; new creators show up within that time.
      'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
