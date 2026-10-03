// Vercel function: hands out a LiveKit token for a creator's free Live.
// The creator who owns the open Live may publish camera and microphone;
// everyone else who is signed in may only watch. Needs LIVEKIT_URL,
// LIVEKIT_API_KEY and LIVEKIT_API_SECRET in the Vercel project settings.
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

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

// A value pasted with spaces, a newline or quotes around it breaks the signature.
const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, '').trim() || undefined;
const livekitEnv = () => ({
  LIVEKIT_URL: clean(process.env.LIVEKIT_URL),
  LIVEKIT_API_KEY: clean(process.env.LIVEKIT_API_KEY),
  LIVEKIT_API_SECRET: clean(process.env.LIVEKIT_API_SECRET),
});

// GET /api/live-token: checks the LiveKit settings without revealing them
// (only the server host, the key's first and last letters and the lengths) and asks
// LiveKit whether it accepts the key and secret.
export async function GET(): Promise<Response> {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = livekitEnv();
  const checks = {
    url: LIVEKIT_URL ? LIVEKIT_URL.replace(/^(\w+:\/\/[^/]+).*$/, '$1') : 'FALTA',
    urlOk: !!LIVEKIT_URL && /^wss?:\/\/|^https?:\/\//.test(LIVEKIT_URL),
    // The key id isn't secret on its own; its ending lets you match it in LiveKit's key list.
    key: LIVEKIT_API_KEY ? `${LIVEKIT_API_KEY.slice(0, 3)}…${LIVEKIT_API_KEY.slice(-4)} (${LIVEKIT_API_KEY.length} caracteres)` : 'FALTA',
    keyOk: !!LIVEKIT_API_KEY && LIVEKIT_API_KEY.startsWith('API'),
    secret: LIVEKIT_API_SECRET ? `${LIVEKIT_API_SECRET.length} caracteres` : 'FALTA',
    secretOk: !!LIVEKIT_API_SECRET && LIVEKIT_API_SECRET.length >= 30 && LIVEKIT_API_SECRET !== LIVEKIT_API_KEY,
    livekit: 'sin comprobar',
  };
  if (LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET) {
    try {
      await new RoomServiceClient(LIVEKIT_URL.replace(/^ws/, 'http'), LIVEKIT_API_KEY, LIVEKIT_API_SECRET).listRooms();
      checks.livekit = 'OK: LiveKit acepta la clave y el secreto';
    } catch (err) {
      const reason = (err instanceof Error ? err.message : String(err)).replace(/eyJ[\w.-]+/g, '').replace(/[:,\s]+$/, '');
      checks.livekit = `RECHAZADO: ${reason}`.slice(0, 200);
    }
  }
  return json(200, checks);
}

export async function POST(request: Request): Promise<Response> {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = livekitEnv();
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
