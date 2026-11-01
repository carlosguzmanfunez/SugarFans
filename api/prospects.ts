// Vercel function: public numbers of professional Instagram accounts for the admin's
// "Captar creadores" tab, through the official Instagram Graph API ("Business
// Discovery"). Nothing is scraped: Meta answers only for business and creator
// accounts, with what they show publicly (name, bio, website, followers, posts and
// the likes and comments of their latest posts). The browser saves the result with
// prospects_import() (supabase/migrations/20261101000001_creator_prospects.sql).
// - GET /api/prospects: whether it is set up (OK/FALTA), without secrets.
// - POST /api/prospects {handles: string[]} with the admin's session: up to 25
//   usernames per call. Meta allows about 200 calls per hour for one account.
//
// Needs in the Vercel project settings: INSTAGRAM_BUSINESS_ID (the id of Fans
// Reserve's own professional Instagram account) and INSTAGRAM_ACCESS_TOKEN (a
// long-lived token of the Meta app with instagram_basic, instagram_manage_insights,
// pages_show_list, pages_read_engagement, business_management and ads_read; it
// lasts 60 days). Optional: INSTAGRAM_GRAPH_VERSION.
import type { InstagramLookup } from '../src/lib/backend/prospectTypes.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://odugxvqwuvewsvifwmwb.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_vuRosXd_owmQ4KeeExEAPQ_d32g6WEL';
const GRAPH = process.env.INSTAGRAM_GRAPH_BASE || 'https://graph.facebook.com';
const MAX_HANDLES = 25;
const HANDLE = /^[a-z0-9._]{1,30}$/;
// Same as emailIn() in src/lib/prospects.ts (not imported: it pulls the country list).
const emailIn = (text?: string) => text?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

// A value pasted with spaces, a newline or quotes around it breaks the request.
const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, '').trim() || undefined;
const env = () => ({
  igId: clean(process.env.INSTAGRAM_BUSINESS_ID),
  token: clean(process.env.INSTAGRAM_ACCESS_TOKEN),
  version: clean(process.env.INSTAGRAM_GRAPH_VERSION) ?? 'v26.0',
});

export async function GET(): Promise<Response> {
  const e = env();
  return json(200, {
    enabled: !!(e.igId && e.token),
    checks: { instagram: e.igId && e.token ? 'OK' : 'FALTA', businessId: e.igId ? 'OK' : 'FALTA', accessToken: e.token ? 'OK' : 'FALTA' },
  });
}

const isAdmin = async (authorization: string) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, authorization, 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(8000),
  });
  if (r.status === 401 || r.status === 403) return 'expired';
  if (!r.ok) throw Error('auth unavailable');
  return (await r.json()) === true ? 'admin' : 'denied';
};

interface Media { timestamp?: string; like_count?: number; comments_count?: number }
interface Discovery {
  username?: string; name?: string; biography?: string; website?: string;
  followers_count?: number; media_count?: number; media?: { data?: Media[] };
}

// Average likes and comments of the latest posts over followers, in %.
export const engagementOf = (followers: number | undefined, media: Media[]) => {
  const counted = media.filter((m) => typeof m.like_count === 'number');
  if (!followers || !counted.length) return undefined;
  const avg = counted.reduce((s, m) => s + (m.like_count ?? 0) + (m.comments_count ?? 0), 0) / counted.length;
  return Math.round((avg / followers) * 10000) / 100;
};

export const toLookup = (handle: string, d: Discovery): InstagramLookup => {
  const media = d.media?.data ?? [];
  const last = media.map((m) => m.timestamp).filter((t): t is string => !!t).sort().pop();
  return {
    handle, ok: true,
    data: {
      display_name: d.name?.slice(0, 120) || undefined,
      followers: d.followers_count,
      posts: d.media_count,
      engagement: engagementOf(d.followers_count, media),
      last_post_at: last,
      email: emailIn(d.biography),
      bio: d.biography?.slice(0, 600) || undefined,
      website: d.website?.slice(0, 300) || undefined,
    },
  };
};

type Fatal = { fatal: string };

const lookup = async (handle: string, e: ReturnType<typeof env>): Promise<InstagramLookup | Fatal> => {
  const fields = `business_discovery.username(${handle}){username,name,biography,website,followers_count,media_count,media.limit(12){timestamp,like_count,comments_count}}`;
  const url = `${GRAPH}/${e.version}/${encodeURIComponent(e.igId!)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(e.token!)}`;
  let r: Response;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  } catch {
    return { handle, ok: false, note: 'Instagram no respondió a tiempo' };
  }
  const body = (await r.json().catch(() => ({}))) as { business_discovery?: Discovery; error?: { code?: number; error_subcode?: number } };
  if (r.ok && body.business_discovery) return toLookup(handle, body.business_discovery);
  const code = body.error?.code;
  if (code === 190) return { fatal: 'El permiso de Instagram venció. Genera un token nuevo en Meta y cámbialo en Vercel (INSTAGRAM_ACCESS_TOKEN).' };
  if (code === 4 || code === 17 || code === 32 || code === 613) return { fatal: 'Instagram pide esperar: se llegó al límite de consultas por hora. Sigue en un rato.' };
  if (code === 10 || code === 200) return { fatal: 'La app de Meta no tiene permiso para consultar perfiles. Revisa los permisos del token.' };
  return { handle, ok: false, note: 'Cuenta personal, privada o que no existe' };
};

export async function POST(request: Request): Promise<Response> {
  const e = env();
  if (!e.igId || !e.token) return json(503, { error: 'Falta conectar la API de Instagram (INSTAGRAM_BUSINESS_ID e INSTAGRAM_ACCESS_TOKEN en Vercel).' });
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer [^\s]+$/.test(authorization)) return json(401, { error: 'Inicia sesión con tu cuenta administrativa.' });
  try {
    const who = await isAdmin(authorization);
    if (who === 'expired') return json(401, { error: 'Tu sesión venció. Vuelve a iniciar sesión.' });
    if (who !== 'admin') return json(403, { error: 'Solo un administrador puede hacer esto.' });
  } catch {
    return json(503, { error: 'No pudimos confirmar tu sesión. Intenta de nuevo.' });
  }

  let body: { handles?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Solicitud no válida.' });
  }
  const handles = Array.isArray(body.handles)
    ? [...new Set(body.handles.filter((h): h is string => typeof h === 'string').map((h) => h.trim().replace(/^@/, '').toLowerCase()))]
    : [];
  if (!handles.length || handles.length > MAX_HANDLES) return json(400, { error: `Envía entre 1 y ${MAX_HANDLES} usuarios.` });

  const results: InstagramLookup[] = [];
  // Five at a time keeps the call fast without bursting Meta's limit.
  for (let i = 0; i < handles.length; i += 5) {
    const batch = await Promise.all(handles.slice(i, i + 5).map((h) =>
      HANDLE.test(h) ? lookup(h, e) : Promise.resolve<InstagramLookup>({ handle: h, ok: false, note: 'No es un usuario de Instagram válido' })));
    const fatal = batch.find((b): b is Fatal => 'fatal' in b);
    results.push(...batch.filter((b): b is InstagramLookup => !('fatal' in b)));
    if (fatal) return json(results.length ? 207 : 502, { error: fatal.fatal, results });
  }
  return json(200, { results });
}
