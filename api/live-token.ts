// Vercel function: hands out LiveKit tokens after deciding who may enter
// (rules in src/lib/liveAccess.ts, the same ones the app shows):
// - A creator's Live ({ creatorProfileId }), from live_broadcasts:
//   · Subscriber Live: the creator publishes; only fans with an active subscription watch.
//   · Open Live: anyone signed in watches. Off unless ENABLE_OPEN_LIVE=true (src/config/features.ts).
// - A Reserve booking ({ bookingId }), confirmed and on its day:
//   · Reserve Event seat: everyone with a seat meets in the event's room; the creator presents.
//   · Reserve 1:1: only the booking's fan and creator get in, and both publish.
// Gifts never grant access, and a subscription never grants a Reserve.
// Needs LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in the Vercel project settings.
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
// Node runs this file as an ES module, so the relative import needs its .js extension.
import { decideBooking, decideBroadcast, type BookingRow, type Decision } from '../src/lib/liveAccess.js';

// Public values (same as .env.production); the anon key is meant to be public.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://odugxvqwuvewsvifwmwb.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_vuRosXd_owmQ4KeeExEAPQ_d32g6WEL';
const LIVE_MAX_HOURS = 4;
// Open Live stays off unless the project turns it back on (src/config/features.ts).
const openLiveEnabled = () => process.env.ENABLE_OPEN_LIVE === 'true';

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
  const body = (await request.json().catch(() => ({}))) as { creatorProfileId?: unknown; bookingId?: unknown };
  const bookingId = typeof body.bookingId === 'string' ? body.bookingId.slice(0, 64) : '';
  const creatorProfileId = typeof body.creatorProfileId === 'string' ? body.creatorProfileId.slice(0, 64) : '';
  if (!creatorProfileId && !bookingId) return json(400, { error: 'Falta el creator.' });

  // Who is asking (the Supabase session token is checked by Supabase itself).
  const authUser = await rest('/auth/v1/user', token);
  if (!authUser?.id) return json(401, { error: 'Tu sesión caducó. Vuelve a iniciar sesión.' });
  const [profile] = ((await rest(`/rest/v1/profiles?id=eq.${authUser.id}&select=name,creator_profile_id`, token)) ?? []) as Array<{
    name?: string;
    creator_profile_id?: string | null;
  }>;
  const sign = async (room: string, canPublish: boolean, ttl: string) => {
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: authUser.id, name: profile?.name || 'Fan', ttl });
    at.addGrant({ room, roomJoin: true, canPublish, canPublishData: true, canSubscribe: true });
    return at.toJwt();
  };
  const answer = async (d: Decision, extra: Record<string, unknown> = {}) =>
    d.ok
      ? json(200, { url: LIVEKIT_URL, token: await sign(d.room, d.canPublish, '4h'), host: d.host, mode: d.mode, ...extra })
      : json(d.status, { error: d.error });

  if (bookingId) {
    // Row security only shows a booking to its fan and its creator.
    const [b] = ((await rest(
      `/rest/v1/vip_bookings?id=eq.${encodeURIComponent(bookingId)}&select=id,experience_id,status,date,time,duration_minutes,fan_id,creator_profile_id,details`,
      token
    )) ?? []) as BookingRow[];
    return answer(decideBooking({ booking: b ?? null, userId: authUser.id, myCreatorProfileId: profile?.creator_profile_id }));
  }

  const since = new Date(Date.now() - LIVE_MAX_HOURS * 3600_000).toISOString();
  // select=* so the request still works before the `mode` column exists (rows without it are open Lives).
  const [live] = ((await rest(
    `/rest/v1/live_broadcasts?creator_profile_id=eq.${encodeURIComponent(creatorProfileId)}&ended_at=is.null&started_at=gt.${encodeURIComponent(since)}&select=*`,
    token
  )) ?? []) as Array<{ id: string; title: string; mode?: string | null }>;
  const isOwner = !!live && profile?.creator_profile_id === creatorProfileId;
  // Row security only shows the fan their own subscriptions.
  const [subscription] = live && !isOwner
    ? (((await rest(
        `/rest/v1/subscriptions?fan_id=eq.${authUser.id}&creator_id=eq.${encodeURIComponent(creatorProfileId)}&select=cancel_at`,
        token
      )) ?? []) as Array<{ cancel_at: string | null }>)
    : [];
  return answer(decideBroadcast({ live: live ?? null, isOwner, subscription: subscription ?? null, openLiveEnabled: openLiveEnabled() }), {
    title: live?.title,
  });
}
