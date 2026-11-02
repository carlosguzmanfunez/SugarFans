// Vercel function: "Conecta tu TikTok" with TikTok Login Kit for Web. A creator
// proves the TikTok account is theirs and Fans Reserve saves its public numbers
// (username, name, followers, likes, videos) with social_connection_save()
// (supabase/migrations/20261102000001_prospects_growth.sql). The TikTok token is
// used once and revoked right away: nothing that opens their TikTok is stored.
// - GET /api/tiktok: whether it is set up (OK/FALTA), without secrets.
// - POST /api/tiktok {action: 'start', back} with the user's session: returns the
//   TikTok address to go to. The state is signed and tied to this browser with a
//   short-lived cookie, so nobody can attach their TikTok to someone else's account.
// - GET /api/tiktok?code=…&state=… is where TikTok sends the user back (the
//   redirect URI registered in the TikTok app): checks the state, asks TikTok who it
//   is, saves it and returns to the page they came from with ?tiktok=ok (or an error).
//
// Needs in the Vercel project settings: TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET
// (TikTok for Developers → the app → Credentials) and SUPABASE_SERVICE_ROLE_KEY.
// Register in the app's Login Kit as redirect URI: https://fansreserve.com/api/tiktok
// (and the Preview address + /api/tiktok to test there).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://odugxvqwuvewsvifwmwb.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_vuRosXd_owmQ4KeeExEAPQ_d32g6WEL';
const AUTH_URL = process.env.TIKTOK_AUTH_URL || 'https://www.tiktok.com/v2/auth/authorize/';
const API = process.env.TIKTOK_API_BASE || 'https://open.tiktokapis.com';
const COOKIE = 'fr_tiktok';
const TTL = 15 * 60; // seconds to finish on TikTok
const SCOPES = ['user.info.basic', 'user.info.profile', 'user.info.stats'];

const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, '').trim() || undefined;
const env = () => ({
  key: clean(process.env.TIKTOK_CLIENT_KEY),
  secret: clean(process.env.TIKTOK_CLIENT_SECRET),
  serviceKey: clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
});
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
const asServer = (key: string): Record<string, string> => (key.startsWith('eyJ') ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key });

// Only a path of this site, so the redirect can't send anyone elsewhere.
const safeBack = (v: unknown) => (typeof v === 'string' && /^\/(?!\/)[A-Za-z0-9/_-]{0,80}$/.test(v) ? v : '/settings');
const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('base64url');
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

type State = { u: string; b: string; n: string; x: number };
const readState = (raw: string | null, secret: string): State | null => {
  const [body, mac] = (raw ?? '').split('.');
  if (!body || !mac || !same(sign(body, secret), mac)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as State;
    return s.x > Date.now() / 1000 ? s : null;
  } catch {
    return null;
  }
};
const cookie = (request: Request, name: string) =>
  (request.headers.get('cookie') ?? '').split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
const redirectUri = (request: Request) => `${new URL(request.url).origin}/api/tiktok`;
const back = (request: Request, path: string, result: string) =>
  new Response(null, { status: 302, headers: { location: `${new URL(request.url).origin}${path}?tiktok=${result}`, 'cache-control': 'no-store', 'set-cookie': `${COOKIE}=; Path=/api/tiktok; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } });

const signedInUser = async (authorization: string): Promise<string | 'expired' | null> => {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization }, signal: AbortSignal.timeout(8000) });
  if (r.status === 401 || r.status === 403) return 'expired';
  if (!r.ok) throw Error('auth unavailable');
  return ((await r.json()) as { id?: string }).id ?? null;
};

export async function POST(request: Request): Promise<Response> {
  const e = env();
  if (!e.key || !e.secret) return json(503, { error: 'Conectar TikTok todavía no está disponible.' });
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer [^\s]+$/.test(authorization)) return json(401, { error: 'Inicia sesión para conectar tu TikTok.' });
  let body: { action?: unknown; back?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Solicitud no válida.' });
  }
  if (body.action !== 'start') return json(400, { error: 'Solicitud no válida.' });
  let user: string | 'expired' | null;
  try {
    user = await signedInUser(authorization);
  } catch {
    return json(503, { error: 'No pudimos confirmar tu sesión. Intenta de nuevo.' });
  }
  if (!user || user === 'expired') return json(401, { error: 'Tu sesión venció. Vuelve a iniciar sesión.' });

  const nonce = randomBytes(16).toString('base64url');
  const payload = b64(JSON.stringify({ u: user, b: safeBack(body.back), n: nonce, x: Math.floor(Date.now() / 1000) + TTL } satisfies State));
  const state = `${payload}.${sign(payload, e.secret)}`;
  const url = `${AUTH_URL}?${new URLSearchParams({ client_key: e.key, response_type: 'code', scope: SCOPES.join(','), redirect_uri: redirectUri(request), state })}`;
  return json(200, { url }, { 'set-cookie': `${COOKIE}=${nonce}; Path=/api/tiktok; Max-Age=${TTL}; HttpOnly; Secure; SameSite=Lax` });
}

type TikTokUser = {
  open_id?: string; username?: string; display_name?: string; avatar_url?: string; is_verified?: boolean;
  follower_count?: number; likes_count?: number; video_count?: number;
};

export async function GET(request: Request): Promise<Response> {
  const e = env();
  const q = new URL(request.url).searchParams;
  if (!q.has('state')) {
    return json(200, {
      enabled: !!(e.key && e.secret && e.serviceKey),
      checks: { clientKey: e.key ? 'OK' : 'FALTA', clientSecret: e.secret ? 'OK' : 'FALTA', serviceRoleKey: e.serviceKey ? 'OK' : 'FALTA' },
    });
  }
  if (!e.key || !e.secret || !e.serviceKey) return back(request, '/settings', 'no-disponible');
  const state = readState(q.get('state'), e.secret);
  if (!state) return back(request, '/settings', 'vencido');
  const nonce = cookie(request, COOKIE);
  if (!nonce || !same(nonce, state.n)) return back(request, state.b, 'vencido');
  if (q.get('error') || !q.get('code')) return back(request, state.b, 'cancelado');

  try {
    const token = await fetch(`${API}/v2/oauth/token/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: e.key, client_secret: e.secret, code: q.get('code')!, grant_type: 'authorization_code', redirect_uri: redirectUri(request) }),
      signal: AbortSignal.timeout(10000),
    }).then((r) => r.json() as Promise<{ access_token?: string; scope?: string; error?: string }>);
    if (!token.access_token) return back(request, state.b, 'error');

    // Ask only for what they agreed to share.
    const granted = (token.scope ?? q.get('scopes') ?? '').split(',');
    const fields = ['open_id', 'display_name', 'avatar_url',
      ...(granted.includes('user.info.profile') ? ['username', 'is_verified'] : []),
      ...(granted.includes('user.info.stats') ? ['follower_count', 'likes_count', 'video_count'] : [])];
    const info = await fetch(`${API}/v2/user/info/?fields=${fields.join(',')}`, {
      headers: { authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10000),
    }).then((r) => r.json() as Promise<{ data?: { user?: TikTokUser }; error?: { code?: string } }>);
    // The token is not needed any more.
    void fetch(`${API}/v2/oauth/revoke/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: e.key, client_secret: e.secret, token: token.access_token }),
    }).catch(() => {});
    const u = info.data?.user;
    if (!u?.open_id || (info.error?.code && info.error.code !== 'ok')) return back(request, state.b, 'error');

    const saved = await fetch(`${SUPABASE_URL}/rest/v1/rpc/social_connection_save`, {
      method: 'POST',
      headers: { ...asServer(e.serviceKey), 'content-type': 'application/json' },
      body: JSON.stringify({
        p_user: state.u, p_network: 'tiktok', p_external_id: u.open_id, p_username: u.username ?? null, p_display_name: u.display_name ?? null,
        p_avatar_url: u.avatar_url ?? null, p_followers: u.follower_count ?? null, p_likes: u.likes_count ?? null, p_videos: u.video_count ?? null,
        p_verified: !!u.is_verified,
      }),
      signal: AbortSignal.timeout(10000),
    });
    return back(request, state.b, saved.ok && (await saved.json()) === true ? 'ok' : 'error');
  } catch {
    return back(request, state.b, 'error');
  }
}
