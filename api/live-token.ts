// Vercel function: hands out a LiveKit token for a creator's free Live.
// The creator who owns the open Live may publish camera and microphone;
// everyone else who is signed in may only watch. Needs LIVEKIT_URL,
// LIVEKIT_API_KEY and LIVEKIT_API_SECRET in the Vercel project settings.
import { AccessToken } from 'livekit-server-sdk';

// Public values (same as .env.production); the anon key is meant to be public.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://odugxvqwuvewsvifwmwb.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_vuRosXd_owmQ4KeeExEAPQ_d32g6WEL';
const LIVE_MAX_HOURS = 4;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const rest = async (path: string, token: string) => {
  const r = await fetch(`${SUPABASE_URL}${path}`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
};

export async function POST(request: Request): Promise<Response> {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return json(503, { error: 'El video del Live aún no está configurado.' });
  }

  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Inicia sesión para ver el Live.' });
  const body = (await request.json().catch(() => ({}))) as { creatorProfileId?: unknown };
  const creatorProfileId = typeof body.creatorProfileId === 'string' ? body.creatorProfileId.slice(0, 64) : '';
  if (!creatorProfileId) return json(400, { error: 'Falta el creator.' });

  // Who is asking (the Supabase session token is checked by Supabase itself).
  const authUser = await rest('/auth/v1/user', token);
  if (!authUser?.id) return json(401, { error: 'Tu sesión caducó. Vuelve a iniciar sesión.' });
  const [profile] = ((await rest(`/rest/v1/profiles?id=eq.${authUser.id}&select=name,creator_profile_id`, token)) ?? []) as Array<{
    name?: string;
    creator_profile_id?: string | null;
  }>;

  const since = new Date(Date.now() - LIVE_MAX_HOURS * 3600_000).toISOString();
  const [live] = ((await rest(
    `/rest/v1/live_broadcasts?creator_profile_id=eq.${encodeURIComponent(creatorProfileId)}&ended_at=is.null&started_at=gt.${encodeURIComponent(since)}&select=id,title`,
    token
  )) ?? []) as Array<{ id: string; title: string }>;
  if (!live) return json(404, { error: 'Este creator no está en Live ahora.' });

  const isHost = profile?.creator_profile_id === creatorProfileId;
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: authUser.id,
    name: profile?.name || 'Fan',
    ttl: '4h',
  });
  at.addGrant({ room: `live-${live.id}`, roomJoin: true, canPublish: isHost, canPublishData: true, canSubscribe: true });
  return json(200, { url: LIVEKIT_URL, token: await at.toJwt(), host: isHost, title: live.title });
}
